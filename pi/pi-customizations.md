# pi 个性化改造记录

> 本文件记录我对 pi（@earendil-works/pi-coding-agent，全局安装于
> `/Users/zhaoziqi/.npm-global/lib/node_modules/@earendil-works/pi-coding-agent`）源码做的三处个性化改造。
> `pi update self` 或 npm 升级会**覆盖 dist 与 node_modules 里的改动**。
> 恢复方式：升级后对我说「恢复我对派的个性化改造」，按本文件逐条重做即可。
> 所有改造点都带 `KAI-PATCH` 注释标记，可用 `grep -rn "KAI-PATCH"` 检查丢失了哪些。

---

## 改造一：费用显示 美元 → 人民币 + 汇率乘积

- **文件**：`dist/modes/interactive/components/footer.js`
- **位置**：render 方法里 statsParts 构建处（costStr 那一行）
- **原版**：
  ```js
  const costStr = `$${usageTotals.cost.toFixed(3)}${usingSubscription ? " (sub)" : ""}`;
  ```
- **改成**：
  ```js
  const costStr = `[¥${(usageTotals.cost * 7).toFixed(3)}]${usingSubscription ? " (sub)" : ""}`;
  ```
- **要点**：`$` → `¥`（人民币展示）；金额 `× 7`（美元按 7 的汇率换算）；外裹 `[ ]` 提升可读性。

## 改造二：费用数字加中括号

- 与改造一同一条代码，即上面 `[¥...]` 的中括号部分。原本想突出费用数字，一并记录在改造一里即可。

## 改造三：TUI 会话跳转增强（v2 键盘版，2026-08-23 启用）

> **状态：已启用（v2 键盘版，替代 v1 点击提示栏方案）**。
> v1（鼠标点击提示栏跳转）已于 2026-08-23 禁用，补丁存档在
> `~/.pi/agent/patches/v1-bar-jump-已禁用/`。
> v2 的完整补丁存档在 `~/.pi/agent/patches/v2-jump-2026-08-23-*.kpatch`
> （官方原版 → 定制版的 diff），升级后重做方式：对对应文件执行
> `patch < 对应 .kpatch`，或直接说「恢复改造三 v2」。

**解决的问题**：
1. `ctrl+shift+down`（下一条 prompt）在长会话里完全失效。根因：pi 原版
   给带工具调用的 assistant 消息不打 OSC133_A 跳转标记，而 agentic 会话里
   几乎所有 assistant 消息都带工具调用，向下找不到任何跳转目标。
2. macOS 没有 End 键，回底部/回最新输入不方便。

**v2 功能（纯键盘，无提示栏）**：
- 带工具调用的 assistant 消息补上 OSC133_A 行首标记 → `ctrl+shift+down`
  逐条向下跳恢复可用，且向下找不到目标时兜底回到底部
- 新增 `tui.altScreen.latestInput` 键位：`shift+up` 一键跳到最新一条
  用户输入（Claude Code 同款手势），落点补偿 -2 行保证消息文本可见
- 用户消息首行加零宽标记 `\x1b]7777;pi-user\x07`（终端不可见，供
  shift+up 精确定位），绘制输出与退出 alt screen 的 scrollback 均已剥除

**改动文件与内容**（均有 `KAI-PATCH` 注释）：
1. `dist/modes/interactive/components/assistant-message.js`
   - `render()`：不再因 `hasToolCalls` 跳过 OSC133_A 行首标记；
     B/C 收尾仍只用于无工具调用消息，保持原行为
2. `dist/modes/interactive/components/user-message.js`
   - 新增 `KAI_USER_MARKER` 零宽标记，拼在首行 OSC133_A 之后
3. `node_modules/@earendil-works/pi-tui/dist/keybindings.js`
   - 新增 `tui.altScreen.latestInput`：默认 `shift+up`
4. `node_modules/@earendil-works/pi-tui/dist/tui-alt-screen.js`
   - 新增 `KAI_USER_MARKER` 正则与 `KAI_USER_MARKER_STRIP` 清理正则
   - `scrollToPrompt`：向下无目标时兜底 `scrollToEnd`
   - 新增 `scrollToLatestInput()`：从渲染内容末尾往前找最后一条
     用户消息标记，`scrollTo(max(0, row - 2))`，找不到则回到底部
   - 输入处理新增 `latestInput` 分支
   - `doRender` 绘制与 `afterTerminalStop` scrollback 剥除用户标记

**按键速查**（fullscreen 模式）：
- `ctrl+shift+up` / `ctrl+shift+down`：上一条 / 下一条消息
- `shift+up`：跳到最新一条输入
- `fn+right`（Mac 上等于 End）：回绝对底部；`fn+left` 回顶部

**验证**：组件级 + 集成级测试全部通过（键位匹配、向下跳覆盖带工具调用的
assistant 消息、latestInput 落点补偿、绘制与 scrollback 无标记残留）。

**注意**：`node_modules/@earendil-works/pi-tui` 会随 pi 包的依赖重装一起被
覆盖，`dist/` 会随 `pi update self` 覆盖，两边都要检查。

**附：历史记录（v1，已禁用）**

**目标**：会话很长时，一键/一点跳回上一条自己发的消息，不用慢慢滚。

**前置条件**：`~/.pi/agent/settings.json` 里有 `"tuiMode": "fullscreen"`（settings.json 是用户配置，pi 升级不会覆盖，但换机器/重置配置时记得补上）。默认是 regular 模式（转录打进终端 scrollback，没有内部滚动和跳转），改造三全部依赖 fullscreen。

**功能**：
- 纯鼠标交互，不新增任何快捷键：用滚轮/触控板往上滚一下，编辑器上方会出现提示栏
- 提示栏：`▲ <上一条消息文本> · 点击跳回`，**整条都是点击热区**（OSC 8 链接），点一下直接跳回最后一条用户消息
- 回到底部后提示栏自动消失；再次上滚又出现
- 提示栏的文本展示为用户最后一条消息的原文

**改动文件与内容**（均有 `KAI-PATCH` 注释）：
1. `dist/modes/interactive/interactive-mode.js`
   - 导入 `truncateToWidth`
   - 新增 `PreviousPromptBar` 类（提示栏组件，位于 InteractiveMode 类定义前）
   - 构造函数新增 `prevPromptBarContainer`、`lastUserPromptText` 字段
   - `addMessageToChat` 的 user 分支记录 `lastUserPromptText`
   - `init()`：把 `prevPromptBarContainer` 加为 dock 第一项、写入 mount 列表；创建提示栏并注入 `internalPiJumpHandler`
   - `createInteractiveTui`：`openUrl` 拦截 `pi-jump://` 前缀的内部链接（`pi-jump://prev-prompt`）
   - 新增方法 `handlePiJumpUrl`（在 `getUserMessageText` 之后）
2. `dist/modes/interactive/components/user-message.js`
   - 新增 `KAI_USER_MARKER = "\x1b]7777;kai-user\x07"`，在用户消息首行拼接于 OSC133_A 之后（零宽不可见标记，供跳转精确定位用户消息）
3. `node_modules/@earendil-works/pi-tui/dist/tui-alt-screen.js`
   - 新增 `KAI_USER_MARKER` 正则（匹配 133;A + 7777 标记）
   - `scrollToPrompt`：只匹配用户消息标记（不再匹配回合边界），落点补偿 `row - 2`
   - 新增公开方法 `scrollToLastPrompt`：从渲染内容末尾往前找最后一条用户消息并跳转（落点同样补偿 -2）

**验证**：pty 驱动真实 TUI 测试通过——pgup 翻页、提示栏出现、点击提示栏后用户消息出现在视口内（第 4 行）。

**注意**：`node_modules/@earendil-works/pi-tui` 会随 pi 包的依赖重装一起被覆盖，`dist/` 会随 `pi update self` 覆盖，两边都要检查。

---

## 不受 pi 升级影响的部分

`~/.pi/agent/extensions/` 下的扩展（session-title.ts、pi-statusbar.ts、plan-mode 等）是用户目录，pi 升级不动它们。
