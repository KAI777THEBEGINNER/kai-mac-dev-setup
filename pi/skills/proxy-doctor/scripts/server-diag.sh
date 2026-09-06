#!/bin/bash
# proxy-doctor｜服务端深诊：当墙内 probe 报「TLS 失败」或想查根因时，SSH 上节点做只读检查。
#   - Xray 是否在跑、443 是否监听、防火墙规则
#   - 当前 SNI 的证书链 DER 大小 vs REALITY 8192 上限（撞上限会握手失败，却长得像「被封」）
#   - Xray error.log 最近的握手类报错
# 用法：  ~/vps-setup/proxy-doctor/scripts/server-diag.sh
set -u

DATA_DIR="${PROXY_DOCTOR_HOME:-$HOME/vps-setup}"
ENV_FILE="${PROXY_DOCTOR_ENV:-$DATA_DIR/.env}"
[ -f "$ENV_FILE" ] || { echo "错误: 缺少 $ENV_FILE"; exit 1; }
# shellcheck disable=SC1091
source "$ENV_FILE"
SNI="${SNI:-www.icloud.com}"
command -v expect >/dev/null || { echo "需要 expect（macOS 自带 /usr/bin/expect）"; exit 1; }

# 远程只读诊断脚本（用非引号 here-doc，本地变量 $SNI 在此展开；远程变量用 \$ 转义）
REMOTE=$(cat <<REMOTE_EOF
echo "=== OS ==="
( . /etc/os-release 2>/dev/null && echo "\$PRETTY_NAME" ) || uname -a
echo "=== Xray 版本 ==="
/usr/local/bin/xray version 2>/dev/null | head -1 || echo "xray 未找到"
echo "=== Xray 运行状态 ==="
systemctl is-active xray 2>/dev/null || echo unknown
echo "=== 443 监听 ==="
ss -tlnp 2>/dev/null | grep 443 || echo "443 未监听"
echo "=== 防火墙 443 规则 ==="
iptables -L -n 2>/dev/null | grep 443 || echo "iptables 无 443 规则"
echo "=== 当前 SNI ($SNI) 证书链 DER 大小 vs 8192 ==="
echo | openssl s_client -connect $SNI:443 -servername $SNI -showcerts 2>/dev/null > /tmp/sni.pem
N=\$(grep -c "BEGIN CERTIFICATE" /tmp/sni.pem)
awk 'BEGIN{n=0} /BEGIN CERTIFICATE/{n++} n>0{print > ("/tmp/cc" n ".pem")}' /tmp/sni.pem
total=0
for f in /tmp/cc*.pem; do
  [ -f "\$f" ] || continue
  s=\$(openssl x509 -in "\$f" -outform DER 2>/dev/null | wc -c)
  total=\$((total + s))
done
echo "证书数: \$N  证书链 DER 总字节: \$total  (REALITY 上限 8192)"
[ "\$total" -gt 8192 ] && echo ">>> 已超 8192：换证书链更小的 SNI" || echo ">>> 未超 8192"
echo "=== Xray error.log 最近 20 行 ==="
tail -20 /var/log/xray/error.log 2>/dev/null || echo "日志空或不存在"
rm -f /tmp/sni.pem /tmp/cc*.pem
echo "=== DONE ==="
REMOTE_EOF
)

B64=$(printf '%s' "$REMOTE" | base64)
/usr/bin/expect <<EOF
set timeout 40
spawn ssh -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null root@$SERVER "echo $B64 | base64 -d | bash"
expect {
    "password:" { send "$PASSWORD\r" }
    "Are you sure you want to continue connecting" { send "yes\r"; exp_continue }
}
expect eof
EOF
