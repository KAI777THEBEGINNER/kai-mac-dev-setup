/**
 * 未知人名启发式（byted_refined）。
 *
 * 目标：词表里没有的人名（新同事、新客户），也能在出站前自动挡住。
 *
 * 只在高置信上下文里认人，不做全量 n-gram：
 *   1. 称谓后缀 —— 「X老师」「X经理」「X同学」
 *   2. 引导词   —— 「叫X」「姓名：X」「联系人：X」
 *
 * 精度优先：以姓氏开头 + 长度 2~3（复姓 3~4）+ 噪音词黑名单，
 * 且引导词后必须紧跟标点/常见谓语，避免「叫张三明天来」把「张三天」吃进来。
 */

import {
  COMPOUND_SURNAMES,
  FUNCTION_CHARS,
  LATIN_NOISE,
  NAME_INTROS,
  NAME_NOISE,
  NAME_TITLES,
  SURNAMES,
  TEACHER_NOISE,
} from "./name-data.ts";

export interface NameHit {
  start: number;
  end: number;
  value: string;
}

function isPlausibleName(value: string): boolean {
  if (value.length < 2 || value.length > 4) return false;
  if (NAME_NOISE.has(value)) return false;
  const compound = COMPOUND_SURNAMES.has(value.slice(0, 2));
  if (compound) return value.length >= 3;
  if (!SURNAMES.has(value[0])) return false;
  // 单姓：2~3 字
  return value.length <= 3;
}

/**
 * 引导词后允许出现的边界：标点/空白/结尾，或常见谓语、称谓。
 * 没有这条约束，「叫张三明天来」会被贪婪地读成「张三天」。
 */
const INTRO_BOUNDARY = new Set([
  "说", "是", "的", "和", "与", "在", "也", "就", "要", "会", "已", "刚", "曾",
  "来", "去", "把", "让", "被", "给", "跟", "对", "发", "打", "问", "回", "找",
  "同", "负", "帮", "带", "做", "写", "提", "交", "签", "确", "联", "介", "加",
]);

const STRICT_TITLES = NAME_TITLES.filter((t) => t !== "老师");

const HAN = /[\u4e00-\u9fa5]/;

function isHan(ch: string): boolean {
  return !!ch && HAN.test(ch);
}

/**
 * 「XX老师」槽位：用户口径是称呼老师一定带「老师」二字，
 * 所以 XX 可以是姓（王老师）、名字后两字（小梅老师）、全名（王小明老师）、
 * 复姓（欧阳娜娜老师）、拼音/英文（Wang老师 / zhang老师 / Zhang San老师）。
 */
function findTeacherNames(text: string, allow?: Set<string>): NameHit[] {
  const hits: NameHit[] = [];
  let idx = text.indexOf("老师");
  while (idx !== -1) {
    const window = text.slice(Math.max(0, idx - 40), idx);

    const latin = /([A-Za-z][A-Za-z.'\-]*(?:\s+[A-Za-z][A-Za-z.'\-]*)?)\s*$/.exec(window);
    if (latin) {
      const candidate = latin[1];
      const start = idx - candidate.length;
      if (
        candidate.length >= 1 &&
        candidate.length <= 24 &&
        !LATIN_NOISE.has(candidate.toLowerCase()) &&
        !allow?.has(candidate)
      ) {
        hits.push({ start, end: idx, value: candidate });
      }
      idx = text.indexOf("老师", idx + 2);
      continue;
    }

    const han = /([\u4e00-\u9fa5]{1,4})$/.exec(window);
    if (han) {
      const run = han[1];
      for (let len = run.length; len >= 1; len--) {
        const candidate = run.slice(-len);
        const start = idx - len;
        const prev = start > 0 ? text[start - 1] : "";
        if (allow?.has(candidate) || TEACHER_NOISE.has(candidate) || NAME_NOISE.has(candidate)) continue;

        let ok = false;
        if (len === 1) {
          // 单字只在「姓 + 边界」时算人名，避免「语文老师」里的「文」
          ok = SURNAMES.has(candidate) && !isHan(prev);
        } else if (len === 2) {
          ok = SURNAMES.has(candidate[0]) || !isHan(prev) || FUNCTION_CHARS.has(prev);
        } else if (len === 3) {
          ok = isPlausibleName(candidate);
        } else {
          ok = COMPOUND_SURNAMES.has(candidate.slice(0, 2)) && !NAME_NOISE.has(candidate);
        }
        if (!ok) continue;
        hits.push({ start, end: idx, value: candidate });
        break;
      }
    }
    idx = text.indexOf("老师", idx + 2);
  }
  return hits;
}

const TITLE_RE = new RegExp(`([\\u4e00-\\u9fa5]{2,4})(?=(?:${STRICT_TITLES.join("|")}))`, "g");
const INTRO_RE = new RegExp(
  `(?:${[...NAME_INTROS].sort((a, b) => b.length - a.length).join("|")})[\\s:：]*([\\u4e00-\\u9fa5]{2,4})`,
  "g",
);

function introBoundaryOk(text: string, end: number): boolean {
  if (end >= text.length) return true;
  const ch = text[end];
  if (!/[\u4e00-\u9fa5]/.test(ch)) return true; // 标点/空白/字母/数字都算边界
  return INTRO_BOUNDARY.has(ch);
}

/**
 * 从一段文本里找出「像人名但词表里没有」的片段。
 * allow 里的字面量直接豁免（与词表共用同一份豁免清单）。
 */
export function findUnknownNames(text: string, allow?: Set<string>): NameHit[] {
  const hits: NameHit[] = findTeacherNames(text, allow);

  TITLE_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = TITLE_RE.exec(text)) !== null) {
    // 贪婪会先拿到 4 字、再退到 3 字；取第一个「像人名」的候选
    for (let len = m[1].length; len >= 2; len--) {
      const candidate = m[1].slice(-len);
      if (!isPlausibleName(candidate)) continue;
      if (allow?.has(candidate)) break;
      hits.push({ start: m.index + m[1].length - len, end: m.index + m[1].length, value: candidate });
      break;
    }
  }

  INTRO_RE.lastIndex = 0;
  while ((m = INTRO_RE.exec(text)) !== null) {
    const start = m.index + m[0].length - m[1].length;
    for (let len = m[1].length; len >= 2; len--) {
      const candidate = m[1].slice(0, len);
      if (!isPlausibleName(candidate)) continue;
      if (allow?.has(candidate)) break;
      if (!introBoundaryOk(text, start + len)) continue;
      hits.push({ start, end: start + len, value: candidate });
      break;
    }
  }

  return hits;
}
