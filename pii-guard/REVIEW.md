# pi-pii-guard 安全与隐私审查报告

> 审查日期 2026-10-12｜审查对象 DESIGN.md（2026-10-12 版）全文 + src/ + tools/ + tests/ 全部代码
> 审查方法：通读设计文档与源码｜核对 pi 扩展钩子的实际运行时语义（pi-coding-agent dist 源码）｜核对 pi-subagents 源码｜单测实测｜自写探针复现泄漏场景

**总体结论：设计文档写得很诚实，但方案目前不能按文档声称的安全保证使用。** 最致命的问题是：唯一引以为傲的 fail-closed 断言在 pi 的实现下根本不闭合——而且触发时反而会把**未经兜底脱敏的原始 payload** 发出去。另外两条文档完全没发现的泄漏通道（compaction、子代理）会让真值绕过全部六层拦截直达云端。

---

## 三个致命发现（先看这里）

### S1｜「唯一 fail-closed」实际是双重 fail-open，且断言触发时放大泄漏

DESIGN.md:165-166 声称发现泄漏时「**抛错阻断请求**」。验证结果：

1. **pi 会吞掉扩展的抛错**。pi 的 `emitBeforeProviderRequest` 对每个 handler 是
   `try { result = await handler(...) } catch (err) { this.emitError(...) }`，catch 后仅把错误以红字打进
   TUI（`runner.onError` → `chatContainer.addChild`），然后**继续返回 `currentPayload` 发请求**。抛错不阻断
   任何东西；RPC／插件模式下用户连红字都看不到。
2. **更糟：触发断言 = 发出原始未脱敏 payload**。脱敏结果是 handler 内部的克隆（`src/index.ts:214` 的
   `deepMapStrings` 产新对象，`event.payload` 本身未动），`return changed ? payload : undefined`
   （`src/index.ts:241` 附近）在 `src/index.ts:225` 抛错之后永远执行不到 → 克隆随 throw 丢弃 → pi 回退到
   **原始 `event.payload`**。system prompt 里的用户名路径、custom／bashExecution／压缩摘要消息——这些
   **只有 payload 层在挡的内容，恰好在检测到泄漏的那一刻全部裸奔**。断言不是保险丝，是放大器。

修复方向：不要 throw。发现泄漏时**就地改写 `event.payload`**（把该值强替换为占位符）再返回，同时
`emitError` 强提示；或 throw 前先把 `event.payload` 的对应字段替换掉。这同时修复 S1 的两个事实。

### S2｜compaction／branch summarization 请求完全绕过全部钩子，携带原始真值历史

pi 的压缩汇总走 `executeSummarization → retryAssistantCall(() => streamFn(model, context, ...))`——
**直接调裸流函数**，不经过 `transformContext`（context 事件），不经过 `onPayload`
（before_provider_request 事件）。而 session 里 user 消息与 assistant 回复按设计存真值
（DESIGN 5.1-11）→ **上下文一满触发自动压缩，整段真值历史直达云端 LLM**，六层拦截一层都不在。

DESIGN.md:268 把通道 8 标为「仅靠兜底」并认为兜底仍会生效（:273）——这个判断是错的，兜底对压缩请求
根本不触发。5.2 的 10 条盲点也没列它。这是文档之外最大的泄漏通道。

### S3｜子代理（lean 模式，默认）被剥掉 5/7 个钩子，system prompt 裸奔

本机装有 pi-subagents。其 `src/runner/sdk-runner.ts:40` 定义
`SUBAGENT_ALLOWED_EXTENSION_EVENTS = ['tool_call', 'tool_result', 'user_bash']`，
`sdk-runner.ts:50-62` 据此过滤所有扩展的 handlers；`config.ts:149-152` 默认
`session_resources = 'lean'`。后果：

- **子代理的 system prompt（subagent markdown 正文、工具说明）不经任何脱敏出站**——主代理场景里由
  payload 层挡住的用户名路径等真值，子代理场景无任何覆盖；
- 泄漏断言在子代理中不存在；
- `session_start` 被剥 → 子代理映射永不持久化；`message_end` 被剥 → 子代理回复保持占位符，而主代理
  state 里没有这些 token → 用户看到还原不了的 `<<PERSON:N>>`（可用性问题，非泄漏）；
- 唯一幸存的是 `tool_result` 脱敏和 `tool_call` 还原（同一实例内存 state，勉强闭环）。

DESIGN 6.3-3 说「RPC 全链路未跑真实插件」，但没意识到子代理是独立的一条链路。

---

## ① 第 8 章 12 问逐答

**Q1 三层职责划分是否合理，有无被短路的层？**
分层思路对，但职责划分和实际风险错位：文档按「消息结构」分了三层，而真实的短路形态是 S2／S3 那种
**整条钩子链被绕过**——层间再严密也没用。另外 payload 兜底层实际承担了通道 6-8、system prompt 的
「唯一防线」角色（DESIGN:150 自己承认它是「唯一 fail-closed」），它偏偏是 S1 中唯一会被拆掉的层。
结论：职责表要按「哪些通道只有这一层」重画，把「单层依赖通道」标红，并把 S2/S3 补进覆盖矩阵。

**Q2 通道 6-8 要不要提升为 context 显式处理？**
值得做但优先级低：`mapMessage`（`src/index.ts:60`）对未知 role 加一个保守的 `deepMapStrings` 遍历即可，
成本约 5 行。它只加深纵深，修不了 S1-S3。做了之后通道 6-8 从「仅兜底」变成双层，断言（修复后的）也能
更早介入。

**Q3 递归替换的副作用？**
除性能外有四个：a) `deepMapStrings` 重建所有对象，原型链丢失、`Map/Date/URL/BigInt` 类值会被破坏成
普通对象——当前 provider payload 纯 JSON 无碍，provider 实现一变就炸，属于 DESIGN:273 说的那个假设的
另一面；b) **对象 key 不替换**（`src/index.ts:14-26` 只 map 值），真值进 key 就漏，findLeak 查的是
`JSON.stringify` 全文所以能兜住 ≥3 字符的值；c) 每轮全量克隆 + 全量扫描 + findLeak 全值遍历，复杂度
O(轮数 × 历史长度 × (词表+规则数))，建议给 mask 加耗时统计、超阈值告警；d) `context` handler 无条件
`scheduleSave()`（`src/index.ts:154`），无变更也写盘防抖，小浪费。

**Q4 fail-open + 单一 fail-closed 是否成立？**
策略方向可以（可用性优先的判断成立），但实现让这个句式失去意义：唯一的 fail-closed 是 S1 那样的
双重 fail-open。修复顺序：先让断言真的能拦（S1 的就地改写方案），再谈分级。分级建议：凭据类
（SECRET/BANK_CARD/ID_CARD）残留 → 强替换+硬告警；人名类残留 → 强替换+软告警。**都不要依赖
throw**——pi 的钩子契约不支持用它做控制流。

**Q5 findLeak 检查集够不够？如何独立于检测规则？**
不够，有四个独立缺陷（后三个文档没披露）：
- `<3` 字符跳过（`src/index.ts:197`，见下 S5）；
- JSON 转义盲区（见下 S6）；
- 自证循环（DESIGN 5.2-7 已承认）；
- 检查集合随 `state.values` 增长，`json.includes` 是 O(值数×payload)，值多了既慢又倾向再加豁免，
  越加越弱。

独立检查的现实组合：① 对审计 jsonl 用**第二套规则**交叉扫（哪怕只覆盖结构化 PII）；② 词表值做
**规范化变体**（去空白、全半角折叠、NFKC）后再 includes——能抓转义和变形残留；③ `PII_GUARD_AUDIT`
固定条数人工抽查进月度流程。完美独立验证不存在，但这三层能把自证循环撕开口子。

**Q6 超长文本：告警还是阻断？**
告警，绝不阻断。理由：a) S1 已证明 throw 达不到阻断目的；b) 触发场景（子代理大输出）恰恰是 S3 下
没有断言保护的路径，阻断只伤工作流不减少泄漏；c) 更好的做法是**不跳过**——对超长文本只跑词表索引
扫描（O(n)，正则跳过），性能可接受；至少也要 `ui.notify`。当前完全静默（`src/index.ts:82`）是必须改的
点，DESIGN:279 的「告警或阻断」二选一时选告警。

**Q7 映射文件加密是否值得？**
不值。威胁模型已把本机磁盘列为非目标（DESIGN 5.3），0600 + 0700 够用；加密后密钥存钥匙串，能读磁盘的
同用户进程大概率也读得到钥匙串，复杂度换来假安心。**真问题是备份通道**：5.2-8 提了 Time Machine，
但 5.3 边界表没列「iCloud／云备份把 `state/*.json` 带离本机」这一行——建议补进边界表，处置是
「把 `~/.pi/agent/pii-guard/` 加入备份排除」而不是加密。

**Q8 BANK_CARD 误报／漏检组合？**
漏检实锤（用项目引擎实测）：**Amex 15 位（`378282246310005`，Luhn 有效）不命中**——`src/rules.ts:58`
长度限 16-19，而 :60 注释自称覆盖 amex，规则与注释自相矛盾；Diners 14 位同理。修正：长度放宽到
`14-19` + 保留 Luhn + 首位约束，误报不会显著上升（订单号几乎不带 Luhn 校验位）。误报方向现有取向合理。
另外实测：15 位旧身份证不命中（可接受，但应写进「不挡」清单）；**智谱 GLM 密钥格式（`id.secret`
两段式）无任何规则**——当前 provider 就是智谱，vault 里若存过 key 直接漏，建议加一条带上下文锚定的
规则。银联 19 位（Luhn 有效构造号）实测正常命中。

**Q9 词表匹配在中文语料的失效场景？**
a) **全半角**：全角字母／数字别名与半角文本互不命中（未做 NFKC 归一）；b) **简繁混排**：词表只有简体
则繁体原文漏；c) **过度匹配**：2 字名命中 3 字名前缀（张三 ⊂ 张三丰）——还原保真不受损（按值映射），
但模型看到的实体边界错位，是噪声非泄漏，文档可加一句定性；d) 零宽字符／同形异码属对抗场景，
6.3-4 已承认未测；e) 首字符索引逐码位扫描对增补字符（非 BMP 汉字）按 UTF-16 码元处理仍正确，无碍。
优先补 a（ASCII 别名侧做 casefold + 全半角折叠即可，中文别名成本高可不做）。

**Q10 是否引入中文 NER？**
维持「暂缓」的判断，且理由要修正：当前所有实锤漏洞（S1-S3）都在**管线覆盖**层，不在召回率层——
NER 装上去只增强 tool_result／context 两层的检测，compaction 和子代理照样漏，钱花在刀背上。若引入，
只走「离线候选发现」模式（NER 跑 `tools/scan-names.mjs` 同类任务，结果进词表），**不进在线链路**——
在线推理的延迟与 8GB 内存压力违背约束 3，离线模式零新增泄漏面（模型本地跑，不出网）。

**Q11 验证是否足够支撑「放心用」？**
不够。按危害排序的缺口：① compaction 全链路未测（S2 是实锤缺陷）；② 子代理链路未测（S3）；
③ **断言从未被对抗验证过**——「抛错能阻断」是文档的核心安全声明，却没有任何测试证明它成立
（S1 证明它不成立）；④ `/pii clear` 与 resume 丢 state 的 token 污染未测（S4，见下）；⑤ 真实 vault
只测 4 个文件（6.3-2 已承认）；⑥ RPC 插件全链路未跑。建议补一个「钩子覆盖度探针」：注册探针扩展
记录每次事件触发与 payload 快照，对 compaction／子代理／clear／resume 四场景断言
「before_provider_request 被调用过」。这一套同时就是 Q12 的回归基线。

**Q12 如何长期回归？**
a) **pi 事件语义**：S1-S3 全是钩子语义问题，pi 小版本就可能变。把 Q11 的探针测试固化为 `tools/` 下的
脚本，pi 升级后必跑；b) **词表**：月度 scan-names + audit，audit 输出记档对比（命中率骤降 = 词表或
规则坏了）；c) **provider 格式**：换 provider 后对 `PII_GUARD_AUDIT` jsonl 用规范化变体 grep；
d) 先把 AGENTS.md:47 引用的 `tools/selfcheck.mjs` 补上——它不存在，「改完必跑」的清单里有一条永远
跑不了的命令；AGENTS.md:46 的 `node --test tests/` 在 Node 24 上也是 MODULE_NOT_FOUND
（须 `node --test tests/engine.test.ts`）。

---

## ② 文档没提到的真值泄漏路径（按危害排序）

1. **compaction／branch summarization 请求**（S2）：自动压缩触发即全量真值出站。触发条件只需对话
   足够长——344 万字符 vault 的日常使用必然遇到。
2. **子代理会话**（S3）：lean 模式默认剥离 context／before_provider_request／message_end，
   system prompt 与工具说明裸奔。已安装 pi-subagents，每次委派任务都在走这条路。
3. **断言触发瞬间的原始 payload**（S1 事实 2）：检测到泄漏的行为本身把兜底层拆掉。
4. **`/pii clear` 后的间接污染**（S4，探针实测）：clear 后 counters 归零，新值重新占用
   `zhangsan3`，与历史残留同名 token 在**同一 payload 内指向两个不同真值**（复现：历史
   `zhangsan3`=张三丰，新消息 `zhangsan3`=李四）。模型引用旧 token 写文件 → `tool_call` 还原
   写入错误真值 → 静默数据损坏。5.2-9 把同源问题（resume 丢 state）轻描淡写为「还原失败，不泄漏」
   ——实际是**错误还原**，且 clear 的后果文档完全没提。
5. **session jsonl 二次使用**：session 按设计存真值（5.1-11 已披露本地留存），但「用户把 session 文件
   喂给别的 AI 工具／上传」这个动作不在任何缓解清单里，建议在 README 已知限制里点名。
6. **PDF／文档类多模态块**：5.2-1 只说了图片；Anthropic 的 document block 等内嵌文本同样不检测，
   与图片同属「payload 里非 text 块」盲区，应合并披露。
7. **审计文件自身**：`PII_GUARD_AUDIT` 用 `appendFileSync` 默认权限写（通常 0644），内容虽已脱敏但含
   完整 payload 与 system prompt，放 `/tmp` 时其他本地用户可读——低危，加 `mode: 0o600` 即可。

---

## ③ 文档声明 vs 代码实现一致性

| 文档声明 | 实际 | 判定 |
|---|---|---|
| DESIGN:166「抛错阻断请求」「唯一 fail-closed」 | pi 吞掉 handler 异常且回退原始 payload，双重 fail-open（S1） | **不符，核心声明失效** |
| DESIGN:268 通道 8「仅靠兜底（仍会被脱敏）」 | 压缩请求不触发任何钩子（S2） | **不符** |
| DESIGN:24/193「15 条正则规则」「SECRET ×8」 | `rules.ts` 实际 16 条、SECRET ×9 | 不符（计数错误） |
| DESIGN:60 BANK_CARD 注释「银联/visa/master/**amex**」 | Amex 15 位实测漏检 | 不符 |
| AGENTS.md「挡 支付宝｜学号｜社保｜税务号」 | `rules.ts` 无对应规则（ACCOUNT 仅微信两条） | 不符（或文档过期） |
| AGENTS.md:46-47 验证命令 `node --test tests/`、`node tools/selfcheck.mjs` | 前者 Node 24 报 MODULE_NOT_FOUND，后者文件不存在 | 不符 |
| DESIGN:297 audit「不打印真值」 | `tools/audit.mjs:3` 自称不打印，:75 打印 Top N 含真值——工具自我矛盾 | 部分不符 |
| DESIGN 3.4-2 幂等性 | 真实词表下成立，11 个单测实测全绿 | 相符 |
| DESIGN 4.3「tool_call 必须就地修改」 | 与 pi 行为一致，实测闭环 | 相符 |
| DESIGN 4.4 权限／原子写 | `store.ts` 一致（0600 + tmp+rename） | 相符 |
| DESIGN:249「词表解析失败→仅正则生效」 | 低估：`engine.ts:88` 对 `extraPatterns` 的 `new RegExp` 无 try/catch，坏正则会让 `Masker` 构造抛错（`index.ts` 顶层）→ **扩展加载失败，全部防护静默消失** | 低估风险 |

最后一条值得单独强调：词表是用户手工维护的 JSON，粘错一条正则的代价不是「降级到正则」，而是
**整个 guard 消失且无任何通知**。给 `new RegExp` 包一层 try/catch、失败时跳过该条并 `ui.notify`，
是性价比最高的一个补丁。

---

## 修复优先级建议

1. **S1**：断言改为「就地强替换 `event.payload` + emitError」，不依赖 throw（数行改动，消除最危险路径）
2. **S2**：compaction 无法用钩子拦截——现实缓解是把 session 中 user/assistant 的存储改为脱敏版、
   仅在展示层还原（改动大），或至少在文档威胁模型中明示此通道并建议调整自动压缩触发阈值；短期先给
   `context` 层之外的补偿：压缩后对 `compactionSummary` 的真值残留做告警
3. **S3**：给 pi-subagents 配置 `session_resources: "full"`（该模式下钩子全量加载），或在 subagent
   定义中避免真值
4. **S4**：`/pii clear` 改为「清空前保留 counters 基线」或直接禁止会话中途 clear；resume 丢 state 时
   检测历史中已有 token 与新分配冲突
5. **S5/S6**：`findLeak` 去掉 `<3` 跳过，改用规范化变体匹配
6. **S7/S8 + 一致性表**：规则长度修正、智谱 key 规则、`new RegExp` 容错、修文档计数与命令

---

## 附：审查证据索引

| 证据 | 位置 |
|---|---|
| pi 吞掉 before_provider_request 异常 | pi-coding-agent `dist/bundle/chunks/chunk-OMWWHBTG.js`，`emitBeforeProviderRequest` 的 catch → emitError → return currentPayload |
| compaction 绕过钩子 | 同文件 `executeSummarization` → `retryAssistantCall(async() => streamFn(...))`，无 transformContext / onPayload |
| 子代理事件白名单 | pi-subagents-j0k3r `src/runner/sdk-runner.ts:40,50-62`；lean 默认 `src/config.ts:149-152` |
| findLeak `<3` 跳过 | `src/index.ts:197` |
| MAX_TEXT 静默跳过 | `src/index.ts:70,82` |
| /pii clear 归零 | `src/index.ts:254` 附近 |
| BANK_CARD 长度 16-19 | `src/rules.ts:58-60` |
| extraPatterns 无容错 | `src/engine.ts:88` |
| Amex/Diners/GLM key 漏检复现 | 探针脚本（临时），输入 `378282246310005` 等实测原样通过 |
| /pii clear token 污染复现 | 探针脚本：历史 `zhangsan3`=张三丰，clear 后新消息 `zhangsan3`=李四，同 payload 并存 |
| 单测命令失效 | Node 24.11.1 下 `node --test tests/` 报 MODULE_NOT_FOUND；`node --test tests/engine.test.ts` 11 例全绿 |
