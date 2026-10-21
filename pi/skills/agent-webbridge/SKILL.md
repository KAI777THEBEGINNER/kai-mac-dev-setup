---
name: agent-webbridge
description: |
  agent-webbridge 让 AI 驾驶用户本机真实的 Chrome（带用户已登录的会话）：打开网页、读页面、点击、
  填表、按键、截图、存 PDF、抓包、跑任意 CDP 命令。凡是需要"真实浏览器 + 真实登录态"的任务都用它：
  浏览网页、操作网页应用、抓取页面内容、走登录后的流程、页面截图取证、把页面存成 PDF。
  用户提到"浏览器""网页""打开链接""帮我在网页上操作""截个图"时优先使用。
  daemon 跑在本机 http://127.0.0.1:10086，全程本地、无外部上报。
metadata:
  version: "v0.1.0-agent"
  endpoint: "http://127.0.0.1:10086"
---

<!-- 本文件由 agent-webbridge daemon 自动生成，手工修改会在 daemon 下次启动时被覆盖 -->

# agent-webbridge

通过本机 daemon（`http://127.0.0.1:10086`）驾驶用户自己的 Chrome。**只读写浏览器，不联网上报任何数据。**

## 调用格式

每个请求都带一个顶层 `session`（任务名），一个任务从头到尾用同一个 session：

```bash
curl -s -X POST http://127.0.0.1:10086/command -H 'Content-Type: application/json' \
  -d '{"action":"navigate","args":{"url":"https://example.com","newTab":true,"group_title":"我的任务"},"session":"my-task"}'
```

响应信封：成功 `{"ok":true,"data":{...}}`，失败 `{"ok":false,"error":{"code":"...","message":"..."}}`。
错误码：`bad_request` / `tool_error` / `extension_error` / `timeout` / `internal_error`。

若内联 JSON 因 shell 转义失败（bash 报错或 daemon 返回 400），不要原样重试：用文件写入工具把
body 写到唯一命名的临时文件（不要用 `echo`/heredoc，同样会破坏 JSON 与中文），再
`curl -s -X POST http://127.0.0.1:10086/command -H 'Content-Type: application/json' --data-binary @<file>`，请求返回后立刻删掉该文件。

机器可读的工具清单（JSON Schema）：`{{HOME}}/.pi/agent/skills/agent-webbridge/tools.json`。

## 工具（共 17 个）

参数带 `\*` 的为必填。取值受限的参数（`format`、`network.cmd`、`paper_format` 等）见 `tools.json` 的 `enum`。

| 工具 | 参数 | 返回 | 说明 |
|------|------|------|------|
| `navigate` | `url`\*, `newTab`, `group_title` | {success, url, tabId} | 在浏览器里打开 URL。首次调用会为该 session 建标签组；newTab=true 时新开标签，否则复用当前标签。 |
| `find_tab` | `url`\*, `active` | {success, url, tabId, borrowed} | 重新选中本 session 之前开过的标签作为当前标签。url 必填（active=true 时也要传，按 hostname 匹配用户正在看的前台标签，就地操作、不并入标签组）。 |
| `snapshot` | — | {url, title, tree}（tree 里交互元素带 @e ref） | 读取当前标签的无障碍树（文本），交互元素带 @e 引用。读页面内容、定位元素都用它，优先于手写 CSS 选择器。 |
| `click` | `selector`\* | {success, tag, text} | 点击元素（DOM 层 el.click()）。selector 可以是 snapshot 给的 @e 引用或 CSS 选择器。 |
| `mouse_click` | `selector`\* | {success, x, y, tag, text} | 按元素真实坐标派发鼠标事件（Input.dispatchMouseEvent）。页面校验事件可信度、或 click 无效时用它。 |
| `fill` | `selector`\*, `value`\* | {success, tag, mode}（mode 为 value 或 contenteditable） | 填入文本，先清空再插入。支持 input/textarea，也支持 contenteditable 富文本编辑器（ProseMirror / Lexical / Slate 等），会派发正确的输入事件。 |
| `evaluate` | `code`\* | {type, value} | 在页面 JS 环境里执行代码并返回结果，支持 async/await。同一页面多次调用共享同一 realm，重复声明 const/let 会报错，用 IIFE 包一层。 |
| `key_type` | `text`\* | {success, length} | 向当前焦点元素插入文本（Input.insertText，一次性插入，不派发逐字符按键事件）。页面依赖真实按键才有反应时用 send_keys。 |
| `send_keys` | `keys`\*, `repeat` | {success, dispatched, os} | 发送按键组合，如 Enter、Escape、Mod+A（Mod 在 macOS 为 Cmd，其他平台为 Ctrl）。 |
| `screenshot` | `format`, `quality`, `selector`, `path` | {format, path, sizeBytes, mimeType}（已落盘，path 是本地文件） | 截图并落盘，返回文件路径而非 base64（模型读不了裸二进制）。默认截可视区域，传 selector 则按该元素的 box 裁剪（会先滚动到元素）。拿到 path 后用文件读取工具打开看图。 |
| `save_as_pdf` | `paper_format`, `landscape`, `scale`, `print_background`, `path`, `file_name` | {path, sizeBytes, mimeType, pageTitle}（已落盘） | 把当前页面渲染为 PDF 并落盘，返回文件路径。解码后上限 100MB。 |
| `network` | `cmd`\*, `filter`, `requestId` | start/stop 返回状态；list 返回 {count, requests[]}；detail 返回该请求的响应详情 | 抓当前标签的网络请求：start 开始录制、list 列请求、detail 看某条的响应体、stop 停止。 |
| `upload` | `selector`\*, `files`\* | {success, selector, fileCount, files} | 给页面的 file input 塞本地文件。 |
| `cdp` | `method`\*, `params` | CDP 原始响应对象（非对象结果包成 {value}） | 原始 Chrome DevTools Protocol 直通，上面工具覆盖不到时的兜底。注意：作用在 tab target 上，不支持 Browser.* 域。 |
| `list_tabs` | — | {success, tabs:[{tabId, url, title, active, groupTitle}]} | 列出本 session 开过的标签（tabId / url / title / active / groupTitle）。 |
| `close_tab` | — | {success, closed, reason?} | 关闭本 session 的当前标签。 |
| `close_session` | — | {success, closed}（closed 是关掉的标签数） | 关闭本 session 开过的所有标签（整组清掉）。只在用户明确要求关标签时调用。 |

## session 语义：一个任务 = 一个 session = 一个标签组

- 任务开始时定好 session 名，**全程不换**，即使跨站点也不换（换名字会把标签组切碎）。
- 按任务命名（`camping-research`、`phone-compare`），不要按站点命名。
- `group_title` 是给人看的标签组名，写在本任务**第一次** `navigate` 上，用用户的语言。
- 单标签类工具（`snapshot` / `click` / `fill` / `screenshot` / `save_as_pdf`）只作用于**当前标签**，
  即最近一次 `navigate` 打开或 `find_tab` 选中的那个；不会误碰别的 session 或用户自己的标签。
- `close_session` 只在用户明确要求（"把那些标签关掉"）时调用。

## 关键约定

- **优先 `snapshot` 拿 `@e` 引用**，再交给 `click` / `fill`。`@e` 基于语义角色，比手写 CSS 选择器抗页面改版。
  只有 snapshot 里没有目标元素、需要读 snapshot 不含的属性（如 `href`）、或要滚动/派发复杂事件时才用 `evaluate`。
- **`evaluate` 返回值用紧凑 `JSON.stringify(data)`**，不要加 `null, 2` 缩进，否则响应体膨胀容易被截断。
  同一页面多次调用共享 JS realm，重复声明 `const`/`let` 会 `SyntaxError`，用 `(() => { ... })()` 包一层。
- **`fill` 是清空后插入**，要追加就先 `evaluate` 读出原值拼好再 `fill`。
- **截图 / PDF 返回文件路径**，不返回 base64；拿 `path` 用文件读取工具打开。自定义 `path` 会被原样使用
  （父目录自动建、同名覆盖），并发时给不同文件名。
- 表单提交没有单独的"按回车"工具：直接 `click` 提交按钮，或 `send_keys` 发 `Enter`。

## 已知限制

- 严格校验 `event.isTrusted` 的页面（部分银行、验证码）会忽略 `click` / `fill` 的合成事件；
  这类页面告诉用户需要手动操作（进阶做法是走 `cdp` 直通派发可信输入）。
- `fill` / `click` / `evaluate` / `snapshot` 作用在顶层 frame。目标在跨域 iframe 里时，直接 navigate 到该 iframe 的 URL。
- `cdp` 作用在 tab target 上，不支持 `Browser.*` 域。

## 调不通时

连接被拒（daemon 没起）时**自己拉起来，不要问用户**，这个命令幂等，已在跑就直接返回：

```bash
python3 {{HOME}}/agent-webbridge/agent-webbridge-daemon.py start
```

然后重试。若仍失败，或浏览器扩展一直连不上（`http://127.0.0.1:10086/status` 里 `extension_connected` 为 false），
按 `{{HOME}}/.pi/agent/skills/agent-webbridge/references/operations.md` 排查：常见原因是扩展没装/被停用，或另一个同类扩展抢占了连接。
不要自动执行 `stop` / `restart`，那会打断正在跑的任务。
