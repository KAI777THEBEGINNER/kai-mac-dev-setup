/**
 * 脱敏引擎：把身份类文本替换成 <<LABEL:N>> 占位符，并能反向还原。
 *
 * 设计要点：
 * - 纯函数式核心（除 state 外无 I/O），可单测。
 * - 幂等：对已脱敏文本再跑一次，占位符不匹配任何规则，结果不变。
 * - 按「值」分配 token（不是按实体归并），还原 100% 保真 —— 文本里写的是
 *   "zhangsan4" 就还原成 "zhangsan4"，不会变成 "zhangsan"。
 * - 检测源：词表（人名等自由文本）+ 正则规则（结构化 PII 与凭据）。
 */

import { findUnknownNames } from "./name-heuristic.ts";
import { DEFAULT_RULES, type RegexRule } from "./rules.ts";

export interface WordlistPerson {
  label: string;
  canonical: string;
  aliases?: string[];
}

export interface WordlistPattern {
  label: string;
  regex: string;
  description?: string;
}

export interface Wordlist {
  version: number;
  people: WordlistPerson[];
  extraPatterns?: WordlistPattern[];
  /** 豁免清单：命中即跳过的字面量（如与词表撞车的地名） */
  allow?: string[];
  /** 未知人名启发式（byted_refined）；默认开，设为 false 可关 */
  nameHeuristics?: boolean;
}

export interface MaskState {
  /** "<<PERSON:1>>" → 真值 */
  tokens: Record<string, string>;
  /** 真值 → "<<PERSON:1>>" */
  values: Record<string, string>;
  /** label → 已分配序号 */
  counters: Record<string, number>;
}

export interface FoundMatch {
  start: number;
  end: number;
  label: string;
}

export const TOKEN_RE = /<<\s*([A-Z_]+)\s*:\s*(\d+)\s*>>/g;

export function emptyState(): MaskState {
  return { tokens: {}, values: {}, counters: {} };
}

/** 占位符的紧凑规范形式 */
export function tokenOf(label: string, n: number): string {
  return `<<${label}:${n}>>`;
}

interface WordEntry {
  value: string;
  lower: string;
  label: string;
  needsBoundary: boolean;
}

function hasAsciiWord(s: string): boolean {
  return /[A-Za-z0-9]/.test(s);
}

/**
 * ASCII 别名的词首判定：**只看前一个字符**不是字母/数字。
 *
 * 为什么后面不检查：真实写法里名字后面常直接跟字母或下划线
 * （`<名字>s_digital_chatbot`、`<名字>-mac-dev-setup`、`<名字>_vault`），
 * 若后面也要求非字母，这些一律漏检（2026-10-13 由 leaks.log 的 1715 条残留定位）。
 *
 * 与 detect 的一致性：`wordStartAt` 同时被 mask 与泄漏断言（findLeak）调用，
 * 避免"mask 认为不是词、断言认为是残留"的反复误报。
 */
export function wordStartAt(text: string, index: number): boolean {
  const before = index > 0 ? text[index - 1] : "";
  return !/[A-Za-z0-9]/.test(before);
}

export class Masker {
  private readonly buckets = new Map<string, WordEntry[]>();
  private readonly rules: RegexRule[];
  private readonly allow: Set<string>;
  /** 词表里写坏的正则：跳过而不抛错（否则整个扩展加载失败、防护静默消失） */
  readonly skippedPatterns: string[] = [];
  /** 运行期从上下文里学到的人名：一旦认出，同会话内裸提及也会被挡 */
  private readonly learned = new Set<string>();
  private readonly nameHeuristics: boolean;

  constructor(
    wordlist: Wordlist,
    rules: RegexRule[] = DEFAULT_RULES,
    options: { nameHeuristics?: boolean } = {},
  ) {
    this.rules = [...rules];
    this.nameHeuristics = options.nameHeuristics ?? wordlist.nameHeuristics ?? true;
    for (const p of wordlist.extraPatterns ?? []) {
      try {
        this.rules.push({
          label: p.label,
          pattern: new RegExp(p.regex, "g"),
          description: p.description ?? "自定义规则",
        });
      } catch (err) {
        this.skippedPatterns.push(`${p.label}: ${String(err)}`);
      }
    }
    this.allow = new Set(wordlist.allow ?? []);

    const seen = new Set<string>();
    for (const person of wordlist.people) {
      const names = [person.canonical, ...(person.aliases ?? [])];
      for (const raw of names) {
        const value = raw.trim();
        if (value.length < 2 || seen.has(value.toLowerCase())) continue;
        seen.add(value.toLowerCase());
        const entry: WordEntry = {
          value,
          lower: value.toLowerCase(),
          label: person.label,
          needsBoundary: hasAsciiWord(value),
        };
        const key = value[0].toLowerCase();
        const bucket = this.buckets.get(key) ?? [];
        bucket.push(entry);
        this.buckets.set(key, bucket);
      }
    }
    // 长词优先：李四 先于 李叁 之类的包含关系，交给重叠解析处理
  }

  /** 把启发式认出的人名登记进词表桶，让后续裸提及也能命中 */
  private learnName(value: string, label = "PERSON"): void {
    if (this.learned.has(value)) return;
    this.learned.add(value);
    const entry: WordEntry = {
      value,
      lower: value.toLowerCase(),
      label,
      needsBoundary: hasAsciiWord(value),
    };
    const key = value[0].toLowerCase();
    const bucket = this.buckets.get(key) ?? [];
    bucket.push(entry);
    this.buckets.set(key, bucket);
  }

  /** 词表 + 正则 + 未知人名启发式的全部命中，未去重 */
  scan(text: string, opts: { learn?: boolean } = {}): FoundMatch[] {
    const out: FoundMatch[] = [];

    // 词表：首字符索引，逐位置尝试
    for (let i = 0; i < text.length; i++) {
      const bucket = this.buckets.get(text[i].toLowerCase());
      if (!bucket) continue;
      for (const entry of bucket) {
        const end = i + entry.value.length;
        if (end > text.length) continue;
        if (entry.needsBoundary && !wordStartAt(text, i)) continue;
        if (text.slice(i, end).toLowerCase() !== entry.lower) continue;
        out.push({ start: i, end, label: entry.label });
      }
    }

    // 未知人名启发式：只在高置信上下文触发，认出后登记，后续裸提及同样命中
    if (this.nameHeuristics) {
      for (const hit of findUnknownNames(text, this.allow)) {
        out.push({ start: hit.start, end: hit.end, label: "PERSON" });
        // 单字（「王老师」里的「王」、单个首字母）只挡这一次，不登记，
        // 否则之后每个「王」「W」都会被替换掉
        // 只有用户自己写的文本才学习：助手回复、工具结果、文档里的示例
        // （比如 pii-guard 自己的 README 就有「X老师」）不能教它认人，否则普通词会被永久替换。
        if (hit.value.length >= 2 && opts.learn !== false) this.learnName(hit.value);
      }
    }

    // 正则规则
    for (const rule of this.rules) {
      rule.pattern.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = rule.pattern.exec(text)) !== null) {
        if (m[0].length === 0) {
          rule.pattern.lastIndex++;
          continue;
        }
        if (rule.validate && !rule.validate(m[0])) continue;
        out.push({ start: m.index, end: m.index + m[0].length, label: rule.label });
      }
    }

    if (this.allow.size > 0) {
      return out.filter((m) => !this.allow.has(text.slice(m.start, m.end)));
    }
    return out;
  }

  /** 冲突消解：按起点排序，重叠取更长者（同长取先出现的规则） */
  static resolve(matches: FoundMatch[]): FoundMatch[] {
    const sorted = [...matches].sort(
      (a, b) => a.start - b.start || b.end - a.end,
    );
    const out: FoundMatch[] = [];
    let lastEnd = -1;
    for (const m of sorted) {
      if (m.start >= lastEnd) {
        out.push(m);
        lastEnd = m.end;
      }
    }
    return out;
  }

  /** 分配或复用 token；同一字符串值永远拿到同一个 token */
  private tokenFor(value: string, label: string, state: MaskState): string {
    const existing = state.values[value];
    if (existing) return existing;
    const n = (state.counters[label] ?? 0) + 1;
    state.counters[label] = n;
    const token = tokenOf(label, n);
    state.values[value] = token;
    state.tokens[token] = value;
    return token;
  }

  mask(text: string, state: MaskState, opts: { learn?: boolean } = {}): string {
    if (!text) return text;
    const matches = Masker.resolve(this.scan(text, opts));
    if (matches.length === 0) return text;
    let out = "";
    let cursor = 0;
    for (const m of matches) {
      const value = text.slice(m.start, m.end);
      out += text.slice(cursor, m.start) + this.tokenFor(value, m.label, state);
      cursor = m.end;
    }
    return out + text.slice(cursor);
  }

  /**
   * 把占位符还原成真值；未知占位符原样保留。
   *
   * mark=true 时输出 `⟦真值⟧`：只用于**显示路径**，
   * 让用户一眼看出哪些内容是被脱敏后还原的。工具参数还原必须 mark=false，
   * 否则写进文件的内容会带上标记符。
   */
  restore(text: string, state: MaskState, mark = false): string {
    if (!text || !text.includes("<<")) return text;
    return text.replace(TOKEN_RE, (whole, label: string, n: string) => {
      const token = tokenOf(label, n);
      const value = state.tokens[token];
      if (value === undefined) return whole;
      return mark ? `⟦${value}⟧` : value;
    });
  }
}
