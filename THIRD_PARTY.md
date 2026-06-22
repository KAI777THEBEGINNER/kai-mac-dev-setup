# 第三方项目声明

本仓库包含或引用了以下第三方开源项目 / 资源。各自保留原许可证。

## 终端与 CLI

| 项目 | 仓库 | 许可证 | 用途 |
|------|------|--------|------|
| Ghostty | https://github.com/ghostty-org/ghostty | MPL-2.0 | 终端模拟器 |
| Claude Code | https://github.com/anthropics/claude-code | 专有 / 服务条款 | Anthropic 官方 CLI 助手 |
| CC Switch | https://github.com/farion1231/cc-switch | 见仓库 | Claude Code 多账号 / 多模型切换 GUI |

## Claude Code 生态

| 项目 | 仓库 | 许可证 | 用途 |
|------|------|--------|------|
| ClaudeStatusBar | https://github.com/hadesh/ClaudeStatusBar | MIT | macOS 菜单栏实时显示 Claude Code 会话状态 |
| claude-statusline-hud | https://github.com/Thewhey-Brian/claude-statusline-hud | MIT | Claude Code 终端内状态栏 HUD |
| cc-sound-effects | https://github.com/KAI777THEBEGINNER/cc-sound-effects | 见仓库 | 自定义 Claude Code 音效（本人仓库） |
| ghostty-retro-stars | https://github.com/KAI777THEBEGINNER/ghostty-retro-stars | 见仓库 | Ghostty 复古星空终端环境（本人仓库） |

## Ghostty Shaders

以下 shader 文件基于第三方原始代码修改而来，已保留原始注释与作者信息：

| 文件 | 原始作者/仓库 | 原始文件链接 |
|------|--------------|-------------|
| `ghostty/shaders/cursor_blaze.glsl` | dkarter/dotfiles | https://github.com/dkarter/dotfiles/blob/main/config/ghostty/shaders/cursor.glsl |
| `ghostty/shaders/bettercrt.glsl` | Lementknight/dotfiles（基于 m-ahdal/ghostty-shaders 的 retro-terminal.glsl） | https://github.com/Lementknight/dotfiles/blob/main/ghostty/bettercrt.glsl |
| `ghostty/shaders/starfield.glsl` | robb/dotfiles | https://github.com/robb/dotfiles/blob/main/ghostty/shaders/starfield.glsl |
| `ghostty/shaders/shader.glsl` | dkarter/dotfiles | https://github.com/dkarter/dotfiles/blob/main/config/ghostty/shaders/cursor.glsl |

原始 shader 的修改说明见各文件头部注释。

## Claude Code Marketplace Skills

以下 Skill 通过 Claude Code 插件市场安装，未包含在本仓库源码中，使用时请从市场安装：

| Skill | 仓库/来源 |
|-------|----------|
| deep-research | Claude Code 官方 / 市场 |
| docx-to-md | Claude Code 官方 / 市场 |
| epub-to-obsidian | Claude Code 官方 / 市场 |
| ielts 系列 | Claude Code 官方 / 市场 |
| podcast-play / podcast-transcribe | Claude Code 官方 / 市场 |
| ppt-screenshot-pptx | Claude Code 官方 / 市场 |
| storage-analyzer | Claude Code 官方 / 市场 |
| web-perf | Claude Code 官方 / 市场 |
| agents-sdk / cloudflare 系列 / durable-objects / sandbox-sdk / turnstile-spin / workers-best-practices / wrangler | Cloudflare 官方 / 市场 |

## 字体

配置中使用的字体需自行安装：

- JetBrains Mono：https://www.jetbrains.com/lp/mono/
- PingFang SC：macOS 系统自带

## 说明

若你发现本仓库遗漏了某个第三方项目的 attribution，请提 issue，我会立即补充。
