#!/usr/bin/env bash
# Deploys signed-file-api to DigitalOcean App Platform, using DO Spaces for
# file blobs (App Platform's filesystem is ephemeral) and the SAME Managed
# PostgreSQL cluster the Droplet deployment uses — the API layer is portable
# across deployment targets; only the blob storage backend differs.
#
# Requires infra/app-platform/provision-spaces-bucket.sh to have been run
# first (or SPACES_* env vars already set), and DATABASE_URL /
# DATABASE_SSL_CA_BASE64 from the existing Managed Postgres cluster (see
# infra/provision.sh's output, or `doctl databases connection <id>` /
# `doctl databases get-ca <id>`).
#
# Usage:
#   export DIGITALOCEAN_ACCESS_TOKEN=dop_v1_...
#   export SPACES_ENDPOINT=https://nyc3.digitaloceanspaces.com
#   export SPACES_REGION=nyc3
#   export SPACES_BUCKET=signed-file-api-blobs
#   export SPACES_ACCESS_KEY_ID=...
#   export SPACES_SECRET_ACCESS_KEY=...
#   export DATABASE_URL=postgresql://...
#   export DATABASE_SSL_CA_BASE64=...
#   export SIGNING_SECRET=...        # optional, generated if unset
#   ./infra/app-platform/provision-app.sh
set -euo pipefail

: "${DIGITALOCEAN_ACCESS_TOKEN:?Set DIGITALOCEAN_ACCESS_TOKEN}"
: "${SPACES_ENDPOINT:?Set SPACES_ENDPOINT (run provision-spaces-bucket.sh first)}"
: "${SPACES_REGION:?Set SPACES_REGION}"
: "${SPACES_BUCKET:?Set SPACES_BUCKET}"
: "${SPACES_ACCESS_KEY_ID:?Set SPACES_ACCESS_KEY_ID}"
: "${SPACES_SECRET_ACCESS_KEY:?Set SPACES_SECRET_ACCESS_KEY}"
: "${DATABASE_URL:?Set DATABASE_URL to the Managed Postgres connection string}"
: "${DATABASE_SSL_CA_BASE64:?Set DATABASE_SSL_CA_BASE64 (doctl databases get-ca <id> -o json | jq -r .certificate)}"

SIGNING_SECRET="${SIGNING_SECRET:-$(openssl rand -hex 32)}"
APP_NAME="${APP_NAME:-signed-file-api}"
SPEC_TEMPLATE="$(dirname "$0")/app.yaml"
RENDERED_SPEC="$(mktemp /tmp/app-platform-spec-XXXXXX.yaml)"
trap 'rm -f "$RENDERED_SPEC"' EXIT

log() { echo "[provision-app-platform] $*" >&2; }

log "Rendering app spec with real secret values (not committed anywhere)"
sed \
  -e "s#SPACES_ENDPOINT_PLACEHOLDER#${SPACES_ENDPOINT}#g" \
  -e "s#SPACES_REGION_PLACEHOLDER#${SPACES_REGION}#g" \
  -e "s#SPACES_BUCKET_PLACEHOLDER#${SPACES_BUCKET}#g" \
  -e "s#SPACES_ACCESS_KEY_ID_PLACEHOLDER#${SPACES_ACCESS_KEY_ID}#g" \
  -e "s#SPACES_SECRET_ACCESS_KEY_PLACEHOLDER#${SPACES_SECRET_ACCESS_KEY}#g" \
  -e "s#SIGNING_SECRET_PLACEHOLDER#${SIGNING_SECRET}#g" \
  -e "s#DATABASE_URL_PLACEHOLDER#${DATABASE_URL}#g" \
  -e "s#DATABASE_SSL_CA_BASE64_PLACEHOLDER#${DATABASE_SSL_CA_BASE64}#g" \
  "$SPEC_TEMPLATE" > "$RENDERED_SPEC"

EXISTING_APP_ID="$(doctl apps list --format ID,Spec.Name --no-header | awk -v n="$APP_NAME" '$2==n{print $1; exit}')"

if [ -n "$EXISTING_APP_ID" ]; then
  log "App '$APP_NAME' already exists ($EXISTING_APP_ID) — updating it"
  doctl apps update "$EXISTING_APP_ID" --spec "$RENDERED_SPEC" --wait
  APP_ID="$EXISTING_APP_ID"
else
  log "Creating app '$APP_NAME'"
  APP_ID="$(doctl apps create --spec "$RENDERED_SPEC" --wait --format ID --no-header)"
fi

APP_URL="$(doctl apps get "$APP_ID" --format DefaultIngress --no-header)"
log "App URL: $APP_URL"

# Managed Postgres only accepts connections from resources explicitly
# trusted in its firewall — this grants the App Platform app the same
# access the Droplet already has, without opening the DB to the internet.
DB_NAME="${DB_NAME:-signed-file-api-pg}"
DB_ID="$(doctl databases list --format ID,Name --no-header | awk -v n="$DB_NAME" '$2==n{print $1; exit}')"
if [ -n "$DB_ID" ]; then
  log "Trusting this app ($APP_ID) in the '$DB_NAME' database firewall"
  doctl databases firewalls append "$DB_ID" --rule "app:${APP_ID}"
else
  log "Could not find a database named '$DB_NAME' to update its firewall — set DB_NAME or add 'app:${APP_ID}' as a trusted source manually"
fi

cat <<SUMMARY

=================================================================
App Platform deployment complete.

  App ID:   $APP_ID
  App URL:  $APP_URL

Verify:
  curl $APP_URL/health
=================================================================
SUMMARY
