/**
 * Codex Responses API 代理的纯数据处理部分。
 *
 * 代理与 pi 扩展共用 Masker、词表和 state。这里不依赖 pi runtime，方便
 * 直接由 Node 启动，也方便离线单测。
 */
import { Masker, type MaskState, wordStartAt } from "./engine.ts";

const IMAGE_BLOCK_TYPES = new Set(["image", "image_url", "input_image"]);
const BASE64_DATA_URI = /^\s*data:[^,\s]*;base64,/i;

export function isImageBlockNode(node: unknown): boolean {
  if (!node || typeof node !== "object" || Array.isArray(node)) return false;
  const type = (node as Record<string, unknown>).type;
  return typeof type === "string" && IMAGE_BLOCK_TYPES.has(type);
}

export function isBinaryDataUri(value: unknown): boolean {
  return typeof value === "string" && BASE64_DATA_URI.test(value);
}

export function isBinaryLike(value: string): boolean {
  if (isBinaryDataUri(value)) return true;
  if (value.length < 1024) return false;
  return !/[\u4e00-\u9fff\s]/.test(value);
}

export function isBinaryPayload(value: unknown): boolean {
  return isBinaryDataUri(value) || isImageBlockNode(value);
}

type StringTransform = (value: string) => string;

/** Responses 协议里的 ID 不是用户文本，不能套手机号/银行卡等规则。 */
function isProtocolIdField(field: string): boolean {
  return field === "id" || field === "call_id" || field === "previous_response_id" || field.endsWith("_id");
}

function isValidProtocolId(value: string): boolean {
  return /^[A-Za-z0-9_-]+$/.test(value);
}

/** 递归处理 JSON，同时整块跳过图片和 base64 数据。 */
export function transformJsonValue(value: unknown, fn: StringTransform, field = ""): unknown {
  if (isBinaryPayload(value)) return value;
  if (typeof value === "string") {
    return isBinaryLike(value) || (isProtocolIdField(field) && isValidProtocolId(value)) ? value : fn(value);
  }
  if (Array.isArray(value)) return value.map((item) => transformJsonValue(item, fn, field));
  if (!value || typeof value !== "object") return value;

  const out: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    const transformedKey = isBinaryLike(key) || isProtocolIdField(key) ? key : fn(key);
    out[transformedKey] = transformJsonValue(child, fn, key);
  }
  return out;
}

export function maskPayload(payload: unknown, masker: Masker, state: MaskState): unknown {
  return transformJsonValue(payload, (value) => masker.mask(value, state));
}

export function restorePayload(payload: unknown, masker: Masker, state: MaskState): unknown {
  return transformJsonValue(payload, (value) => masker.restore(value, state));
}

/** 修复早期版本已经写进历史 ID 的占位符，只作用于协议 ID 字段。 */
export function restoreProtocolIds(payload: unknown, masker: Masker, state: MaskState): unknown {
  const walk = (value: unknown, field = ""): unknown => {
    if (isBinaryPayload(value)) return value;
    if (typeof value === "string") {
      return isProtocolIdField(field) ? masker.restore(value, state) : value;
    }
    if (Array.isArray(value)) return value.map((item) => walk(item, field));
    if (!value || typeof value !== "object") return value;
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, child]) => [key, walk(child, key)]),
    );
  };
  return walk(payload);
}

/**
 * Codex 会在历史 custom tool item 上带 `ctc_...` 客户端 ID。该字段是可选的，
 * 但 aigocode 的 Responses 适配层会拒绝这类 ID；call_id 仍需保留来关联工具调用。
 */
export function stripCodexClientItemIds(payload: unknown): unknown {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return payload;
  const root = payload as Record<string, unknown>;
  if (!Array.isArray(root.input)) return payload;
  return {
    ...root,
    input: root.input.map((item) => {
      if (!item || typeof item !== "object" || Array.isArray(item)) return item;
      const record = item as Record<string, unknown>;
      if (typeof record.id !== "string" || !record.id.startsWith("ctc_")) return item;
      const { id: _id, ...withoutId } = record;
      return withoutId;
    }),
  };
}

/**
 * 与 Masker.mask 完全一致的"这个词会不会被当成真值"判定。
 *
 * 2026-10-17 修的坑：旧实现用裸 `includes`，而 mask 对含 ASCII 的值要求**词首**
 * （`wordStartAt`）。于是 `Taskai` 里的 3 字母人名、`sk-...` 尾巴之类会被断言
 * 判成残留 → 代理 503 拒绝整个请求；mask 却认为没问题。两边必须共用同一判定。
 */
function containsKnownValue(text: string, value: string): boolean {
  if (!/[A-Za-z0-9]/.test(value)) return text.includes(value);
  let index = text.indexOf(value);
  while (index !== -1) {
    if (wordStartAt(text, index)) return true;
    index = text.indexOf(value, index + 1);
  }
  return false;
}

/** 找出非二进制 JSON 区域里仍然出现的已知真值。只返回 token，不返回真值。 */
export function findKnownLeaks(payload: unknown, state: MaskState): string[] {
  const values = Object.entries(state.values).filter(([value]) => value.length >= 2);
  const hits = new Set<string>();
  const visit = (value: unknown, field = ""): void => {
    if (isBinaryPayload(value)) return;
    if (typeof value === "string") {
      if (isBinaryLike(value) || (isProtocolIdField(field) && isValidProtocolId(value))) return;
      for (const [raw, token] of values) {
        if (containsKnownValue(value, raw)) hits.add(token);
      }
      return;
    }
    if (Array.isArray(value)) {
      value.forEach((item) => visit(item, field));
      return;
    }
    if (value && typeof value === "object") {
      for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
        visit(key);
        visit(child, key);
      }
    }
  };
  visit(payload);
  return [...hits];
}

/** 已知值的强制替换表：长值优先，避免短值先把长值切碎。 */
function forceMaskTable(state: MaskState): Array<[string, string]> {
  return Object.entries(state.values)
    .filter(([value]) => value.length >= 2)
    .sort((a, b) => b[0].length - a[0].length);
}

/** 已生成的占位符区域（保护：不能被“已知值”二次替换，否则 token 会被切碎） */
const TOKEN_SPLIT = /(<<[A-Z_]+:\d+>>)/g;

function replaceKnownIn(text: string, table: Array<[string, string]>): string {
  let out = text;
  for (const [value, token] of table) {
    if (out.includes(value)) out = out.split(value).join(token);
  }
  return out;
}

/**
 * 无视检测规则的强制替换：只用于断言发现残留后的兜底。
 *
 * 必须存在的理由：有些真值当初是被**上下文锚定**的规则命中的
 * （如 `api key: xxx` 只把 xxx 本身记进映射），离开锚点后规则再也认不出它，
 * 但它仍是真值 → 只要出现在别的文本里就会被断言判为残留。
 */
export function forceMaskKnownValues(text: string, state: MaskState): string {
  if (!text) return text;
  const table = forceMaskTable(state);
  if (table.length === 0) return text;
  if (!text.includes("<<")) return replaceKnownIn(text, table);
  // 占位符区间原样保留：短值（如 "ID"）不能把 <<STUDENT_ID:1>> 这种 token 切坏
  const parts = text.split(TOKEN_SPLIT);
  for (let i = 0; i < parts.length; i += 2) parts[i] = replaceKnownIn(parts[i], table);
  return parts.join("");
}

/** 修复遍历：跳过范围必须与 findKnownLeaks 一致（只跳二进制，不跳协议 id）。 */
export function forceMaskPayload(payload: unknown, state: MaskState): unknown {
  const walk = (value: unknown, field = ""): unknown => {
    if (isBinaryPayload(value)) return value;
    if (typeof value === "string") {
      return isBinaryLike(value) || (isProtocolIdField(field) && isValidProtocolId(value))
        ? value
        : forceMaskKnownValues(value, state);
    }
    if (Array.isArray(value)) return value.map((item) => walk(item, field));
    if (!value || typeof value !== "object") return value;
    const out: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      const safeKey = isBinaryLike(key) || isProtocolIdField(key) ? key : forceMaskKnownValues(key, state);
      out[safeKey] = walk(child, key);
    }
    return out;
  };
  return walk(payload);
}

export interface MaskOutcome {
  /** 脱敏 + 兜底修复后的 payload */
  payload: unknown;
  /** 常规脱敏后仍残留、已由兜底强替换掉的 token */
  repaired: string[];
  /** 强替换后仍然残留的 token（非空才该拒绝请求） */
  leaks: string[];
}

/**
 * Codex 代理的出站主流程：先规则脱敏，再对残留做强制替换，最后才断言。
 * 与 pi 扩展 `before_provider_request` 的语义一致：残留是修复信号，不是拒绝理由。
 */
export function maskPayloadWithRepair(payload: unknown, masker: Masker, state: MaskState): MaskOutcome {
  const masked = maskPayload(payload, masker, state);
  const first = findKnownLeaks(masked, state);
  if (first.length === 0) return { payload: masked, repaired: [], leaks: [] };
  const repaired = forceMaskPayload(masked, state);
  return { payload: repaired, repaired: first, leaks: findKnownLeaks(repaired, state) };
}

/**
 * 对 SSE 的文本增量做跨 event 的占位符还原。
 * 模型可能把一个 token 拆成多个 delta，例如 `<<PERS` + `ON:1>>`。
 */
export class StreamingRestorer {
  private carry = "";
  private readonly masker: Masker;
  private readonly state: MaskState;

  constructor(masker: Masker, state: MaskState) {
    this.masker = masker;
    this.state = state;
  }

  get hasCarry(): boolean {
    return this.carry.length > 0;
  }

  transform(value: string): string {
    const combined = this.carry + value;
    const split = partialTokenSuffix(combined);
    this.carry = split.tail;
    return this.masker.restore(split.safe, this.state);
  }

  flush(): string {
    const tail = this.carry;
    this.carry = "";
    return this.masker.restore(tail, this.state);
  }
}

function partialTokenSuffix(value: string): { safe: string; tail: string } {
  const start = value.lastIndexOf("<<");
  if (start < 0) return { safe: value, tail: "" };
  const suffix = value.slice(start);
  // 只缓存看起来像占位符前缀的尾巴，普通的比较运算符不会被吞掉。
  if (/^<<\s*[A-Z_]*\s*:?[\s\d]*$/.test(suffix) && !suffix.includes(">>")) {
    return { safe: value.slice(0, start), tail: suffix };
  }
  return { safe: value, tail: "" };
}

interface PendingSseEvent {
  text: string;
  appendTail?: (tail: string) => void;
}

/** 将单个完整 SSE event 的 data JSON 还原，并保留原有 event 字段。 */
export function restoreSseEvent(
  rawEvent: string,
  restorer: StreamingRestorer,
): PendingSseEvent {
  const lines = rawEvent.split(/\r?\n/);
  const dataIndexes: number[] = [];
  const dataParts: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].startsWith("data:")) {
      dataIndexes.push(i);
      dataParts.push(lines[i].slice(5).replace(/^ /, ""));
    }
  }
  if (dataParts.length === 0) return { text: rawEvent };
  const data = dataParts.join("\n");
  if (data === "[DONE]") return { text: rawEvent };

  let parsed: unknown;
  try {
    parsed = JSON.parse(data);
  } catch {
    return { text: rawEvent };
  }

  let tailSetter: (() => string) | undefined;
  const textFields = new Set([
    "text",
    "delta",
    "thinking",
    "arguments",
    "output_text",
    "input_text",
    "summary",
    "content",
  ]);
  const walk = (value: unknown, field = ""): unknown => {
    if (isBinaryPayload(value)) return value;
    if (typeof value === "string") {
      if (!textFields.has(field)) return value;
      const holder = { value: restorer.transform(value) };
      if (restorer.hasCarry) tailSetter = () => holder.value;
      // holder 不能直接改变 primitive，尾巴在事件结束时通过 setter 追加。
      return holder;
    }
    if (Array.isArray(value)) return value.map((item) => walk(item, field));
    if (!value || typeof value !== "object") return value;
    const out: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      const transformed = walk(child, key);
      out[key] = transformed && typeof transformed === "object" && "value" in transformed
        ? (transformed as { value: unknown }).value
        : transformed;
    }
    return out;
  };
  const restored = walk(parsed);

  const outputLines = [...lines];
  const encoded = JSON.stringify(restored);
  outputLines[dataIndexes[0]] = `data: ${encoded}`;
  for (let i = 1; i < dataIndexes.length; i++) outputLines[dataIndexes[i]] = "";
  const text = outputLines.join("\n");

  if (!restorer.hasCarry || !tailSetter) return { text };
  return {
    text,
    appendTail: (tail) => {
      // 这里重新序列化最末一个字符串所在的 JSON，避免把未完成 token 丢掉。
      // 由于 tail 只在流结束时使用，递归定位的复杂度不影响正常流式路径。
      const parsedAgain = JSON.parse(encoded) as unknown;
      let appended = false;
      const append = (node: unknown): unknown => {
        if (appended) return node;
        if (typeof node === "string") {
          appended = true;
          return node + tail;
        }
        if (Array.isArray(node)) return node.map(append);
        if (node && typeof node === "object") {
          return Object.fromEntries(Object.entries(node as Record<string, unknown>).map(([k, v]) => [k, append(v)]));
        }
        return node;
      };
      const finalData = JSON.stringify(append(parsedAgain));
      const finalLines = [...lines];
      finalLines[dataIndexes[0]] = `data: ${finalData}`;
      for (let i = 1; i < dataIndexes.length; i++) finalLines[dataIndexes[i]] = "";
      return finalLines.join("\n");
    },
  };
}

