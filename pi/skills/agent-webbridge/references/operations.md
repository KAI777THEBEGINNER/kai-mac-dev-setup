# agent-webbridge 运维与排障

daemon 脚本：`/Users/zhaoziqi/agent-webbridge/agent-webbridge-daemon.py`
状态目录：`/Users/zhaoziqi/.agent-webbridge`（日志 `logs/daemon.log`、pid `daemon.pid`、skill 副本 `skills/`）

## 生命周期

```bash
python3 /Users/zhaoziqi/agent-webbridge/agent-webbridge-daemon.py start            # 后台启动（幂等，已在跑则直接返回）
python3 /Users/zhaoziqi/agent-webbridge/agent-webbridge-daemon.py status           # 打印 /status JSON
python3 /Users/zhaoziqi/agent-webbridge/agent-webbridge-daemon.py stop             # 停止
python3 /Users/zhaoziqi/agent-webbridge/agent-webbridge-daemon.py restart          # 重启
python3 /Users/zhaoziqi/agent-webbridge/agent-webbridge-daemon.py run --verbose    # 前台调试
```

端口默认 10086，可用 `--port` 或环境变量 `AGENT_WEBBRIDGE_PORT` 改。
**不要在没得到用户许可时执行 `stop` / `restart`**：会打断别人正在跑的浏览器任务。

## 判断哪一环断了

```bash
curl -s http://127.0.0.1:10086/health     # daemon 活着 → {"ok":true}
curl -s http://127.0.0.1:10086/status     # 看 extension_connected / extension_version / sessions
```

- `/health` 不通：daemon 没起 → `start`；若报端口占用，说明另一个同类 daemon 占着 10086，
  同一时刻只能有一个，先停掉它。
- `/health` 通但 `extension_connected` 为 false：扩展没装、被停用，或有另一个同类扩展抢连接。
  扩展每 30 秒自愈重连一次，daemon 重启后等一会儿即可；始终连不上就让用户去
  `chrome://extensions` 确认扩展已启用，并停用其他同类扩展。
- 工具报 `extension_error`：错误来自扩展/CDP 侧，通常是选择器失效或页面拦了操作，
  重新 `snapshot` 拿新的 `@e` 引用再试。
- 工具报 `tool_error` 且提示 `session "x" has no tab`：该 session 还没有标签，
  先 `navigate` 或 `find_tab`。

## skill 文件从哪来

daemon 每次启动会把 skill（`SKILL.md` / `references/operations.md` / `tools.json`）
写到本机权威副本 `/Users/zhaoziqi/.agent-webbridge/skills`，并同步到已存在的 agent skill 目录（`~/.claude/skills/`、`~/.codex/skills/`）。
内容只在有变化时才覆盖写。

- 手动重写一次：`python3 /Users/zhaoziqi/agent-webbridge/agent-webbridge-daemon.py install-skill`
- 启动时不写：`python3 /Users/zhaoziqi/agent-webbridge/agent-webbridge-daemon.py run --no-skill-install`
- 追加目标目录：`AGENT_WEBBRIDGE_SKILL_DIRS=/path/to/skills:/another/skills`

## 安全边界

- 只监听 `127.0.0.1`，非本机来源的 HTTP 请求直接 403。
- `/ws` 校验 `Origin` 必须是 `chrome-extension://…`（浏览器 WebSocket 不受同源策略约束，
  不校验等于把浏览器控制权暴露给任意网页）。
- 可选扩展白名单：`/Users/zhaoziqi/.agent-webbridge/allowed_extensions.txt`，每行一个扩展 ID。
- 无任何外部上报；日志只记工具名与调试信息，不上传。
- 任何能访问本机端口的进程都能驾驶这个浏览器，别把端口转发出去。
