#!/usr/bin/env bash
set -euo pipefail

# Isolated deployment: it never changes Nginx, /root/stockpulse, or existing PM2 apps.
# The server password and every API key are intentionally omitted.
SERVER="root@67.215.255.196"
REMOTE_APP="/opt/portfolio-tracker-gateway"
REMOTE_WEB="/opt/portfolio-tracker-web"
IMPORT_ARCHIVE_ENV=""
PORTFOLIO_SYNC_ENV=""
BARK_ENV=""
BARK_BASE_ENV=""
if [[ -n "${IMPORT_ARCHIVE_TOKEN:-}" ]]; then
  printf -v IMPORT_ARCHIVE_ENV 'IMPORT_ARCHIVE_TOKEN=%q ' "${IMPORT_ARCHIVE_TOKEN}"
fi
if [[ -n "${PORTFOLIO_SYNC_TOKEN:-}" ]]; then
  printf -v PORTFOLIO_SYNC_ENV 'PORTFOLIO_SYNC_TOKEN=%q ' "${PORTFOLIO_SYNC_TOKEN}"
fi
if [[ -n "${BARK_DEVICE_KEY:-}" ]]; then
  printf -v BARK_ENV 'BARK_DEVICE_KEY=%q ' "${BARK_DEVICE_KEY}"
fi
if [[ -n "${BARK_BASE_URL:-}" ]]; then
  printf -v BARK_BASE_ENV 'BARK_BASE_URL=%q ' "${BARK_BASE_URL}"
fi

ssh "${SERVER}" "
  mkdir -p '${REMOTE_APP}' '${REMOTE_WEB}' && \
  if [ -f '${REMOTE_APP}/portfolio-gateway.mjs' ]; then \
    cp '${REMOTE_APP}/portfolio-gateway.mjs' '${REMOTE_APP}/portfolio-gateway.mjs.bak-'\$(date +%Y%m%d-%H%M%S); \
  fi
"
rsync -az --delete dist/ "${SERVER}:${REMOTE_WEB}/"
scp deploy/runtime-config.us-vps.js "${SERVER}:${REMOTE_WEB}/runtime-config.js"
scp deploy/aliyun-gateway.mjs "${SERVER}:${REMOTE_APP}/portfolio-gateway.mjs"
scp deploy/refresh-request-route.mjs "${SERVER}:${REMOTE_APP}/refresh-request-route.mjs"
scp deploy/alert-tracker.mjs "${SERVER}:${REMOTE_APP}/alert-tracker.mjs"
scp deploy/market-session.mjs "${SERVER}:${REMOTE_APP}/market-session.mjs"
scp deploy/yahoo-quote.mjs "${SERVER}:${REMOTE_APP}/yahoo-quote.mjs"
ssh "${SERVER}" "
  ufw allow 8788/tcp && \
  (pm2 describe portfolio-tracker >/dev/null 2>&1 \
    && ${IMPORT_ARCHIVE_ENV}${PORTFOLIO_SYNC_ENV}${BARK_ENV}${BARK_BASE_ENV}PORT=8788 HOST=0.0.0.0 STATIC_ROOT=/opt/portfolio-tracker-web PORTFOLIO_ALERTS_ROOT=/opt/portfolio-tracker-data/alerts pm2 restart portfolio-tracker --update-env \
    || ${IMPORT_ARCHIVE_ENV}${PORTFOLIO_SYNC_ENV}${BARK_ENV}${BARK_BASE_ENV}PORT=8788 HOST=0.0.0.0 STATIC_ROOT=/opt/portfolio-tracker-web PORTFOLIO_ALERTS_ROOT=/opt/portfolio-tracker-data/alerts pm2 start /opt/portfolio-tracker-gateway/portfolio-gateway.mjs --name portfolio-tracker --interpreter node --node-args='--max-old-space-size=96') && \
  pm2 save
"
