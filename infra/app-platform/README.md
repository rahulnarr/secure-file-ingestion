# Alternative deployment: App Platform + Spaces

The [Droplet deployment](../README.md) is one valid choice; this is the
other one. **App Platform** is fully managed — DigitalOcean builds the
container from this repo, runs it, restarts it on crashes, and can scale the
instance count up automatically as traffic grows, none of which the Droplet
setup does on its own. The tradeoff is that App Platform's filesystem is
ephemeral, so it only works if file blobs live somewhere durable and
reachable from any instance: **DO Spaces** (S3-compatible object storage),
via `SpacesBlobStorage` (`src/infrastructure/storage/spaces-blob-storage.ts`).

Nothing else about the service changes. Same code, same Postgres schema,
same API — `STORAGE_BACKEND=spaces` swaps the blob backend at startup via
`container.ts`; see [`docs/architecture.md`](../../docs/architecture.md) for
the Droplet vs. App Platform tradeoffs this is built on.

| File | Purpose |
|---|---|
| `provision-spaces-bucket.sh` | Creates the Spaces bucket and an access key scoped to only that bucket |
| `provision-app.sh` | Renders `app.yaml` with real secrets and creates/updates the App Platform app via `doctl` |
| `app.yaml` | The App Platform spec — build/run commands, health check, env vars |

## One-time setup

### 1. Create the Spaces bucket and a scoped access key

```bash
export DIGITALOCEAN_ACCESS_TOKEN=dop_v1_...
./infra/app-platform/provision-spaces-bucket.sh
```

Spaces access keys aren't shown twice — save the output. The key this
creates can only read/write the one bucket it was scoped to, not your whole
Spaces account.

### 2. Deploy the app

Reuse the **same** Managed PostgreSQL cluster the Droplet deployment uses
(the API layer is portable across deployment targets; only the storage
backend differs) — or point at a different cluster if you want them fully
isolated:

```bash
export SPACES_ENDPOINT=https://nyc3.digitaloceanspaces.com
export SPACES_REGION=nyc3
export SPACES_BUCKET=signed-file-api-blobs
export SPACES_ACCESS_KEY_ID=...       # from step 1
export SPACES_SECRET_ACCESS_KEY=...   # from step 1
export DATABASE_URL=postgresql://...  # from infra/provision.sh's output
export DATABASE_SSL_CA_BASE64=...     # ditto
./infra/app-platform/provision-app.sh
```

This renders `app.yaml` with the real values (never committed), creates or
updates the app, waits for the deployment, and adds the app as a trusted
source on the database's firewall — the same mechanism used for the
Droplet, just with `app:<id>` instead of `droplet:<id>`.

### 3. Verify

```bash
doctl apps get <app-id> --format DefaultIngress --no-header
curl https://<app-url>/health
```

## CI/CD

App Platform has its own git-push deploy built in (`deploy_on_push: true`
in `app.yaml`) — a push to `main` rebuilds and redeploys automatically,
with no separate GitHub Actions workflow needed for *this* target. The
Droplet's `deploy.yml` pipeline (test → verify-droplet → verify-database →
deploy) keeps running independently; the two deployments don't interfere
with each other, and both read from the same `main` branch.

## Why this isn't just the default

The Droplet path stays the primary, documented default because it needs no
external object storage account and matches the exercise's "accept a file
... store it in a non-public directory on the local file system" framing
most directly. App Platform + Spaces is the better choice once horizontal
scaling actually matters — see "Scalability & future architecture" in
`docs/architecture.md`.
