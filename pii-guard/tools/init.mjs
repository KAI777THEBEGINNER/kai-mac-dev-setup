#!/usr/bin/env node
/**
 * 初始化 ~/.pi/agent/pii-guard/wordlist.json。
 * 已存在时不覆盖（除非 --force）；--print 只打印不写盘。
 */
import { existsSync, mkdirSync, writeFileSync, chmodSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const DIR = path.join(os.homedir(), ".pi", "agent", "pii-guard");
const FILE = path.join(DIR, "wordlist.json");

const WORDLIST = {
  version: 1,
  _readme:
    "pi-pii-guard 词表。people 里的每个名字会被替换成 <<PERSON:N>>；aliases 是同一人的其他写法。" +
    "extraPatterns 可加自定义正则（label + regex）。allow 是豁免清单。改完无需重启 pi，/reload 即可。",
  people: [
    {
      label: "PERSON",
      canonical: "zhangsan",
      aliases: ["zhangsan1", "zhangsan2", "zhangsan3", "zhangsan4", "zhangsan5", "TODO-你的中文全名"],
    },
    { label: "PERSON", canonical: "李四", aliases: ["李叁"] },
    { label: "PERSON", canonical: "王五", aliases: ["王叁"] },
    { label: "PERSON", canonical: "赵六", aliases: ["赵叁", "zhaoliu"] },
    { label: "PERSON", canonical: "孙七", aliases: ["孙叁"] },
    { label: "PERSON", canonical: "周八", aliases: [] },
    { label: "PERSON", canonical: "吴九", aliases: ["吴叁"] },
  ],
  extraPatterns: [],
  allow: [],
};

const force = process.argv.includes("--force");
const printOnly = process.argv.includes("--print");

if (printOnly) {
  console.log(JSON.stringify(WORDLIST, null, 2));
  process.exit(0);
}

mkdirSync(DIR, { recursive: true, mode: 0o700 });
if (existsSync(FILE) && !force) {
  console.log(`已存在，未覆盖：${FILE}`);
  console.log("如需重置：node tools/init.mjs --force（会覆盖现有词表）");
  process.exit(0);
}
writeFileSync(FILE, JSON.stringify(WORDLIST, null, 2), { mode: 0o600 });
chmodSync(FILE, 0o600);
console.log(`已写入 ${FILE}`);
console.log("提示：把 TODO-你的中文全名 换成真实中文名，再 /reload 生效。");
