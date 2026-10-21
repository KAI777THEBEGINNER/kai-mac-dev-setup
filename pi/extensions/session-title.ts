// Session Title — 语义总结任务内容作为会话标题
//
// 每次 agent 完全落定（agent_settled）后，用当前模型把会话核心任务
// 总结成一句短标题，写入会话名（pi.setSessionName），重启/恢复会话后自动还原。
//
// 2026-10-22：不再往 TUI footer 推状态行（省一行显示空间），只写会话名；
// 总结与命名逻辑保持原样，标题照常生成。
//
// 规则：
//   - 只在会话内容有新增（指纹变化）时才重新生成，一次用户输入最多生成一次
//   - 用户手动 /name 过就不再自动覆盖
//   - 模型不可用、生成失败时静默跳过，不打扰主流程
//   - 会话被替换（/new、/fork、/resume）或 /reload 后，旧实例的 ctx/pi 一律作废：
//     定时器回调与生成结果全部作废且绝不抛错（否则 uncaughtException 会杀死整个 pi）
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { uuidv7 } from "@earendil-works/pi-ai";

const TITLE_MAX = 40;
const CONVERSATION_BUDGET = 6000;
const PER_MESSAGE_CAP = 400;
const DEBOUNCE_MS = 2500;
const GEN_TIMEOUT_MS = 45_000;

type ContentBlock = { type?: string; text?: string; name?: string };
type SessionEntry = { type: string; message?: { role?: string; content?: unknown } };

// ---------- 会话文本提取 ----------

function extractText(content: unknown): string[] {
  if (typeof content === "string") return [content];
  if (!Array.isArray(content)) return [];
  const parts: string[] = [];
  for (const part of content) {
    if (part && typeof part === "object") {
      const block = part as ContentBlock;
      if (block.type === "text" && typeof block.text === "string") parts.push(block.text);
    }
  }
  return parts;
}

function extractToolNames(content: unknown): string[] {
  if (!Array.isArray(content)) return [];
  const names: string[] = [];
  for (const part of content) {
    if (part && typeof part === "object") {
      const block = part as ContentBlock;
      if (block.type === "toolCall" && typeof block.name === "string") names.push(block.name);
    }
  }
  return names;
}

// 从最近的消息往前拼，控制总预算；用户/助手文本 + 助手调用的工具名
function buildConversationText(entries: SessionEntry[]): string {
  const parts: string[] = [];
  let budget = CONVERSATION_BUDGET;
  for (let i = entries.length - 1; i >= 0 && budget > 0; i--) {
    const entry = entries[i];
    if (entry.type !== "message" || !entry.message?.role) continue;
    const { role, content } = entry.message;
    if (role !== "user" && role !== "assistant") continue;

    const lines: string[] = [];
    const text = extractText(content).join("\n").trim();
    if (text) lines.push(`${role === "user" ? "用户" : "助手"}: ${text}`);
    if (role === "assistant") {
      const tools = extractToolNames(content);
      if (tools.length > 0) lines.push(`助手调用工具: ${tools.join(", ")}`);
    }
    if (lines.length === 0) continue;

    let chunk = lines.join("\n");
    if (chunk.length > PER_MESSAGE_CAP) chunk = chunk.slice(0, PER_MESSAGE_CAP) + "…";
    if (chunk.length > budget) chunk = chunk.slice(0, budget) + "…";
    budget -= chunk.length;
    parts.unshift(chunk);
  }
  return parts.join("\n");
}

// 轻量指纹：用户消息条数 + 总文本量 + 最后一条用户消息尾部
// 只有出现新的用户内容才会触发重新生成
function fingerprint(entries: SessionEntry[]): string {
  let count = 0;
  let total = 0;
  let last = "";
  for (const entry of entries) {
    if (entry.type !== "message" || entry.message?.role !== "user") continue;
    count++;
    const text = extractText(entry.message.content).join(" ").trim();
    total += text.length;
    if (text) last = text.slice(-200);
  }
  return `${count}|${total}|${last}`;
}

// 去掉模型输出里的引号、markdown 符号和结尾标点
function cleanTitle(raw: string): string | undefined {
  let t = raw.trim();
  t = t.replace(/^[\s"'“”‘’「」『』【】()（）《》[\]]+|[\s"'“”‘’「」『』【】()（）《》[\]]+$/g, "");
  t = t.replace(/^#+\s*/, "");
  t = t.replace(/^\s*[-*+]\s+/, "");
  t = t.replace(/\*\*/g, "");
  t = t.replace(/`/g, "");
  t = t.replace(/[。．.！!？?；;：:，,、\s]+$/g, "");
  t = t.replace(/\s+/g, " ").trim();
  if (!t) return undefined;
  return t.length > TITLE_MAX ? t.slice(0, TITLE_MAX) : t;
}

function buildTitlePrompt(conversation: string): string {
  return [
    "你是会话标题生成器。下面是一段人与 AI 协作会话的摘录，请根据它用一句简短的中文概括这段会话正在完成的核心任务，作为会话标题。",
    "要求：",
    "- 不超过 20 个字",
    "- 不要书名号、引号或任何标点符号",
    "- 不要解释，直接输出标题本身",
    "",
    "<会话摘录>",
    conversation,
    "</会话摘录>",
  ].join("\n");
}

export default function (pi: ExtensionAPI) {
  let generatedTitle: string | undefined; // 最近一次由本扩展生成的标题
  let manualTitle = false; // 用户手动 /name 过，不再自动覆盖
  let lastFingerprint = "";
  let timer: ReturnType<typeof setTimeout> | undefined;
  let running = false;
  // session_shutdown 之后旧实例持有的 ctx/pi 都可能已被 pi 标记为 stale，触碰即抛错
  let shutdown = false;

  const generate = async (ctx: ExtensionContext) => {
    if (running || shutdown) return;
    const model = ctx.model;
    if (!model || !ctx.modelRegistry.hasConfiguredAuth(model)) return;

    const conversation = buildConversationText(ctx.sessionManager.getBranch());
    if (!conversation.trim()) return;

    running = true;
    try {
      const response = await ctx.modelRegistry.complete(
        model,
        {
          messages: [
            {
              role: "user" as const,
              content: [{ type: "text" as const, text: buildTitlePrompt(conversation) }],
              timestamp: Date.now(),
            },
          ],
        },
        {
          reasoningEffort: "minimal",
          cacheRetention: "none",
          sessionId: uuidv7(),
          signal: AbortSignal.timeout(GEN_TIMEOUT_MS),
        },
      );

      const raw = response.content
        .filter((c): c is { type: "text"; text: string } => c.type === "text")
        .map((c) => c.text)
        .join(" ")
        .trim();

      const title = cleanTitle(raw);
      if (!title || shutdown) return;

      generatedTitle = title;
      pi.setSessionName(title);
    } catch {
      // 生成失败静默跳过，下一次内容变化时再试
    } finally {
      running = false;
    }
  };

  // 会话启动：记住已有会话名（用于判断是否被手动改过），初始化指纹
  pi.on("session_start", async (_event, ctx) => {
    shutdown = false;
    manualTitle = false;
    generatedTitle = pi.getSessionName();
    lastFingerprint = fingerprint(ctx.sessionManager.getBranch());
  });

  // 会话名变化（/name 或本扩展写入）：手动改名后不再自动覆盖
  pi.on("session_info_changed", async (event) => {
    if (event.name) {
      if (event.name !== generatedTitle) manualTitle = true;
    } else {
      manualTitle = false;
    }
  });

  // 新的一轮开始：取消尚未执行的生成，避免在用户连续输入时白白生成
  pi.on("agent_start", async () => {
    if (timer) {
      clearTimeout(timer);
      timer = undefined;
    }
  });

  // agent 完全落定后：内容有新增且未被手动命名，防抖后生成标题
  pi.on("agent_settled", async (_event, ctx) => {
    if (manualTitle) return;
    const fp = fingerprint(ctx.sessionManager.getBranch());
    if (fp === lastFingerprint) return;
    lastFingerprint = fp;
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = undefined;
      // 此处运行在 pi 事件系统 try/catch 的保护之外：ctx 若已因会话替换/重载失效，
      // 任何异常都会变成 uncaughtException 直接杀死 pi，因此必须全部吞掉
      if (shutdown) return;
      void generate(ctx).catch(() => {});
    }, DEBOUNCE_MS);
  });

  pi.on("session_shutdown", async () => {
    shutdown = true;
    if (timer) {
      clearTimeout(timer);
      timer = undefined;
    }
  });
}
