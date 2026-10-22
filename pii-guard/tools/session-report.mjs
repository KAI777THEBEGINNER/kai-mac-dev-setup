#!/usr/bin/env node
/**
 * 会话残留报告：把「state 文件 ↔ 是哪个会话 ↔ 有哪些三字人名候选」对应起来。
 * 用途：某个会话弹了 pii-guard 残留告警、但当时还没写 leaks.log 时，从外面回溯。
 * 只读，不碰任何正在运行的 pi 会话。
 *
 * 用法：node tools/session-report.mjs [显示条数，默认 5]
 * 注意：输出含真值（本地终端查看）。
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const STATE_DIR = path.join(os.homedir(), ".pi", "agent", "pii-guard", "state");
const SESSIONS_DIR = path.join(os.homedir(), ".pi", "agent", "sessions");
const LIMIT = Math.max(1, Number(process.argv[2] || 5));

/** 在 sessions/ 里按 uuid 找会话文件，并读出它的显示名 */
function findSession(sessionId) {
  const stack = [SESSIONS_DIR];
  while (stack.length > 0) {
    const dir = stack.pop();
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) {
        stack.push(p);
        continue;
      }
      if (!e.name.endsWith(".jsonl") || !e.name.includes(sessionId)) continue;
      let name = null;
      let cwd = null;
      try {
        const lines = readFileSync(p, "utf8").split("\n").filter(Boolean);
        for (const line of lines.slice(0, 3)) {
          if (cwd) break;
          try {
            const d = JSON.parse(line);
            if (d.type === "session" && typeof d.cwd === "string") cwd = d.cwd;
          } catch {}
        }
        // 会话名存在 type=session_info 的 entry 里（取最后一个）
        for (let i = lines.length - 1; i >= 0; i--) {
          if (!lines[i].includes("session_info")) continue;
          try {
            const d = JSON.parse(lines[i]);
            if (d.type === "session_info" && typeof d.name === "string" && d.name) {
              name = d.name;
              break;
            }
          } catch {}
        }
      } catch {
        /* 读不动就留空 */
      }
      return { file: p, name, cwd };
    }
  }
  return null;
}

function shortTime(ms) {
  const d = new Date(ms);
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getMonth() + 1}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

let files = [];
try {
  files = readdirSync(STATE_DIR)
    .filter((f) => f.endsWith(".json"))
    .map((f) => ({ f, mtime: statSync(path.join(STATE_DIR, f)).mtimeMs }))
    .sort((a, b) => b.mtime - a.mtime)
    .slice(0, LIMIT);
} catch {
  console.log(`没有 state 目录：${STATE_DIR}`);
  process.exit(0);
}

if (files.length === 0) {
  console.log("state 目录里没有会话记录。");
  process.exit(0);
}

console.log(`最近活跃的 ${files.length} 个会话（按 state 修改时间倒序）：\n`);
for (const { f, mtime } of files) {
  const sessionId = f.replace(/\.json$/, "");
  let state;
  try {
    state = JSON.parse(readFileSync(path.join(STATE_DIR, f), "utf8"));
  } catch {
    continue;
  }
  const values = Object.entries(state.values ?? {});
  const byLabel = {};
  for (const [, token] of values) {
    const label = String(token).replace(/<<([A-Z_]+):.*$/, "$1");
    byLabel[label] = (byLabel[label] ?? 0) + 1;
  }
  const sess = findSession(sessionId);
  const live = Date.now() - mtime < 5 * 60_000 ? "  ← 5 分钟内还在更新（可能正忙）" : "";
  console.log(`── ${shortTime(mtime)}  session ${sessionId.slice(0, 8)}…${live}`);
  console.log(`   会话名：${sess?.name ?? "（未命名）"}`);
  console.log(`   工作目录：${sess?.cwd ?? "?"}`);
  console.log(`   已脱敏 ${values.length} 项：${Object.entries(byLabel).map(([k, v]) => `${k}×${v}`).join("｜") || "无"}`);
  const three = values.filter(
    ([v, t]) => String(v).length === 3 && String(t).startsWith("<<PERSON"),
  );
  if (three.length > 0) {
    console.log(`   三字人名候选（告警里"3 字符 PERSON"就是其中之一）：`);
    for (const [value, token] of three) console.log(`     ${token} = ${value}`);
  }
  console.log();
}
console.log("提示：新版本会在 ~/.pi/agent/pii-guard/leaks.log 里记录残留的值与 payload 位置；");
console.log("      上述候选用 /pii leaks 可在会话内直接查看（需 /reload 后）。");
