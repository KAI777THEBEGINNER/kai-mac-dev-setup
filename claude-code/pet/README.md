# Claude Code Desktop Pet — Clippy

Swift + AppKit 原生桌宠，读取 Claude Code session 状态实时响应。

## 行为

- **idle** → Clippy 原地待机动画
- **busy** → Clippy 快速活跃动画
- **busy → idle** → 先播放一次完成动画，再回待机
- 可拖拽到屏幕任意位置，位置自动保存
- 右键菜单可退出

## 启动

```bash
~/.claude/pet/run.sh
```

首次运行会自动编译 + 提取帧，后续直接启动。

## 自启动（可选）

```bash
# 创建 LaunchAgent 实现开机自启
mkdir -p ~/Library/LaunchAgents
cat > ~/Library/LaunchAgents/com.claude.pet.plist <<'EOF'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.claude.pet</string>
    <key>ProgramArguments</key>
    <array>
        <string>/Users/zhaoziqi/.claude/pet/run.sh</string>
    </array>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <false/>
</dict>
</plist>
EOF
launchctl load ~/Library/LaunchAgents/com.claude.pet.plist
```

## 文件

| 文件 | 说明 |
|---|---|
| `clippy-pet.swift` | 主程序源码 |
| `extract_frames.py` | 一次性：webp → PNG 帧 |
| `assets/frames/` | 57 张提取后的 PNG 帧 |
| `run.sh` | 编译+启动脚本 |

## 状态来源

轮询 `~/.claude/sessions/*.json` 中的 `status` 字段，零侵入，不需要改 Claude Code 配置。
