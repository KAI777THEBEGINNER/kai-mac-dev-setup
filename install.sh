#!/bin/bash
# 新机器装配置：仓库 → 本机。
#
#   bash install.sh                     只装终端组（Ghostty + zellij + zsh + pi）
#   bash install.sh --dry-run           先看会改哪些文件
#   bash install.sh --home /tmp/fake    装到别的 HOME（冒烟测试）
#
# 覆盖前会把原文件备份到 ~/.mac-dev-setup-backup-<时间戳>/。
set -euo pipefail
cd "$(dirname "$0")"

if ! command -v python3 >/dev/null 2>&1; then
    echo "需要 python3（macOS 自带，或 xcode-select --install）" >&2
    exit 1
fi

exec python3 tools/sync.py apply "$@"
