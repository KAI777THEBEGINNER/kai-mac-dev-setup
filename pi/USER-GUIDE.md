# pi 使用手册（Kai 专用版）

> 版本 0.84.1 ｜ 2026-08-14 ｜ 基于你的实际配置写成

## 1. 启动

```bash
pi                        # 交互式会话（日常用这个）
pi -p "问题"              # 一次性问答，不进交互
pi -c                     # 继续上一次会话
pi -r                     # 选择要恢复的会话
```

- 退出：`Ctrl+C` 两次，或编辑器为空时 `Ctrl+D`
- 新终端窗口直接可用；旧窗口执行 `source ~/.zshrc`

## 2. 你的模型配置（现状）

| 项 | 值 |
|---|---|
| 默认 provider | deepseek（key 在 auth.json） |
| 默认模型 | deepseek-v4-flash（快、省） |
| 强推理 | /model 里选 deepseek-v4-pro，或 `pi --model deepseek/deepseek-v4-pro` |
| kimi | 待配（见第 6 节） |

**所有模型平级**：`/model` 列出全部已认证 provider 的模型，无主次。轮换列表由 settings.json 的 `enabledModels` 控制（只影响快捷键轮换范围，不影响 /model 可见性）。

## 3. 换模型的三个入口

| 方式 | 操作 | 说明 |
|---|---|---|
| 模型选择器 | `/model` 或 `Ctrl+L` | 模糊搜索（如输入 pro 找 v4-pro） |
| 快捷键轮换 | `Ctrl+M` 下一个 ｜ `Shift+Ctrl+M` 上一个 | 已从 Ctrl+P 改绑（避开 zellij） |
| 启动指定 | `pi --model deepseek/deepseek-v4-pro` | 本次会话固定 |

## 4. 日常能力

- **Skill**：`/skill:名称` 直接调（如 `/skill:audio-to-notes <链接>`），或描述需求自动匹配。列表用 `/skills`
- **子代理**：自动分配。已迁 6 个：code-reviewer、python-reviewer、typescript-reviewer、planner（用 pro 模型）、build-error-resolver、cnki-researcher
- **浏览器**：说「用 agent-webbridge」，自动接管 Dia 浏览器（保留登录态）。daemon 管理：`python3 ~/agent-webbridge/agent-webbridge-daemon.py status|start|stop`
- **读图**：deepseek 不支持图像输入，pi 侧自动走 `~/.pi/agent/scripts/ocr_image.py`（本地 OCR），直接给图片路径即可
- **记忆**：pi 无自动记忆。关键习惯已写死在 AGENTS.md（中文标点、PDF 多模态、禁止静默覆盖等）；项目细节存 `~/.pi/agent/memory/`，模型按需读取

## 5. 配置文件地图（`~/.pi/agent/`）

| 文件 | 干什么 | 备注 |
|---|---|---|
| `auth.json` | 所有 provider 的 key | 权限 600，别手删内容；所有条目平级 |
| `settings.json` | 默认模型、enabledModels（轮换范围）、主题 | pi 运行时会写 lastChangelogVersion 等 |
| `keybindings.json` | 快捷键 | 改完 `/reload` 生效 |
| `models.json` | 自定义 provider（OpenAI/Anthropic/Google 兼容 API） | 内置 provider 不用写 |
| `AGENTS.md` | 全局指令（自动加载） | 项目 CLAUDE.md 也兼容读取 |
| `skills/`、`agents/`、`extensions/`、`memory/` | 技能、子代理、扩展、记忆 | |

## 6. 配置新 provider（以 kimi 为例）

**方法 A（推荐）**：`/login` → 回车 → 选 provider → 粘贴 key → 回车。注意 `/login` 不带参数。

**方法 B（手动）**：编辑 `~/.pi/agent/auth.json`：

```json
{
  "deepseek":    { "type": "api_key", "key": "sk-..." },
  "kimi-coding": { "type": "api_key", "key": "sk-..." }
}
```

每行一个 provider，同格式平级；注意上一行结尾的逗号。然后：

1. `pi update --models`（刷新模型目录）
2. `/reload`
3. `/model` 里选新模型

## 6.5 加新模型/新厂商（决策流程）

| 场景 | 操作 |
|---|---|
| 现有厂商出新模型 | 零操作（目录自动刷新）；急用：`pi update --models` |
| 加内置厂商（40+ 家） | `/login` → 选 provider → 「Use an API key」→ 粘贴 key → `pi update --models` → enabledModels 加 `"<provider>/*"` |
| 加非内置厂商 | 见第 7 节 models.json |

判断是否内置：`pi --list-models | grep 厂商名`。内置常见：deepseek、kimi-coding、openrouter、zai、zai-coding-cn、minimax、minimax-cn、qwen-token-plan、xiaomi 等。

## 7. 自定义 provider（models.json）

仅对 OpenAI/Anthropic/Google 兼容 API（OpenRouter、智谱、Ollama 等）需要：

```json
{
  "providers": {
    "openrouter": {
      "baseUrl": "https://openrouter.ai/api/v1",
      "api": "openai-completions",
      "apiKey": "sk-or-...",
      "models": [{ "id": "anthropic/claude-sonnet-5" }]
    }
  }
}
```

## 8. 与 Claude Code 的差异（容易踩的）

1. **无 WebSearch/WebFetch**：查资料用 `curl` 或让 pi 写脚本
2. **无 MCP**：第三方服务不接；浏览器任务走 agent-webbridge
3. **无 hooks**：handoff 之类依赖 hooks 的 skill 不适用
4. **无权限弹窗（重要）**：所有工具直接以账户权限执行，没有 bypass/acceptEdits 模式可轮换。唯一的守卫是 project trust（`/trust` 决定是否加载项目本地配置），不拦截工具操作。不信任的代码别在 pi 里跑陌生命令
5. **会话记录**：`~/.pi/agent/sessions/`，与 `~/.claude` 互不影响

## 9. 已踩过的坑（别再踩）

| 坑 | 现象 | 解法 |
|---|---|---|
| `/login kimi-coding` 带参数 | 回车没反应 | 用不带参数的 `/login` |
| auth.json 被清空 | pi 报 No models available | key 的源在 `~/.claude/settings.json` 的 `env.ANTHROPIC_AUTH_TOKEN`（别删） |
| 手写 JSON 出错 | 全部 provider 一起失效 | 少逗号/引号/中文标点都会炸；写完 `python3 -m json.tool` 验证 |
| Ctrl+P 撞 zellij | 快捷键被 zellij 抢 | 已改绑 Ctrl+M（keybindings.json） |
| enabledModels 缺新 provider | Ctrl+P 轮换不到 | 加一条 pattern，如 `"kimi-coding-*"` |
| skill 缺 frontmatter | pi 报 description is required | SKILL.md 头部必须有 `---` 块含 name + description |

## 10. 验证清单（配置完跑一遍）

```bash
pi -p "回复ok"          # 连通性
# 进交互后：
#   /model             → 应列出 deepseek、kimi 等全部模型
#   Ctrl+M             → 轮换模型
#   /skills            → 49 个 skill 正常
#   菜单栏 HUD          → 显示 pi 会话状态
```
