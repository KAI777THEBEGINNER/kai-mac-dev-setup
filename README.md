# Kai 的 macOS 终端配置

Ghostty + zellij + zsh + pi coding agent 的整套配置，**双向同步**：

- 新电脑：`bash install.sh` 一步装好
- 本机改完：`bash export.sh` 回流仓库 → `git commit`，不会再放几个月就过时

`manifest.json` 是唯一事实来源：哪个文件放哪个路径、哪些东西故意不进仓库，全写在那里，不用再猜。

## 一、新电脑（三步）

```bash
# 1. 装依赖（Apple Silicon）
brew install --cask ghostty
brew install zellij node
npm install -g --ignore-scripts @earendil-works/pi-coding-agent

# 2. 拉配置
git clone https://github.com/KAI777THEBEGINNER/kai-mac-dev-setup.git
cd kai-mac-dev-setup

# 3. 应用（先看计划再执行）
bash install.sh --dry-run
bash install.sh
```

然后：

1. **开一个新的 Ghostty 窗口**（zellij 配置只对新会话生效，窗口里会自动进 `gt-<pid>` 会话）
2. **运行 `pi`，按提示登录**（`auth.json` 不进仓库，四家 provider 的 key 都要重新填）
3. 可选：装终端字体（不装也能用，Ghostty 回退到自带 JetBrains Mono + PingFang SC）

```bash
# 中英文一体：更纱黑体 Sarasa Term SC（需要 7z：brew install p7zip）
curl -L -o /tmp/sarasa.7z https://github.com/be5invis/Sarasa-Gothic/releases/download/v1.0.42/SarasaTermSC-TTF-1.0.42.7z
7z x -y -o/tmp/sarasa /tmp/sarasa.7z
mkdir -p ~/Library/Fonts/SarasaTermSC && cp /tmp/sarasa/*.ttf ~/Library/Fonts/SarasaTermSC/
```

装了新字体 Ghostty 却没认出来：`atsutil databases -removeUser`，再重开 Ghostty。

**族名要写完整**：`Sarasa Term SC` 是族名；不要写成 `Sarasa-Term-SC-Regular`，也不要往族名里拼样式——像 `Ioskeley Mono Term Semi-Condensed` 这种写法，Ghostty 会当成不存在的族名静默回退，字体就“悄悄变了”。

中文字体备选（换掉 `font-family = Sarasa Term SC` 那一行即可）：

| 字体 | 风格 | 安装 |
|---|---|---|
| Sarasa Term SC（现用） | 中英文一体：Iosevka 拉丁 + 思源黑体中文，两个英文 = 一个汉字 | 上面那段 |
| Sarasa Fixed SC | 同上，标点/全角更规整 | `brew install --cask font-sarasa-gothic`（843 MB，全系列） |
| Maple Mono CN | 圆润、连字多，中文是思源黑体子集 | `brew install --cask font-maple-mono-cn` |
| LXGW WenKai | 楷体，阅读舒服，笔画细 | `brew install --cask font-lxgw-wenkai` |
| Noto Sans Mono CJK SC | 中性无个性，最稳 | `brew install --cask font-noto-sans-mono-cjk-sc` |
| PingFang SC | macOS 自带，字面偏满 | 不用装 |

`install.sh` 覆盖前会把你原来的文件备份到 `~/.mac-dev-setup-backup-<时间戳>/`，想回滚直接拷回去。

## 二、日常：改完配置怎么回流

```bash
bash export.sh --dry-run   # 先看会改哪些
bash export.sh             # 本机 → 仓库
git diff                   # 确认改动
git add -A && git commit -m "Update terminal config"
```

`export.sh` 自带凭证扫描，发现 `sk-`、`ghp_`、私钥之类的字符串会停下来（确认安全才加 `--force`）。

应用方向反过来：`bash install.sh`（改了仓库想在另一台机器生效就跑这个）。

## 三、仓库管了什么

| 分组 | 内容 | 目标位置 |
|------|------|----------|
| `ghostty/` | 主配置、背景、shader、macOS 偏好快照 | `~/.config/ghostty/`、`~/Library/Preferences/com.mitchellh.ghostty.plist` |
| `zellij/` | 0.42 配置：自定义键位、内联金色主题 `gold` | `~/.config/zellij/config.kdl` |
| `shell/` | `.zshrc`（zellij 单会话自动启动、PATH、Ghidra）、`.zprofile`（brew 镜像） | `~/` |
| `bin/` | `ghostty-bg`（背景开关）、`ghostty-reload`（热重载）、`ghostty-open-folder`（Finder 入口） | `~/.local/bin/` |
| `pi/` | 行为规则 `AGENTS.md`、`settings.json`、`models.json`、快捷键、subagents、主题、6 个 agents、skills、扩展、脚本 | `~/.pi/agent/` |
| `pii-guard/` | **byted_refined** 脱敏层：正则 + 词表 + 未知人名启发式 | `~/.pi/agent/extensions/pii-guard/` |

### 脱敏层（byted_refined）

`pii-guard/` 是独立的出站脱敏组件，随仓库分发：

- **正则**：手机号、邮箱、身份证、护照、银行卡（Luhn 校验）、各类 API key / 私钥 / JWT、微信号
- **词表**：本人及往来人名的中/英/拼音写法，机构、学校、学号等自定义实体
- **未知人名启发式**（byted_refined 新增）：在「X老师 / 叫X / 姓名：X」这类高置信上下文里认出词表外的新人名，一次认出后整个会话的裸提及也会被挡

词表、会话映射、leaks 日志都在 `~/.pi/agent/pii-guard/`（700/600 权限），**不进仓库**；仓库只放 `wordlist.example.json` 示例和词表初始化脚本。换机器要单独拷词表。

机器相关的绝对路径在仓库里写成 `{{HOME}}`，安装时替换成实际家目录，所以新电脑的用户名不同也不会坏。

### 故意不进仓库的

| 路径 | 原因 |
|------|------|
| `~/.pi/agent/auth.json` | 登录凭证，新机器重新登录 |
| `~/.pi/agent/memory/` | 个人记忆（含真实姓名等），需要时单独 `rsync -a` 过去 |
| `~/.pi/agent/sessions/`、`models-store.json`、`trust.json` | 会话与缓存，可重建 |
| `~/.pi/agent/pii-guard/` | 脱敏词表与映射含真值，绝不入库 |
| `~/.pi/agent/npm/` | pi 扩展包缓存，`install.sh` 会按 `settings.json` 的 `packages` 重装 |
| `~/.local/bin/` 里的二进制与符号链接 | 不是配置 |
| `~/Library/Fonts/SarasaTermSC/` | 字体文件（OFL 1.1），不进仓库 |

完整清单见 `manifest.json` 的 `excluded` 字段。

## 四、几个关键设计（别乱改）

- **zellij 同一时间只保留一个会话**：`.zshrc` 先清掉 EXITED 和没人连的会话，再开 `gt-$$`。以前多开会一直留进程、特别耗电，这是刻意设计，不是 bug。
- **金色边框主题内联在 `config.kdl` 末尾**：不用 `theme_dir` 外置文件，避免「改了没生效又看不出为什么」。
- **Ghostty 背景拆到 `background.conf`**：主配置用 `config-file = ?background.conf` 引入，`ghostty-bg` 改完发 `SIGUSR2` 热重载，不重启进程、不打断会话。
- **pi 扩展目录里的文件由 pi 直接加载**，升级 pi 不会覆盖；`settings.json` 的 `extensions` 只放外部项目（如 `pi-pii-guard`，本机有才登记）。

## 五、常见问题

**zellij 配置改了没生效？** 开新窗口。校验语法：`zellij setup --check`（`[CONFIG FILE]: Well defined.`）。

**改完 shader 没反应？** 跑 `ghostty-reload`（它会先 `+validate-config`，坏配置拒绝热重载）。

**想临时关掉背景（截图／录屏／省电）？** `ghostty-bg off`，再 `ghostty-bg on` 恢复。

**pi 报没模型？** 先登录：`pi` → `/login`；再 `pi --list-models` 确认。

**想看仓库和本机差在哪？** `python3 tools/sync.py status`。

## 六、第三方项目

见 [THIRD_PARTY.md](./THIRD_PARTY.md)。我本人写的配置与脚本用 MIT License。

## Finder 文件夹右键入口

在 Finder 选中文件夹，右键 → Quick Actions（快速操作）→「直接在Ghostty中打开」。Ghostty 未启动时以该文件夹为初始目录启动；已有窗口时复用前台窗口，向右新建 Zellij pane（等同 Ctrl+P、R）并进入所选目录。支持多选，每个文件夹一个 pane。

实现为 `finder/直接在Ghostty中打开.workflow` 和 `bin/ghostty-open-folder`，已纳入 manifest 同步。

注册包含 `NSRequiredContext` 空字典、文件夹 UTI 和 `NSFilenamesPboardType`。本机 `pbs` 的 `NSServicesStatus` 中，该工作流的 `presentation_modes` 已启用 `ContextMenu`、`FinderPreview`、`ServicesMenu` 和 `TouchBar`，并已刷新 Finder 缓存。

2026-10-26 验证：实际右键选中的 `shifu_SKILL` 文件夹，展开 Quick Actions，读取到可见菜单项「直接在Ghostty中打开」（有实际屏幕位置和尺寸）。顶栏 Services 菜单中的可见性不能代替此验证。工作流执行另已验证复用窗口、新建 pane、中文及含空格和引号的路径；未关闭现有会话来测试首次启动。

## Ghostty 配置同步范围

`ghostty/macos-preferences.plist` 保存本机 macOS 偏好快照，包括自动更新检查、窗口恢复和最近窗口位置。向新机器应用这份文件时应先退出 Ghostty，再运行安装脚本；正在运行的应用可能缓存或重新写入偏好。

配置目录中的 `config.bak.*`、shader 的 `.bak.*` 和 `.glsl.txt`、未被引用的 `auto/theme.ghostty` 均不参与当前配置，不同步。`ghostty-tip-resume` 是绑定旧 Zellij 会话的临时升级入口，当前启动命令未引用它，也不入库。字体文件仍按安装说明单独安装。
