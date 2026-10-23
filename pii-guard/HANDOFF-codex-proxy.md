# HANDOFF：给 Codex CLI 加出站脱敏（本地代理）

> 写给接手这个任务的 session。**动手前先读 `AGENTS.md`**（本目录），它定义了脱敏的范围与硬约束。
> 撰写：2026-10-16 ｜ 状态：调研完成，代码未动

---

## 1｜背景（为什么做这件事）

用户发现：**pi agent 有出站脱敏，Codex CLI 没有**——Codex 发给模型的所有内容都是原样。

pi 的脱敏是**进程内扩展**（`src/index.ts`，六个拦截点）。Codex 没有等价机制，所以已经发生的事：用户此前在 Codex 里跑过的每一轮请求，都包含了

- 用户自己输入的全部文字；
- 工具读到的文件内容；
- **系统提示里的 `cwd`**——`/Users/<用户名>/workspace/...`，即 macOS 用户名已经出站。

用户对这个很在意（整套 pi-pii-guard 就是为此建的），所以要求给 Codex 也补上。

**最终目标不是"再写一个脱敏器"，而是"同一个脱敏语义覆盖两个 harness"。**

---

## 2｜目标与非目标

**目标**

1. Codex CLI 走 aigocode 中转到模型的**全部流量**，出站前把身份信息换成 `<<LABEL:N>>` 占位符；
2. 模型回来的内容（流式文本、tool call 参数）**还原**成真值——否则模型会把占位符写进用户的文件；
3. 与 pi 侧**共用同一套引擎、词表与映射**，`张叁三` 在两边指向同一个真值；
4. 真值零出站，且在本地可验证（不是"应该没事"）。

**非目标**

- 不改 Codex 源码、不 fork；
- 不新写检测器（中文边界是 pi-pii-guard 当初否决 `piighost` 的原因，别重蹈）；
- 不覆盖 OpenAI 官方端点（用户不用）；
- 不动 pi 侧既有实现（那边已上线且已过独立审查）。

---

## 3｜已就绪的资产（直接用，不要重写）

### 3.1 引擎：`~/workspace/pi-pii-guard/src/engine.ts`

```ts
export class Masker {
  constructor(wordlist: Wordlist, rules: RegexRule[] = DEFAULT_RULES)
  scan(text: string): FoundMatch[]                       // 只找不改
  mask(text: string, state: MaskState): string           // 真值 → 占位符（幂等）
  restore(text: string, state: MaskState, mark = false): string  // 占位符 → 真值
}
export const TOKEN_RE = /<<\s*([A-Z_]+)\s*:\s*(\d+)\s*>>/g;
export function tokenOf(label: string, n: number): string;
```

**实测（2026-10-16）**：本机 Node v24 能**直接 `import` 这个 `.ts`**（type stripping），
`node -e "import('…/src/engine.ts')"` 成功导出 `Masker, TOKEN_RE, emptyState, tokenOf, wordStartAt`。
→ **不需要编译步骤、不需要 tsx**，代理直接引用源码即可。

### 3.2 词表与映射：`~/workspace/pi-pii-guard/src/store.ts`

```ts
GUARD_DIR   = ~/.pi/agent/pii-guard          // 700
WORDLIST_PATH = GUARD_DIR/wordlist.json      // 词表（600，不入 git）
STATE_DIR     = GUARD_DIR/state              // 每会话一份 {tokens, values, counters}
loadWordlist(); loadState(sessionId); saveState(sessionId, state);
```

词表结构：`{ version, _readme, people: [{canonical, aliases, label}], extraPatterns: [{label, regex}], allow: [] }`

⚠️ **这些文件里有真值**。任何验证都不要把真值打印到会话/日志里，用长度、哈希或掩码形式断言。

---

## 4｜Codex 侧的事实（本轮实测，别再猜）

| 事实 | 结论/用法 |
|---|---|
| `base_url` 可指向任意 URL（含 `http://127.0.0.1:PORT/v1`） | **代理方案可行**，这是唯一的全量拦截点 |
| `wire_api` 只支持 `"responses"`（`"chat"` 已被移除，写了会报错） | 只需处理 Responses API 的请求/流式格式 |
| hooks 支持 `updatedInput` / `additionalContext` / `permissionDecision`（二进制确认） | 可做工具层补丁，但**没有 UserPromptSubmit** → 看不到用户消息与系统提示，**不能作为主线** |
| 用户消息与系统提示 | 只能靠代理拦 |
| 当前 key 位置 | `~/.config/aigocode.key`（600），由 `~/.zshenv` 的 `AIGOCODE_API_KEY` 注入 Codex |
| 当前 Codex 配置 | `~/.codex/config.toml`：`model_provider = "aigocode"`、`base_url = "https://api.aigocode.dev/v1"`、`approval_policy = "never"`、`sandbox_mode = "danger-full-access"` |
| 模型 | `gpt-6.1-sol`（默认）/ `gpt-6-astra`（贵，少用）；端点还提供 `codex-auto-review`（审批模型） |
| 改配置生效 | 退出 Codex 重开（无 `/reload`） |

---

## 5｜方案：本地脱敏代理

```
Codex CLI ──▶ http://127.0.0.1:8787/v1 ──▶ https://api.aigocode.dev/v1
                    （脱敏 / 还原 / 注入 key）
```

**请求方向（出站脱敏）**：把 JSON body 里所有可读文本字段送进 `masker.mask()`——
`instructions`（系统提示，含 cwd）、`input[]` 里各 item 的 text、function/tool call 的 arguments、
工具输出文本。**逐字段处理，不做整串正则替换**。

**响应方向（入站还原）**：Responses API 是 SSE 流。`data:` 行里 JSON 的文本增量要用
`masker.restore()` 还原后再转发。**必须跨 chunk 缓冲**：占位符可能被切成 `<<PERS` + `ON:1>>`。

**必须整块跳过的区域**（见 §6 第 1 条）：任何 base64 图片载荷（`input_image` / data URI）。

**key 的归属（建议）**：代理侧持有真 key，Codex 侧不再需要 `AIGOCODE_API_KEY`——少一处泄漏面。
若这么做，Codex 的 `base_url` 指本机即可，`env_key` 可保留一个占位值或改由代理忽略。

**进程形态**：先做成可手动前台启动的脚本（`node proxy/server.ts`）；验证通过后再考虑 launchd 常驻。

---

## 6｜必须处理的坑（都来自 pi 侧的实战记录，别重新踩）

1. **二进制载荷一律跳过**：随机 base64 里撞上人名是**碰撞不是泄漏**，替换会打断 base64 →
   provider 返回 `Invalid base64 data` 拒掉整个请求（pi 在 2026-10-12 实测踩到并修复）。
2. **SSE 跨块**：占位符会被 chunk 边界切开，必须缓冲到能判定"不是一个完整/半截占位符"再输出。
3. **tool call 参数必须还原**：模型写 `张叁三`，落到文件系统的必须是真值，否则文件内容与文件名被写坏。
4. **fail-open**：代理内部出错时不要静默放行原值——要么带着告警继续（并按 pi 的做法记录），要么明确失败；
   **最坏情况是"看起来在跑但没脱敏"**，所以要么有泄漏断言，要么有可读的健康状态。

---

## 7｜分步落地与验收

**Step 1｜离线单测（不联网、不花钱）**
喂构造好的 fixture payload（含中文人名、邮箱、`/Users/<用户名>/`、一段 base64 图片、被切断的占位符），断言：
- 出站文本里不含任何词表真值（用枚举词表比对，而不是靠肉眼）；
- base64 段字节级不变；
- `restore(mask(x)) == x`；
- 对已脱敏文本再 mask 一次结果不变（幂等）。

**Step 2｜本地联调**：起代理，用 `curl` 打 `http://127.0.0.1:8787/v1/responses`，
确认转发、SSE 还原、错误码透传。

**Step 3｜切 Codex（先取得用户同意——这一步要花真钱）**
改 `config.toml` 的 `base_url`（备份原文件），跑一次**极短**的真实对话，然后检查：
- 代理日志里出现的每个出站字段都不含真值（可断言，不需要打印内容）；
- 模型回复里的占位符被还原（用户看到的是真名）；
- 让模型写一个文件，落到磁盘的是真值。

**Step 4｜常驻与文档**：launchd 自启（或明确的手动启动步骤）；在本目录补 `docs/` 或更新 `AGENTS.md`；
如果 key 迁到代理侧，同步清理 `~/.zshenv`。

**完成标准（Definition of Done）**：真实对话一轮后，能给出"出站字节里零真值"的断言输出 + 一条被正确还原的回复。

---

## 8｜需要用户拍板的未决问题

1. **映射的粒度**：代理用一份全局 state，还是按 Codex 会话分文件？（影响占位符编号在会话间的稳定性）
2. **key 是否迁进代理**（Codex 侧不再持有）？
3. 是否顺带覆盖 pi 的 subagents / 其它 harness？
4. 代理端口（默认建议 8787）与是否 launchd 自启。

---

## 9｜给接手 session 的工作约定

- **先读**：本文件 → `~/workspace/pi-pii-guard/AGENTS.md` → `DESIGN.md` → `REVIEW.md`（后者列了三个致命坑的修法）。
- **不打印真值**：验证一律用长度 / 哈希 / 掩码 / 计数断言；词表与 state 里的真值不进会话、不进日志。
- **改配置先备份**：`cp x y.bak-$(date +%H%M%S)`；改完说明"这个改动会让什么变化"。
- **花钱的调用先问**：任何真实模型请求（哪怕一个 token）先征得同意；优先用最便宜的模型。
- **验证驱动**：每一步给出可复现的命令与输出，不写"应该没问题"。
- 用户是新手开发者：术语要解释，改动影响要说人话。
