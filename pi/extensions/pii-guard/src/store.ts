/**
 * 词表加载与会话映射持久化。
 *
 * 隐私约定：运行时数据全部在 ~/.pi/agent/pii-guard/ 下（700 权限），
 * 映射文件含真值（600 权限），一律不进 git 仓库。
 */
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

import { emptyState, type MaskState, type Wordlist } from "./engine.ts";

export const GUARD_DIR = path.join(homedir(), ".pi", "agent", "pii-guard");
export const WORDLIST_PATH = path.join(GUARD_DIR, "wordlist.json");
export const STATE_DIR = path.join(GUARD_DIR, "state");

export function ensureDirs(): void {
  mkdirSync(STATE_DIR, { recursive: true, mode: 0o700 });
}

/** 会话 id 来自 pi（uuid 形式），这里再兜一层，防目录穿越与非法字符 */
function safeId(sessionId: string): string {
  return sessionId.replace(/[^A-Za-z0-9._-]/g, "_").slice(0, 120) || "default";
}

function statePath(sessionId: string): string {
  return path.join(STATE_DIR, `${safeId(sessionId)}.json`);
}

const EMPTY_WORDLIST: Wordlist = { version: 1, people: [] };

export function loadWordlist(): { wordlist: Wordlist; error?: string } {
  try {
    ensureDirs();
  } catch (error) {
    return { wordlist: EMPTY_WORDLIST, error: `无法创建 ${GUARD_DIR}：${String(error)}` };
  }
  if (!existsSync(WORDLIST_PATH)) {
    return { wordlist: EMPTY_WORDLIST, error: `词表不存在：${WORDLIST_PATH}（先跑 node tools/init.mjs）` };
  }
  try {
    const data = JSON.parse(readFileSync(WORDLIST_PATH, "utf8")) as Partial<Wordlist>;
    return {
      wordlist: {
        version: data.version ?? 1,
        people: Array.isArray(data.people) ? data.people : [],
        extraPatterns: Array.isArray(data.extraPatterns) ? data.extraPatterns : undefined,
        allow: Array.isArray(data.allow) ? data.allow : undefined,
      },
    };
  } catch (error) {
    return { wordlist: EMPTY_WORDLIST, error: `词表解析失败：${String(error)}` };
  }
}

export function loadState(sessionId: string): MaskState {
  const file = statePath(sessionId);
  if (!existsSync(file)) return emptyState();
  try {
    const data = JSON.parse(readFileSync(file, "utf8")) as Partial<MaskState>;
    const state = emptyState();
    if (data.tokens && typeof data.tokens === "object") state.tokens = data.tokens;
    if (data.values && typeof data.values === "object") state.values = data.values;
    if (data.counters && typeof data.counters === "object") state.counters = data.counters;
    return state;
  } catch {
    return emptyState();
  }
}

/** 原子写 + 0600：映射含真值，别让别人读到，也别因半截写入损坏 */
export function saveState(sessionId: string, state: MaskState): void {
  ensureDirs();
  const file = statePath(sessionId);
  const tmp = `${file}.tmp`;
  writeFileSync(tmp, JSON.stringify(state, null, 2), { encoding: "utf8", mode: 0o600 });
  chmodSync(tmp, 0o600);
  renameSync(tmp, file);
}

export function clearState(sessionId: string): void {
  const file = statePath(sessionId);
  if (existsSync(file)) unlinkSync(file);
}
