#!/usr/bin/env node
/**
 * 人名候选扫描：从 vault 里挖"像人名但不在词表里"的候选，供人工确认后加进词表。
 *
 * 两个信号分开统计（n-gram 全扫噪音太大，已弃用）：
 *   - 称谓上下文 X老师 / X经理 / X先生：高置信，排前面
 *   - 联系方式邻近（手机/邮箱/微信号 ±60 字）：低置信，排后面
 * 输出附「示例」列（数字与邮箱已打码），人工一眼能判断。
 *
 * 用法：
 *   node tools/scan-names.mjs <vault-dir> [--full] [--min <n>] [--out <file>]
 *   --full  忽略缓存全量重扫（默认只扫新增/修改过的文件）
 *   --min   最小总出现次数（默认 2）
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { NAME_NOISE, NAME_TITLES, SURNAMES } from "../src/name-data.ts";

/** 与运行时启发式共用同一份姓氏与噪音词，避免两套标准 */
const TITLE_RE = new RegExp(`([\\u4e00-\\u9fa5]{2,6})(?:${NAME_TITLES.join("|")})`, "g");
const CONTACT_RE = /(?:微信|手机|电话|邮箱|Email|E-mail|[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}|1[3-9]\d{9})/g;
const HAN = /[\u4e00-\u9fa5]{2,8}/g;

/** 噪音词：与运行时启发式共用同一份 */
const NOISE = NAME_NOISE;

const VAULT = process.argv[2];
if (!VAULT || !existsSync(VAULT)) {
  console.error("用法：node tools/scan-names.mjs <vault-dir> [--full] [--min <n>] [--out <file>]");
  process.exit(1);
}
const full = process.argv.includes("--full");
const minArg = process.argv.indexOf("--min");
const MIN = minArg > -1 ? Number(process.argv[minArg + 1]) || 2 : 2;
const outArg = process.argv.indexOf("--out");
const OUT = outArg > -1 ? process.argv[outArg + 1] : null;

const CACHE_DIR = path.join(os.homedir(), ".pi", "agent", "pii-guard");
const CACHE_FILE = path.join(CACHE_DIR, "scan-cache.json");
const WORDLIST_FILE = path.join(CACHE_DIR, "wordlist.json");

function knownNames() {
  const known = new Set();
  try {
    const wl = JSON.parse(readFileSync(WORDLIST_FILE, "utf8"));
    for (const p of wl.people ?? []) {
      known.add(String(p.canonical).toLowerCase());
      for (const a of p.aliases ?? []) known.add(String(a).toLowerCase());
    }
  } catch {
    /* 没词表就不过滤 */
  }
  return known;
}

function* walk(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith(".")) continue;
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(p);
    else if (entry.name.endsWith(".md")) yield p;
  }
}

const redact = (s) =>
  s
    .replace(/[0-9]{7,}/g, "[NUM]")
    .replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, "[EMAIL]")
    .replace(/\s+/g, " ");

const known = knownNames();
let cache = {};
if (!full && existsSync(CACHE_FILE)) {
  try {
    cache = JSON.parse(readFileSync(CACHE_FILE, "utf8"));
  } catch {
    cache = {};
  }
}

/** 候选 → { title, contact, files:Set, sample } */
const hits = new Map();
const nextCache = {};
let scanned = 0;

function bump(word, kind, file, sample) {
  if (word.length < 2 || NOISE.has(word) || known.has(word.toLowerCase())) return;
  const entry = hits.get(word) ?? { title: 0, contact: 0, files: new Set(), sample: "" };
  entry[kind] += 1;
  entry.files.add(file);
  if (!entry.sample && sample) entry.sample = redact(sample);
  hits.set(word, entry);
}

for (const file of walk(VAULT)) {
  const st = statSync(file);
  nextCache[file] = st.mtimeMs;
  if (!full && cache[file] === st.mtimeMs) continue;
  scanned++;
  let text;
  try {
    text = readFileSync(file, "utf8");
  } catch {
    continue;
  }

  // 信号一：称谓上下文（取 raw 的所有 2~4 字后缀，长词优先，靠收敛去碎片）
  for (const m of text.matchAll(TITLE_RE)) {
    const raw = m[1];
    const at = m.index ?? 0;
    const sample = text.slice(Math.max(0, at - 12), at + raw.length + 4);
    for (const len of [4, 3, 2]) {
      if (raw.length < len) continue;
      const cand = raw.slice(-len);
      if (SURNAMES.has(cand[0])) bump(cand, "title", file, sample);
    }
  }

  // 信号二：联系方式邻近
  for (const m of text.matchAll(CONTACT_RE)) {
    const idx = m.index ?? 0;
    const a = Math.max(0, idx - 60);
    const b = Math.min(text.length, idx + m[0].length + 60);
    const win = text.slice(a, b);
    for (const h of win.matchAll(HAN)) {
      const s = h[0];
      for (const len of [4, 3, 2]) {
        for (let i = 0; i + len <= s.length; i++) {
          const cand = s.slice(i, i + len);
          if (SURNAMES.has(cand[0])) bump(cand, "contact", file, text.slice(a, b).slice(0, 60));
        }
      }
    }
  }
}

mkdirSync(CACHE_DIR, { recursive: true, mode: 0o700 });
try {
  writeFileSync(CACHE_FILE, JSON.stringify(nextCache));
} catch {
  /* 缓存写不进去不影响扫描 */
}

// 收敛：长词优先，被更高频的长候选包住就丢弃（李四 压掉 杨怡 / 和李四）
const entries = [...hits.entries()]
  .filter(([, v]) => v.title + v.contact >= MIN)
  .sort((a, b) => b[0].length - a[0].length || b[1].title + b[1].contact - (a[1].title + a[1].contact));
const kept = [];
for (const [w, v] of entries) {
  const total = v.title + v.contact;
  const swallowed = kept.some(
    ([kw, kv]) => (kw.includes(w) || w.includes(kw)) && kv.title + kv.contact >= total * 0.6,
  );
  if (!swallowed) kept.push([w, v]);
}

const byTitle = kept
  .filter(([, v]) => v.title > 0)
  .sort((a, b) => b[1].title - a[1].title || b[1].files.size - a[1].files.size);
const byContact = kept
  .filter(([, v]) => v.title === 0)
  .sort((a, b) => b[1].contact - a[1].contact || b[1].files.size - a[1].files.size);

const lines = [
  `# 人名候选扫描（${full ? "全量" : `增量，扫描 ${scanned} 个文件`}）`,
  "",
  "## A. 称谓上下文（高置信）",
  "",
  "| 候选 | 称谓次数 | 文件数 | 示例（已打码） |",
  "|---|---|---|---|",
  ...byTitle.map(([w, v]) => `| ${w} | ${v.title} | ${v.files.size} | ${v.sample.replaceAll("|", "/")} |`),
  "",
  "## B. 联系方式邻近（低置信，需人工判断）",
  "",
  "| 候选 | 邻接次数 | 文件数 |",
  "|---|---|---|",
  ...byContact.map(([w, v]) => `| ${w} | ${v.contact} | ${v.files.size} |`),
  "",
  "确认后加进 ~/.pi/agent/pii-guard/wordlist.json，再 /reload。",
].join("\n");

if (OUT) {
  writeFileSync(OUT, lines);
  console.log(`已写入 ${OUT}（A 类 ${byTitle.length} 条，B 类 ${byContact.length} 条，扫描 ${scanned} 个文件）`);
} else {
  console.log(lines);
}
