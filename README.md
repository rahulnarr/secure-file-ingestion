# Signed File API

Production-oriented REST service for private file uploads, metadata management, and cryptographically signed temporary download links.

## Features

- **Secure ingestion** — multipart uploads stored under a non-public local directory, keyed to an owner `X-User-Id`
- **Signed URLs** — HMAC-SHA256 links with TTL that remain valid across process restarts
- **Public retrieval** — validates signature + expiry before serving the blob
- **Metadata & audit** — owners can query file status; every signed-link generation is audited
- **Production basics** — input validation, typed errors, Vitest coverage, GitHub Actions CI

## Architecture

See [docs/architecture.md](docs/architecture.md) for the request lifecycle diagram.

## Quick start

```bash
cp .env.example .env
npm install
npm run dev
```

Service listens on [http://127.0.0.1:3847](http://127.0.0.1:3847) by default.

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
| `POST` | `/files/:fileId/sign` | Body `{ "ttlSeconds": 300 }` → signed URL + audit id |
| `GET` | `/files/:fileId/audit` | Signed-link audit trail (owner only) |
| `GET` | `/download?fileId=&expires=&sig=` | Public download via signed URL |

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
| `UPLOAD_DIR` | `./data/uploads` | Non-public blob directory |
| `DATABASE_PATH` | `./data/files.db` | SQLite metadata + audit store |
| `MAX_UPLOAD_BYTES` | `26214400` | Upload size limit (25 MiB) |

## Testing

```bash
npm test
npm run typecheck
```

## Project layout

```
src/
  app.ts              Hono app + error handling
  index.ts            Server entry
  config.ts           Env validation (zod)
  db/client.ts        SQLite schema
  lib/signing.ts      HMAC create/verify
  routes/             HTTP handlers
  services/files.ts   Upload, ownership, signing, audit
docs/architecture.md  Lifecycle diagram
.github/workflows/ci.yml
```

## Design choices

- **HMAC over opaque tokens** — signed claims need no server-side session store, so links survive restarts as long as `SIGNING_SECRET` is stable.
- **SQLite** — zero-ops local persistence for metadata and audit events; swap for Postgres later without changing the HTTP contract.
- **Identity via `X-User-Id`** — keeps the exercise focused on file security; wire real auth (JWT/OIDC) at the edge in a full deployment.
