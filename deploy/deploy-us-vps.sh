#!/usr/bin/env bash
set -euo pipefail

# Isolated deployment: upload a complete versioned release, then switch one symlink.
# It never changes Nginx, /root/stockpulse, or unrelated PM2 apps.
# The server password and every API key are intentionally omitted.
SERVER="root@67.215.255.196"
RELEASE_ID="${RELEASE_ID:-$(date -u +%Y%m%dT%H%M%SZ)-$$}"
REMOTE_RELEASE_ROOT="/opt/portfolio-tracker-releases/${RELEASE_ID}"
REMOTE_RELEASE_APP="${REMOTE_RELEASE_ROOT}/gateway"
REMOTE_RELEASE_WEB="${REMOTE_RELEASE_ROOT}/web"
REMOTE_CURRENT="/opt/portfolio-tracker-current"
REMOTE_STABLE_APP='/opt/portfolio-tracker-gateway'
REMOTE_STABLE_WEB='/opt/portfolio-tracker-web'
IMPORT_ARCHIVE_ENV=""
PORTFOLIO_SYNC_ENV=""
BARK_ENV=""
BARK_BASE_ENV=""
SSH_CMD=(ssh)
SCP_CMD=(scp)
RSYNC_SHELL="ssh"
if [[ -n "${SSHPASS:-}" ]]; then
  SSH_CMD=(sshpass -e ssh)
  SCP_CMD=(sshpass -e scp)
  RSYNC_SHELL="sshpass -e ssh"
fi
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

"${SSH_CMD[@]}" "${SERVER}" "mkdir -p '${REMOTE_RELEASE_APP}' '${REMOTE_RELEASE_WEB}'"
rsync -e "${RSYNC_SHELL}" -az --delete dist/ "${SERVER}:${REMOTE_RELEASE_WEB}/"
"${SCP_CMD[@]}" deploy/runtime-config.us-vps.js "${SERVER}:${REMOTE_RELEASE_WEB}/runtime-config.js"
"${SCP_CMD[@]}" deploy/aliyun-gateway.mjs "${SERVER}:${REMOTE_RELEASE_APP}/portfolio-gateway.mjs"
"${SCP_CMD[@]}" deploy/refresh-request-route.mjs "${SERVER}:${REMOTE_RELEASE_APP}/refresh-request-route.mjs"
"${SCP_CMD[@]}" deploy/alert-tracker.mjs "${SERVER}:${REMOTE_RELEASE_APP}/alert-tracker.mjs"
"${SCP_CMD[@]}" deploy/channel-review.mjs "${SERVER}:${REMOTE_RELEASE_APP}/channel-review.mjs"
"${SCP_CMD[@]}" deploy/z-breakout.mjs "${SERVER}:${REMOTE_RELEASE_APP}/z-breakout.mjs"
"${SCP_CMD[@]}" deploy/z-extreme.mjs "${SERVER}:${REMOTE_RELEASE_APP}/z-extreme.mjs"
"${SCP_CMD[@]}" deploy/quant-decision-alerts.mjs "${SERVER}:${REMOTE_RELEASE_APP}/quant-decision-alerts.mjs"
"${SCP_CMD[@]}" deploy/sell-price-sanity.mjs "${SERVER}:${REMOTE_RELEASE_APP}/sell-price-sanity.mjs"
"${SCP_CMD[@]}" deploy/last-good-cache.mjs "${SERVER}:${REMOTE_RELEASE_APP}/last-good-cache.mjs"
"${SCP_CMD[@]}" deploy/position-estimate.mjs "${SERVER}:${REMOTE_RELEASE_APP}/position-estimate.mjs"
"${SCP_CMD[@]}" deploy/decision-log.mjs "${SERVER}:${REMOTE_RELEASE_APP}/decision-log.mjs"
"${SCP_CMD[@]}" deploy/decision-log-resolve.mjs "${SERVER}:${REMOTE_RELEASE_APP}/decision-log-resolve.mjs"
"${SCP_CMD[@]}" deploy/alert-log.mjs "${SERVER}:${REMOTE_RELEASE_APP}/alert-log.mjs"
"${SCP_CMD[@]}" deploy/alert-noise.mjs "${SERVER}:${REMOTE_RELEASE_APP}/alert-noise.mjs"
"${SCP_CMD[@]}" deploy/alert-outcomes.mjs "${SERVER}:${REMOTE_RELEASE_APP}/alert-outcomes.mjs"
"${SCP_CMD[@]}" deploy/alert-noise.config.json "${SERVER}:${REMOTE_RELEASE_APP}/alert-noise.config.json"
"${SCP_CMD[@]}" deploy/void-dust-records.mjs "${SERVER}:${REMOTE_RELEASE_APP}/void-dust-records.mjs"
"${SCP_CMD[@]}" deploy/fix-reference-price-alerts.mjs "${SERVER}:${REMOTE_RELEASE_APP}/fix-reference-price-alerts.mjs"
"${SCP_CMD[@]}" deploy/broker-health.mjs "${SERVER}:${REMOTE_RELEASE_APP}/broker-health.mjs"
"${SCP_CMD[@]}" deploy/index-quotes.mjs "${SERVER}:${REMOTE_RELEASE_APP}/index-quotes.mjs"
"${SCP_CMD[@]}" deploy/overnight-quotes.mjs "${SERVER}:${REMOTE_RELEASE_APP}/overnight-quotes.mjs"
"${SCP_CMD[@]}" deploy/quote-freshness.mjs "${SERVER}:${REMOTE_RELEASE_APP}/quote-freshness.mjs"
"${SCP_CMD[@]}" deploy/portfolio-loss.mjs "${SERVER}:${REMOTE_RELEASE_APP}/portfolio-loss.mjs"
"${SCP_CMD[@]}" deploy/data-sources.mjs "${SERVER}:${REMOTE_RELEASE_APP}/data-sources.mjs"
"${SCP_CMD[@]}" deploy/ibkr-flex.mjs "${SERVER}:${REMOTE_RELEASE_APP}/ibkr-flex.mjs"
"${SCP_CMD[@]}" deploy/source-compare.mjs "${SERVER}:${REMOTE_RELEASE_APP}/source-compare.mjs"
"${SCP_CMD[@]}" deploy/server-worker.mjs "${SERVER}:${REMOTE_RELEASE_APP}/server-worker.mjs"
"${SCP_CMD[@]}" deploy/fetch-ibkr-flex.mjs "${SERVER}:${REMOTE_RELEASE_APP}/fetch-ibkr-flex.mjs"
"${SCP_CMD[@]}" deploy/compare-sources.mjs "${SERVER}:${REMOTE_RELEASE_APP}/compare-sources.mjs"
"${SCP_CMD[@]}" deploy/ibkr-flex.config.template.json "${SERVER}:${REMOTE_RELEASE_APP}/ibkr-flex.config.template.json"
# server-worker.config.json 只在服务器上还没有时才放默认值（默认全关），已有的设置不覆盖。
"${SCP_CMD[@]}" deploy/server-worker.config.json "${SERVER}:${REMOTE_RELEASE_APP}/server-worker.config.default.json"
"${SCP_CMD[@]}" deploy/realtime-alerts.mjs "${SERVER}:${REMOTE_RELEASE_APP}/realtime-alerts.mjs"
"${SCP_CMD[@]}" deploy/realtime-push.mjs "${SERVER}:${REMOTE_RELEASE_APP}/realtime-push.mjs"
"${SCP_CMD[@]}" deploy/realtime-monitor.mjs "${SERVER}:${REMOTE_RELEASE_APP}/realtime-monitor.mjs"
"${SCP_CMD[@]}" deploy/notification-copy.mjs "${SERVER}:${REMOTE_RELEASE_APP}/notification-copy.mjs"
"${SCP_CMD[@]}" deploy/notification-control.mjs "${SERVER}:${REMOTE_RELEASE_APP}/notification-control.mjs"
"${SCP_CMD[@]}" deploy/market-session.mjs "${SERVER}:${REMOTE_RELEASE_APP}/market-session.mjs"
"${SCP_CMD[@]}" deploy/yahoo-quote.mjs "${SERVER}:${REMOTE_RELEASE_APP}/yahoo-quote.mjs"
"${SCP_CMD[@]}" deploy/ma-slope-query.mjs "${SERVER}:${REMOTE_RELEASE_APP}/ma-slope-query.mjs"
"${SCP_CMD[@]}" deploy/sector-rotation.mjs "${SERVER}:${REMOTE_RELEASE_APP}/sector-rotation.mjs"

"${SSH_CMD[@]}" "${SERVER}" "
  test -s '${REMOTE_RELEASE_WEB}/index.html' && \
  node --check '${REMOTE_RELEASE_APP}/portfolio-gateway.mjs' && \
  node --check '${REMOTE_RELEASE_APP}/refresh-request-route.mjs' && \
  node --check '${REMOTE_RELEASE_APP}/alert-tracker.mjs' && \
  node --check '${REMOTE_RELEASE_APP}/channel-review.mjs' && \
  node --check '${REMOTE_RELEASE_APP}/z-breakout.mjs' && \
  node --check '${REMOTE_RELEASE_APP}/z-extreme.mjs' && \
  node --check '${REMOTE_RELEASE_APP}/quant-decision-alerts.mjs' && \
  node --check '${REMOTE_RELEASE_APP}/sell-price-sanity.mjs' && \
  node --check '${REMOTE_RELEASE_APP}/last-good-cache.mjs' && \
  node --check '${REMOTE_RELEASE_APP}/position-estimate.mjs' && \
  node --check '${REMOTE_RELEASE_APP}/decision-log.mjs' && \
  node --check '${REMOTE_RELEASE_APP}/decision-log-resolve.mjs' && \
  node --check '${REMOTE_RELEASE_APP}/alert-log.mjs' && \
  node --check '${REMOTE_RELEASE_APP}/alert-noise.mjs' && \
  node --check '${REMOTE_RELEASE_APP}/alert-outcomes.mjs' && \
  node --check '${REMOTE_RELEASE_APP}/void-dust-records.mjs' && \
  node --check '${REMOTE_RELEASE_APP}/fix-reference-price-alerts.mjs' && \
  node --check '${REMOTE_RELEASE_APP}/broker-health.mjs' && \
  node --check '${REMOTE_RELEASE_APP}/index-quotes.mjs' && \
  node --check '${REMOTE_RELEASE_APP}/overnight-quotes.mjs' && \
  node --check '${REMOTE_RELEASE_APP}/quote-freshness.mjs' && \
  node --check '${REMOTE_RELEASE_APP}/portfolio-loss.mjs' && \
  node --check '${REMOTE_RELEASE_APP}/data-sources.mjs' && \
  node --check '${REMOTE_RELEASE_APP}/ibkr-flex.mjs' && \
  node --check '${REMOTE_RELEASE_APP}/source-compare.mjs' && \
  node --check '${REMOTE_RELEASE_APP}/server-worker.mjs' && \
  node --check '${REMOTE_RELEASE_APP}/fetch-ibkr-flex.mjs' && \
  node --check '${REMOTE_RELEASE_APP}/compare-sources.mjs' && \
  { test -f '${REMOTE_RELEASE_APP}/server-worker.config.json' || cp '${REMOTE_RELEASE_APP}/server-worker.config.default.json' '${REMOTE_RELEASE_APP}/server-worker.config.json'; } && \
  node --check '${REMOTE_RELEASE_APP}/realtime-alerts.mjs' && \
  node --check '${REMOTE_RELEASE_APP}/realtime-push.mjs' && \
  node --check '${REMOTE_RELEASE_APP}/realtime-monitor.mjs' && \
  node --check '${REMOTE_RELEASE_APP}/notification-control.mjs' && \
  node --check '${REMOTE_RELEASE_APP}/ma-slope-query.mjs' && \
  node --check '${REMOTE_RELEASE_APP}/sector-rotation.mjs' && \
  ln -sfn '${REMOTE_RELEASE_ROOT}' '${REMOTE_CURRENT}.next' && \
  mv -Tf '${REMOTE_CURRENT}.next' '${REMOTE_CURRENT}' && \
  if [ -e '${REMOTE_STABLE_APP}' ] && [ ! -L '${REMOTE_STABLE_APP}' ]; then mv '${REMOTE_STABLE_APP}' '${REMOTE_STABLE_APP}.legacy-${RELEASE_ID}'; fi && \
  if [ -e '${REMOTE_STABLE_WEB}' ] && [ ! -L '${REMOTE_STABLE_WEB}' ]; then mv '${REMOTE_STABLE_WEB}' '${REMOTE_STABLE_WEB}.legacy-${RELEASE_ID}'; fi && \
  ln -sfn '${REMOTE_CURRENT}/gateway' '${REMOTE_STABLE_APP}.next' && \
  mv -Tf '${REMOTE_STABLE_APP}.next' '${REMOTE_STABLE_APP}' && \
  ln -sfn '${REMOTE_CURRENT}/web' '${REMOTE_STABLE_WEB}.next' && \
  mv -Tf '${REMOTE_STABLE_WEB}.next' '${REMOTE_STABLE_WEB}' && \
  (ufw delete allow 8788/tcp >/dev/null 2>&1 || true) && \
  if pm2 describe portfolio-tracker >/dev/null 2>&1; then \
    pm2 restart portfolio-tracker; \
  else \
    ${IMPORT_ARCHIVE_ENV}${PORTFOLIO_SYNC_ENV}${BARK_ENV}${BARK_BASE_ENV}PORT=8788 HOST=127.0.0.1 STATIC_ROOT='${REMOTE_STABLE_WEB}' PORTFOLIO_ALERTS_ROOT=/opt/portfolio-tracker-data/alerts pm2 start '${REMOTE_STABLE_APP}/portfolio-gateway.mjs' --name portfolio-tracker --interpreter node --node-args='--max-old-space-size=96'; \
  fi && \
  pm2 save
"
