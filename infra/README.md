# Deploying to DigitalOcean

This service is designed to run on a single **Droplet** with a **Managed
PostgreSQL** cluster (see [`docs/architecture.md`](../docs/architecture.md)
for why: file blobs need a persistent local disk, which App Platform's
ephemeral filesystem doesn't provide). This directory has everything needed
to stand that up and keep it updated via CI/CD.

| File | Purpose |
|---|---|
| `provision.sh` | One-time: creates the SSH key, Managed Postgres cluster, Droplet, and firewall via `doctl` |
| `setup-server.sh` | One-time: run over SSH on the fresh Droplet — installs Node, Caddy, clones the repo, installs the systemd unit |
| `signed-file-api.service` | systemd unit the app runs under (installed by `setup-server.sh`) |
| `Caddyfile` | Reverse proxy in front of the app; upgrade to free automatic HTTPS by swapping `:80` for your domain |

`.github/workflows/deploy.yml` handles every deploy after that, as four
dependent jobs — each one only runs if the previous one succeeded, and each
is its own visible step in the Actions UI:

1. **`test`** — the full CI suite (`ci.yml`): typecheck, unit tests with an
   80% coverage gate, and integration tests against a real Postgres
   container (with its own explicit connectivity check).
2. **`verify-droplet`** — confirms the Droplet's SSH port is actually
   reachable before anything tries to deploy to it.
3. **`verify-database`** — SSHes into the Droplet and runs `psql ... select
   1` to confirm the app can actually reach Managed Postgres. This has to
   happen *from* the Droplet, not the GitHub runner, because the database
   firewall only allows connections from the Droplet itself.
4. **`deploy`** — uploads the rendered `.env`, then over SSH: `git pull &&
   npm ci && npm run build && systemctl restart`, followed by a health
   check both on the Droplet and through the public `BASE_URL`.

## One-time setup

### 1. Provision the infrastructure

```bash
export DIGITALOCEAN_ACCESS_TOKEN=dop_v1_...   # DO Control Panel > API > Generate New Token
./infra/provision.sh
```

This prints the Droplet's IP, a deploy SSH key, and the database connection
string. Keep the terminal output — you'll need all three next.

### 2. Bootstrap the Droplet

```bash
DROPLET_IP=<from step 1>
SSH_KEY=~/.ssh/signed_file_api_deploy   # written by provision.sh

scp -i "$SSH_KEY" infra/setup-server.sh root@"$DROPLET_IP":/root/
ssh -i "$SSH_KEY" root@"$DROPLET_IP" \
  "REPO_URL=https://github.com/<you>/<repo>.git bash /root/setup-server.sh"
```

### 3. Add GitHub Actions secrets

In the repo's **Settings > Secrets and variables > Actions**, add:

| Secret | Value |
|---|---|
| `DROPLET_HOST` | The Droplet's public IP from step 1 |
| `DROPLET_SSH_KEY` | Contents of the **private** key file from step 1 (`cat ~/.ssh/signed_file_api_deploy`) |
| `DATABASE_URL` | The Managed Postgres connection URI from step 1 |
| `DATABASE_SSL_CA_BASE64` | The cluster's CA certificate (base64), also printed by `provision.sh` — the app verifies this rather than trusting any TLS cert (`src/infrastructure/database/pool.ts`) |
| `SIGNING_SECRET` | `openssl rand -hex 32` |
| `BASE_URL` | `http://<droplet-ip>` (or `https://<your-domain>` once DNS + Caddy are pointed at it) |

Also create a **`production` environment** (Settings > Environments) so the
deploy job in `deploy.yml` can optionally require manual approval before
running — recommended once this is more than a demo.

### 4. Deploy

```bash
git push origin main
```

`deploy.yml` runs the test suite, then deploys automatically. Watch it under
the repo's **Actions** tab. Subsequent pushes to `main` redeploy the same
way — there's nothing else to run by hand.

## Upgrading to HTTPS with a real domain

1. Point an A record at the Droplet's IP.
2. Edit `infra/Caddyfile`, replacing `:80` with the domain.
3. `scp` the updated file to `/etc/caddy/Caddyfile` on the Droplet (or just
   redeploy — a future improvement would have CI sync this file too) and run
   `systemctl reload caddy`. Caddy obtains and renews the certificate
   automatically from then on.
4. Update the `BASE_URL` secret to `https://<domain>` — this is the base
   every signed download URL is minted against, so it must match exactly.

## Rotating the signing secret

Changing `SIGNING_SECRET` invalidates every outstanding signed link
immediately (they're HMAC-derived from it) — the same tradeoff described in
[`docs/architecture.md`](../docs/architecture.md#why-postgres-instead-of-only-stateless-hmac-verification).
Prefer revoking individual links (`POST /files/:fileId/links/:linkId/revoke`)
over rotating the secret unless every outstanding link needs to die at once.
