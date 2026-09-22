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
| `POST` | `/files` | Upload multipart field `file` |
| `GET` | `/files` | List caller's files |
| `GET` | `/files/:fileId` | File metadata (owner only) |
| `POST` | `/files/:fileId/sign` | Body `{ "ttlSeconds": 300 }` → signed URL, persisted in Postgres |
| `GET` | `/files/:fileId/links` | List all signed links generated for a file, with `active`/`revoked` status |
| `POST` | `/files/:fileId/links/:linkId/revoke` | Revoke an active signed link before it expires |
| `GET` | `/files/:fileId/audit` | Full audit trail: generation, downloads, rejections, revocations (owner only) |
| `GET` | `/download?fileId=&expires=&sig=` | Public download via signed URL (crypto check + Postgres revocation check) |

### Example

```bash
# Upload
curl -s -X POST http://127.0.0.1:3847/files \
  -H 'X-User-Id: alice' \
  -F 'file=@./README.md'

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

## Testing

Tests run against a real Postgres database (no mocking), truncating tables between runs.

```bash
docker compose up -d postgres
# create the test DB once:
PGPASSWORD=postgres psql -h 127.0.0.1 -U postgres -c "CREATE DATABASE signed_file_api_test;"

npm test
npm run typecheck
```

CI (`.github/workflows/ci.yml`) spins up a Postgres service container automatically — no local setup needed there.

## Project layout

```
src/
  app.ts              Hono app + error handling
  index.ts            Server entry
  config.ts           Env validation (zod)
  db/client.ts        Postgres pool + migrations (files, signed_links, audit_events)
  lib/signing.ts      HMAC create/verify (fileId + TTL -> signature)
  routes/             HTTP handlers
  services/files.ts   Upload, ownership, signing, link persistence/revocation, audit
docs/architecture.md  Lifecycle diagram
docker-compose.yml    Local Postgres for dev/test
.github/workflows/ci.yml
```

## Design choices

- **HMAC over opaque tokens, persisted in Postgres** — the signature is a pure function of `(fileId, expiresAt, SIGNING_SECRET)`, so it's always re-verifiable even after a restart with zero server-side session state. It's *also* persisted in `signed_links` so the service can revoke a link on demand and audit every link ever issued — capabilities a pure stateless scheme can't offer.
- **Two-phase download validation** — the public `/download` endpoint first does a cheap in-memory HMAC + expiry check (rejects garbage instantly), then a Postgres lookup only for links that pass crypto validation (confirms provenance + not revoked).
- **Local disk for blobs, Postgres for state** — file bytes stay on local disk (fits a single Droplet with a persistent volume); structured data (metadata, links, audit) lives in Postgres so it can point at a Managed Database in production without code changes.
- **Identity via `X-User-Id`** — keeps the exercise focused on file security; wire real auth (JWT/OIDC) at the edge in a full deployment.
