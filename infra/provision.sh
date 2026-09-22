#!/usr/bin/env bash
# Provisions the DigitalOcean infrastructure for signed-file-api:
#   - an SSH key registered with your DO account (generated locally if needed)
#   - a Managed PostgreSQL cluster
#   - a Droplet running Ubuntu 24.04
#   - a Firewall exposing only SSH/HTTP/HTTPS, restricting the DB to the Droplet
#
# Idempotent: safe to re-run. Requires `doctl` authenticated
# (`doctl auth init` or DIGITALOCEAN_ACCESS_TOKEN in the environment).
#
# Usage: ./infra/provision.sh
# Prints the Droplet's public IP and the database connection string on
# success — feed both into GitHub Actions secrets (see infra/README.md).
set -euo pipefail

: "${DIGITALOCEAN_ACCESS_TOKEN:?Set DIGITALOCEAN_ACCESS_TOKEN (a DO Personal Access Token) before running this script}"

REGION="${DO_REGION:-nyc3}"
DROPLET_NAME="${DROPLET_NAME:-signed-file-api}"
DROPLET_SIZE="${DROPLET_SIZE:-s-1vcpu-1gb}"
DB_NAME="${DB_NAME:-signed-file-api-pg}"
DB_SIZE="${DB_SIZE:-db-s-1vcpu-1gb}"
DB_APP_NAME="${DB_APP_NAME:-signed_file_api}"
FIREWALL_NAME="${FIREWALL_NAME:-signed-file-api-fw}"
SSH_KEY_NAME="${SSH_KEY_NAME:-signed-file-api-deploy}"
SSH_KEY_PATH="${SSH_KEY_PATH:-$HOME/.ssh/signed_file_api_deploy}"

log() { echo "[provision] $*" >&2; }

doctl_id_by_name() {
  # $1 = doctl subcommand (e.g. "compute droplet"), $2 = name to match
  doctl $1 list --format ID,Name --no-header 2>/dev/null | awk -v n="$2" '$2==n{print $1; exit}'
}

log "Authenticating doctl..."
doctl auth init --access-token "$DIGITALOCEAN_ACCESS_TOKEN" >/dev/null

# --- 1. SSH key -------------------------------------------------------------
if [ ! -f "$SSH_KEY_PATH" ]; then
  log "Generating deploy SSH key at $SSH_KEY_PATH"
  ssh-keygen -t ed25519 -f "$SSH_KEY_PATH" -N "" -C "$SSH_KEY_NAME" >/dev/null
fi

DO_KEY_ID="$(doctl_id_by_name "compute ssh-key" "$SSH_KEY_NAME")"
if [ -z "$DO_KEY_ID" ]; then
  log "Registering SSH key with DigitalOcean"
  DO_KEY_ID="$(doctl compute ssh-key import "$SSH_KEY_NAME" --public-key-file "${SSH_KEY_PATH}.pub" --format ID --no-header)"
fi
log "SSH key ID: $DO_KEY_ID"

# --- 2. Managed PostgreSQL ---------------------------------------------------
DB_ID="$(doctl_id_by_name "databases" "$DB_NAME")"
if [ -z "$DB_ID" ]; then
  log "Creating Managed PostgreSQL cluster $DB_NAME (this takes a few minutes)"
  # `databases create` doesn't support --format/--no-header; use JSON + jq.
  DB_ID="$(doctl databases create "$DB_NAME" \
    --engine pg --version 16 --region "$REGION" --size "$DB_SIZE" --num-nodes 1 \
    --wait -o json | jq -r '.[0].id')"
fi
log "Database cluster ID: $DB_ID"

if ! doctl databases db list "$DB_ID" --format Name --no-header | grep -qx "$DB_APP_NAME"; then
  log "Creating application database $DB_APP_NAME"
  doctl databases db create "$DB_ID" "$DB_APP_NAME" >/dev/null
fi

# `databases connection` has no --database flag; fetch the admin URI as JSON
# and swap in our application database name.
DB_CONNECTION_JSON="$(doctl databases connection "$DB_ID" -o json)"
DB_CONNECTION_URI="$(echo "$DB_CONNECTION_JSON" | jq -r --arg db "$DB_APP_NAME" '.uri | sub("/[a-zA-Z0-9_-]+\\?"; "/" + $db + "?")')"

# The app verifies the cluster's TLS certificate (see src/infrastructure/
# database/pool.ts) rather than trusting any cert, so it needs this CA.
DB_CA_CERT_BASE64="$(doctl databases get-ca "$DB_ID" -o json | jq -r '.certificate')"

# --- 3. Droplet ---------------------------------------------------------------
DROPLET_ID="$(doctl_id_by_name "compute droplet" "$DROPLET_NAME")"
if [ -z "$DROPLET_ID" ]; then
  log "Creating Droplet $DROPLET_NAME (Ubuntu 24.04, $DROPLET_SIZE, $REGION)"
  DROPLET_ID="$(doctl compute droplet create "$DROPLET_NAME" \
    --region "$REGION" --size "$DROPLET_SIZE" --image ubuntu-24-04-x64 \
    --ssh-keys "$DO_KEY_ID" --wait --format ID --no-header)"
fi
log "Droplet ID: $DROPLET_ID"

DROPLET_IP="$(doctl compute droplet get "$DROPLET_ID" --format PublicIPv4 --no-header)"
log "Droplet public IP: $DROPLET_IP"

# --- 4. Firewall ---------------------------------------------------------------
FW_ID="$(doctl_id_by_name "compute firewall" "$FIREWALL_NAME")"
if [ -z "$FW_ID" ]; then
  log "Creating firewall $FIREWALL_NAME (22/80/443 inbound only)"
  doctl compute firewall create --name "$FIREWALL_NAME" \
    --droplet-ids "$DROPLET_ID" \
    --inbound-rules "protocol:tcp,ports:22,address:0.0.0.0/0,address:::/0 protocol:tcp,ports:80,address:0.0.0.0/0,address:::/0 protocol:tcp,ports:443,address:0.0.0.0/0,address:::/0" \
    --outbound-rules "protocol:tcp,ports:1-65535,address:0.0.0.0/0,address:::/0 protocol:udp,ports:1-65535,address:0.0.0.0/0,address:::/0" \
    >/dev/null
fi

# --- 5. Restrict the database to only accept connections from the Droplet ---
log "Restricting database access to the Droplet"
doctl databases firewalls append "$DB_ID" --rule "droplet:$DROPLET_ID" >/dev/null 2>&1 || true

cat <<SUMMARY

=================================================================
Provisioning complete.

  Droplet IP:        $DROPLET_IP
  Deploy SSH key:     $SSH_KEY_PATH (private, keep out of git)
  Database URI:       $DB_CONNECTION_URI
  Database CA (base64, first 40 chars): ${DB_CA_CERT_BASE64:0:40}...

Next steps:
  1. SSH in and run the server bootstrap script once:
       scp -i $SSH_KEY_PATH infra/setup-server.sh root@$DROPLET_IP:/root/
       ssh -i $SSH_KEY_PATH root@$DROPLET_IP 'REPO_URL=<your-git-url> bash /root/setup-server.sh'
  2. Add these as GitHub Actions repository secrets (Settings > Secrets > Actions):
       DROPLET_HOST           = $DROPLET_IP
       DROPLET_SSH_KEY        = (contents of $SSH_KEY_PATH)
       DATABASE_URL           = $DB_CONNECTION_URI
       DATABASE_SSL_CA_BASE64 = $DB_CA_CERT_BASE64
       SIGNING_SECRET         = (openssl rand -hex 32)
       BASE_URL               = http://$DROPLET_IP   (or https://<your-domain> once DNS is set up)
  3. Push to main — .github/workflows/deploy.yml will run tests, then deploy.
=================================================================
SUMMARY
