# CODEBASE.md —— kai-mac-dev-setup 代码地图

> 自动生成于 2026-10-21 20:53（pi codebase-map）。改动代码后运行 `/map` 刷新。
> 用法：先读本图建立全局认知，再按需 read 具体文件；不要每次全量扫仓库。

## 总览

- 技术栈：.py/.sh/.ts
- 源码文件：26 个
- 入口：`pi/extensions/plan-mode/index.ts`

## 目录结构

```
├── ./  (2 files at root)
├── pi/  (23 files)
│   ├── extensions/  (5 files)
│   │   └── plan-mode/  (2 files)
│   ├── scripts/  (5 files)
│   └── skills/  (13 files)
│       ├── epub-to-obsidian/  (1 files)
│       │   └── scripts/  (1 files)
│       ├── human-writing/  (1 files)
│       │   └── scripts/  (1 files)
│       ├── lieflat-charts/  (3 files)
│       │   └── scripts/  (1 files)
│       ├── ppt-screenshot-pptx/  (1 files)
│       ├── proxy-doctor/  (4 files)
│       │   └── scripts/  (4 files)
│       └── storage-analyzer/  (3 files)
│           └── scripts/  (3 files)
└── tools/  (1 files)
```

## 文档

- `README.md`
- `THIRD_PARTY.md`
- `pi/AGENTS.md`
- `pi/USER-GUIDE.md`
- `pi/agents/build-error-resolver.md`
- `pi/agents/cnki-researcher.md`
- `pi/agents/code-reviewer.md`
- `pi/agents/planner.md`
- `pi/agents/python-reviewer.md`
- `pi/agents/typescript-reviewer.md`
- `pi/extensions/plan-mode/README.md`
- `pi/pi-customizations.md`
- `pi/skills/agent-webbridge/SKILL.md`
- `pi/skills/agent-webbridge/references/operations.md`
- `pi/skills/audio-to-notes/SKILL.md`
- `pi/skills/dark_factory_mode.md`
- `pi/skills/deep-research/SKILL.md`
- `pi/skills/docx-to-md/SKILL.md`
- `pi/skills/dragon_subduing_7_steps.md`
- `pi/skills/epub-to-obsidian/SKILL.md`
- `pi/skills/huashubei-paper-figure/SKILL.md`
- `pi/skills/human-writing/SKILL.md`
- `pi/skills/human-writing/references/fiction.md`
- `pi/skills/human-writing/references/formats.md`
- `pi/skills/human-writing/references/forum-prose.md`
- `pi/skills/human-writing/references/reality.md`
- `pi/skills/human-writing/references/revision.md`
- `pi/skills/lieflat-charts/README.en.md`
- `pi/skills/lieflat-charts/README.md`
- `pi/skills/lieflat-charts/SKILL.md`

## 源码地图

### (root)/
- `export.sh` —— 本机改完配置后回流仓库：本机 → 仓库。
- `install.sh` —— 新机器装配置：仓库 → 本机。

### pi/extensions/
- `session-title.ts` —— Session Title — 语义总结任务内容作为会话标题 （符号：STATUS_KEY、TITLE_MAX、CONVERSATION_BUDGET、PER_MESSAGE_CAP、DEBOUNCE_MS、GEN_TIMEOUT_MS、extractText、extractToolNames、buildConversationText、fingerprint、cleanTitle、buildTitlePrompt）
- `preannounce-guard.ts` —— 预告守卫（Preannounce Guard）—— Pi 全局扩展 作用：拦住那些会打扰用户的 shell 命令，在执行前先让「预告」刘海 toast 倒数 3 秒。 为什么需要它：AI 可能忘记先问用户，这类命令一旦执行，用户的前台就被抢了 —— 这是机械兜底。 安装：把本文件 （符号：BIN、MODE、MAX_MESSAGE、MUTATING_WEBRIDGE_ACTIONS、INTERACTIVE_CAPTURE、clip、describeOpenTarget、detect、runAnnounce、preannounceGuard）
- `codebase-map.ts` —— codebase-map —— pi 扩展：项目代码地图自动注入 + 维护命令 （符号：MAP_NAME、MAX_INJECT_BYTES、MTIME_TAG、SCRIPT、findMap、runGenerator、looksLikeProject）

### pi/extensions/plan-mode/
- `utils.ts` —— Pure utility functions for plan mode. Extracted for testability. （符号：DESTRUCTIVE_PATTERNS、SAFE_PATTERNS、isSafeCommand、TodoItem、cleanStepText、extractTodoItems、extractDoneSteps、markCompletedSteps）
- `index.ts` —— Plan Mode Extension Read-only exploration mode for safe code analysis. When enabled, built-in write tools are disabled. Features: - /plan co （符号：PLAN_MODE_TOOLS、NORMAL_MODE_TOOLS、PLAN_MODE_DISABLED_TOOLS、PLAN_MANAGED_TOOLS、isAssistantMessage、getTextContent、planModeExtension）

### pi/scripts/
- `codebase-map.mjs` —— codebase-map —— 为项目生成 CODEBASE.md 代码地图（pi 上下文资产） （符号：__dirname、MAX_MAP_BYTES、MAX_FILES、MAX_SYMBOLS_PER_FILE、MAX_TREE_ENTRIES、MAX_TREE_DEPTH、IGNORE_DIRS、IGNORE_FILES、BINARY_EXTS、SOURCE_EXTS、DOC_EXTS、SYMBOL_RULES、ruleFor、walk、extractSymbols）
- `md2pdf.py` —— -*- coding: utf-8 -*- Markdown -> PDF（纯本地，无浏览器、无 LaTeX） （符号：inline、h2_flowable、split_row、col_widths、_old_col_widths、parse、build）
- `openrouter_toggle.py` —— openrouter 凭证开关 —— 让 /model 列表里的 openrouter 模型整体出现或消失。 （符号：acquire_lock、read_json、atomic_write、cmd_off、cmd_on、cmd_status、main）
- `volc_vc_transcribe.py` —— 火山引擎录音文件识别 2.0 极速版批量转写 —— 音频目录 → 带时间戳逐字稿(md) （符号：load_creds、recognize、fmt_ts、write_md、collect_audio、main）
- `ocr_image.py` —— 快速读图 OCR（deepseek 等不支持图像输入的模型读图专用）。 （符号：ocr、main）

### pi/skills/epub-to-obsidian/scripts/
- `convert_epubs.py` （符号：sanitize_filename、rewrite_image_paths、extract_images_from_epub、walk_toc、get_toc_chapters、html_to_md、split_html_by_fragments、process_epub、fallback_by_document、split_txt_by_chapters、main）

### pi/skills/human-writing/scripts/
- `check_prose.py` —— 检查中文成稿的硬禁令与常见模型化形状。只报警，不自动改文。""" （符号：Paragraph、han_count、line_number、excerpt、mask_non_prose、non_overlapping_terms、all_matches、heavy_de_sentences、anaphora_runs、sentence_length_cv、bracket_highlights、prose_paragraphs、metaphor_cluster、short_streak、opener_counts）

### pi/skills/lieflat-charts/
- `color-presets.js` —— ═══════════════════════════════════════════════════════════════
- `mono-tokens.js` —— ═══════════════════════════════════════════════════════════════

### pi/skills/lieflat-charts/scripts/
- `validate.mjs` （符号：root、requiredColorTemplates、required、failures、htmlFiles、ignoredDirectories、treemapTemplates、walk、rel、lineNumber、colorChannels、collectPresetChannels、catalogSource、skillSource、presetChannels）

### pi/skills/ppt-screenshot-pptx/
- `ppt_screenshot.py` —— -*- coding: utf-8 -*- （符号：export_pptx_to_pdf、pdf_to_images、create_screenshot_pptx、main）

### pi/skills/proxy-doctor/scripts/
- `probe.sh` —— proxy-doctor｜墙内体检：从本机（墙内）测节点 443 的「TCP 建连 + TLS 握手」总耗时（CONNECT 延迟）， 把网络现象翻译成可行动结论。模式： ./probe.sh 普通：打印结论 + 写日志（人看） ./probe.sh --notify 预警：仅在
- `server-diag.sh` —— proxy-doctor｜服务端深诊：当墙内 probe 报「TLS 失败」或想查根因时，SSH 上节点做只读检查。 - Xray 是否在跑、443 是否监听、防火墙规则 - 当前 SNI 的证书链 DER 大小 vs REALITY 8192 上限（撞上限会握手失败，却长得像「
- `watch-install.sh` —— proxy-doctor｜启用自动预警：装一个 launchd 定时任务，每 N 分钟在本机自测节点一次， 仅当节点「健康↔异常」翻转时弹 macOS 通知。装完即生效，重启电脑后自动恢复。 ./watch-install.sh 默认每 30 分钟 ./watch-install
- `watch-uninstall.sh` —— proxy-doctor｜关闭自动预警：卸载 launchd 定时任务并删除 plist

### pi/skills/storage-analyzer/scripts/
- `scan.py` —— Read-only storage scanner (macOS + Windows). （符号：human、run、du_children、dev_caches_macos、system_info_macos、scan_macos、dir_size_bytes、scandir_children、list_drives_windows、system_info_windows、scan_windows、main）
- `server.py` —— Serve the storage report with a guarded one-click delete API (macOS + Windows). （符号：expand、load、move_to_trash、_trash_macos、_trash_windows、hard_delete、open_in_file_manager、Handler、main）
- `build_report.py` —— Inject an analysis JSON into the HTML template -> a standalone report. （符号：main）

### tools/
- `sync.py` —— 配置同步器：本机 ⇄ 仓库。 （符号：info、warn、fail、load_manifest、expand、pretty、is_binary、render、backup_path、write_file、snapshot、walk_selected、apply_chmod、export_entry、apply_entry）

## 其他文件

`LICENSE`、`bin/ghostty-bg`、`bin/ghostty-reload`、`ghostty/background.conf`、`ghostty/config`、`ghostty/custom_shader/bettercrt.glsl`、`ghostty/custom_shader/cursor_blaze.glsl`、`ghostty/custom_shader/starfield.glsl`、`ghostty/custom_shader/starfield_downloaded.glsl`、`ghostty/shaders/shader.glsl`、`manifest.json`、`pi/extensions/pi-computer-use.json`、`pi/keybindings.json`、`pi/models.json`、`pi/patches/v1-bar-jump-已禁用/interactive-mode.js.kpatch`、`pi/patches/v1-bar-jump-已禁用/tui-alt-screen.js.kpatch`、`pi/patches/v1-bar-jump-已禁用/user-message.js.kpatch`、`pi/patches/v2-jump-2026-08-23-assistant-message.js.kpatch`、`pi/patches/v2-jump-2026-08-23-keybindings.js.kpatch`、`pi/patches/v2-jump-2026-08-23-tui-alt-screen.js.kpatch`、`pi/patches/v2-jump-2026-08-23-user-message.js.kpatch`、`pi/pi-dsh-minimal.json`、`pi/settings.json`、`pi/skills/agent-webbridge/tools.json`、`pi/skills/human-writing/LICENSE`、`pi/skills/human-writing/VERSION`、`pi/skills/human-writing/agents/openai.yaml`、`pi/skills/lieflat-charts/LICENSE`、`pi/skills/lieflat-charts/agents/openai.yaml`、`pi/skills/lieflat-charts/examples/lenny-2026-survey.html`、`pi/skills/lieflat-charts/templates/basics-gallery.html`、`pi/skills/lieflat-charts/templates/big-circular.html`、`pi/skills/lieflat-charts/templates/big-force.html`、`pi/skills/lieflat-charts/templates/big-threads.html`、`pi/skills/lieflat-charts/templates/color/basics-palm.html`、`pi/skills/lieflat-charts/templates/color/basics-porcelain.html`、`pi/skills/lieflat-charts/templates/color/basics-wire.html`、`pi/skills/lieflat-charts/templates/color/big-circular-palm.html`、`pi/skills/lieflat-charts/templates/color/big-circular-porcelain.html`、`pi/skills/lieflat-charts/templates/color/big-force-palm.html`（共 57 个，仅列前 40）

## Finder 文件夹入口（2026-10-26）

- `finder/直接在Ghostty中打开.workflow` → `~/Library/Services/`，接收文件夹的 Finder 快速操作。
- `bin/ghostty-open-folder` → `~/.local/bin/`，首次启动 Ghostty 时指定 cwd；已打开时找到前台终端的 Zellij session，向右新建指定 cwd 的 pane，复用现有窗口。
- `manifest.json` 包含上述两个同步项。
- Finder 菜单注册必须包含 `NSRequiredContext = {}`，否则服务会进入缓存但默认不显示。
- 本机已启用 `pbs` 中该项的 `presentation_modes.ContextMenu`，刷新 Finder 后实测「文件夹右键 → Quick Actions → 直接在Ghostty中打开」可见；顶栏 Services 可见不能代替右键验证。

## Ghostty 配置核对（2026-10-26）

- `ghostty/macos-preferences.plist` → `~/Library/Preferences/com.mitchellh.ghostty.plist`，由 manifest 的 `ghostty-macos-preferences` 同步，包含 macOS 偏好和最近窗口位置；应用时先退出 Ghostty。
- Ghostty 当前主配置只引入 `background.conf`，后者引用 3 个 shader；仓库同时保留另外 2 个本机 shader 源文件。
- 历史配置备份、shader 草稿、未引用自动主题与旧会话临时升级脚本不属于同步范围。
