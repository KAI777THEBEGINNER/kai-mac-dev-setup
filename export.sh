#!/bin/bash
# 本机改完配置后回流仓库：本机 → 仓库。
#
#   bash export.sh             把终端组（Ghostty / zellij / zsh / pi）抄回仓库
#   bash export.sh --dry-run   只看会改哪些文件
#
# 默认不碰 claude-code 组：那边的 settings.json 含真实 token，
# 回流会把凭证写进仓库；确需回流请用 --with-claude-code 并自己先脱敏。
#
# 跑完记得：git diff → git add -A && git commit
set -euo pipefail
cd "$(dirname "$0")"

if ! command -v python3 >/dev/null 2>&1; then
    echo "需要 python3（macOS 自带，或 xcode-select --install）" >&2
    exit 1
fi

exec python3 tools/sync.py export "$@"
