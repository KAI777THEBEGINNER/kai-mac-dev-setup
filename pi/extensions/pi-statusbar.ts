// Pi Status Bar — pi extension (状态数据源)
//
// 把 pi 的会话事件原子写入 ~/.pi/statusbar/state.d/<session>.json，
// 由菜单栏应用 PiStatusBar.app 轮询渲染（pi 自带的 braille spinner 动效）。
// 不再桥接任何 Claude 时代的脚本或目录。
//
// 状态机：
//   session_start / before_agent_start → thinking（用户提交 prompt 即开始转）
//   tool_execution_start → tool + label（工具名，如 Bash / Read / Edit）
//   tool_execution_end → thinking
//   agent_settled → done（含自动重试 / compaction 后的最终落定）
//   session_shutdown → 删除本会话状态文件
//
// app 启动：session_start 时 open -g -b com.local.pistatusbar（幂等，已在跑则忽略）。
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync, renameSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const SB_DIR = path.join(os.homedir(), ".pi", "statusbar");
const STATE_DIR = path.join(SB_DIR, "state.d");
const BUNDLE_ID = "com.local.pistatusbar";

// pi 工具名（小写）→ 菜单栏 label
const TOOL_MAP: Record<string, string> = {
  bash: "Bash",
  read: "Read",
  write: "Write",
  edit: "Edit",
  grep: "Grep",
  ls: "Glob",
  find: "Glob",
};

function writeAtomic(file: string, obj: Record<string, unknown>) {
  const tmp = file + "." + process.pid + ".tmp";
  writeFileSync(tmp, JSON.stringify(obj));
  renameSync(tmp, file);
}

// 即发即忘启动菜单栏 app（已在跑则由 open 自身幂等处理）
function launchApp() {
  try {
    const p = spawn("open", ["-g", "-b", BUNDLE_ID], { stdio: "ignore", detached: true });
    p.unref();
  } catch {
    /* 菜单栏不可用时静默降级 */
  }
}

export default function (pi: ExtensionAPI) {
  // session 文件路径（如 ~/.pi/agent/sessions/<cwd>/<uuid>.jsonl）→ uuid
  const sid = (ctx: { sessionManager?: { getSessionFile?: () => string | null } }) => {
    const f = ctx?.sessionManager?.getSessionFile?.() ?? "";
    return path.basename(f).replace(/\.jsonl?$/, "") || "unknown";
  };
  const statePath = (id: string) => path.join(STATE_DIR, id + ".json");

  const nowSec = () => Math.floor(Date.now() / 1000);
  const project = (cwd: string) => (cwd ? path.basename(cwd) : "");

  // 确保目录 + 写状态 + 拉起 app。首次为 idle，prompt 提交后进入 thinking。
  pi.on("session_start", async (_event, ctx) => {
    const id = sid(ctx);
    try {
      mkdirSync(STATE_DIR, { recursive: true });
      writeAtomic(statePath(id), {
        state: "idle",
        label: "",
        project: project(ctx.cwd),
        entrypoint: "pi-cli",
        term_program: process.env.TERM_PROGRAM || "",
        startedAt: 0,
        ts: nowSec(),
      });
      launchApp();
    } catch {
      /* 状态目录不可写时静默降级 */
    }
  });

  pi.on("session_shutdown", async (_event, ctx) => {
    try {
      rmSync(statePath(sid(ctx)), { force: true });
    } catch {
      /* ignore */
    }
  });

  // 用户提交输入 → thinking
  pi.on("before_agent_start", async (_event, ctx) => {
    const id = sid(ctx);
    try {
      writeAtomic(statePath(id), {
        state: "thinking",
        label: "",
        project: project(ctx.cwd),
        entrypoint: "pi-cli",
        term_program: process.env.TERM_PROGRAM || "",
        startedAt: nowSec(),
        ts: nowSec(),
      });
    } catch {
      /* ignore */
    }
  });

  // 工具开始执行 → Running <tool>
  pi.on("tool_execution_start", async (event, ctx) => {
    const id = sid(ctx);
    try {
      writeAtomic(statePath(id), {
        state: "tool",
        label: TOOL_MAP[event.toolName] ?? event.toolName,
        project: project(ctx.cwd),
        entrypoint: "pi-cli",
        term_program: process.env.TERM_PROGRAM || "",
        startedAt: nowSec(),
        ts: nowSec(),
      });
    } catch {
      /* ignore */
    }
  });

  // 工具结束 → 回到 thinking（若 turn 已结束，随后的 agent_settled 会收尾）
  pi.on("tool_execution_end", async (_event, ctx) => {
    const id = sid(ctx);
    try {
      writeAtomic(statePath(id), {
        state: "thinking",
        label: "",
        project: project(ctx.cwd),
        entrypoint: "pi-cli",
        term_program: process.env.TERM_PROGRAM || "",
        startedAt: nowSec(),
        ts: nowSec(),
      });
    } catch {
      /* ignore */
    }
  });

  // agent 整体完成（含重试/compaction 后的最终落定）→ Done
  pi.on("agent_settled", async (_event, ctx) => {
    const id = sid(ctx);
    try {
      writeAtomic(statePath(id), {
        state: "done",
        label: "",
        project: project(ctx.cwd),
        entrypoint: "pi-cli",
        term_program: process.env.TERM_PROGRAM || "",
        startedAt: 0,
        ts: nowSec(),
      });
    } catch {
      /* ignore */
    }
  });
}
