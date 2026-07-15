#!/usr/bin/env bash
set -euo pipefail

# Isolated deployment: it never changes Nginx, /root/stockpulse, or existing PM2 apps.
# The server password and every API key are intentionally omitted.
SERVER="root@67.215.255.196"
REMOTE_APP="/opt/portfolio-tracker-gateway"
REMOTE_WEB="/opt/portfolio-tracker-web"
printf -v IMPORT_ARCHIVE_ENV 'IMPORT_ARCHIVE_TOKEN=%q ' "${IMPORT_ARCHIVE_TOKEN:-}"
printf -v PORTFOLIO_SYNC_ENV 'PORTFOLIO_SYNC_TOKEN=%q ' "${PORTFOLIO_SYNC_TOKEN:-}"

ssh "${SERVER}" "mkdir -p '${REMOTE_APP}' '${REMOTE_WEB}'"
rsync -az --delete dist/ "${SERVER}:${REMOTE_WEB}/"
scp deploy/runtime-config.us-vps.js "${SERVER}:${REMOTE_WEB}/runtime-config.js"
scp deploy/aliyun-gateway.mjs "${SERVER}:${REMOTE_APP}/portfolio-gateway.mjs"
ssh "${SERVER}" "
  ufw allow 8788/tcp && \
  (pm2 describe portfolio-tracker >/dev/null 2>&1 \
    && ${IMPORT_ARCHIVE_ENV}${PORTFOLIO_SYNC_ENV}PORT=8788 HOST=0.0.0.0 STATIC_ROOT=/opt/portfolio-tracker-web pm2 restart portfolio-tracker --update-env \
    || ${IMPORT_ARCHIVE_ENV}${PORTFOLIO_SYNC_ENV}PORT=8788 HOST=0.0.0.0 STATIC_ROOT=/opt/portfolio-tracker-web pm2 start /opt/portfolio-tracker-gateway/portfolio-gateway.mjs --name portfolio-tracker --interpreter node --node-args='--max-old-space-size=96') && \
  pm2 save
"
