#!/bin/bash
# Auto-sanitizer for Claude Code settings.
# Triggered by launchd whenever settings.json or settings.local.json changes.
# Strips dead app hooks and ensures statusbar hooks are present.

set -e

BACKUP_DIR="$HOME/.claude/backup"
python3 "$BACKUP_DIR/sanitize-settings.py"
python3 "$BACKUP_DIR/sanitize-settings-local.py"
