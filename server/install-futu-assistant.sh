#!/usr/bin/env bash
# 在服务器上装一份 futu-assistant（量化系统），只装不跑、不填任何密钥。
# 用法：bash install-futu-assistant.sh <代码来源>
#   代码来源可以是 git 地址，也可以是已经上传到服务器的目录
set -euo pipefail

SOURCE="${1:-}"
TARGET=/opt/futu-assistant
if [[ -z "${SOURCE}" ]]; then
  echo "用法：bash install-futu-assistant.sh <git 地址或本地目录>" >&2
  exit 2
fi

echo "[1/5] 准备 ${TARGET}"
mkdir -p "${TARGET}"
if [[ -d "${SOURCE}" ]]; then
  rsync -a --delete --exclude '.venv' --exclude '.git' --exclude 'config/channels.yaml' "${SOURCE}/" "${TARGET}/"
else
  if [[ -d "${TARGET}/.git" ]]; then git -C "${TARGET}" pull --ff-only; else git clone "${SOURCE}" "${TARGET}"; fi
fi

echo "[2/5] 建虚拟环境"
command -v python3 >/dev/null || { echo "服务器上没有 python3" >&2; exit 1; }
python3 -m venv "${TARGET}/.venv" 2>/dev/null || true
"${TARGET}/.venv/bin/pip" install --quiet --upgrade pip

echo "[3/5] 装依赖（内存小，逐个装、不并行）"
if [[ -f "${TARGET}/requirements.txt" ]]; then
  "${TARGET}/.venv/bin/pip" install --quiet --no-cache-dir -r "${TARGET}/requirements.txt"
elif [[ -f "${TARGET}/pyproject.toml" ]]; then
  "${TARGET}/.venv/bin/pip" install --quiet --no-cache-dir -e "${TARGET}"
fi

echo "[4/5] 放配置模板（不含任何密钥）"
mkdir -p "${TARGET}/config"
if [[ ! -f "${TARGET}/config/channels.yaml" ]]; then
  cp "$(dirname "$0")/channels.yaml.template" "${TARGET}/config/channels.yaml"
  chmod 600 "${TARGET}/config/channels.yaml"
  echo "    已生成 ${TARGET}/config/channels.yaml，里面的 <<<...>>> 需要你自己填"
else
  echo "    配置已存在，保持原样不动"
fi

echo "[5/5] 安装 systemd 单元（先不启用）"
cp "$(dirname "$0")/futu-assistant.service" /etc/systemd/system/futu-assistant.service
systemctl daemon-reload
echo "    已安装 futu-assistant.service；确认 OpenD 能登录、配置填好之后再执行："
echo "      systemctl enable --now futu-assistant"

echo
echo "装好了，没有启动、没有填任何密钥。"
