#!/usr/bin/env bash
# Runs ONCE, over SSH, on a freshly provisioned Droplet (Ubuntu 24.04) to turn
# it into a host for signed-file-api: installs Node.js and Caddy, creates a
# dedicated `deploy` user, clones the repo, and installs the systemd unit.
# Subsequent deploys are handled by .github/workflows/deploy.yml over SSH as
# the `deploy` user — this script is not part of the regular deploy path.
#
# Usage (as root, right after the Droplet is up):
#   REPO_URL=https://github.com/<you>/<repo>.git bash setup-server.sh
set -euo pipefail

: "${REPO_URL:?Set REPO_URL to the git URL of this repository}"
APP_DIR="/opt/signed-file-api"
APP_USER="deploy"

echo "==> Installing base packages"
apt-get update -y
# postgresql-client (psql) backs the CI/CD "verify Postgres connectivity from
# the Droplet" step in .github/workflows/deploy.yml — the Managed Postgres
# firewall only allows connections from this Droplet, so that check has to
# run here, not from the GitHub Actions runner.
apt-get install -y curl git ca-certificates gnupg ufw postgresql-client

echo "==> Installing Node.js 22"
if ! command -v node >/dev/null || [ "$(node --version | cut -d. -f1 | tr -d v)" -lt 22 ]; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y nodejs
fi

echo "==> Installing Caddy (reverse proxy / TLS termination)"
if ! command -v caddy >/dev/null; then
  apt-get install -y debian-keyring debian-archive-keyring apt-transport-https
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' \
    | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' \
    | tee /etc/apt/sources.list.d/caddy-stable.list >/dev/null
  apt-get update -y
  apt-get install -y caddy
fi

echo "==> Creating the deploy user"
id -u "$APP_USER" >/dev/null 2>&1 || useradd -m -s /bin/bash "$APP_USER"
mkdir -p "$APP_DIR"
chown "$APP_USER:$APP_USER" "$APP_DIR"

# `doctl compute droplet create --ssh-keys` only authorizes root; CI/CD
# deploys as $APP_USER over SSH, so it needs the same key authorized here.
mkdir -p "/home/$APP_USER/.ssh"
cp /root/.ssh/authorized_keys "/home/$APP_USER/.ssh/authorized_keys"
chown -R "$APP_USER:$APP_USER" "/home/$APP_USER/.ssh"
chmod 700 "/home/$APP_USER/.ssh"
chmod 600 "/home/$APP_USER/.ssh/authorized_keys"

# Let the deploy user restart the app service and reload Caddy without a
# password (needed for the CI/CD SSH deploy step).
cat > /etc/sudoers.d/signed-file-api-deploy <<SUDOERS
$APP_USER ALL=(root) NOPASSWD: /usr/bin/systemctl restart signed-file-api, /usr/bin/systemctl status signed-file-api*
SUDOERS
chmod 440 /etc/sudoers.d/signed-file-api-deploy

echo "==> Cloning the repository"
if [ ! -d "$APP_DIR/.git" ]; then
  sudo -u "$APP_USER" git clone "$REPO_URL" "$APP_DIR"
fi

echo "==> Installing the systemd unit"
cp "$APP_DIR/infra/signed-file-api.service" /etc/systemd/system/signed-file-api.service
systemctl daemon-reload
systemctl enable signed-file-api

echo "==> Configuring Caddy reverse proxy"
cp "$APP_DIR/infra/Caddyfile" /etc/caddy/Caddyfile
systemctl enable caddy
systemctl restart caddy

echo "==> Configuring firewall (22, 80, 443 only)"
ufw allow OpenSSH
ufw allow 80/tcp
ufw allow 443/tcp
ufw --force enable

mkdir -p "$APP_DIR/data/uploads"
chown -R "$APP_USER:$APP_USER" "$APP_DIR/data"

cat <<DONE

==================================================================
Server bootstrap complete.

Before the app can start, put a real .env at $APP_DIR/.env
(the deploy workflow does this automatically from GitHub secrets on
the first CI/CD run), then:

  cd $APP_DIR && sudo -u $APP_USER npm ci && sudo -u $APP_USER npm run build
  systemctl start signed-file-api
  systemctl status signed-file-api

Caddy is already proxying :80 -> 127.0.0.1:3847. Edit infra/Caddyfile and
replace ":80" with your domain once DNS is pointed at this Droplet to get
free automatic HTTPS.
==================================================================
DONE
