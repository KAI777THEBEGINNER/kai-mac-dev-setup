# 第三方项目声明

本仓库包含或引用了以下第三方开源项目 / 资源，各自保留原许可证。

## 终端与工具

| 项目 | 仓库 | 许可证 | 用途 |
|------|------|--------|------|
| Ghostty | https://github.com/ghostty-org/ghostty | MPL-2.0 | 终端模拟器 |
| Zellij | https://github.com/zellij-org/zellij | MIT | 终端复用器（multiplexer） |
| pi coding agent | https://github.com/earendil-works/pi | MIT | 本仓库 `pi/` 配置服务的 AI 编码助手 |
| ghostty-retro-stars | https://github.com/KAI777THEBEGINNER/ghostty-retro-stars | 见仓库 | Ghostty 复古星空终端环境（本人仓库） |

## Ghostty Shaders

以下 shader 文件基于第三方原始代码修改而来，已保留原始注释与作者信息：

| 文件 | 原始作者/仓库 | 原始文件链接 |
|------|--------------|-------------|
| `ghostty/custom_shader/cursor_blaze.glsl` | dkarter/dotfiles | https://github.com/dkarter/dotfiles/blob/main/config/ghostty/shaders/cursor.glsl |
| `ghostty/custom_shader/bettercrt.glsl` | Lementknight/dotfiles（基于 m-ahdal/ghostty-shaders 的 retro-terminal.glsl） | https://github.com/Lementknight/dotfiles/blob/main/ghostty/bettercrt.glsl |
| `ghostty/custom_shader/starfield.glsl` | robb/dotfiles | https://github.com/robb/dotfiles/blob/main/ghostty/shaders/starfield.glsl |
| `ghostty/custom_shader/starfield_downloaded.glsl` | robb/dotfiles（同上，下载版） | 同上 |
| `ghostty/shaders/shader.glsl` | dkarter/dotfiles | https://github.com/dkarter/dotfiles/blob/main/config/ghostty/shaders/cursor.glsl |

原始 shader 的修改说明见各文件头部注释。

## 随仓库分发的 Skill

`pi/skills/` 下的部分 skill 来自公开项目，各自保留原许可证与声明，详见对应目录：

| Skill | 来源 | 许可证 |
|-------|------|--------|
| `lieflat-charts` | https://moxt.ai（随附 `LICENSE` 与 `THIRD_PARTY_NOTICES.md`） | 见目录内文件 |
| `human-writing` | 随附 `LICENSE` | 见目录内文件 |
| `swiftui-pro`、`deep-research`、`docx-to-md`、`epub-to-obsidian`、`ppt-screenshot-pptx`、`storage-analyzer`、`proxy-doctor`、`obsidian-vault` | 公开市场 / 官方示例，部分经本人改写 | 见各 `SKILL.md` |

## 字体

配置中引用的字体需自行安装：

- Ioskeley Mono（基于 Iosevka 的 OFL 字体，风格受 Berkeley Mono 影响）：https://github.com/ahatem/IoskeleyMono
  在线样张（可直接打字对比）：https://ahatem.github.io/IoskeleyMono/
- PingFang SC：macOS 系统自带
- JetBrains Mono：https://www.jetbrains.com/lp/mono/

## 说明

若你发现本仓库遗漏了某个第三方项目的 attribution，请提 issue，我会立即补充。
