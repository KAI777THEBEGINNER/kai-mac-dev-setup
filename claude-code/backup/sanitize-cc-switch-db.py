#!/usr/bin/env python3
"""
Sanitize CC Switch's stored common_config_claude in ~/.cc-switch/cc-switch.db.
- Strip codeisland / ping-island / vibe-island hooks and statusLine refs.
- Ensure statusbar hooks are present.
- Keep only StopFailure sound effect.
- Fix statusLine to claude-statusline-hud.

Safe to run while CC Switch is running, but recommended to quit the app first
since the DB uses journal_mode=delete.
"""
import json
import sqlite3
import shutil
from pathlib import Path

HOME = Path.home()
DB = HOME / ".cc-switch" / "cc-switch.db"
BACKUP = HOME / ".cc-switch" / "cc-switch.db.bak-before-sanitize"
NODE = "/usr/local/bin/node"
SB_UPDATE = HOME / ".claude" / "statusbar" / "update.js"
SB_LIFE = HOME / ".claude" / "statusbar" / "lifecycle.js"
SL_HUD = HOME / ".claude" / "plugins" / "claude-statusline-hud" / "scripts" / "statusline.sh"

DEAD = ("codeisland", "ping-island", "vibe-island")

SOUND_FILES = {"StopFailure": "surprise-mother-fer.aiff"}
SOUND_HOOKS = {
    event: [{"hooks": [{"type": "command", "command": f"sh -c 'afplay \"$HOME/Library/Sounds/{filename}\"'"}]}]
    for event, filename in SOUND_FILES.items()
}

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
        if any(d in h.get("command", "") for d in DEAD):
            return True
    return False


def is_sound_hook(entry):
    for h in entry.get("hooks", []):
        cmd = h.get("command", "")
        if "afplay" in cmd and "Library/Sounds" in cmd:
            return True
    return False


def merge_event(existing, additions):
    cleaned = [e for e in existing if not is_dead(e)]
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


def sanitize(data):
    hooks = data.get("hooks", {})

    for event, entries in list(hooks.items()):
        hooks[event] = [e for e in entries if not is_dead(e)]
        if not hooks[event]:
            del hooks[event]

    for event, additions in STATUSBAR_HOOKS.items():
        hooks[event] = merge_event(hooks.get(event, []), additions)

    for event in list(hooks.keys()):
        hooks[event] = [e for e in hooks[event] if not is_sound_hook(e)]
        if not hooks[event]:
            del hooks[event]
    for event, additions in SOUND_HOOKS.items():
        hooks[event] = merge_event(hooks.get(event, []), additions)

    data["hooks"] = hooks

    sl_cmd = data.get("statusLine", {}).get("command", "")
    if "vibe-island" in sl_cmd or not SL_HUD.exists():
        if SL_HUD.exists():
            data["statusLine"] = {"type": "command", "command": f"bash {SL_HUD}"}
        else:
            data.pop("statusLine", None)

    return data


def main():
    if not DB.exists():
        print(f"Database not found: {DB}")
        return

    shutil.copy(DB, BACKUP)

    conn = sqlite3.connect(DB)
    cur = conn.cursor()
    cur.execute("SELECT value FROM settings WHERE key = 'common_config_claude'")
    row = cur.fetchone()
    if not row:
        print("common_config_claude not found in CC Switch database")
        return

    data = json.loads(row[0])
    new_data = sanitize(data)
    new_json = json.dumps(new_data, indent=2)

    if new_json == row[0]:
        print("CC Switch common_config_claude already clean; no change written")
        return

    cur.execute(
        "UPDATE settings SET value = ? WHERE key = 'common_config_claude'",
        (new_json,),
    )
    conn.commit()
    conn.close()
    print(f"Sanitized common_config_claude in {DB}")
    print(f"Backup saved to {BACKUP}")


if __name__ == "__main__":
    main()
