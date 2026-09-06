#!/bin/bash
# proxy-doctor｜墙内体检：从本机（墙内）测节点 443 的「TCP 建连 + TLS 握手」总耗时（CONNECT 延迟），
# 把网络现象翻译成可行动结论。模式：
#   ./probe.sh             普通：打印结论 + 写日志（人看）
#   ./probe.sh --notify    预警：仅在「健康↔异常」翻转时弹 macOS 通知（launchd 用）
#   ./probe.sh --section   片段：输出节点健康几行，供 bwg-monitor 菜单栏展开内嵌（不写日志）
# 注：连的是你自己的节点 443，与 bandwagon 后台 / Cloudflare 完全无关。
set -u

# launchd / SwiftBar 跑时 PATH 很精简，补上系统路径，确保找得到 osascript / date / open
export PATH="/usr/bin:/bin:/usr/sbin:/sbin:$PATH"

# 数据区固定在 ~/vps-setup（.env / 日志 / 状态都在这；skill 只放逻辑）
DATA_DIR="${PROXY_DOCTOR_HOME:-$HOME/vps-setup}"
ENV_FILE="${PROXY_DOCTOR_ENV:-$DATA_DIR/.env}"
LOG="$DATA_DIR/probe-node.log"
STATE="$DATA_DIR/.proxy-doctor-state"
PY="/usr/bin/python3"   # 本机唯一可用解释器（homebrew 未装 python）；脚本仅用标准库，3.9 够用

[ -f "$ENV_FILE" ] || { echo "错误: 缺少 $ENV_FILE，请先在 ~/vps-setup 建好 .env"; exit 1; }
# shellcheck disable=SC1091
source "$ENV_FILE"

SNI="${SNI:-www.icloud.com}"
PORT="${PORT:-443}"
MODE="${1:-plain}"
TS="$(date '+%Y-%m-%d %H:%M:%S')"

# 一把测「TCP 建连 + TLS 握手」总耗时 = CONNECT 延迟
# REALITY 用伪造证书，故关闭证书校验，只看握手能否完成
probe_out="$("$PY" - "$SERVER" "$PORT" "$SNI" <<'PY'
import socket, ssl, sys, time
host, port, sni = sys.argv[1], int(sys.argv[2]), sys.argv[3]
t = time.time()
try:
    sock = socket.create_connection((host, port), timeout=6)
except socket.timeout:
    print("TIMEOUT -"); sys.exit()
except ConnectionRefusedError:
    print("REFUSED -"); sys.exit()
except Exception:
    print("ERR -"); sys.exit()
try:
    ctx = ssl._create_unverified_context()
    ss = ctx.wrap_socket(sock, server_hostname=sni)
    ms = int((time.time() - t) * 1000)
    ss.close()
    print("OK %dms" % ms)
except Exception:
    try: sock.close()
    except Exception: pass
    print("TLSFAIL -")
PY
)"
state="${probe_out%% *}"
latency="${probe_out#* }"

if [ "$state" = "OK" ]; then
  healthy="healthy"
else
  healthy="unhealthy"
fi

# 把现象翻译成下一步该查什么
case "$state" in
  OK)      verdict="健康：可正常连接" ;;
  TIMEOUT) verdict="超时无响应 → 疑似 IP 被 GFW 封锁（也可能服务器宕机，去 KiwiVM 后台确认机器在线）" ;;
  REFUSED) verdict="连接被拒 → 服务器在线但 443 没监听（Xray 没起来，重启 Xray）" ;;
  TLSFAIL) verdict="TLS握手失败 → 疑似 Xray/REALITY 配置问题，不是被封（跑 server-diag.sh 查服务端）" ;;
  *)       verdict="探测异常（${probe_out}），手动排查" ;;
esac

line="${TS} | ${SERVER}:${PORT} SNI=${SNI} | CONNECT=${state} ${latency} | ${verdict}"

# 仅 plain / notify 写日志；section 高频刷新不写，避免刷屏
[ "$MODE" != "--section" ] && echo "$line" >> "$LOG"

case "$MODE" in
  --notify)
    # 预警：只在「健康↔异常」翻转时弹通知，避免持续异常狂轰炸
    prev="$(cat "$STATE" 2>/dev/null || echo "")"
    if [ "$healthy" != "$prev" ]; then
      if [ "$healthy" = "unhealthy" ]; then
        osascript -e "display notification \"${verdict}\" with title \"proxy-doctor｜节点异常\" sound name \"Basso\"" 2>/dev/null
      elif [ -n "$prev" ]; then
        # 仅「之前异常→现在好」才报恢复；首次（prev 为空）健康不打扰
        osascript -e "display notification \"节点已恢复正常\" with title \"proxy-doctor｜已恢复\" sound name \"Glass\"" 2>/dev/null
      fi
      echo "$healthy" > "$STATE"
    fi
    ;;
  --section)
    # 供 bwg-monitor 菜单栏展开内嵌的「节点健康」片段（不含菜单栏标题行）
    if [ "$healthy" = "healthy" ]; then
      echo "🟢 节点健康 ｜ CONNECT ${latency}"
    else
      echo "🔴 节点异常 ｜ ${state}"
    fi
    echo "节点 ${SERVER}:${PORT} ｜ SNI ${SNI}"
    echo "${verdict}"
    echo "探测 ${TS}"
    echo "打开探测日志 | bash=/usr/bin/open param1=${LOG} terminal=false"
    ;;
  *)
    echo "$line"   # 普通模式：打印给人看
    ;;
esac
