#!/bin/bash
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ENV_FILE="$SCRIPT_DIR/.env"

if [ ! -f "$ENV_FILE" ]; then
  echo "Error: .env file not found. Copy .env.example to .env and fill in your values."
  exit 1
fi

source "$ENV_FILE"

if [ -z "$SERVER_IP" ] || [ -z "$SERVER_USER" ]; then
  echo "Error: SERVER_IP and SERVER_USER must be set in .env"
  exit 1
fi

REMOTE_PATH="/opt/pdf-editor"

GREEN='\033[0;32m'
NC='\033[0m'
log() { echo -e "${GREEN}==>${NC} $1"; }

log "Syncing files to ${SERVER_USER}@${SERVER_IP}..."
rsync -avz -e "ssh" \
  --exclude 'node_modules' \
  --exclude '.git' \
  --exclude '.env' \
  "$SCRIPT_DIR/" "${SERVER_USER}@${SERVER_IP}:${REMOTE_PATH}/"

log "Restarting container..."
ssh "${SERVER_USER}@${SERVER_IP}" << 'EOF'
  docker restart pdf-editor 2>/dev/null || \
  docker run -d --name pdf-editor --restart unless-stopped \
    -p 80:80 \
    -v /opt/pdf-editor:/usr/share/nginx/html:ro \
    nginx:alpine

  echo ""
  echo "=== Status ==="
  docker ps --filter name=pdf-editor
EOF

log "Deploy complete! Site: http://${SERVER_IP}/"
