#!/usr/bin/env python3
"""
Sanitize ~/.claude/settings.local.json:
- Remove all permissions entries that reference dead apps (codeisland, ping-island, vibe-island).
"""
import json
from pathlib import Path

SETTINGS_LOCAL = Path.home() / ".claude" / "settings.local.json"
DEAD = ("codeisland", "ping-island", "vibe-island")


def main():
    with open(SETTINGS_LOCAL, "r") as f:
        raw = f.read()
        data = json.loads(raw)

    perms = data.get("permissions", {}).get("allow", [])
    cleaned = [p for p in perms if not any(d in p.lower() for d in DEAD)]

    if cleaned:
        data["permissions"]["allow"] = cleaned
    else:
        data.pop("permissions", None)

    new_raw = json.dumps(data, indent=2) + "\n"
    if new_raw != raw:
        with open(SETTINGS_LOCAL, "w") as f:
            f.write(new_raw)
        print(f"Wrote sanitized {SETTINGS_LOCAL}")
    else:
        print(f"No change needed for {SETTINGS_LOCAL}")


if __name__ == "__main__":
    main()
