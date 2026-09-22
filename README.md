# Signed File API

Production-oriented REST service for private file uploads, metadata management, and cryptographically signed temporary download links.

## Features

- **Secure ingestion** — multipart uploads stored under a non-public local directory, keyed to an owner `X-User-Id`
- **Signed URLs** — fileId + TTL are cryptographically combined into an HMAC-SHA256 signature that remains verifiable across process restarts
- **Persisted links** — every generated signature is stored in Postgres (`signed_links`) alongside its TTL and expiry, enabling revocation and querying
- **Revocation** — owners can revoke an active signed link before it naturally expires
- **Public retrieval** — validates signature + expiry (stateless) *and* checks the Postgres record for revocation before serving the blob
- **Metadata & audit** — owners can query file status; link generation, downloads (success/rejected), and revocations are all audited
- **Production basics** — input validation, typed errors, Vitest coverage, GitHub Actions CI

## Architecture

See [docs/architecture.md](docs/architecture.md) for the request lifecycle diagram and the rationale for persisting signed links in Postgres.

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

## Testing

Tests run against a real Postgres database (no mocking), truncating tables between runs.

```bash
docker compose up -d postgres
# create the test DB once:
PGPASSWORD=postgres psql -h 127.0.0.1 -U postgres -c "CREATE DATABASE signed_file_api_test;"

npm test                  # everything
npm run test:unit         # services against in-memory fakes; no database needed
npm run test:integration  # full HTTP stack against real Postgres
npm run typecheck
```

CI (`.github/workflows/ci.yml`) spins up a Postgres service container automatically — no local setup needed there.

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

```
src/
  index.ts                         Bootstrap: config -> DB -> container -> HTTP server
  app.ts                           Mounts module routes, auth middleware, error handlers
  container.ts                     Composition root (dependency wiring)
  config/env.ts                    Env validation (zod)
  common/
    errors/                        HttpError, global error + 404 handlers
    middleware/require-user.ts     X-User-Id authentication
    types/app-env.ts               Typed request context
    validation/                    UUID, batch-size, JSON body parsing helpers
  infrastructure/
    database/                      Pool + idempotent migrations
    storage/                       BlobStorage interface + LocalBlobStorage
    crypto/url-signer.ts           HMAC-SHA256 sign/verify (fileId + TTL)
  modules/
    files/                         upload, batch upload, list, get, update, delete, batch delete
      controllers/  services/  file.repository.ts  file.mapper.ts  file.schemas.ts  file.types.ts
    signed-links/                  create, list, revoke, redeem
      controllers/  services/  signed-link.repository.ts  ...
    downloads/                     public signed-URL download
    audit/                         record + list audit events
    health/                        liveness
tests/
  unit/                            Services + signer with in-memory fakes (tests/unit/fakes.ts)
  integration/                     Full HTTP stack against Postgres
docs/architecture.md               Request lifecycle diagram
```

## Design choices

- **HMAC over opaque tokens, persisted in Postgres** — the signature is a pure function of `(fileId, expiresAt, SIGNING_SECRET)`, so it's always re-verifiable even after a restart with zero server-side session state. It's *also* persisted in `signed_links` so the service can revoke a link on demand and audit every link ever issued — capabilities a pure stateless scheme can't offer.
- **Two-phase download validation** — the public `/download` endpoint first does a cheap in-memory HMAC + expiry check (rejects garbage instantly), then a Postgres lookup only for links that pass crypto validation (confirms provenance + not revoked).
- **Local disk for blobs, Postgres for state** — file bytes stay on local disk (fits a single Droplet with a persistent volume); structured data (metadata, links, audit) lives in Postgres so it can point at a Managed Database in production without code changes.
- **Identity via `X-User-Id`** — keeps the exercise focused on file security; wire real auth (JWT/OIDC) at the edge in a full deployment.
