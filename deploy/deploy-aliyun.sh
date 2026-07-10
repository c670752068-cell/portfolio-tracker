#!/usr/bin/env bash
set -euo pipefail

# Run this from the project root on the developer Mac after a successful build.
# Passwords and API Keys are intentionally not present in this script.
SERVER="root@47.116.138.180"
REMOTE_APP="/root/portfolio-tracker-gateway"
REMOTE_WEB="/var/www/portfolio-tracker"

ssh "${SERVER}" "mkdir -p '${REMOTE_APP}' '${REMOTE_WEB}'"
rsync -az --delete dist/ "${SERVER}:${REMOTE_WEB}/"
scp deploy/runtime-config.aliyun.js "${SERVER}:${REMOTE_WEB}/runtime-config.js"
scp deploy/aliyun-gateway.mjs "${SERVER}:${REMOTE_APP}/aliyun-gateway.mjs"
scp deploy/portfolio-tracker.nginx.conf "${SERVER}:/etc/nginx/conf.d/portfolio-tracker.conf"
ssh "${SERVER}" 'pm2 start /root/portfolio-tracker-gateway/aliyun-gateway.mjs --name portfolio-ai-gateway --interpreter node --update-env || pm2 restart portfolio-ai-gateway --update-env; pm2 save; nginx -t; systemctl enable --now nginx'
