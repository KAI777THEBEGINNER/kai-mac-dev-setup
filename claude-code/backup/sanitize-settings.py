#!/usr/bin/env python3
"""
Sanitize ~/.claude/settings.json:
- Strip all codeisland / ping-island / vibe-island hooks and statusLine refs.
- Ensure statusbar hooks (ClaudeStatusBar.app) are installed.
- Restore latest cc-sound-effects hooks.
- Keep current env and minimal permissions.
"""
import json
import os
from pathlib import Path

HOME = Path.home()
SETTINGS = HOME / ".claude" / "settings.json"
NODE = "/usr/local/bin/node"
SB_UPDATE = HOME / ".claude" / "statusbar" / "update.js"
SB_LIFE = HOME / ".claude" / "statusbar" / "lifecycle.js"
SL_HUD = HOME / ".claude" / "plugins" / "claude-statusline-hud" / "scripts" / "statusline.sh"

DEAD = ("codeisland", "ping-island", "vibe-island")

# 只保留失败音效；成功/请求确认音效按用户要求移除。
SOUND_FILES = {
    "StopFailure": "surprise-mother-fer.aiff",
}

SOUND_HOOKS = {
    event: [{"hooks": [{"type": "command", "command": f"sh -c 'afplay \"$HOME/Library/Sounds/{filename}\"'"}]}]
    for event, filename in SOUND_FILES.items()
}


def is_sound_hook(entry):
    """判断一个 hook 条目是否是 cc-sound-effects 音效（按 afplay + Library/Sounds 路径）。"""
    for h in entry.get("hooks", []):
        cmd = h.get("command", "")
        if "afplay" in cmd and "Library/Sounds" in cmd:
            return True
    return False

STATUSBAR_HOOKS = {
    "UserPromptSubmit": [{"hooks": [{"type": "command", "command": f"{NODE} {SB_UPDATE} prompt"}]}],
    "PreToolUse": [{"matcher": "*", "hooks": [{"type": "command", "command": f"{NODE} {SB_UPDATE} pre"}]}],
    "PostToolUse": [{"matcher": "*", "hooks": [{"type": "command", "command": f"{NODE} {SB_UPDATE} post"}]}],
    "Notification": [{"hooks": [{"type": "command", "command": f"{NODE} {SB_UPDATE} notify"}]}],
    "Stop": [{"hooks": [{"type": "command", "command": f"{NODE} {SB_UPDATE} stop"}]}],
    "SessionStart": [{"hooks": [{"type": "command", "command": f"{NODE} {SB_LIFE} start"}]}],
    "SessionEnd": [{"hooks": [{"type": "command", "command": f"{NODE} {SB_LIFE} end"}]}],
}


def is_dead(entry):
    for h in entry.get("hooks", []):
        cmd = h.get("command", "")
        if any(d in cmd for d in DEAD):
            return True
    return False


def merge_event(existing, additions):
    """Append additions after stripping any dead hooks from existing."""
    cleaned = [e for e in existing if not is_dead(e)]
    # Avoid duplicates: if an identical command already exists, skip adding it.
    existing_cmds = {
        h.get("command", "")
        for e in cleaned
        for h in e.get("hooks", [])
        if h.get("type") == "command"
    }
    for add in additions:
        add_cmds = [h.get("command", "") for h in add.get("hooks", []) if h.get("type") == "command"]
        if any(c in existing_cmds for c in add_cmds):
            continue
        cleaned.append(add)
        existing_cmds.update(add_cmds)
    return cleaned


def main():
    with open(SETTINGS, "r") as f:
        raw = f.read()
        data = json.loads(raw)

    hooks = data.get("hooks", {})

    # 1. Strip dead hooks from every event.
    for event, entries in list(hooks.items()):
        hooks[event] = [e for e in entries if not is_dead(e)]
        if not hooks[event]:
            del hooks[event]

    # 2. Install / refresh statusbar hooks.
    for event, additions in STATUSBAR_HOOKS.items():
        hooks[event] = merge_event(hooks.get(event, []), additions)

    # 3. 先清除所有音效 hook，再按当前策略重新安装（目前只保留 StopFailure）。
    for event in list(hooks.keys()):
        hooks[event] = [e for e in hooks[event] if not is_sound_hook(e)]
        if not hooks[event]:
            del hooks[event]
    for event, additions in SOUND_HOOKS.items():
        hooks[event] = merge_event(hooks.get(event, []), additions)

    data["hooks"] = hooks

    # 4. Fix statusLine: remove vibe-island, prefer claude-statusline-hud.
    sl_cmd = data.get("statusLine", {}).get("command", "")
    if "vibe-island" in sl_cmd or not SL_HUD.exists():
        if SL_HUD.exists():
            data["statusLine"] = {"type": "command", "command": f"bash {SL_HUD}"}
        else:
            data.pop("statusLine", None)
    else:
        data["statusLine"] = {"type": "command", "command": sl_cmd}

    # 5. Ensure plugins section has swift-lsp if missing.
    if "enabledPlugins" not in data:
        data["enabledPlugins"] = {"swift-lsp@claude-plugins-official": True}

    # 只在真正发生变化时才写回，避免文件系统 watcher 死循环。
    new_raw = json.dumps(data, indent=2) + "\n"
    if new_raw != raw:
        with open(SETTINGS, "w") as f:
            f.write(new_raw)
        print(f"Wrote sanitized {SETTINGS}")
    else:
        print(f"No change needed for {SETTINGS}")


if __name__ == "__main__":
    main()
