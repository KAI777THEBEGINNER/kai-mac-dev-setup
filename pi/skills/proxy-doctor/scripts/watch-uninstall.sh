#!/bin/bash
# proxy-doctor｜关闭自动预警：卸载 launchd 定时任务并删除 plist
set -u
LABEL="com.kai.proxy-doctor.watch"
PLIST="$HOME/Library/LaunchAgents/${LABEL}.plist"
launchctl bootout "gui/$(id -u)/${LABEL}" 2>/dev/null || true
launchctl unload "$PLIST" 2>/dev/null || true
rm -f "$PLIST"
echo "✅ 已关闭自动预警，并删除 $PLIST"
echo "   （probe.sh 仍可手动跑；历史日志 probe-node.log 保留）"
