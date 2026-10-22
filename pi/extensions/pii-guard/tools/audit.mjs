#!/usr/bin/env node
/**
 * 覆盖率审计：对真实目录跑一遍脱敏，只输出统计，不打印任何真值原文。
 *
 * 用法：
 *   node tools/audit.mjs <dir> [--top <n>]
 *
 * 输出：命中类别计数、人名命中榜、总字符量、按文件覆盖率。
 * 用途：验收「词表 + 正则」到底挡住了多少，以及哪些类别还空着。
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { emptyState, Masker } from "../src/engine.ts";
import { loadWordlist } from "../src/store.ts";

const DIR = process.argv[2];
if (!DIR || !statSync(DIR, { throwIfNoEntry: false })?.isDirectory()) {
  console.error("用法：node tools/audit.mjs <dir> [--top <n>]");
  process.exit(1);
}
const topArg = process.argv.indexOf("--top");
const TOP = topArg > -1 ? Math.max(0, Number(process.argv[topArg + 1]) || 0) : 10;

const { wordlist, error } = loadWordlist();
if (error) console.error(`警告：${error}`);
const masker = new Masker(wordlist);

function* walk(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith(".")) continue;
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(p);
    else if (entry.name.endsWith(".md")) yield p;
  }
}

const byLabel = new Map();
const byValue = new Map();
let files = 0;
let chars = 0;
let maskedChars = 0;

for (const file of walk(DIR)) {
  files++;
  let text;
  try {
    text = readFileSync(file, "utf8");
  } catch {
    continue;
  }
  chars += text.length;
  const state = emptyState();
  const matches = Masker.resolve(masker.scan(text));
  for (const m of matches) {
    const value = text.slice(m.start, m.end);
    byLabel.set(m.label, (byLabel.get(m.label) ?? 0) + 1);
    byValue.set(value, (byValue.get(value) ?? 0) + 1);
    maskedChars += m.end - m.start;
  }
}

const fmt = (n) => n.toLocaleString("en-US");
console.log(`目录：${DIR}`);
const total = [...byLabel.values()].reduce((a, b) => a + b, 0);
console.log(`文件：${fmt(files)} 个｜字符：${fmt(chars)}｜命中：${fmt(total)} 处｜覆盖字符：${((maskedChars / chars) * 100).toFixed(2)}%\n`);

console.log("按类别：");
for (const [label, n] of [...byLabel.entries()].sort((a, b) => b[1] - a[1])) {
  console.log(`  ${label.padEnd(12)} ${fmt(n)}`);
}
if (byLabel.size === 0) console.log("  （无命中）");

if (TOP > 0) console.log(`\n高频命中值（Top ${TOP}，含真值，仅本地查看）：`);
if (TOP > 0) {
  for (const [value, n] of [...byValue.entries()].sort((a, b) => b[1] - a[1]).slice(0, TOP)) {
    console.log(`  ${String(n).padStart(5)} × ${value}`);
  }
}
