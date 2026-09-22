# Signed File API

Production-oriented REST service for private file uploads, metadata management, and cryptographically signed temporary download links.

## Features

- **Secure ingestion** — multipart uploads stored under a non-public local directory, keyed to an owner `X-User-Id`
- **Signed URLs** — fileId + TTL are cryptographically combined into an HMAC-SHA256 signature that remains verifiable across process restarts
- **Persisted links** — every generated signature is stored in Postgres (`signed_links`) alongside its TTL and expiry, enabling revocation and querying
- **Revocation** — owners can revoke an active signed link before it naturally expires
- **Public retrieval** — validates signature + expiry (stateless) *and* checks the Postgres record for revocation before serving the blob
- **Metadata & audit** — owners can query file status; link generation, downloads (success/rejected), and revocations are all audited
- **Typed exceptions** — every thrown error derives from a common `AppError` base carrying a machine-readable `code`, HTTP `statusCode`, `isRetryable` flag, structured `context`, and the original low-level cause, for fast incident triage
- **Structured logging** — every request failure is logged (via `pino`) with full error metadata at the HTTP boundary, regardless of which layer it came from
- **Exponential retry with a bounded budget** — transient Postgres and filesystem failures (connection resets, deadlocks, lock contention, `EBUSY`/`EAGAIN`) are retried with exponential backoff + jitter, capped by both an attempt count and a wall-clock time budget, applied uniformly to every repository and to blob storage
- **Metrics** — HTTP request volume/latency and per-layer failure counts, in Prometheus text format at `GET /metrics`; point Prometheus or the Datadog Agent's OpenMetrics check at it with zero code changes
- **API documentation** — every endpoint is described in an OpenAPI 3.0 spec (`GET /openapi.json`) with an interactive explorer at `GET /docs`
- **Production basics** — input validation, typed errors, ≥80% unit test coverage (enforced in CI), GitHub Actions CI/CD

## Architecture

See [docs/architecture.md](docs/architecture.md) for the request lifecycle diagram and the rationale for persisting signed links in Postgres.

## Deployment

Runs on a DigitalOcean Droplet (file blobs need a real persistent disk) with a Managed PostgreSQL cluster, deployed automatically by `.github/workflows/deploy.yml` on every push to `main` — full test suite first, deploy only if it's green. See [infra/README.md](infra/README.md) for the one-time provisioning/setup commands and the GitHub Actions secrets required.

## Quick start

```bash
cp .env.example .env
npm install

# Start Postgres (via Docker) ...
docker compose up -d postgres
# ... or, if Docker isn't available, use a local Postgres install:
#   sudo apt-get install -y postgresql
#   sudo service postgresql start
#   sudo -u postgres psql -c "ALTER USER postgres PASSWORD 'postgres';"
#   sudo -u postgres psql -c "CREATE DATABASE signed_file_api;"

npm run dev
```

Service listens on [http://127.0.0.1:3847](http://127.0.0.1:3847) by default. Tables (`files`, `signed_links`, `audit_events`) are created automatically on startup.

Generate a production signing secret:

```bash
openssl rand -hex 32
```

## API

All owner endpoints require header `X-User-Id`.

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/health` | Liveness |
| `POST` | `/files` | Upload one file, multipart field `file` — accepts a file + user id, generates the file id |
| `POST` | `/files/batch` | Batch upload, multipart field `files` repeated per file (max `MAX_BATCH_SIZE`); per-file failures are isolated |
| `GET` | `/files` | List caller's files |
| `GET` | `/files/:fileId` | File metadata (owner only) |
| `PATCH` | `/files/:fileId` | Update metadata for a file owned by the caller — body `{ "filename": "new-name.pdf" }` |
| `DELETE` | `/files/:fileId` | Delete a file owned by the caller (removes blob + DB row; audit history is preserved) |
| `POST` | `/files/batch-delete` | Batch delete — body `{ "fileIds": ["..."] }`; per-id failures are isolated |
| `POST` | `/files/:fileId/sign` | Body `{ "ttlSeconds": 300 }` → signed URL, persisted in Postgres |
| `GET` | `/files/:fileId/links` | List all signed links generated for a file, with `active`/`revoked` status |
| `POST` | `/files/:fileId/links/:linkId/revoke` | Revoke an active signed link before it expires |
| `GET` | `/files/:fileId/audit` | Full audit trail: generation, downloads, rejections, revocations, renames, deletes (owner only, survives file deletion) |
| `GET` | `/download?fileId=&expires=&sig=` | Public download via signed URL (crypto check + Postgres revocation check) |
| `GET` | `/metrics` | Prometheus text-format metrics — request volume/latency, per-layer error counts, retry counts |
| `GET` | `/docs` | Interactive Swagger UI for the full API |
| `GET` | `/openapi.json` | Raw OpenAPI 3.0 spec backing `/docs` |

All `/files*` endpoints require the `X-User-Id` header. Batch endpoints return `201` when every item succeeds, `207 Multi-Status` when some fail (with per-item `error`/`code` detail so a client can retry just the failures), and never abort the whole batch because one item was bad.

### Example

```bash
# Upload a single file
curl -s -X POST http://127.0.0.1:3847/files \
  -H 'X-User-Id: alice' \
  -F 'file=@./README.md'

# Batch upload
curl -s -X POST http://127.0.0.1:3847/files/batch \
  -H 'X-User-Id: alice' \
  -F 'files=@./a.txt' -F 'files=@./b.txt'

# Rename (replace FILE_ID)
curl -s -X PATCH http://127.0.0.1:3847/files/FILE_ID \
  -H 'X-User-Id: alice' -H 'Content-Type: application/json' \
  -d '{"filename":"renamed.txt"}'

# Delete
curl -s -X DELETE http://127.0.0.1:3847/files/FILE_ID -H 'X-User-Id: alice'

# Batch delete
curl -s -X POST http://127.0.0.1:3847/files/batch-delete \
  -H 'X-User-Id: alice' -H 'Content-Type: application/json' \
  -d '{"fileIds":["FILE_ID_1","FILE_ID_2"]}'

# Sign (replace FILE_ID)
curl -s -X POST http://127.0.0.1:3847/files/FILE_ID/sign \
  -H 'X-User-Id: alice' \
  -H 'Content-Type: application/json' \
  -d '{"ttlSeconds":120}'

# Download using the returned downloadUrl
curl -OJ '<downloadUrl>'
```

## Configuration

| Variable | Default | Purpose |
|----------|---------|---------|
| `PORT` | `3847` | Listen port |
| `HOST` | `0.0.0.0` | Bind address |
| `BASE_URL` | `http://127.0.0.1:3847` | Public base used when minting download URLs |
| `SIGNING_SECRET` | dev default | HMAC secret (≥16 chars); required for restart-safe links |
| `UPLOAD_DIR` | `./data/uploads` | Non-public blob directory (local disk) |
| `DATABASE_URL` | `postgres://postgres:postgres@127.0.0.1:5432/signed_file_api` | Postgres connection string for `files` / `signed_links` / `audit_events` |
| `MAX_UPLOAD_BYTES` | `26214400` | Upload size limit (25 MiB) |
| `MAX_BATCH_SIZE` | `20` | Max files per batch upload / max ids per batch delete |
| `MAX_TTL_SECONDS` | `86400` | Ceiling on the TTL a caller can request when signing a download link |
| `LOG_LEVEL` | `info` | `fatal`\|`error`\|`warn`\|`info`\|`debug`\|`trace`\|`silent` |
| `RETRY_MAX_ATTEMPTS` | `4` | Total attempts (including the first) before giving up on a transient DB/storage failure |
| `RETRY_BASE_DELAY_MS` | `100` | Base delay for exponential backoff between retries |
| `RETRY_MAX_DELAY_MS` | `2000` | Cap on any single backoff delay |
| `RETRY_MAX_ELAPSED_MS` | `10000` | Cap on total wall-clock time spent retrying one operation |

All of the above are validated and typed in `src/config/env.ts` — that file is the single place any environment or otherwise-configurable value should be read from; nothing else in the codebase touches `process.env` directly.

## Testing

Tests run against a real Postgres database (no mocking), truncating tables between runs.

```bash
docker compose up -d postgres
# create the test DB once:
PGPASSWORD=postgres psql -h 127.0.0.1 -U postgres -c "CREATE DATABASE signed_file_api_test;"

npm test                    # everything
npm run test:unit           # services against in-memory fakes; no database needed
npm run test:unit:coverage  # same, plus a coverage report; CI fails below 80% lines/branches/functions/statements
npm run test:integration    # full HTTP stack against real Postgres
npm run typecheck
```

CI (`.github/workflows/ci.yml`) runs two independent jobs on every push/PR:

- **`unit-tests`** — typecheck, unit tests with coverage, uploads the HTML/lcov report as a build artifact. The coverage threshold (80% lines/branches/functions/statements) is scoped to business logic — services, mappers, and infrastructure utilities — not thin HTTP adapters (controllers/routes), which the integration suite covers instead.
- **`integration-tests`** — spins up a Postgres service container, runs an explicit `pg_isready` connectivity check as its own visible step (not just the container's internal healthcheck), then the full HTTP-level test suite.

`.github/workflows/deploy.yml` depends on both (via `workflow_call`) before it deploys — see [infra/README.md](infra/README.md) for the additional Droplet-reachability and Postgres-connectivity checks that run before every production deploy.

## Code structure

The code follows **Controller → Service → Repository** with one class per use case (Single Responsibility), grouped by domain module.

| Layer | Responsibility | Knows about |
|---|---|---|
| **Routes** (`*.routes.ts`) | Map HTTP method + path to a controller | Controllers |
| **Controllers** (`controllers/`) | Parse/validate the HTTP request, call one service, shape the HTTP response | Hono `Context`, schemas, mappers, one service |
| **Services** (`services/`) | One business use case each: rules, ownership, orchestration, audit | Repository/storage **interfaces**, other services |
| **Repositories** (`*.repository.ts`) | SQL for one table, behind an interface | `pg` only |
| **Infrastructure** | Cross-cutting technical concerns: DB pool + migrations, blob storage, URL signing | Node / `pg` |

Services never see HTTP, and controllers never see SQL. `src/container.ts` is the only file that instantiates concrete classes (`PgFileRepository`, `LocalBlobStorage`, and so on) and wires them together. That's why the unit tests can swap in in-memory fakes, and why moving blobs to DigitalOcean Spaces would mean writing one new `BlobStorage` implementation.

### Exceptions, logging, and retries

Every custom exception derives from one common base, **`AppError`** (`src/common/errors/app-error.ts`), which carries a machine-readable `code`, an HTTP `statusCode`, an `isRetryable` flag, structured `context`, and (via native `Error.cause`) the original low-level failure when there is one. Two families of subclass sit on top of it:

- **Domain errors** (`common/errors/domain-errors.ts`): `ValidationError`, `NotFoundError`, `ForbiddenError`, `UnauthorizedError`, `GoneError`, `PayloadTooLargeError` — thrown by services for known, non-retryable business-rule failures ("you don't own this file", "ttlSeconds out of range").
- **Infrastructure errors** (`common/errors/infrastructure-errors.ts`): `DatabaseError`, `StorageError`, `RetryExhaustedError` — thrown only by the resilience layer below, when a raw Postgres/filesystem failure needs wrapping.

The global error handler (`common/errors/error-handler.ts`) is the one place guaranteed to see every failure, from any layer; it logs the full `AppError` (or an unclassified error, tagged as such) via a structured `pino` logger before responding.

Retries are handled by `src/infrastructure/resilience/`, applied at the **repository/storage boundary** — the only place client-to-DB and client-to-filesystem calls actually happen (file creation writes a blob *and* persists a row; every other operation reads/writes Postgres):

- `error-classifiers.ts` — recognizes known-transient Postgres SQLSTATEs (`40001` serialization_failure, `40P01` deadlock_detected, `57P03` cannot_connect_now, ...), network codes (`ECONNRESET`, `ECONNREFUSED`, ...), and fs codes (`EBUSY`, `EAGAIN`, `EMFILE`, ...). Permanent failures (`23505` unique_violation, `ENOENT`, `EACCES`) are deliberately excluded.
- `with-retry.ts` — exponential backoff with jitter, bounded by **both** `RETRY_MAX_ATTEMPTS` and `RETRY_MAX_ELAPSED_MS` — the "limited period" the policy is capped to, whichever limit is hit first.
- `resilient-proxy.ts` (`makeResilient`) — a generic `Proxy` that wraps every method of a repository or `BlobStorage` with the retry policy, purely via composition in `container.ts`. The repository/storage implementations themselves never know retries exist — Single Responsibility stays intact.
- `error-wrappers.ts` — after a final failure, wraps the raw cause into `DatabaseError`/`StorageError` (permanent) or `RetryExhaustedError` (was transient, but the budget ran out), so nothing reaches the error handler unclassified.

```
src/
  index.ts                         Bootstrap: config -> DB -> container -> HTTP server
  app.ts                           Mounts module routes, middleware, error handlers, /docs
  container.ts                     Composition root (dependency wiring, incl. retry + metrics wrapping)
  config/env.ts                    Single source of env + configurable values (zod-validated)
  docs/openapi.ts                  Hand-authored OpenAPI 3.0 document (served at /openapi.json, /docs)
  common/
    errors/                        AppError base, HttpError, domain/infrastructure errors, handlers
    middleware/                    X-User-Id auth, HTTP metrics recording
    types/app-env.ts               Typed request context
    validation/                    UUID, batch-size, JSON body parsing helpers
  infrastructure/
    database/                      Pool + idempotent migrations
    storage/                       BlobStorage interface + LocalBlobStorage
    crypto/url-signer.ts           HMAC-SHA256 sign/verify (fileId + TTL)
    logging/logger.ts              Structured logger (pino)
    metrics/metrics.ts             Prometheus counters/histograms (prom-client)
    resilience/                    Error classifiers, backoff, retrying proxy
  modules/
    files/                         upload, batch upload, list, get, update, delete, batch delete
      controllers/  services/  file.repository.ts  file.mapper.ts  file.schemas.ts  file.types.ts
    signed-links/                  create, list, revoke, redeem
      controllers/  services/  signed-link.repository.ts  ...
    downloads/                     public signed-URL download
    audit/                         record + list audit events
    health/                        liveness
    metrics/                       GET /metrics
tests/
  unit/                            Services + infra with in-memory fakes (tests/unit/fakes.ts); ≥80% coverage
  integration/                     Full HTTP stack against Postgres
vitest.config.ts                   Coverage scope + 80% thresholds
docs/architecture.md               Request lifecycle + scalability diagrams
```

## Design choices

- **HMAC over opaque tokens, persisted in Postgres** — the signature is a pure function of `(fileId, expiresAt, SIGNING_SECRET)`, so it's always re-verifiable even after a restart with zero server-side session state. It's *also* persisted in `signed_links` so the service can revoke a link on demand and audit every link ever issued — capabilities a pure stateless scheme can't offer.
- **Two-phase download validation** — the public `/download` endpoint first does a cheap in-memory HMAC + expiry check (rejects garbage instantly), then a Postgres lookup only for links that pass crypto validation (confirms provenance + not revoked).
- **Local disk for blobs, Postgres for state** — file bytes stay on local disk (fits a single Droplet with a persistent volume); structured data (metadata, links, audit) lives in Postgres so it can point at a Managed Database in production without code changes.
- **Identity via `X-User-Id`** — keeps the exercise focused on file security; wire real auth (JWT/OIDC) at the edge in a full deployment.
- **Prometheus text format for metrics, not a vendor SDK** — `GET /metrics` is scrapeable by Prometheus or the Datadog Agent's Prometheus/OpenMetrics check as-is. Migrating to a hosted metrics backend later is a scrape-config change, not an application code change.
- **Coverage thresholds scoped to logic, not wiring** — the 80% unit-coverage gate (`vitest.config.ts`) covers services, mappers, and infrastructure utilities. Controllers and routes are thin HTTP adapters exercised by the integration suite instead; enforcing a unit-test number on them would reward testing framework glue rather than behavior.
