/**
 * pi-pii-guard —— pi 扩展入口：出站脱敏（mask）+ 本地还原（restore）。
 *
 * 数据流（审核后修订版，2026-10-12）：
 *   tool_result ─脱敏→ 会话历史
 *   context     ─全量兜底脱敏→ 每轮请求
 *   before_provider_request ─就地兜底脱敏（含 system prompt）+ 残留断言──▶ 云端
 *   tool_call   ←还原─ 工具参数（本地执行拿真值）
 *   message_end ←还原─ 助手回复（仅"还原模式"，见下）
 *
 * 两种存储模式（按 ctx.mode 自动选择，关键安全设计）：
 *   - TUI（cleanStorage=true）：user/assistant/toolResult 全部以占位符入库，
 *     用户靠 registerMarkdownTransformer 在显示层看到真值。
 *     好处：session 文件、自动压缩（compaction 直接调裸 streamFn，绕过全部钩子）、
 *     子代理读取历史时都不含真值。
 *   - RPC / print / json（cleanStorage=false）：消息按真值入库（用户与插件要读懂），
 *     出站靠 before_provider_request 就地兜底；压缩前由 session_before_compact 就地脱敏（不阻塞）。
 *
 * 失败策略：全程 fail-open（出错不阻断工作流）。pi 会吞掉 handler 抛错并回退到
 * 上一份 payload，所以"抛错阻断"在 pi 里不成立（审核发现 S1），断言改为就地强替换 + 告警。
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { closeSync, openSync, readFileSync, writeSync } from "node:fs";
import path from "node:path";

import { emptyState, Masker, type MaskState, wordStartAt } from "./engine.ts";
import { clearState, GUARD_DIR, loadState, loadWordlist, saveState } from "./store.ts";

type StrFn = (s: string) => string;

// ---- 二进制载荷保护 ---------------------------------------------------------
// base64 是随机串，里"偶然包含真值"是碰撞而不是泄漏；一旦被替换，base64 结构
// 损坏，provider 会直接报 `Invalid base64 data` 拒掉整个请求（2026-10-12 实测：
// Screendrop 截图 base64 里撞上 3 字母英文名，forceMask 把图片打断 → 400）。
// 因此所有出站遍历（脱敏、泄漏检查、还原）都必须整块跳过二进制载荷：
// data URI（图片/PDF/任意附件）与图片 block。
const IMAGE_BLOCK_TYPES = new Set(["image", "image_url", "input_image"]);
const BASE64_DATA_URI = /^\s*data:[^,\s]*;base64,/i;

/** 图片 block：OpenAI（image_url）｜Anthropic（image）｜pi 内部（image）三种形态 */
export function isImageBlockNode(node: unknown): boolean {
  if (!node || typeof node !== "object" || Array.isArray(node)) return false;
  const t = (node as Record<string, unknown>).type;
  return typeof t === "string" && IMAGE_BLOCK_TYPES.has(t);
}

/**
 * base64 data URI（`data:image/png;base64,…` / `data:application/pdf;base64,…`）。
 * 不限于 image：所有 base64 data URI 都是不可读的二进制载荷，替换只会打断它。
 * 对象 type 不可靠时的第二道保险。
 */
export function isBinaryDataUri(value: unknown): boolean {
  return typeof value === "string" && BASE64_DATA_URI.test(value);
}

/** 统一判定：字符串看 data URI 前缀，对象看 block type */
export function isBinaryPayload(value: unknown): boolean {
  return isBinaryDataUri(value) || isImageBlockNode(value);
}

/** 递归重建对象/数组里的所有字符串值（返回新对象）；二进制载荷原样透传 */
function deepMapStrings<T>(value: T, fn: StrFn): T {
  if (isBinaryPayload(value)) return value;
  if (typeof value === "string") return fn(value) as unknown as T;
  if (Array.isArray(value)) return value.map((v) => deepMapStrings(v, fn)) as unknown as T;
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = deepMapStrings(v, fn);
    }
    return out as unknown as T;
  }
  return value;
}

/**
 * 就地变换所有字符串值**与对象 key**。返回是否发生变更。
 * 关键：pi 的 emitBeforeProviderRequest 在 handler 抛错时会丢弃其返回值并回退原始
 * payload，所以兜底必须"就地"改，不能依赖返回值。
 * key 也必须处理：findLeak 会检查 key，若不改 key 则"强制替换"永远无效、告警反复出现。
 */
export function transformInPlace(node: unknown, fn: StrFn): boolean {
  let changed = false;
  if (isImageBlockNode(node)) return false;
  if (Array.isArray(node)) {
    for (let i = 0; i < node.length; i++) {
      const v = node[i];
      if (isBinaryPayload(v)) continue;
      if (typeof v === "string") {
        const nv = fn(v);
        if (nv !== v) {
          node[i] = nv;
          changed = true;
        }
      } else if (v && typeof v === "object") {
        if (transformInPlace(v, fn)) changed = true;
      }
    }
    return changed;
  }
  if (node && typeof node === "object") {
    const obj = node as Record<string, unknown>;
    for (const key of Object.keys(obj)) {
      const v = obj[key];
      let currentKey = key;
      const newKey = fn(key);
      if (newKey !== key) {
        delete obj[key];
        obj[newKey] = v;
        currentKey = newKey;
        changed = true;
      }
      const current = obj[currentKey];
      if (isBinaryPayload(current)) continue;
      if (typeof current === "string") {
        const nv = fn(current);
        if (nv !== current) {
          obj[currentKey] = nv;
          changed = true;
        }
      } else if (current && typeof current === "object") {
        if (transformInPlace(current, fn)) changed = true;
      }
    }
  }
  return changed;
}

/** 记录 value 在 payload 里出现的所有位置（路径 + 上下文），用于残留诊断 */
export interface LeakLocation {
  path: string;
  where: "value" | "key";
  snippet: string;
}

export function locateValue(
  node: unknown,
  value: string,
  path = "$",
  acc: LeakLocation[] = [],
): LeakLocation[] {
  if (typeof node === "string") {
    const i = node.indexOf(value);
    if (i >= 0) {
      const a = Math.max(0, i - 50);
      const b = Math.min(node.length, i + value.length + 50);
      acc.push({
        path,
        where: "value",
        snippet: `${a > 0 ? "…" : ""}${node.slice(a, b).replace(/\s+/g, " ")}${b < node.length ? "…" : ""}`,
      });
    }
    return acc;
  }
  if (Array.isArray(node)) {
    node.forEach((v, i) => locateValue(v, value, `${path}[${i}]`, acc));
    return acc;
  }
  if (node && typeof node === "object") {
    for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
      if (k.includes(value)) acc.push({ path: `${path}.(key)`, where: "key", snippet: k });
      locateValue(v, value, `${path}.${k}`, acc);
    }
  }
  return acc;
}

/** 收集 payload 里全部字符串（值），用于与 JSON 转义无关的泄漏检查；跳过二进制载荷 */
export function collectStrings(node: unknown, out: string[]): void {
  if (isBinaryPayload(node)) return;
  if (typeof node === "string") {
    out.push(node);
    return;
  }
  if (Array.isArray(node)) {
    for (const v of node) collectStrings(v, out);
    return;
  }
  if (node && typeof node === "object") {
    for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
      out.push(k);
      collectStrings(v, out);
    }
  }
}

/**
 * 只处理已知的文本字段，不碰 id/name 等结构字段。
 * maskArguments：脱敏方向要处理 toolCall.arguments；还原方向不处理
 * （参数在存储层保持占位符，还原只在 tool_call 执行瞬间做）。
 */
function mapBlocks(blocks: unknown[], fn: StrFn, maskArguments: boolean): unknown[] {
  return blocks.map((b) => {
    if (!b || typeof b !== "object") return b;
    const block = b as Record<string, unknown>;
    if (block.type === "text" && typeof block.text === "string") {
      return { ...block, text: fn(block.text) };
    }
    if (block.type === "thinking" && typeof block.thinking === "string") {
      return { ...block, thinking: fn(block.thinking) };
    }
    if (maskArguments && block.type === "toolCall" && block.arguments) {
      return { ...block, arguments: deepMapStrings(block.arguments, fn) };
    }
    return b;
  });
}

function mapMessage(msg: unknown, fn: StrFn, maskArguments: boolean): unknown {
  if (!msg || typeof msg !== "object") return msg;
  const m = msg as Record<string, unknown>;
  // 已知 role 走字段级处理；未知 role（custom / bashExecution / compactionSummary 等）
  // 退化为全字符串遍历，避免"只靠 payload 兜底"的单层依赖。
  if (m.role !== "user" && m.role !== "assistant" && m.role !== "toolResult") {
    return { ...m, content: deepMapStrings(m.content, fn) };
  }
  if (typeof m.content === "string") {
    return { ...m, content: fn(m.content) };
  }
  if (Array.isArray(m.content)) {
    return { ...m, content: mapBlocks(m.content, fn, maskArguments) };
  }
  return msg;
}

/** session_before_compact 事件里我们关心的字段（pi 用同一个 preparation 对象生成压缩请求） */
export interface CompactionLikeEvent {
  preparation: {
    messagesToSummarize?: unknown[];
    turnPrefixMessages?: unknown[];
    previousSummary?: string;
  };
  customInstructions?: string;
}

/**
 * 就地脱敏压缩输入。
 *
 * pi 的 compaction 直接调裸 streamFn，绕过 context / before_provider_request 等钩子；
 * 但 agent-session 传给 compact() 的就是这个 preparation 对象，所以原地改写属性即可让
 * 压缩请求拿到占位符，不需要取消压缩。
 *
 * 注意：`customInstructions`（手动 /compact 时用户当场打的那句话）pi 是从局部变量取的，
 * 改 event 上的副本不生效，这里只做记录，不做脱敏。
 */
export function maskCompactionInput(event: CompactionLikeEvent, mask: StrFn): void {
  const prep = event.preparation;
  if (Array.isArray(prep.messagesToSummarize)) {
    prep.messagesToSummarize = prep.messagesToSummarize.map((m) => mapMessage(m, mask, true));
  }
  if (Array.isArray(prep.turnPrefixMessages)) {
    prep.turnPrefixMessages = prep.turnPrefixMessages.map((m) => mapMessage(m, mask, true));
  }
  if (typeof prep.previousSummary === "string") {
    prep.previousSummary = mask(prep.previousSummary);
  }
}

/** 终端 ANSI 浅橙（256 色 215），跟随 ghostty/终端主题；与 ~/.pi/agent/themes/soft.json 的 warning 同色 */
const ACCENT_WARN = "\x1b[38;5;215m";
const ANSI_RESET = "\x1b[0m";

/** 单次处理上限，超过就跳过（保护性能）。跳过时告警，不静默。 */
const MAX_TEXT = 500_000;

/**
 * 二进制/base64 长串：整体跳过。
 * 词表里的短值（3 字母拼音名）在几万字符的 base64 里必然以"词首"形态出现，
 * 一旦替换就会破坏数据 → provider 400 invalid base64（2026-10-13 实测）。
 * 判定：长且整串无中文、无空格（base64/密钥/哈希的特征）。
 */
export function isBinaryLike(s: string): boolean {
  if (s.startsWith("data:")) return true;
  if (s.length < 1024) return false;
  return !/[\u4e00-\u9fff\s]/.test(s);
}

export default function (pi: ExtensionAPI) {
  const { wordlist, error } = loadWordlist();
  const masker = new Masker(wordlist, undefined, {
    // 未知人名启发式：词表可关，环境变量也可关（PII_GUARD_HEURISTICS=0）
    nameHeuristics: process.env.PII_GUARD_HEURISTICS !== "0" && wordlist.nameHeuristics !== false,
  });

  let state: MaskState = emptyState();
  let sessionId: string | null = null;
  let saveTimer: ReturnType<typeof setTimeout> | null = null;
  /** TUI 模式：会话存储保持占位符，显示层还原 */
  let cleanStorage = false;
  /** 是否把工具参数里的占位符还原成真值（默认开；写含占位符字面量的文件时先 /pii args off） */
  let restoreArgs = true;
  /** 本轮累积的残留告警（turn_end 时统一提示一次，避免工具循环里每轮 LLM 调用都刷屏） */
  let pendingLeakNotice: string | null = null;
  let skippedOnce = false;


  const mask = (s: string): string => {
    try {
      if (!s) return s;
      if (s.length > MAX_TEXT || isBinaryLike(s)) return s;
      return masker.mask(s, state);
    } catch {
      return s;
    }
  };
  /** 还原；mark=true 时给还原出的真值包上 ⟦⟧（仅显示路径用） */
  const restore = (s: string, mark = false): string => {
    try {
      if (!s || !s.includes("<<")) return s;
      return masker.restore(s, state, mark);
    } catch {
      return s;
    }
  };
  /** 无视检测规则的强制替换：只用于断言发现残留后的兜底 */
  const forceMask = (s: string): string => {
    let out = s;
    for (const [value, token] of Object.entries(state.values)) {
      if (value.length >= 2 && out.includes(value)) out = out.split(value).join(token);
    }
    return out;
  };
  const scheduleSave = (): void => {
    if (!sessionId) return;
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      saveTimer = null;
      try {
        if (sessionId) saveState(sessionId, state);
      } catch {
        /* fail-open */
      }
    }, 400);
    saveTimer.unref?.();
  };

  /**
   * 泄漏检查：只报"词首出现"的命中——与 mask 的判定一致。
   * 若用无边界 includes，base64/二进制里的随机字母组合会被反复误报成残留
   * （2026-10-13：leaks.log 累计 1715 处，其中 ~75% 是这类假阳性）。
   */
  const findAllLeaks = (payload: unknown): Array<{ value: string; token: string }> => {
    try {
      const strings: string[] = [];
      collectStrings(payload, strings);
      const hits: Array<{ value: string; token: string }> = [];
      for (const [value, token] of Object.entries(state.values)) {
        if (value.length < 2) continue;
        for (const s of strings) {
          if (s.length > MAX_TEXT || isBinaryLike(s)) continue;
          let idx = s.indexOf(value);
          let found = false;
          while (idx !== -1) {
            // 中文值不需要边界；含 ASCII 的值要求词首出现（与 mask 相同）
            if (!/[A-Za-z0-9]/.test(value) || wordStartAt(s, idx)) {
              found = true;
              break;
            }
            idx = s.indexOf(value, idx + 1);
          }
          if (found) {
            hits.push({ value, token });
            break;
          }
        }
      }
      return hits;
    } catch {
      return [];
    }
  };

  const auditWrite = (record: unknown): void => {
    const file = process.env.PII_GUARD_AUDIT;
    if (!file) return;
    try {
      // 0600：审计内容虽已脱敏，仍含完整 system prompt 与工具 schema
      const fd = openSync(file, "a", 0o600);
      try {
        writeSync(fd, `${JSON.stringify(record)}\n`);
      } finally {
        closeSync(fd);
      }
    } catch {
      /* 审计写不进去不影响请求 */
    }
  };

  // ---- 显示层还原（TUI）：display-only，不改 session、不进模型上下文 ----
  pi.registerMarkdownTransformer((markdown) => {
    try {
      if (!markdown || !markdown.includes("<<")) return markdown;
      return restore(markdown, true);
    } catch {
      return markdown;
    }
  });

  // ---- 会话生命周期 ----
  pi.on("session_start", async (_event, ctx) => {
    try {
      sessionId = ctx.sessionManager.getSessionId();
      state = loadState(sessionId);
      cleanStorage = ctx.mode === "tui";
      if (error) ctx.ui.notify(`pii-guard：${error}`, "warning");
      if (masker.skippedPatterns.length > 0) {
        ctx.ui.notify(
          `pii-guard：词表里 ${masker.skippedPatterns.length} 条自定义正则无法编译，已跳过（其余规则仍生效）：\n${masker.skippedPatterns.join("\n")}`,
          "warning",
        );
      }
    } catch {
      /* fail-open */
    }
  });

  pi.on("session_shutdown", async () => {
    if (saveTimer) {
      clearTimeout(saveTimer);
      saveTimer = null;
    }
    if (sessionId) {
      try {
        saveState(sessionId, state);
      } catch {
        /* ignore */
      }
    }
  });

  // ---- 用户输入：仅"干净存储"模式下脱敏（TUI，显示层会还原） ----
  pi.on("input", async (event) => {
    try {
      if (!cleanStorage || typeof event.text !== "string") return undefined;
      const masked = mask(event.text);
      if (masked === event.text) return undefined;
      scheduleSave();
      return { action: "transform" as const, text: masked };
    } catch {
      return undefined;
    }
  });

  // ---- 工具结果：所有模式都脱敏（模型只看到占位符） ----
  pi.on("tool_result", async (event, ctx) => {
    try {
      const content = mapBlocks(event.content as unknown[], (s) => {
        if (s && s.length > MAX_TEXT && !skippedOnce) {
          skippedOnce = true;
          ctx.ui.notify(
            `pii-guard：单条文本超过 ${MAX_TEXT} 字符，已跳过脱敏（可能存在未替换内容）`,
            "warning",
          );
        }
        return mask(s);
      }, false);
      scheduleSave();
      return { content: content as typeof event.content };
    } catch {
      return undefined;
    }
  });

  // ---- 每轮请求前：对全部消息做兜底脱敏 ----
  pi.on("context", async (event) => {
    try {
      const messages = event.messages.map((m) => mapMessage(m, mask, true));
      scheduleSave();
      return { messages: messages as typeof event.messages };
    } catch {
      return undefined;
    }
  });

  // ---- 工具调用的参数：占位符 → 真值（必须就地修改，替换引用无效） ----
  pi.on("tool_call", async (event) => {
    try {
      if (!restoreArgs) return;
      if (!event.input || typeof event.input !== "object") return;
      const restored = deepMapStrings(event.input, (s) => restore(s, false));
      for (const key of Object.keys(event.input as Record<string, unknown>)) {
        delete (event.input as Record<string, unknown>)[key];
      }
      Object.assign(event.input as Record<string, unknown>, restored);
    } catch {
      /* fail-open */
    }
  });

  // ---- 助手回复：仅"还原模式"（RPC/print/json）还原；TUI 保持占位符由显示层还原 ----
  pi.on("message_end", async (event, ctx) => {
    try {
      if (cleanStorage) return undefined;
      const msg = event.message as unknown as Record<string, unknown>;
      if (msg.role !== "assistant") return undefined;
      const replaced = mapMessage(msg, (s) => restore(s, true), false) as Record<string, unknown>;
      if (JSON.stringify(replaced) === JSON.stringify(msg)) return undefined;
      return { message: replaced as typeof event.message };
    } catch {
      return undefined;
    }
  });

  // ---- 发出前最后一道：就地兜底 + 残留断言（不抛错，pi 会吞异常并回退原始 payload） ----
  pi.on("before_provider_request", async (event, ctx) => {
    try {
      const changed = transformInPlace(event.payload, mask);
      if (changed) scheduleSave();

      const leaks = findAllLeaks(event.payload);
      if (leaks.length > 0) {
        // 诊断日志：含真值 + 出现位置 + 上下文（0600，只在本机）
        try {
          const details = leaks.map(({ value, token }) => ({
            value,
            token,
            locations: locateValue(event.payload, value).slice(0, 5),
          }));
          const logFile = path.join(GUARD_DIR, "leaks.log");
          const fd = openSync(logFile, "a", 0o600);
          try {
            writeSync(
              fd,
              `${JSON.stringify({ ts: new Date().toISOString(), session: sessionId, leaks: details })}\n`,
            );
          } finally {
            closeSync(fd);
          }
        } catch {
          /* 日志失败不影响主流程 */
        }
        // 就地强替换：把已知真值直接换成占位符（无视规则是否漏检）
        transformInPlace(event.payload, forceMask);
        // 不在这里 notify：工具循环里一次回答会触发多次 LLM 调用，逐次弹会刷屏；
        // 改为记 pending，turn_end 统一提示一次
        const first = leaks[0].token.replace(/<<([A-Z_]+):.*$/, "$1");
        pendingLeakNotice =
          `pii-guard：本轮检测到 ${leaks.length} 处未脱敏残留（含 ${first}），已在发出前强制替换。` +
          `定位：/pii leaks 或 ~/.pi/agent/pii-guard/leaks.log`;
      }
      auditWrite({ ts: new Date().toISOString(), leaks: leaks.map((l) => l.token), payload: event.payload });
      return undefined; // 就地修改已完成，不依赖返回值
    } catch {
      return undefined;
    }
  });

  // ---- 回答结束时统一提示一次残留（替代逐次 LLM 调用的刷屏告警） ----
  pi.on("turn_end", async (_event, ctx) => {
    if (!pendingLeakNotice) return;
    const notice = pendingLeakNotice;
    pendingLeakNotice = null;
    try {
      if (process.env.PII_GUARD_BLOCK !== "0") {
        ctx.ui.notify(notice, "warning");
      }
    } catch {
      /* ignore */
    }
  });

  // ---- 压缩兜底：compaction 直接调裸 streamFn，绕过 context 与本扩展的其它钩子 ----
  // 2026-10-22 改：不再取消压缩（用户要求 compact 永不被阻塞），改成就地脱敏输入。
  pi.on("session_before_compact", async (event) => {
    try {
      maskCompactionInput(event as CompactionLikeEvent, mask);
      // 兜底断言：只检查真正会发出去的内容（fileOps 里的本地路径不算）
      const prep = event.preparation as CompactionLikeEvent["preparation"];
      const leaks = findAllLeaks({
        messagesToSummarize: prep.messagesToSummarize,
        turnPrefixMessages: prep.turnPrefixMessages,
        previousSummary: prep.previousSummary,
      });
      if (leaks.length > 0) {
        try {
          const fd = openSync(path.join(GUARD_DIR, "leaks.log"), "a", 0o600);
          try {
            writeSync(
              fd,
              `${JSON.stringify({ ts: new Date().toISOString(), session: sessionId, where: "compact", leaks: leaks.map((l) => l.token) })}\n`,
            );
          } finally {
            closeSync(fd);
          }
        } catch {
          /* 记日志失败不影响压缩 */
        }
      }
      return undefined; // 不取消：压缩照常进行
    } catch {
      return undefined; // fail-open：脱敏失败也不阻塞压缩
    }
  });

  // ---- /pii：查看映射（本地审计） ----
  pi.registerCommand("pii", {
    description: "映射 /pii｜定位 /pii sid｜残留 /pii leaks（leaks off 收起）｜参数还原 /pii args on|off｜清空 /pii clear",
    handler: async (args, ctx) => {
      try {
        const arg = (args ?? "").trim();
        if (arg === "sid" || arg === "where") {
          const sid = sessionId ?? "（未知）";
          const statePath = sessionId
            ? path.join(GUARD_DIR, "state", `${sessionId}.json`)
            : "（未持久化）";
          let name = "（未命名）";
          try {
            name = pi.getSessionName() ?? name;
          } catch {
            /* ignore */
          }
          ctx.ui.notify(
            `pii-guard 会话定位：\n会话名：${name}\nsession id：${sid}\nstate 文件：${statePath}\n` +
              `存储模式：${cleanStorage ? "干净（TUI，靠显示层还原）" : "还原"}｜工具参数还原：${restoreArgs ? "开" : "关"}`,
            "info",
          );
          return;
        }
        if (arg === "args off" || arg === "args on" || arg === "args") {
          if (arg === "args off") restoreArgs = false;
          if (arg === "args on") restoreArgs = true;
          ctx.ui.notify(
            `pii-guard：工具参数还原现在为「${restoreArgs ? "开" : "关"}」。` +
              `关闭后模型写的占位符会原样落盘（写含占位符示例的文档/代码时用）。`,
            "info",
          );
          return;
        }
        if (arg === "leaks" || arg === "leaks off") {
          if (arg === "leaks off") {
            ctx.ui.setWidget("pii-leaks", undefined); // 清除面板
            ctx.ui.notify("pii-guard：已清除残留面板", "info");
            return;
          }
          const logFile = path.join(GUARD_DIR, "leaks.log");
          let raw: string[] = [];
          try {
            raw = readFileSync(logFile, "utf8").trim().split("\n").filter(Boolean);
          } catch {
            /* 文件不存在按空处理 */
          }
          if (raw.length === 0) {
            ctx.ui.notify("pii-guard：还没有残留记录", "info");
            return;
          }
          let lines: string[];
          try {
            const last = JSON.parse(raw[raw.length - 1]) as {
              ts: string;
              leaks: Array<{ value: string; token: string; locations: LeakLocation[] }>;
            };
            lines = [
              `pii-guard 残留（共 ${raw.length} 次）｜最近 ${last.ts}`,
              ...last.leaks.slice(0, 2).flatMap((l) => [
                `${l.token} = ${l.value}`,
                ...l.locations
                  .slice(0, 1)
                  .map((loc) => `  ${loc.where === "key" ? "[key] " : ""}${loc.path}`),
              ]),
              `完整记录：~/.pi/agent/pii-guard/leaks.log`,
              `收起本面板：/pii leaks off`,
            ];
          } catch {
            lines = [`pii-guard：leaks.log 解析失败（${raw.length} 行）`, `收起本面板：/pii leaks off`];
          }
          // 用 widget（可清除）而不是 notify（没有清除 API，长内容会一直占屏）
          // 文字染成终端浅橙：Text 组件保留 ANSI 码，颜色跟随 ghostty 主题
          ctx.ui.setWidget(
            "pii-leaks",
            lines.map((l) => `${ACCENT_WARN}${l}${ANSI_RESET}`),
          );
          return;
        }
        if ((args ?? "").trim() === "clear") {
          // 保留 counters：否则新值会复用旧 token，同一 payload 内同名 token 指向两个真值
          const counters = state.counters;
          state = emptyState();
          state.counters = counters;
          if (sessionId) clearState(sessionId);
          ctx.ui.notify("pii-guard：本次会话映射已清空（token 计数保留，避免复用冲突）", "info");
          return;
        }
        const tokens = Object.entries(state.tokens);
        if (tokens.length === 0) {
          ctx.ui.notify(
            `pii-guard：本次会话尚无脱敏记录（词表 ${wordlist.people.length} 人｜存储模式：${cleanStorage ? "干净（TUI 显示层还原）" : "还原"}）`,
            "info",
          );
          return;
        }
        const head = tokens.slice(0, 20).map(([token, value]) => `${token} = ${value}`);
        const more = tokens.length > 20 ? `\n…还有 ${tokens.length - 20} 项` : "";
        ctx.ui.notify(
          `pii-guard：本次会话已脱敏 ${tokens.length} 项\n${head.join("\n")}${more}`,
          "info",
        );
      } catch {
        /* ignore */
      }
    },
  });
}
