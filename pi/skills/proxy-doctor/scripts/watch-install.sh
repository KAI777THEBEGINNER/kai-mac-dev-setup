#!/bin/bash
# proxy-doctor｜启用自动预警：装一个 launchd 定时任务，每 N 分钟在本机自测节点一次，
# 仅当节点「健康↔异常」翻转时弹 macOS 通知。装完即生效，重启电脑后自动恢复。
#   ./watch-install.sh         默认每 30 分钟
#   ./watch-install.sh 900     自定义间隔（秒），此处为每 15 分钟
set -e

LABEL="com.kai.proxy-doctor.watch"
PLIST="$HOME/Library/LaunchAgents/${LABEL}.plist"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROBE="$SCRIPT_DIR/probe.sh"
INTERVAL="${1:-1800}"

[ -f "$PROBE" ] || { echo "错误: 找不到 $PROBE"; exit 1; }
chmod +x "$PROBE"
mkdir -p "$HOME/Library/LaunchAgents"

cat > "$PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${LABEL}</string>
  <key>ProgramArguments</key>
  <array>
    <string>/bin/bash</string>
    <string>${PROBE}</string>
    <string>--notify</string>
  </array>
  <key>StartInterval</key>
  <integer>${INTERVAL}</integer>
  <key>RunAtLoad</key>
  <true/>
  <key>StandardOutPath</key>
  <string>${HOME}/vps-setup/.proxy-doctor-watch.log</string>
  <key>StandardErrorPath</key>
  <string>${HOME}/vps-setup/.proxy-doctor-watch.log</string>
</dict>
</plist>
EOF

# 幂等：先卸旧的（两种方式都试，兼容不同 macOS 版本）
launchctl bootout "gui/$(id -u)/${LABEL}" 2>/dev/null || true
launchctl unload "$PLIST" 2>/dev/null || true
# 现代方式加载，失败回退老方式
launchctl bootstrap "gui/$(id -u)" "$PLIST" 2>/dev/null || launchctl load -w "$PLIST"

echo "✅ 已启用自动预警：每 $((INTERVAL/60)) 分钟自测一次"
echo "   plist: $PLIST"
echo "   日志:  $HOME/vps-setup/probe-node.log"
# 发一条测试通知，确认通知通道是通的
osascript -e "display notification \"每 $((INTERVAL/60)) 分钟自测一次，节点异常时会提醒你\" with title \"proxy-doctor｜预警已启用\" sound name \"Glass\"" 2>/dev/null || true
echo "   若没看到系统通知，去「系统设置 → 通知」允许「脚本编辑器」弹通知"
