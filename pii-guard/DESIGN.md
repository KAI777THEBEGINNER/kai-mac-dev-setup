# 个人 Agent 隐私化方案：设计、实现与安全分析

> 版本 2026-10-12（rev.2，含审核响应）｜项目 `~/workspace/pi-pii-guard`
> 初版经独立审查后修订：审查报告见 `REVIEW.md`，处置记录见第 9 章
> 文中所有人名、号码均为代号或示例，真实词表在 `~/.pi/agent/pii-guard/wordlist.json`（不入库）

---

## 0. 审查指引（先读这节）

**这份文档的目的**：让审查者能独立判断"真值会不会漏到云端 LLM"，并找出设计缺陷。

**最该被挑战的三件事**：

1. 是否存在**未覆盖的数据通道**（真值绕过拦截点进入请求体）？
2. **失败路径**会不会静默放行（fail-open 的代价是否被低估）？
3. 三层脱敏的**职责划分**是否自洽，有没有"以为覆盖了其实没覆盖"的层？

**代码入口**（建议按此顺序读）：

| 文件 | 内容 | 行数 |
|---|---|---|
| `src/index.ts` | 事件接线、消息遍历、泄漏断言 | ~290 |
| `src/engine.ts` | 检测/替换/还原核心（纯函数） | ~180 |
| `src/rules.ts` | 18 条正则规则 | ~140 |
| `src/store.ts` | 词表加载与映射持久化 | ~90 |
| `tests/engine.test.ts` | 单测 11 例 | ~100 |

**可复现的验证命令**：见附录 D。

---

## 1. 背景与威胁模型

### 1.1 使用场景

用户把个人知识库（Obsidian vault，440 个 markdown，约 344 万字符）对接到 pi agent 使用。两种入口：

- **Obsidian pi-agent 插件**：插件构造"当前笔记 + 一跳链接"的上下文，通过 `pi --mode rpc` 调起本地 pi 进程
- **命令行 pi**：直接在 vault 目录里跑会话

两者最终都由本地 pi 进程把内容发往云端 LLM API（当前为智谱 GLM）。

**本地扩展机制对两种入口都生效**：pi 的全局扩展（`~/.pi/agent/extensions/` 与 `settings.json` 的 `extensions` 数组）在 RPC 模式下同样加载——这一点已实测确认（插件调用未使用 `--no-extensions`）。

### 1.2 威胁模型

**防护目标**：知识库中的身份信息不进入发往 LLM API 的请求体（payload）。

具体资产：

| 资产 | 举例（代号） |
|---|---|
| 用户本人标识 | 中文全名、`zhangsan`、拼音、英文自称（6 种写法） |
| 联系方式 | 手机号、私人邮箱、微信/支付宝 |
| 第三方人名 | 学术推荐人 2 人、中介顾问 3 人、实习上级 1 人 |
| 证件与金融 | 身份证、护照、银行卡 |
| 凭据 | API key、token、私钥、带密码的 URL |

**攻击者模型**（我们假设的最坏情况）：

- LLM provider 完整留存请求体，可能被人工审核、被司法调取、被内部泄露
- 模型输出被用户复制到第三方系统（聊天工具、文档）
- 不假设 provider 本身是恶意的（不是端到端加密场景）

**非目标**（明确不做，见 5.3 详述）：

- 本地磁盘加密：映射文件与 vault 本身是明文，依赖 OS 文件权限
- iCloud 通道：vault 位于 iCloud，文件本身已上云，与本方案无关
- 拿到本机 shell 的攻击者
- 重识别攻击（上下文足以推断身份，见 5.2-6）

### 1.3 为什么不用现成方案（piighost）

调研了 `athroniaeth/piighost` 2.1.0（Python，MIT，工程与文档质量都很高：六边形架构、占位符工厂、会话记忆、加密存储、OpenAI/Anthropic 代理、Claude Code 集成）与官方 catalog（156 条正则 / 50 个组 / 31 个配置）。

**对中文语料的三个硬伤**（均经源码阅读与本地实测复刻确认）：

1. **官方 PII 模型不支持中文**：`fastino/gliner2-privacy-filter-PII-multi` 只训练了 7 种语言（en/fr/es/de/it/pt/nl），无中文。
2. **三个核心组件在无空格语言下失效**：`ExactMatchDetector` / `WordBoundaryExpander` / `LLMDetector` 都依赖 `(?<!\w)值(?!\w)` 找词边界，而 Python 的 `\w` 匹配汉字。实测复刻其边界逻辑：`张三` 在「张三和李四都来了，张三走了」中命中 **0 次**；连 `13812345678` 在「电话13812345678联系我」里也是 **0 命中**。
3. **官方正则 catalog 无中国条目**：有日、韩、印、新、印尼，唯独没有身份证/手机号/学号。

结论：中文场景下它的检测层需要全部重写，剩余价值（管道骨架 + 记忆 + API 服务）撑不起跨语言（Python 服务 ↔ TS 扩展）的部署与延迟成本 → 自建。

**借鉴的部分**：可逆脱敏的整体思路、占位符设计、`tool_call` 先还原后执行再脱敏结果的模式。

---

## 2. 需求与约束

**功能性需求**（2026-10-12 与用户逐条确认）：

| 需求 | 内容 |
|---|---|
| 挡 | 本人标识、真实往来人名、证件/银行卡、凭据、政府申报材料 |
| 不挡 | 机构名、学校名、公司名、地址、公众人物（如 Sam Altman、李飞飞） |
| 还原 | 用户看到的模型回复必须是真值；写文件的工具参数必须还原成真值 |
| 语言 | 中文为主（含中英混排） |

**非功能约束**：

1. **全本地**：检测、替换、还原全部在本机完成，不得把原文发给任何第三方做检测（这排除了用云端 LLM 做 PII 检测的方案）。
2. **不破坏工作流**：还原错误会导致文件被写坏或工具调用失败，比漏检更直接可见。
3. **低延迟**：每次工具结果、每轮请求都要过一遍，用户不能感知到卡顿。
4. **可维护**：用户是知识管理者而非安全工程师，词表必须能用 JSON 直接改。

---

## 3. 方案总览

### 3.1 方案选型

| 方案 | 覆盖能力 | 部署成本 | 风险 | 结论 |
|---|---|---|---|---|
| **A. pi 扩展 + 词表 + 正则** | 结构化 PII 全覆盖；人名靠词表 | 一个 TS 文件 | 词表外的人名漏检 | **已采用** |
| B. A + 本地 NER（中文 BERT/GLiNER） | A + 人名/机构自动识别 | 加 Python 服务 + 数百 MB 模型 | 中文 NER 效果未经实测、误报、8GB 内存压力 | 暂缓，先实测再定 |
| C. 本地代理（改 provider baseURL） | 同 B，对所有客户端生效 | 代理服务 + 流式与 tool-calling 兼容改造 | 改造量大、未知兼容性问题 | 不采用（扩展是更干净的接入点） |

用户明确选择了 A，并要求"不要 NER"（理由：漏的是词表外的新人名，可用月度增量扫描补偿；NER 的误报与延迟代价更高）。

### 3.2 架构与数据流

```
本地真值源（vault 文件）
        │  read / grep / ls 工具（本地执行，拿真值）
        ▼
   tool_result 事件 ──脱敏──▶ 会话历史（模型只见占位符，session 也存脱敏版）
        │
        ▼
   context 事件 ──全量兜底脱敏──▶ 每轮发给模型的消息（历史里被还原过的真值重新挡住）
        │
        ▼
   before_provider_request ──payload 级兜底 + 泄漏断言──▶ 云端 LLM
        │
        ▼
   模型输出（含占位符）
        │
   message_end 事件 ──还原──▶ 用户看到真值（写回 session，下一轮再脱敏）
        │
        ▼
   tool_call 事件 ──还原参数──▶ 本地工具执行（文件里落真值）
```

### 3.3 六个拦截点的职责划分

| 事件 | 方向 | 职责 | 为什么需要这一层 |
|---|---|---|---|
| `tool_result` | 脱敏 | 工具输出 → 占位符 | 让 session 文件也干净（本地留存最小化） |
| `context` | 脱敏 | 每轮全量消息兜底 | 历史里被还原过的真值必须重新挡住；比 payload 层结构更清晰 |
| `before_provider_request` | 脱敏 | payload 全局字符串兜底（含 system prompt） | 覆盖 `context` 照顾不到的部分：system prompt（含 `/Users/<用户名>/` 路径）、未知消息类型、provider 特有字段 |
| `before_provider_request` | 断言 | 泄漏检测（见 3.4-4） | 唯一 fail-closed 的地方 |
| `tool_call` | 还原 | 工具参数真值化 | 模型写占位符，文件必须落真值 |
| `message_end` | 还原 | 助手回复真值化 | 用户必须看懂回复（仅"还原模式"，见第 9 章双模式） |
| `registerMarkdownTransformer` | 还原（显示层） | TUI 渲染时把占位符换回真值 | display-only：不改 session、不进模型上下文（"干净模式"的关键） |
| `session_before_compact` | 拦截 | 压缩前检查内容是否含真值，含则 cancel + 告警 | compaction 直接调裸 `streamFn`，绕过 `context` 与 `before_provider_request`（审核发现 S2） |
| `input` | 脱敏 | 干净模式下把用户输入也转成占位符入库 | 让 agent state 全程干净（TUI 显示层负责还原） |

### 3.4 关键设计决策

**1. 按「值」分配 token，不按「实体」归并。**
同一实体的不同写法（`李四` 与 `李叁`）得到**不同** token。代价是模型看到"两个占位符"，收益是还原 100% 保真——文本里写的是 `zhangsan4` 就还原成 `zhangsan4`，不会变成 `zhangsan`。对"写回文件"场景，保真优先于简洁。

**2. 幂等性。** `mask(mask(x)) === mask(x)`：占位符本身不匹配任何规则。这是"每轮重新脱敏全历史"能成立的前提。

**3. 三层防御，各有明确职责**（见 3.3）。任何一层失效，其余层仍应兜住——这是"纵深防御"，但也带来"以为覆盖了其实没有"的风险（见 8-3）。

**4. 失败策略：全程 fail-open，泄漏断言改为"就地强替换 + 告警"。**
mask/restore 的每一步都包在 try/catch 里，出错时静默返回原文（不阻断工具与对话）。
> ⚠️ 初版设计为"发现残留时抛错阻断"，独立审查证明该假设不成立（S1）：pi 的 `emitBeforeProviderRequest` 会 catch 扩展抛错、只把错误打到 TUI，然后**继续用上一份 payload 发请求**。抛错不但不能阻断，还会丢弃 handler 产出的脱敏副本、回退到未脱敏的原始 payload。
> 现方案：`before_provider_request` **就地**改写 `event.payload`（不依赖返回值），发现残留时先 `transformInPlace(forceMask)` 强制替换、再 `ui.notify` 告警。环境变量 `PII_GUARD_BLOCK=0` 仅关闭告警。

**5. 占位符语法：`<<LABEL:N>>`**（LABEL 大写，N 按 label 各自递增）。
选它的理由：模型对它有稳定的理解（类似 XML 标签），不易被 markdown 渲染吞掉，且与真实文本的碰撞概率极低。还原时容忍空格变体 `<< LABEL : N >>`。

---

## 4. 实现细节

### 4.1 检测层

**词表匹配**（`src/engine.ts`，用户维护的真人名）：

- 构建首字符索引：`值首字符 → 候选列表`，扫描时逐位置查表，避免 O(词表数 × 文本长度) 的全量扫描
- ASCII 边界：含字母/数字的别名（如 `zhangsan4`）要求前后不能是 `[A-Za-z0-9_]`，防止命中 `Kaiserreich`；纯中文别名不做边界检查（中文无空格，做了反而全失效）
- 大小写不敏感；单字符别名被拒绝（防误伤）

**正则规则**（`src/rules.ts`，18 条）：

| 类别 | 规则要点 |
|---|---|
| EMAIL | 标准形态 |
| PHONE | `1[3-9]\d{9}` + 数字边界（`(?<!\d)` / `(?!\d)`） |
| ID_CARD | 18 位 + 出生日期段合法性 + 末位 X |
| PASSPORT | `[EG]\d{8}` + 词边界 |
| BANK_CARD | 16–19 位 + **首位 ∈ {3,4,5,6}** + **Luhn 校验**（双层降低误报） |
| SECRET ×8 | `sk-`／`ghp_`／`AKIA`／`AIza`／`xox`／`Bearer`／JWT／PEM 私钥块／带密码 URL |
| ACCOUNT ×2 | 微信号（lookbehind 锚定"微信号："）、`wxid_` 前缀 |

**冲突消解**：所有命中去重后按 `start` 升序、长度降序排序，贪心选取不重叠的匹配（长匹配优先）。

**设计取舍**：形态匹配不校验 checksum（Luhn 除外）——宁可挡住一个"像卡号的订单号"，也不放过真卡号。

### 4.2 替换与还原

```ts
// 分配：同一字符串值永远拿到同一个 token
tokenFor(value, label, state) →
  state.values[value] ?? (allocate: n = ++state.counters[label]; token = `<<${label}:${n}>>`)

// 还原：宽松匹配，未知 token 原样保留
restore(text) → text.replace(/<<\s*([A-Z_]+)\s*:\s*(\d+)\s*>>/g, (m,l,n) =>
  state.tokens[`<<${l}:${n}>>`] ?? m)
```

### 4.3 消息遍历（`src/index.ts`）

**只处理已知的文本字段**，不碰 `id` / `name` / 工具调用结构：

| 消息类型 | 处理字段 |
|---|---|
| `user` | `content`（string 或 text block） |
| `assistant` | `content` 数组里的 `text`、`thinking`；**脱敏方向**额外处理 `toolCall.arguments` |
| `toolResult` | `content` 数组里的 text block |

**方向差异**：`toolCall.arguments` 只在脱敏方向处理，还原方向不处理——参数在存储层保持占位符，还原只发生在 `tool_call` 事件的"执行瞬间"。

**关键实现坑（已实测）**：`tool_call` 里必须**就地修改** `event.input`（先 `delete` 所有 key 再 `Object.assign`），直接赋值新对象无效——pi 执行工具时用的仍是原引用。

### 4.4 状态管理（`src/store.ts`）

| 项 | 位置/权限 |
|---|---|
| 词表 | `~/.pi/agent/pii-guard/wordlist.json`（0600） |
| 会话映射 | `~/.pi/agent/pii-guard/state/<sessionId>.json`（0600，原子写：tmp + rename） |
| 目录 | `~/.pi/agent/pii-guard/`（0700） |

- 保存时机：变更后 400ms 防抖 + `session_shutdown` 立即保存
- 加载时机：`session_start`（恢复会话时映射随之恢复）
- `/pii` 命令可在会话内查看当前映射（本地可视化审计）

### 4.5 失败策略实现

```ts
const mask = (s) => { try { ... } catch { return s; } };      // fail-open
const restore = (s) => { try { ... } catch { return s; } };   // fail-open
// 唯一例外（见 3.4-4）：
if (leak) throw new Error("pii-guard 阻断：payload 里仍有未脱敏内容（...）");
```

**已知失败模式**（诚实记录，供审查）：

- 词表解析失败 → 仅正则生效，`session_start` 时告警一次（`ui.notify`），print 模式下通知是 no-op（静默降级）
- 超长文本（> 500,000 字符）→ **静默跳过脱敏**，无告警（见 5.2-2，这是已知缺陷）
- 映射写盘失败 → 静默（会话结束后映射丢失，resume 时占位符无法还原，但不泄漏）

---

## 5. 安全分析

### 5.1 数据通道覆盖矩阵

| # | 通道 | 覆盖方式 | 状态 |
|---|---|---|---|
| 1 | 用户输入（CLI / 插件构造的上下文包） | `context` 脱敏全部消息 | ✅ 已实测 |
| 2 | 工具结果（read/grep/ls/bash 输出） | `tool_result` 脱敏 + `context` 兜底 | ✅ 已实测（真实 vault 文件，审计零泄漏） |
| 3 | 工具参数（模型产出，含 path/content/command） | `tool_call` 还原（脱敏方向由 `context` 处理 arguments） | ✅ 已实测（写文件落真值） |
| 4 | 助手回复（含 thinking） | `message_end` 还原 | ✅ 已实测 |
| 5 | system prompt（含 `/Users/<用户名>/` 与工具说明） | `before_provider_request` 全局字符串兜底 | ✅ 已实测（`zhangsan3` 被替换） |
| 6 | 自定义扩展注入的消息（`custom` role） | 仅靠兜底 | ⚠️ `context` 层不处理（`mapMessage` 只认 user/assistant/toolResult） |
| 7 | 用户 bash 执行的输出（`bashExecution` role） | 仅靠兜底 | ⚠️ 同上 |
| 8 | 压缩摘要（`compactionSummary` / `branchSummary`） | 干净模式下存储即脱敏；还原模式下 `session_before_compact` 拦截 | ⚠️→✅ 已修（S2） |
| 8b | **压缩请求本身**（`executeSummarization`） | 绕过全部钩子（直接调裸 `streamFn`）；靠"存储层干净"或压缩拦截兜底 | ✅ 已修（S2） |
| 8c | **子代理会话**（pi-subagents） | lean 模式剥离 `context`/`before_provider_request`/`message_end` 等；已配置 `session_resources: "full"` | ✅ 已修（S3） |
| 9 | 图片内容（base64 image block） | **不检测** | ❌ 盲点（见 5.2-1） |
| 10 | 文件名与路径 | 仅在命中词表时替换 | ⚠️ 部分（词表外的人名会随文件名泄漏，如 `..._老师<姓名>.md`） |
| 11 | session 持久化文件 | `tool_result` 保证工具结果干净；用户输入与助手回复存真值 | ⚠️ 设计选择（用户要求回复可读） |

**兜底的实质**：通道 6–8 之所以"仅靠兜底"，是因为 `before_provider_request` 对整个 payload 做**递归字符串替换**（不依赖消息结构），所以最终仍会被脱敏。但这条路径依赖"payload 是一个纯 JSON 对象"这个假设——若某 provider 的请求体含二进制或分段流式上传，兜底会失效。

### 5.2 已知盲点与绕过路径（10 条）

1. **图片内容不检测。** 用户贴入含 PII 的截图（成绩单、身份证照片）时，base64 数据原样发出。当前无法在纯文本层解决（需要 OCR，且 OCR 本身会成为新的泄漏面）。**影响**：高。**缓解**：文档告知 + 用户教育。

2. ~~**超长文本静默跳过。**~~ **已修**：超过 `MAX_TEXT = 500_000` 字符仍跳过脱敏，但会 `ui.notify` 告警一次（不阻断——审核结论：阻断只伤工作流，且该路径下断言本身也不可靠）。

3. ~~**`context` 层的消息类型覆盖不全**~~（5.1 通道 6–8）。**已修**：`mapMessage` 对未知 role（custom / bashExecution / compactionSummary 等）改为退化的全字符串遍历，不再是单层依赖。

4. **文件名/路径泄漏。** vault 里存在含人名的文件名（如 `..._老师刘XX.md`），模型执行 `ls`/`grep` 时会看到。**影响**：中。**缓解**：把人名加入词表后，路径里的名字也会被替换（`tool_call` 还原保证工具仍能操作真实路径）；但词表外的新人名仍会漏。

5. **词表外的人名必然漏检。** 这是词表法的固有边界（用户已接受）。首次出现的陌生姓名（如某次面试官）会原样发给模型。**缓解**：月度增量扫描 + 人工确认（`tools/scan-names.mjs`）。

6. **重识别（re-identification）。** 占位符只替换标识符，不替换上下文。"患者 `<<PERSON:1>>`，村里唯一的心脏科医生" 依然指名道姓。**影响**：中（用户的知识库充满"唯一性描述"）。**缓解**：无（属于匿名化理论的根本限制，与 piighost 文档所述一致）。

7. **`findLeak` 无法自证覆盖完整。** 断言的检查集合是 `state.values`（已被 mask 过的值）。如果某个值从未被任何规则检测到，它不会进 `values`，断言也就查不到它。**这是"用检测能力验证检测能力"的循环**。**缓解**：独立审计脚本 `tools/audit.mjs`（同一套规则，同样受此限制）+ 人工抽查。

8. **映射文件是明文真值。** `state/*.json` 含"占位符 → 真值"的完整映射（0600 权限）。任何能读到用户 home 目录的进程/备份/同步工具都能拿到。**影响**：视环境（本地威胁不在威胁模型内，但 Time Machine、云备份会把它们带走）。

9. **多进程并发写同一 session 的映射。** 两个 pi 进程同时打开同一 session（如同一会话在 CLI 与插件里同时活跃）时，state 文件后写覆盖先写，可能丢失映射（表现为还原失败，不泄漏）。**影响**：低。

10. **模型改写占位符。** 模型输出 `<<PERSON:1>>` 时可能写成 `<< PERSON : 1 >>`（可还原）或被拆成 `<<PERSON:` 与 `1>>`（不可还原，原样保留）。**影响**：低（显示异常，无泄漏）；但若模型在**写文件**时拆坏占位符，会把残缺 token 写进文件（脏数据）。

### 5.3 威胁模型边界

| 风险 | 在本方案内？ | 说明 |
|---|---|---|
| 请求体含真值发送到 provider | ✅ 防护 | 本方案的全部目标 |
| provider 侧留存/审核/泄露 | ✅ 防护 | 通过"根本不发真值"实现 |
| 本机磁盘被读取 | ❌ | vault 与映射均为明文，依赖 OS 权限 |
| iCloud 同步 | ❌ | vault 本身在 iCloud，独立通道 |
| 拿到 shell 的攻击者 | ❌ | 映射文件对其完全透明 |
| 重识别 | ❌ | 见 5.2-6 |
| 模型输出被复制到外部 | ⚠️ 部分 | 输出是真值（用户要求），复制即外发 |

---

## 6. 验证

### 6.1 单元测试（11 例，`node --test tests/engine.test.ts`）

覆盖：手机/邮箱/身份证/银行卡（含 Luhn 正反例）、人名与别名、英文词边界、幂等性、还原容错（空格变体、未知 token）、凭据类、重叠消解。

### 6.2 端到端验证（实测记录）

| 验证 | 方法 | 结果 |
|---|---|---|
| 离线隔离测试 | 注册假 provider（指向 `127.0.0.1:9`），dump 真实 payload | 用户消息里的中文名/手机/邮箱/护照号全部替换为占位符 |
| 工具链闭环 | 真实 provider + 假 PII 测试文件 | 模型只看到占位符；写文件落真值；`message_end` 还原生效 |
| session 洁净度 | 检查 session jsonl | 工具结果存脱敏版，真值 0 次出现 |
| **真实 vault 文件** | 拷贝 4 个真实文件，真实 provider，开启 `PII_GUARD_AUDIT` | **审计文件里词表内真值 0 次出现**；模型回复正常还原真值 |
| 全局加载 | 不加 `-e`（走 settings.json） | 扩展正常加载并生效 |
| 全库审计 | `tools/audit.mjs`（440 文件 / 344 万字符） | 845 处命中：PERSON 767｜EMAIL 58｜BANK_CARD 10｜PHONE 9；覆盖率 0.11% 字符 |
| 性能 | 同上 | 全库扫描 0.47 秒（约 0.13 ms/KB） |

### 6.3 验证方法的局限（供审查）

1. **自证问题**：验证用的检测器与被验证的检测器是同一套（见 5.2-7）。真正独立的验证需要人工抽查，或换一套规则做交叉检查。
2. **样本局限**：真实 vault 端到端只测了 4 个文件，不是全库遍历。
3. **单机单环境**：未测试其他 provider（Anthropic 格式、多模态请求）与其他 pi 模式（RPC 全链路未跑真实插件）。
4. **未做对抗测试**：没有人尝试构造"绕过脱敏"的输入（如编码变形、零宽字符、同形异码字）。

---

## 7. 已知局限（汇总）

技术性：见 5.2 全部 10 条。
产品性：

- 词表需要用户手工维护（月度扫描是辅助，不是自动）
- 中英混排的罕见英文名（推荐人、教授）可能不在词表
- 占位符对阅读体验有影响（用户已接受；`/pii` 可随时查看映射）
- 与 NER 方案相比，召回率依赖于"用户能想到要挡谁"

---

## 8. 待审查问题清单 ⭐

**A. 架构与覆盖**

1. 三层脱敏（tool_result / context / before_provider_request）的职责划分是否合理？是否存在"某一层以为覆盖了、实际被另一层短路"的隐患？
2. 通道 6–8（custom / bashExecution / compactionSummary 消息）只靠兜底，是否应该提升为 `context` 层的显式处理？
3. 兜底层用"递归替换所有字符串"这个策略，除了性能，还有什么副作用风险（例如改坏 provider 期望的关键字段）？

**B. 安全与失败路径**

4. "默认 fail-open + 单一 fail-closed 断言"这个策略，在这个威胁模型下是否成立？有没有更好的分层（比如按内容敏感度分级阻断）？
5. `findLeak` 的检查集合（`state.values`）够不够？有没有办法做**独立于检测规则**的泄漏检查？
6. 超长文本静默跳过（5.2-2）应该改成"告警"还是"阻断"？
7. 映射文件明文存真值，是否应该加密（如 AES-GCM + 钥匙串密钥）？收益是否值得复杂度？

**C. 检测质量**

8. 正则规则的误报/漏检组合是否合理？特别是 BANK_CARD 的 "首位 {3,4,5,6} + Luhn" 是否会放过某些卡种，或误伤编号类数据？
9. 词表匹配用"首字符索引 + ASCII 边界"，在中文语料上还有哪些已知失效场景（如全角字符、异体字、简繁混排）？
10. 是否值得引入**中文本地 NER**（方案 B）来补召回？如果引入，如何与词表法共存而不引入新的泄漏面（NER 模型与推理框架本身）？

**D. 验证与运维**

11. 目前的验证方法（自证 + 少量真实样本）是否足够支撑"可以放心用"的结论？要补哪些测试才有说服力？
12. 这套东西如何做**长期回归**（词表变化、pi 版本升级导致事件语义变化、provider 格式变化）？


---

## 9. 审核发现与处置（2026-10-12）

初版经独立审查（`REVIEW.md`），报告确认 3 个致命 + 6 个重要发现，**全部核实属实**。处置如下。

### 9.1 已修复并验证

| 编号 | 发现 | 修复方式 | 验证 |
|---|---|---|---|
| **S1** | `before_provider_request` 抛错被 pi 吞掉并回退原始 payload——断言不闭合，且触发时放大泄漏 | 改为**就地改写** `event.payload`（`transformInPlace`），残留时先 `forceMask` 强替换再告警，全程不抛错 | 用"抛错探针"实测：中间 handler 抛错后，后续 handler 看到的 payload 仍是脱敏版、零泄漏 |
| **S2** | compaction 走 `executeSummarization → streamFn`（裸函数），绕过 `context` 与 `before_provider_request` | 引入**双模式存储**（见 9.2）+ `session_before_compact` 拦截 | 读 pi 源码确认 `streamFn: this.agent.streamFunction`；端到端回归零泄漏 |
| **S3** | pi-subagents 的 `SUBAGENT_ALLOWED_EXTENSION_EVENTS` 只保留 `tool_call/tool_result/user_bash`，子代理会话无兜底、无断言 | `~/.pi/agent/subagents.json` 设 `session_resources: "full"`（绕过 `isolateSubagentExtensions`） | 读 sdk-runner.ts 确认该开关控制事件剥离 |
| **S4** | `/pii clear` 清空 counters，新值复用旧 token → 同一 payload 内同名 token 指向两个真值 | clear 时**保留 counters** | 单测 + 代码审查 |
| **S5** | `findLeak` 跳过 <3 字符的值（2 字中文名不受检） | 阈值降为 2 | 代码审查 |
| **S6** | `findLeak` 用 `JSON.stringify` 比对，值含转义字符时漏检 | 改为 `collectStrings` 直接比对原始字符串（含对象 key） | 代码审查 |
| **S7** | `BANK_CARD` 限 16–19 位，与注释声称的 Amex 不符（Amex 15 位、Diners 14 位漏检） | 放宽到 14–19 位 | 新增单测：Amex `378282246310005`、Diners `30569309025904` 均命中 |
| **S8** | 当前 provider（智谱）的 key 格式 `id.secret` 无规则 | 加 `[a-f0-9]{32}\.[a-f0-9]{16}` + 一条上下文锚定的通用凭据规则 | 新增单测 |
| **S9** | 词表 `extraPatterns` 里一条坏正则会让 `Masker` 构造抛错 → **扩展加载失败、全部防护静默消失** | `new RegExp` 包 try/catch，跳过该条并在 `session_start` 告警 | 新增单测：坏正则不抛错且其余规则生效 |

另修正：文档正则计数（实际 16→现 19 条，SECRET 11 条）、`AGENTS.md` 的失效命令（`node --test tests/` 在 Node 24 报错、`tools/selfcheck.mjs` 不存在）、`tools/audit.mjs --top 0` 解析 bug、审计文件权限（改为 0600）。

### 9.2 由 S2 引出的架构变更：双模式存储

**问题**：compaction 读的是 agent state，而 state 里存的是"用户要读懂的真值"（初版 `message_end` 还原）。压缩请求绕过全部钩子，于是真值直接出站。

**解法**（按 `ctx.mode` 自动选择，无需配置）：

| 模式 | 存储策略 | 用户如何看到真值 | compaction 风险 |
|---|---|---|---|
| **TUI**（`ctx.mode === "tui"`） | user / assistant / toolResult **全部以占位符入库** | `registerMarkdownTransformer`（display-only）在渲染时还原 | 无——压缩输入天然是占位符 |
| **RPC / print / json** | 消息按真值入库（插件与脚本消费需要） | 消息本身就是真值（`message_end` 还原） | 由 `session_before_compact` 拦截：检出真值即 `cancel` + 告警（`PII_GUARD_ALLOW_COMPACT=1` 放行） |

**权衡**：RPC 模式下用户不再需要理解占位符；代价是长会话触发压缩时会被拦一次，需要 ` /new` 开新会话或显式放行。TUI 模式下 session 文件、导出内容、压缩输入全部为占位符（本地留存最小化），代价是看 session 原文时也是占位符。

### 9.3 已知未修（如实披露）

| 项 | 原因 |
|---|---|
| 图片 / 多模态 document block 不检测 | 纯文本层无解；OCR 会引入新的泄漏面。披露 + 用户教育 |
| 重识别（上下文足以推断身份） | 匿名化理论的根本限制 |
| 模型改写占位符导致还原失败 | 已做宽松匹配；残缺 token 原样保留（不泄漏、可能写脏文件） |
| 审计文件含完整 payload（已脱敏） | 权限 0600；放 `/tmp` 时仍在本地其他用户不可读（0600） |
| `findLeak` 的自证循环 | 检查集仍来自同一套检测规则；独立验证依赖人工抽查与规范化变体比对 |

### 9.4 回归要求（新增）

- 单测覆盖 S7/S8/S9 三项修复（共 14 例）
- 端到端验证新增两步：① 抛错探针（验证就地修改在异常后保留）；② `session_before_compact` 不误触发（短会话）
- pi 升级后必跑：`node --test tests/engine.test.ts` + 抛错探针（事件语义可能随版本变化）

---

## 附录

### A. 文件清单

```
pi-pii-guard/
├── AGENTS.md            项目规则（范围、约束、目录约定）
├── README.md            用户向使用说明
├── DESIGN.md            本文档
├── CODEBASE.md          代码地图（自动生成）
├── src/
│   ├── index.ts         pi 扩展入口（事件接线、消息遍历、泄漏断言）
│   ├── engine.ts        检测/替换/还原核心
│   ├── rules.ts         15 条正则规则
│   └── store.ts         词表加载与映射持久化
├── tools/
│   ├── init.mjs         初始化词表
│   ├── scan-names.mjs   人名候选扫描（增量）
│   └── audit.mjs        覆盖率审计（不打印真值）
└── tests/engine.test.ts 单测
```

### B. piighost 调研结论（简版）

- 位置：github.com/athroniaeth/piighost，2.1.0，MIT，Python，活跃（2026-10 仍在更新）
- 能力：可逆脱敏管道（检测→重叠消解→扩展→链接→实体解析→匿名化→守卫）、占位符工厂族、会话记忆（内存/Redis/SQL，可加密）、LangChain/PydanticAI/LlamaIndex/Claude Code 集成、OpenAI/Anthropic 兼容代理
- 中文硬伤：见 1.3（模型不支持中文、边界搜索失效、catalog 无中国条目）
- 结论：思路可借鉴，检测层不可复用；本方案的占位符设计与其思路一致

### C. 命令与环境变量

```bash
node tools/init.mjs                      # 初始化词表（已存在不覆盖）
node tools/scan-names.mjs <vault>        # 人名候选扫描（--full 全量）
node tools/audit.mjs <vault> --top 0      # 覆盖率审计（--top 0 不打印真值）
node --test tests/engine.test.ts         # 单测
```

| 变量 | 作用 |
|---|---|
| `PII_GUARD_AUDIT=<file>` | 把每次发出的 payload 写入 jsonl（含 leak 断言结果），用于事后审计 |
| `PII_GUARD_BLOCK=0` | 关闭"发现残留即阻断"的断言（默认开启） |

pi 内命令：`/pii`（查看本次会话映射）、`/pii clear`（清空映射）

### D. 复现验证（审查者可照做）

```bash
# 1) 单测
cd ~/workspace/pi-pii-guard && node --test tests/engine.test.ts

# 2) 离线隔离验证（不产生任何外部调用）：用一个假 provider 注册扩展
#    见 /tmp/pii-lab/probe.ts（dump payload 的调试扩展）
pi -ne -e /tmp/pii-lab/probe.ts -e src/index.ts \
   --provider pii-offline --model probe --no-session --no-skills \
   --no-context-files --mode text -p "测试：某人 13800001234"
# 检查 /tmp/pii-lab/dump-payload.json 里 user 消息是否为占位符

# 3) 全库覆盖率审计（不打印真值）
node tools/audit.mjs "<vault 目录>" --top 0

# 4) 真实链路审计
PII_GUARD_AUDIT=/tmp/audit.jsonl pi ... -p "<让模型读一个含 PII 的文件>"
# 然后 grep 审计文件确认真值 0 次出现
```
