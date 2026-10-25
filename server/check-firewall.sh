#!/usr/bin/env bash
# 确认 OpenD 的端口没有暴露到公网。装完和每次改配置之后都可以跑一遍。
set -uo pipefail
PORT="${1:-11111}"

echo "=== 1) 本机监听情况（期望只有 127.0.0.1:${PORT}）==="
ss -ltnp 2>/dev/null | grep -E ":${PORT}\b" || echo "（没有进程在监听 ${PORT}，OpenD 可能还没启动）"

echo
echo "=== 2) 有没有监听在 0.0.0.0 或 :: 上（出现就是危险）==="
if ss -ltn 2>/dev/null | grep -E "(0\.0\.0\.0|\[::\]):${PORT}\b"; then
  echo "！！端口对外开放了，请把 OpenD 配置里的 ip 改回 127.0.0.1"
  exit 1
fi
echo "没有对外监听，正常"

echo
echo "=== 3) 防火墙规则 ==="
if command -v ufw >/dev/null 2>&1; then
  ufw status | head -20
  if ufw status | grep -qE "^${PORT}\b.*ALLOW"; then
    echo "！！ufw 里放行了 ${PORT}，建议执行：ufw delete allow ${PORT}/tcp"
    exit 1
  fi
fi

echo
echo "=== 4) 从外面能不能连上（用公网地址自连，期望连不上）==="
PUBLIC_IP=$(curl -s --max-time 10 https://api.ipify.org || echo "")
if [[ -n "${PUBLIC_IP}" ]]; then
  if timeout 5 bash -c "</dev/tcp/${PUBLIC_IP}/${PORT}" 2>/dev/null; then
    echo "！！从公网地址 ${PUBLIC_IP}:${PORT} 连上了，必须立刻收紧"
    exit 1
  fi
  echo "公网地址 ${PUBLIC_IP}:${PORT} 连不上，正常"
fi
echo
echo "检查通过：OpenD 端口只在本机可用。"
