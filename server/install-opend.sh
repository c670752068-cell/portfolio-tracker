#!/usr/bin/env bash
# 在服务器上安装富途 OpenD 命令行版（只装不登录）。
# 用法：
#   bash install-opend.sh /path/to/Futu_OpenD_x.x.x_Ubuntu16.04.tar.gz
#   bash install-opend.sh https://.../Futu_OpenD_x.x.x_Ubuntu16.04.tar.gz
# 装完不会启动，也不会写任何账号信息。
set -euo pipefail

SOURCE="${1:-}"
TARGET=/opt/futu-opend
if [[ -z "${SOURCE}" ]]; then
  echo "用法：bash install-opend.sh <OpenD 压缩包路径或下载地址>" >&2
  echo "压缩包从富途 OpenAPI 下载页取：https://www.futunn.com/download/openAPI（需要登录富途账号）" >&2
  exit 2
fi

mkdir -p "${TARGET}/logs"
TMP=$(mktemp -d)
trap 'rm -rf "${TMP}"' EXIT

if [[ "${SOURCE}" =~ ^https?:// ]]; then
  echo "[1/4] 下载 ${SOURCE}"
  curl -fL --max-time 600 -o "${TMP}/opend.tar.gz" "${SOURCE}"
  PACKAGE="${TMP}/opend.tar.gz"
else
  [[ -f "${SOURCE}" ]] || { echo "找不到文件：${SOURCE}" >&2; exit 2; }
  PACKAGE="${SOURCE}"
fi

echo "[2/4] 解包到 ${TARGET}"
tar -xzf "${PACKAGE}" -C "${TMP}"
BINARY=$(find "${TMP}" -maxdepth 3 -type f -name 'FutuOpenD' | head -1)
[[ -n "${BINARY}" ]] || { echo "压缩包里没找到 FutuOpenD 可执行文件" >&2; exit 1; }
cp -a "$(dirname "${BINARY}")"/. "${TARGET}/"
chmod +x "${TARGET}/FutuOpenD"

echo "[3/4] 放置配置模板（不含任何账号信息）"
if [[ ! -f "${TARGET}/OpenD.ini" ]]; then
  cp "$(dirname "$0")/opend.conf.template" "${TARGET}/OpenD.ini"
  chmod 600 "${TARGET}/OpenD.ini"
  echo "    已生成 ${TARGET}/OpenD.ini，里面的 <<<...>>> 需要你自己填"
else
  echo "    ${TARGET}/OpenD.ini 已存在，保持原样不动"
fi

echo "[4/4] 安装 systemd 单元（先不启用）"
cp "$(dirname "$0")/futu-opend.service" /etc/systemd/system/futu-opend.service
systemctl daemon-reload
echo "    已安装 futu-opend.service；确认能登录之后再执行："
echo "      systemctl enable --now futu-opend"

echo
echo "装好了，但没有启动、也没有登录。接下来看 server/README.md 的「我回来后要做的事」。"
