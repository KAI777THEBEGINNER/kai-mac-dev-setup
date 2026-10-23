# pi-pii-guard · byted_refined

pi agent 的**出站脱敏层**：内容发往云端模型之前，把身份信息换成 `<<LABEL:N>>` 占位符；
模型回复和写文件的参数再在本地还原成真值。

- **对模型**：张三 → `zhangsan3`，13800000000 → `13812345678`
- **对你**：回复照常显示真值，写进文件的也是真值
- **全程本地**：检测、映射、还原都在本机，原文不出本机

```
tool_result ─脱敏→ 会话历史
context     ─全量兜底脱敏→ 每次请求
tool_call   ←还原─ 工具参数（写文件时）
message_end ←还原─ 助手回复（给你看）
before_provider_request ─兜底脱敏 + 泄漏断言→ 云端
```

> 这份代码是本仓库的一部分，标记为 **byted_refined**：在原始脱敏层之上补了
> 「未知人名启发式」。整个项目都在 `pii-guard/` 下，调试与二次开发直接改这里。

## 目录结构

| 路径 | 说明 |
|---|---|
| `index.ts` / `src/` | pi 扩展本体（目录型扩展入口 + 引擎、规则、词表读写、启发式） |
| `tools/` | `init.mjs` 生成词表、`scan-names.mjs` 扫候选、`audit.mjs` / `session-report.mjs` 审计 |
| `tests/` | 43 个单测 |
| `proxy/` | Codex CLI 用的本地 Responses API 脱敏代理（可选，不进 pi） |
| `launchd/` | 代理的 LaunchAgent 模板 |
| `DESIGN.md` / `REVIEW.md` / `HANDOFF-codex-proxy.md` | 设计、审核结论与代理交接记录 |

`install.sh` 只把运行时文件（`index.ts`、`src/`、`tools/`、`tests/`、`package.json`、`README.md`、`wordlist.example.json`）
装到 `~/.pi/agent/extensions/pii-guard`；`proxy/`、`launchd/` 和设计文档留在仓库里，不随安装复制。

## 挡什么

| 类别 | 方式 |
|---|---|
| 手机号｜邮箱｜身份证｜护照｜银行卡（Luhn 校验） | 正则 |
| API key｜token｜私钥｜带账号密码的 URL｜JWT | 正则 |
| 微信号 | 正则 |
| 本人及往来人名的各种写法（中/英/拼音） | 词表 |
| 机构、学校、学号等自定义实体 | 词表（label 自定） |
| **词表里没有的新人名** | 启发式（见下） |

## 未知人名启发式（byted_refined 新增）

只在高置信上下文里认人，不做全量 n-gram。

### 「XX老师」槽位（2026-10-22 加）

用户口径：称呼老师一定带「老师」二字。因此 XX 不限定形状，以下都算：

| 写法 | 例子 |
|---|---|
| 姓 | 王老师 |
| 名字后两字 | 小梅老师 |
| 全名 | 王小明老师 |
| 复姓 | 欧阳娜娜老师 |
| 拼音 / 英文 | Wang老师、zhang老师、Zhang San老师 |

排除噪音：「语文老师」「班主任老师」「各位老师」「项目老师」「任课老师」里的 XX 不是人名，
靠 `TEACHER_NOISE` + `NAME_NOISE` 两份黑名单挡掉；单字候选只认「姓 + 词边界」，
避免把「语文老师」拆成「文」老师。

**单字不登记**：「王老师」只挡当前这一处，不会把「王」登记成全局人名，
否则后面每个「王」都会被换成占位符。

### 其他称谓与引导词

- 称谓后缀：X 经理 / X 同学 / X 总 / X 教授……
- 引导词：叫 X / 姓名：X / 联系人：X

判定条件：以常见姓氏开头 + 长度 2~3（复姓 3~4）+ 不在噪音词表里；
引导词后还必须紧跟标点或常见谓语，避免把「叫张三明天来」读成「张三天」。

**一次认出、全会话生效**：某个名字被启发式命中后（≥2 字），会登记进本次会话的词表桶，
之后不带称谓的裸提及（「王小梅后来又改口」）同样会被挡住，token 保持一致。

**挡不住的**：既没有称谓也没有引导词、又不在词表里的人名（「和王小梅对接」里的「王小梅」）；
纯拼音写法；地址；公众人物。要覆盖这些请把人名加进词表——`tools/scan-names.mjs`
可以从 Obsidian vault 里扫候选，人工确认后入库。

**误伤优先于漏挡还是反过来？** 这里选的是精度优先：认错一个人名会把普通词换成占位符，
模型会把它当实体，直接污染回答；漏掉一个名字还有词表兜底。所以噪音词表（高兴、马上、方向、
项目、语文、各位……）宁可长一点。

关闭启发式：词表里加 `"nameHeuristics": false`，或启动时 `PII_GUARD_HEURISTICS=0`。

## 上下文压缩（compaction）

pi 的压缩直接调裸 streamFn，绕过全部钩子。本扩展在 `session_before_compact` 里**就地脱敏**要发给模型的三处内容
（`messagesToSummarize`、`turnPrefixMessages`、`previousSummary`），然后放行——**压缩永远不会被取消**。

例外：手动 `/compact 你的指令` 里当场打的那句话，pi 是从局部变量取的，扩展改不到，若其中含真实姓名仍会原样发出。

## 安装（本仓库内）

`manifest.json` 已经把本目录映射到 `~/.pi/agent/extensions/pii-guard`，
`bash install.sh` 会一并装好，并把扩展登记进 `settings.json`。

首次使用初始化词表：

```bash
cd ~/.pi/agent/extensions/pii-guard
node tools/init.mjs            # 写 ~/.pi/agent/pii-guard/wordlist.json（已存在不覆盖）
node tools/init.mjs --print    # 只看模板，不写盘
```

改完词表 `/reload` 即可生效，不用重启。

## 词表

`~/.pi/agent/pii-guard/wordlist.json`（700 目录 / 600 文件，**绝不入库**）：

```json
{
  "version": 1,
  "people": [
    { "label": "PERSON", "canonical": "张三", "aliases": ["小张", "zhangsan"] },
    { "label": "ORG", "canonical": "示例大学", "aliases": ["示例大"] }
  ],
  "extraPatterns": [{ "label": "STUDENT_ID", "regex": "\\b2021\\d{7}\\b", "description": "学号" }],
  "allow": ["与词表撞车的地名"]
}
```

仓库里的 `wordlist.example.json` 是同样结构的脱敏示例，复制过去改成真值即可。

## 自测

```bash
cd ~/.pi/agent/extensions/pii-guard
node --test tests/engine.test.ts tests/payload.test.ts tests/name-heuristic.test.ts
```

## 运行期数据

| 路径 | 内容 |
|---|---|
| `~/.pi/agent/pii-guard/wordlist.json` | 词表（含真值，600 权限） |
| `~/.pi/agent/pii-guard/state/<session>.json` | 会话级 token ↔ 真值映射 |
| `~/.pi/agent/pii-guard/leaks.log` | 残留断言记录 |

这些文件**不进 git**，换机器要单独拷词表（或重新跑 `tools/init.mjs` 填一遍）。
