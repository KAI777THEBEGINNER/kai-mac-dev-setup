#!/bin/bash
# Install Kai's macOS dev setup (Ghostty + Claude Code personalization).
# Usage: bash install.sh

set -e

REPO_DIR="$(cd "$(dirname "$0")" && pwd)"
BACKUP_DIR="$HOME/.kai-mac-dev-setup-backup-$(date +%Y%m%d_%H%M%S)"

echo "Kai's macOS Dev Setup Installer"
echo "================================"
echo ""

mkdir -p "$BACKUP_DIR"

# --- Ghostty ---
if [ -d "$HOME/.config/ghostty" ]; then
    echo "Backing up existing Ghostty config..."
    cp -R "$HOME/.config/ghostty" "$BACKUP_DIR/ghostty"
fi

echo "Installing Ghostty config..."
mkdir -p "$HOME/.config/ghostty"
cp "$REPO_DIR/ghostty/config" "$HOME/.config/ghostty/config"
mkdir -p "$HOME/.config/ghostty/custom_shader"
cp "$REPO_DIR/ghostty/shaders/"*.glsl "$HOME/.config/ghostty/custom_shader/"
mkdir -p "$HOME/.config/ghostty/shaders"
cp "$REPO_DIR/ghostty/shaders/shader.glsl" "$HOME/.config/ghostty/shaders/shader.glsl"

# --- Zellij ---
if [ -f "$HOME/.config/zellij/config.kdl" ]; then
    echo "Backing up existing Zellij config..."
    cp "$HOME/.config/zellij/config.kdl" "$BACKUP_DIR/zellij-config.kdl"
fi

echo "Installing Zellij config..."
mkdir -p "$HOME/.config/zellij"
cp "$REPO_DIR/zellij/config.kdl" "$HOME/.config/zellij/config.kdl"

# --- Claude Code ---
mkdir -p "$HOME/.claude"

if [ -f "$HOME/.claude/settings.json" ]; then
    cp "$HOME/.claude/settings.json" "$BACKUP_DIR/settings.json"
fi
if [ -f "$HOME/.claude/settings.local.json" ]; then
    cp "$HOME/.claude/settings.local.json" "$BACKUP_DIR/settings.local.json"
fi
if [ -f "$HOME/.claude/CLAUDE.md" ]; then
    cp "$HOME/.claude/CLAUDE.md" "$BACKUP_DIR/CLAUDE.md"
fi

echo "Installing Claude Code config..."
cp "$REPO_DIR/claude-code/settings.json" "$HOME/.claude/settings.json"
cp "$REPO_DIR/claude-code/settings.local.json" "$HOME/.claude/settings.local.json"
cp "$REPO_DIR/claude-code/CLAUDE.md" "$HOME/.claude/CLAUDE.md"
cp "$REPO_DIR/claude-code/statusline-preset" "$HOME/.claude/statusline-preset"

# Skills
mkdir -p "$HOME/.claude/skills"
cp "$REPO_DIR/claude-code/skills/"*.md "$HOME/.claude/skills/"

# Statusbar hooks
mkdir -p "$HOME/.claude/statusbar"
cp "$REPO_DIR/claude-code/statusbar/"*.js "$HOME/.claude/statusbar/"
cp "$REPO_DIR/claude-code/statusbar/"*.sh "$HOME/.claude/statusbar/"
chmod +x "$HOME/.claude/statusbar/watcher.sh"

# Backup / sanitize scripts
mkdir -p "$HOME/.claude/backup"
cp "$REPO_DIR/claude-code/backup/"*.py "$HOME/.claude/backup/"
cp "$REPO_DIR/claude-code/backup/"*.sh "$HOME/.claude/backup/"
chmod +x "$HOME/.claude/backup/"*.sh

# Pet
mkdir -p "$HOME/.claude/pet"
cp "$REPO_DIR/claude-code/pet/"*.py "$HOME/.claude/pet/"
cp "$REPO_DIR/claude-code/pet/"*.swift "$HOME/.claude/pet/"
cp "$REPO_DIR/claude-code/pet/"*.sh "$HOME/.claude/pet/"
cp "$REPO_DIR/claude-code/pet/"*.txt "$HOME/.claude/pet/"
cp "$REPO_DIR/claude-code/pet/README.md" "$HOME/.claude/pet/README.md"
mkdir -p "$HOME/.claude/pet/assets/frames"

echo ""
echo "Installing config sanitizer LaunchAgent..."
mkdir -p "$HOME/Library/LaunchAgents"
cp "$REPO_DIR/claude-code/backup/com.local.claude-config-sanitizer.plist" "$HOME/Library/LaunchAgents/" 2>/dev/null || true

# Load agent if plist exists
if [ -f "$HOME/Library/LaunchAgents/com.local.claude-config-sanitizer.plist" ]; then
    launchctl bootstrap gui/$(id -u) "$HOME/Library/LaunchAgents/com.local.claude-config-sanitizer.plist" 2>/dev/null || true
fi

echo ""
echo "安装完成。"
echo "备份保存在: $BACKUP_DIR"
echo ""
echo "⚠️  重要：请编辑 ~/.claude/settings.json，把以下占位符替换为真实值："
echo "    ANTHROPIC_AUTH_TOKEN"
echo "    ANTHROPIC_BASE_URL（如使用官方端点可保持默认）"
echo ""
echo "宠物素材需要自行准备：将 spritesheet.webp 放到 ~/.claude/pet/assets/spritesheet.webp"
echo "然后运行：bash ~/.claude/pet/run.sh"
