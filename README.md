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
3. 可选：装字体 `Ioskeley Mono`，否则 Ghostty 回退到系统等宽字体，其余效果不变

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
| `ghostty/` | 主配置、`background.conf`（毛玻璃＋三个 shader，`ghostty-bg` 一键开关）、shader 源文件 | `~/.config/ghostty/` |
| `zellij/` | 0.42 配置：自定义键位、内联金色主题 `gold` | `~/.config/zellij/config.kdl` |
| `shell/` | `.zshrc`（zellij 单会话自动启动、PATH、Ghidra）、`.zprofile`（brew 镜像） | `~/` |
| `bin/` | `ghostty-bg`（背景开关）、`ghostty-reload`（改 shader 后热重载） | `~/.local/bin/` |
| `pi/` | 行为规则 `AGENTS.md`、`settings.json`、`models.json`、快捷键、subagents、主题、6 个 agents、skills、扩展、脚本 | `~/.pi/agent/` |
| `pi/extensions/pii-guard/` | **byted_refined** 脱敏层：正则 + 词表 + 未知人名启发式 | `~/.pi/agent/extensions/pii-guard/` |

### 脱敏层（byted_refined）

`pi/extensions/pii-guard/` 是独立的出站脱敏组件，随仓库分发：

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
| `~/Library/Fonts/IoskeleyMono/` | 26 MB 字体，非本人版权 |

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
