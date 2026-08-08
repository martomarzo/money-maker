#!/usr/bin/env bash
# One-time setup of the money-maker deploy host (README "Deployment").
# Run FROM THE DEV MACHINE (needs `tailscale` + an authenticated `gh`):
#
#   bash scripts/server-setup.sh
#
# Idempotent: skips the .env if it exists and the runner if configured.
# Afterwards, the one remaining manual step is filling TS_AUTHKEY into
# /opt/money-maker/.env (key from https://login.tailscale.com/admin/settings/keys).
set -euo pipefail

HOST="root@docker"
REPO="martomarzo/money-maker"
TAILNET="peacock-snapper.ts.net"

echo "==> 1/2 /opt/money-maker/.env"
tailscale ssh "$HOST" -- bash -c "'
set -e
mkdir -p /opt/money-maker
if [ -s /opt/money-maker/.env ]; then
  echo \".env already exists — leaving it alone\"
else
  PW=\$(openssl rand -hex 24)
  AS=\$(openssl rand -base64 32)
  {
    echo \"DATABASE_URL=postgres://money:\${PW}@postgres:5432/money_maker\"
    echo \"POSTGRES_USER=money\"
    echo \"POSTGRES_PASSWORD=\${PW}\"
    echo \"POSTGRES_DB=money_maker\"
    echo \"AUTH_SECRET=\${AS}\"
    echo \"AUTH_URL=https://money-maker.'"$TAILNET"'\"
    echo \"TS_AUTHKEY=\"
  } > /opt/money-maker/.env
  chmod 600 /opt/money-maker/.env
  echo \"wrote /opt/money-maker/.env\"
fi
'"

echo "==> 2/2 GitHub Actions self-hosted runner"
TOKEN=$(gh api -X POST "repos/${REPO}/actions/runners/registration-token" -q .token)
tailscale ssh "$HOST" -- bash -c "'
set -e
if [ -f /opt/actions-runner/.runner ]; then
  echo \"runner already configured — skipping\"
  exit 0
fi
id runner >/dev/null 2>&1 || useradd -m -s /bin/bash runner
usermod -aG docker runner
mkdir -p /opt/actions-runner
cd /opt/actions-runner
if [ ! -f config.sh ]; then
  VER=\$(curl -fsSL https://api.github.com/repos/actions/runner/releases/latest | grep -m1 tag_name | cut -d\\\" -f4 | tr -d v)
  curl -fsSL -o runner.tgz \"https://github.com/actions/runner/releases/download/v\${VER}/actions-runner-linux-x64-\${VER}.tar.gz\"
  tar xzf runner.tgz && rm runner.tgz
  ./bin/installdependencies.sh
fi
chown -R runner:runner /opt/actions-runner
sudo -u runner ./config.sh --url https://github.com/'"$REPO"' --token '"$TOKEN"' --unattended --name docker-host
./svc.sh install runner
./svc.sh start
sleep 2
./svc.sh status | head -8
'"

echo
echo "Done. Remaining manual step: put a one-time Tailscale auth key into"
echo "/opt/money-maker/.env on the host, e.g.:"
echo "  tailscale ssh ${HOST} -- \"sed -i 's|^TS_AUTHKEY=.*|TS_AUTHKEY=tskey-auth-...|' /opt/money-maker/.env\""
