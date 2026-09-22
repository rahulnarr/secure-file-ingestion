#!/usr/bin/env bash
# Creates a DO Spaces bucket and an access key scoped to only that bucket.
#
# Spaces isn't managed through the DigitalOcean V2 API the way Droplets and
# Databases are — buckets are created via the S3-compatible API, and access
# keys via a separate /v2/spaces/keys endpoint that doctl doesn't wrap.
# This script does both with plain curl + the aws-sdk already in
# node_modules, so it fits the same "one script, idempotent" pattern as
# infra/provision.sh.
#
# Usage: ./infra/app-platform/provision-spaces-bucket.sh
set -euo pipefail

: "${DIGITALOCEAN_ACCESS_TOKEN:?Set DIGITALOCEAN_ACCESS_TOKEN before running this script}"

REGION="${SPACES_REGION:-nyc3}"
BUCKET="${SPACES_BUCKET:-signed-file-api-blobs}"
KEY_NAME="${SPACES_KEY_NAME:-signed-file-api-scoped}"
ENDPOINT="https://${REGION}.digitaloceanspaces.com"

log() { echo "[provision-spaces] $*" >&2; }

api() {
  curl -sf -H "Authorization: Bearer $DIGITALOCEAN_ACCESS_TOKEN" -H "Content-Type: application/json" "$@"
}

log "Looking for an existing Spaces key named '$KEY_NAME'..."
EXISTING_KEY_JSON="$(api "https://api.digitalocean.com/v2/spaces/keys" | jq -c --arg n "$KEY_NAME" '.keys[] | select(.name == $n)')"

if [ -n "$EXISTING_KEY_JSON" ]; then
  log "Key already exists (access_key=$(echo "$EXISTING_KEY_JSON" | jq -r .access_key)); reusing it."
  log "Its secret was only ever shown once at creation — if you don't have it saved, delete the key via the API and re-run this script to get a fresh one."
  ACCESS_KEY_ID="$(echo "$EXISTING_KEY_JSON" | jq -r .access_key)"
  SECRET_ACCESS_KEY=""
else
  log "Creating a Spaces key scoped to read/write on '$BUCKET' only"
  KEY_JSON="$(api -X POST -d "$(jq -n --arg n "$KEY_NAME" --arg b "$BUCKET" \
    '{name: $n, grants: [{bucket: $b, permission: "readwrite"}]}')" \
    "https://api.digitalocean.com/v2/spaces/keys")"
  ACCESS_KEY_ID="$(echo "$KEY_JSON" | jq -r .key.access_key)"
  SECRET_ACCESS_KEY="$(echo "$KEY_JSON" | jq -r .key.secret_key)"
fi

if [ -n "$SECRET_ACCESS_KEY" ]; then
  log "Creating bucket '$BUCKET' in $REGION (idempotent: ignores 'already owned by you')"
  node -e "
    const { S3Client, CreateBucketCommand } = require('@aws-sdk/client-s3');
    const client = new S3Client({
      endpoint: '$ENDPOINT',
      region: '$REGION',
      credentials: { accessKeyId: '$ACCESS_KEY_ID', secretAccessKey: '$SECRET_ACCESS_KEY' },
    });
    client.send(new CreateBucketCommand({ Bucket: '$BUCKET' }))
      .then(() => console.error('[provision-spaces] Bucket created'))
      .catch((e) => {
        if (e.name === 'BucketAlreadyOwnedByYou' || e.name === 'BucketAlreadyExists') {
          console.error('[provision-spaces] Bucket already exists, continuing');
        } else {
          console.error('[provision-spaces] Bucket creation failed:', e.name, e.message);
          process.exit(1);
        }
      });
  "
fi

cat <<SUMMARY

=================================================================
Spaces provisioning complete.

  Endpoint:            $ENDPOINT
  Region:              $REGION
  Bucket:              $BUCKET
  Access key ID:       $ACCESS_KEY_ID
  Secret access key:   ${SECRET_ACCESS_KEY:-"(already existed — not re-shown; re-create the key if you don't have it saved)"}

Set these in your App Platform spec / GitHub secrets:
  STORAGE_BACKEND=spaces
  SPACES_ENDPOINT=$ENDPOINT
  SPACES_REGION=$REGION
  SPACES_BUCKET=$BUCKET
  SPACES_ACCESS_KEY_ID=$ACCESS_KEY_ID
  SPACES_SECRET_ACCESS_KEY=<see above>
=================================================================
SUMMARY
