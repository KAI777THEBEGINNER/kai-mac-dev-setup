#!/bin/bash
# 恢复 Claude Code 非 env 配置（保留当前模型/API 设置），并自动清理已卸载 app 残留。
# 用法: bash ~/.claude/backup/restore-settings.sh
#
# 设计思路：
# - env 段随模型切换而变化，不应被覆盖。
# - 从干净备份恢复 hooks / permissions / plugins / statusLine 等。
# - 恢复后再运行 sanitize 脚本，确保已卸载的 codeisland / ping-island / vibe-island
#   不会复活，并保证 statusbar / sound-effect hooks 始终存在。

set -e

BACKUP_DIR="$(cd "$(dirname "$0")" && pwd)"
SETTINGS="$HOME/.claude/settings.json"
LOCAL_SETTINGS="$HOME/.claude/settings.local.json"
SANITIZE="$BACKUP_DIR/sanitize-settings.py"
SANITIZE_LOCAL="$BACKUP_DIR/sanitize-settings-local.py"

echo "正在恢复 Claude Code 非 env 配置..."

# 找到最新的干净备份
JSON_BAK=$(ls -t "$BACKUP_DIR"/settings.json.clean.* 2>/dev/null | head -1)
LOCAL_BAK=$(ls -t "$BACKUP_DIR"/settings.local.json.clean.* 2>/dev/null | head -1)

if [ -z "$JSON_BAK" ] || [ -z "$LOCAL_BAK" ]; then
    echo "错误: 找不到备份文件"
    exit 1
fi

echo "  settings.json  -> $JSON_BAK"
echo "  settings.local.json -> $LOCAL_BAK"

# ---- 关键：保留当前 env 段 ----
if [ -f "$SETTINGS" ]; then
    CURRENT_ENV=$(python3 -c "
import json, sys
with open('$SETTINGS') as f:
    data = json.load(f)
print(json.dumps(data.get('env', {}), indent=2))
" 2>/dev/null || echo "{}")
else
    CURRENT_ENV="{}"
fi

# 先恢复 settings.local.json（不涉及 env，直接覆盖）
cp "$LOCAL_BAK" "$LOCAL_SETTINGS"

# 恢复 settings.json 的干净版本
cp "$JSON_BAK" "$SETTINGS"

# 把当前 env 写回去
python3 -c "
import json
with open('$SETTINGS') as f:
    data = json.load(f)
data['env'] = json.loads('''$CURRENT_ENV''')
with open('$SETTINGS', 'w') as f:
    json.dump(data, f, indent=2)
    f.write('\n')
"

# ---- 恢复后强制消毒：清除已卸载 app 残留并补全 statusbar / 音效 hooks ----
echo ""
echo "正在清理已卸载 app 残留并补全 hooks..."
python3 "$SANITIZE"
python3 "$SANITIZE_LOCAL"

echo ""
echo "恢复完成。env 配置已保留，hooks/permissions/plugins/statusLine 已从备份恢复并消毒。"
echo "请重启 Claude Code 会话生效。"
