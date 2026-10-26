#!/usr/bin/env bash
# 首次交互式登录 OpenD（要手机验证码）。只读行情，不做任何交易动作。
# 密码哈希从 /opt/futu-opend/credentials 读，不在这里显示、也不要求你再输一遍。
set -euo pipefail

CRED=/opt/futu-opend/credentials
BIN=/opt/futu-opend/FutuOpenD
CFG=/opt/futu-opend/OpenD.xml
ACCOUNT=18079298523

[[ -f "${CRED}" ]] || { echo "找不到凭据文件 ${CRED}" >&2; exit 2; }
[[ -f "${CFG}" ]] || { echo "找不到配置 ${CFG}" >&2; exit 2; }

MD5=$(grep -oE '^login_pwd_md5=[0-9a-f]{32}$' "${CRED}" | cut -d= -f2 || true)
[[ -n "${MD5}" ]] || { echo "凭据文件里没有 32 位的密码哈希" >&2; exit 2; }

echo "正在登录 OpenD。看到提示后输入手机验证码："
echo "    input_phone_verify_code -code=你收到的6位数字"
echo
cd /opt/futu-opend
exec "${BIN}" -cfg_file="${CFG}" -login_account="${ACCOUNT}" -login_pwd_md5="${MD5}" -console=1
