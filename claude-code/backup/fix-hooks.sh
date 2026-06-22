#!/bin/bash
# 检测并清除 settings.json 中指向不存在文件的 hook
# 用法: bash ~/.claude/backup/fix-hooks.sh
#
# 安全设计：
# - 修改前自动备份到 backup/ 目录
# - 只删除目标文件不存在的 hook 条目
# - shell 内建命令（如 sh -c '...'）不受影响

set -e

SETTINGS="$HOME/.claude/settings.json"
BACKUP_DIR="$HOME/.claude/backup"

if [ ! -f "$SETTINGS" ]; then
    echo "错误: $SETTINGS 不存在"
    exit 1
fi

# 自动备份
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
cp "$SETTINGS" "$BACKUP_DIR/settings.json.pre-hookfix.$TIMESTAMP"
echo "已备份到: $BACKUP_DIR/settings.json.pre-hookfix.$TIMESTAMP"

python3 << 'PYEOF'
import json, os, shlex, sys

def extract_exe_path(cmd):
    """从 hook command 中提取可执行文件的实际路径"""
    cmd = cmd.strip()

    # 展开 ~
    cmd_expanded = cmd.replace("~", os.path.expanduser("~"))

    # 处理 sh -c '...' / bash -c '...' 模式 —— 这些都是 shell 内建，永远有效
    first_word = cmd_expanded.split()[0] if cmd_expanded.split() else ""
    if first_word in ("sh", "bash", "zsh", "exec", "eval", "source", "."):
        # sh -c 'actual command' —— 递归检查 -c 后的脚本中的可执行文件
        try:
            parts = shlex.split(cmd_expanded)
        except ValueError:
            return None
        for i, p in enumerate(parts):
            if p == "-c" and i + 1 < len(parts):
                inner_cmd = parts[i + 1]
                # 递归提取内层命令的可执行文件
                inner_exe = extract_exe_path(inner_cmd)
                if inner_exe is None:
                    return None  # sh/bash 本身总是存在，内层命令在 PATH 中也 OK
                return inner_exe
        return None  # sh/bash 本身总是存在

    # 绝对路径 /Users/xxx/bin/tool --args
    if first_word.startswith("/"):
        return first_word

    # 通过 shlex 正确解析命令
    try:
        parts = shlex.split(cmd_expanded)
    except ValueError:
        return None

    if not parts:
        return None

    exe = parts[0]
    # 绝对路径
    if exe.startswith("/"):
        return exe
    # 相对路径 ./foo 或 ../foo
    if exe.startswith("./") or exe.startswith("../"):
        return os.path.abspath(exe)
    # 纯命令名（在 PATH 中）—— 不检查，信任 PATH
    if "/" not in exe:
        return None

    return None


def command_exists(path):
    """检查路径是否指向存在的可执行文件"""
    if path is None:
        return True
    if os.path.exists(path):
        return True
    return False


def main():
    SETTINGS = os.path.expanduser("~/.claude/settings.json")

    with open(SETTINGS) as f:
        data = json.load(f)

    hooks = data.get("hooks", {})
    if not hooks:
        print("没有 hook 配置，无需修复。")
        return

    removed_count = 0
    cleaned_hooks = {}

    for event, hook_list in hooks.items():
        kept = []
        for entry in hook_list:
            entry_kept_hooks = []
            for h in entry.get("hooks", []):
                cmd = h.get("command", "")
                keep = True

                if cmd:
                    exe = extract_exe_path(cmd)
                    if exe and not command_exists(exe):
                        print(f"  [移除] {event}: {cmd}")
                        print(f"         原因: {exe} 不存在")
                        keep = False
                        removed_count += 1

                if keep:
                    entry_kept_hooks.append(h)

            if entry_kept_hooks:
                entry["hooks"] = entry_kept_hooks
                kept.append(entry)

        if kept:
            cleaned_hooks[event] = kept

    if removed_count == 0:
        print("所有 hook 引用的文件都存在，无需修复。")
        return

    data["hooks"] = cleaned_hooks

    with open(SETTINGS, "w") as f:
        json.dump(data, f, indent=2)
        f.write("\n")

    print(f"\n已移除 {removed_count} 个无效 hook 引用。")
    print("请重启 Claude Code 会话生效。")


if __name__ == "__main__":
    main()
PYEOF
