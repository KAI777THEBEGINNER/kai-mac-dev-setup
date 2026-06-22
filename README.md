# Kai's macOS Dev Setup

本仓库汇总了我在 macOS 上使用的 Ghostty 终端配置与 Claude Code 个性化配置（不含 memory）。

## 包含内容

| 目录 | 说明 |
|------|------|
| `ghostty/` | Ghostty 终端配置 + 复古星空 / CRT / 光标尾迹 Shader |
| `claude-code/CLAUCE.md` | 我的 Claude Code 全局行为约定 |
| `claude-code/settings.json` | Claude Code 主配置（已脱敏，需自行填入 API token） |
| `claude-code/settings.local.json` | 本地权限白名单 |
| `claude-code/skills/` | 自定义 Skill：`dark-factory-mode`、`dragon-subduing-7-steps` |
| `claude-code/statusbar/` | [ClaudeStatusBar](https://github.com/hadesh/ClaudeStatusBar) 的 hooks 脚本 |
| `claude-code/backup/` | 配置自动消毒与恢复脚本 |
| `claude-code/pet/` | 桌面 Clippy 宠物源码（需自备 spritesheet） |
| `claude-code/statusline-preset` | Claude Code 终端状态栏预设 |

## 快速安装

```bash
git clone https://github.com/KAI777THEBEGINNER/kai-mac-dev-setup.git
cd kai-mac-dev-setup
bash install.sh
```

`install.sh` 会：
1. 备份你现有的 `~/.config/ghostty` 和 `~/.claude` 相关文件
2. 将本仓库的配置复制到对应位置
3. 提示你需要手动填入的 API token / 路径
4. 安装并加载配置自动消毒的 LaunchAgent

## 重要：填入你的 secrets

`claude-code/settings.json` 中的以下值被替换成了占位符，安装后必须改回真实值：

- `ANTHROPIC_AUTH_TOKEN`
- `ANTHROPIC_BASE_URL`（如果你用官方端点则保持默认）

## 第三方项目声明

所有使用到的第三方项目及其许可证见 [THIRD_PARTY.md](./THIRD_PARTY.md)。

## 自行构建桌面宠物

`claude-code/pet/` 不包含 Clippy 图像素材（版权问题）。运行前需要将 spritesheet.webp 放到 `claude-code/pet/assets/spritesheet.webp`，然后：

```bash
cd ~/.claude/pet
bash run.sh
```

## License

本仓库中我本人创作的配置与脚本使用 MIT License。第三方项目各自保留原许可证，详见 THIRD_PARTY.md。
