# pi-pii-guard — 项目规则

给 pi agent（CLI 与 Obsidian pi-agent 插件）做**出站脱敏**：内容发往云端 LLM 之前，把身份类信息替换成占位符；模型回复与写文件的参数再还原成真值。

## 目标与范围（2026-10-12 与用户确认）

**挡**（替换为 `<<LABEL:N>>` 占位符）：

- 用户本人：中文全名｜张叁｜张叁三｜张叁四｜张叁五｜手机｜私人邮箱｜微信/支付宝号｜学号｜银行卡｜证件号
- 真实往来的人：李四（示例学院推荐人）｜王五（示例学院推荐人）｜赵六（示例实验室主导师）｜孙七（示例实验室文书）｜周八（字节 leader）｜吴九
- 凭据类：API key｜token｜私钥｜带密码的 URL
- 政府申报相关：身份证｜护照｜社保｜税务号（都走身份证规则覆盖）
- 支付宝账号（手机/邮箱形态已被覆盖）；**学号暂无通用规则**，需要时在词表 `extraPatterns` 里按自己的格式加一条

**不挡**：机构名｜学校名｜公司名｜地址｜公众人物（李飞飞、Sam Altman、书籍作者等）。

**已排除**（用户不认识，勿加入词表）：谢笑林、任俊萍、华国凡、黄雪桐、黄君怡、李继刚。

## 硬约束

1. **全本地**：检测、映射、还原都在本机完成，不把原文发给任何服务。
2. **词表与映射不入 git**：词表存 `~/.pi/agent/pii-guard/wordlist.json`，会话映射存 `~/.pi/agent/pii-guard/state/`。仓库里只放 example 与代码。
3. **不破坏工作流**：还原必须准确；检测/存储出错时不得拦截工具执行（fail-open），但要 `ui.notify` 告警。
4. **幂等**：mask 对已脱敏文本再跑一次结果不变（占位符本身不匹配任何规则）。
5. **不碰二进制载荷**：payload 里的 base64 data URI 与图片 block（OpenAI `image_url`｜Anthropic `image`｜pi 内部 `image`）
   一律整块跳过，脱敏／泄漏检查／还原都不例外。随机 base64 里撞上人名是**碰撞不是泄漏**，替换会打断 base64 →
   provider 报 `Invalid base64 data` 拒掉整个请求（2026-10-12 实测，见 `memory/pi-pii-guard.md`）。

## 目录约定

```
src/index.ts     pi 扩展入口（事件接线）
src/engine.ts    脱敏/还原引擎（纯函数，可单测）
src/rules.ts     正则规则集
src/store.ts     词表加载 + 映射持久化
tools/init.mjs   初始化 ~/.pi/agent/pii-guard/wordlist.json（不存在才写）
tools/scan-names.mjs  月度增量人名扫描（出候选清单给人确认）
tests/            node:test 单测，fixtures 用假数据
```

## 命名与风格

- 代码英文，注释中文（与 `~/.pi/agent/extensions/` 现有扩展一致）
- 占位符格式固定 `<<LABEL:N>>`（LABEL 大写，N 从 1 递增，按 label 各自计数）
- 还原时容忍空格变体 `<< LABEL : N >>`，输出必须是紧凑格式

## 写作注意（改本项目文件前必读）

**不要在本项目的文件里写「<<标签:数字>>」形式的字面量**（如 `张叁三`）。在 pii-guard 生效的会话里，
工具参数还原会把它当成真实占位符、替换成真值写进文件——2026-10-12 实际踩过，`tests/payload.test.ts` 被整片污染需重写。

- 测试/代码里需要构造 token：用运行时的 `T()` 拼接（见 `tests/payload.test.ts`）
- 文档里必须展示占位符格式时：先 `/pii args off` 关掉参数还原，改完再 `/pii args on`

## 验证要求（改完必跑）

```bash
node --test tests/engine.test.ts   # 单测全绿（Node 24 不支持 --test 传目录）
node tools/audit.mjs <dir> --top 0 # 覆盖率审计（不打印真值）
```

端到端回归：`pi -ne -e <index.ts> --provider <fake> ... -p "..."` 或按 README 的冒烟步骤，确认 payload 里无真值、工具写入是真值。

## 数据流

```
tool_result ─脱敏→ session/历史 ─context 全量兜底─→ before_provider_request ─→ 云端 LLM
tool_call   ←还原─ 工具执行（本地真值）
message_end ←还原─ 用户看到真值（写回 session，下一轮 context 再脱敏）
```
