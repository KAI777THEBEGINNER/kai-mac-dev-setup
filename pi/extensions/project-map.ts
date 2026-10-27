// project-map —— pi 扩展：项目空间地图自动注入 + 维护命令
//
// 机制（与 AGENTS.md「代码地图」约定配套）：
//   1. 会话启动时从 cwd 向上找 PROJECT_MAP.md
//   2. 每次 agent 启动前，若地图存在且本会话尚未注入（或地图已更新），
//      把地图全文作为 context message 注入一次 —— 后续轮次都带在历史里，
//      Pi 不再需要每次全量重扫源码
//   3. 没有地图的项目：启动时提醒一次「/map 生成」
//   4. /map 命令 + project_map 工具：生成/刷新地图（调 scripts/project-map.mjs）
//
// 防重复注入：message 里埋 mtime 标记；resume 会话时从历史恢复上次注入的 mtime，
// 地图没变就不重复注入；地图刷新（mtime 变化）后下一轮自动注入新版。

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const MAP_NAME = "PROJECT_MAP.md";
const LEGACY_NAME = "CODEBASE.md"; // 旧名，存在且新名缺失时仍读，向后兼容
const MAX_INJECT_BYTES = 24 * 1024;
const MTIME_TAG = /<!-- project-map:mtime:(\d+) -->/;
const SCRIPT = path.join(homedir(), ".pi", "agent", "scripts", "project-map.mjs");

function findMap(cwd: string): string | null {
  let dir = path.resolve(cwd);
  while (true) {
    for (const name of [MAP_NAME, LEGACY_NAME]) {
      const candidate = path.join(dir, name);
      if (existsSync(candidate)) return candidate;
    }
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

function runGenerator(targetDir: string): { ok: boolean; output: string } {
  const res = spawnSync(process.execPath, [SCRIPT, targetDir], {
    encoding: "utf8",
    timeout: 60_000,
  });
  const output = `${res.stdout ?? ""}${res.stderr ?? ""}`.trim();
  return { ok: res.status === 0, output };
}

function looksLikeProject(cwd: string): boolean {
  if (path.resolve(cwd) === homedir()) return false;
  if (existsSync(path.join(cwd, ".git"))) return true;
  try {
    const entries = readdirSync(cwd);
    return entries.some(
      (n: string) =>
        /\.(ts|tsx|js|jsx|py|swift|go|rs|java|kt|cpp|c|sh|mjs)$/i.test(n) ||
        n === "package.json",
    );
  } catch {
    return false;
  }
}

export default function (pi: ExtensionAPI) {
  let injectedMtime = -1; // 本会话已注入的地图 mtime；-1 表示未注入
  let sessionSeen = false;

  // 从会话历史恢复上次注入的 mtime（resume/fork 场景防重复注入）
  const restoreFromSession = (ctx: { sessionManager?: { getEntries?: () => unknown[] } }) => {
    const entries = ctx?.sessionManager?.getEntries?.() ?? [];
    for (const entry of entries) {
      const raw = JSON.stringify(entry);
      const m = MTIME_TAG.exec(raw);
      if (m) {
        injectedMtime = Number(m[1]);
        return;
      }
    }
  };

  pi.on("session_start", async (_event, ctx) => {
    if (!sessionSeen) {
      sessionSeen = true;
      restoreFromSession(ctx);
    }
    const mapPath = findMap(ctx.cwd);
    if (!mapPath && ctx.hasUI && looksLikeProject(ctx.cwd)) {
      ctx.ui.notify("此项目还没有项目空间地图，输入 /map 生成 PROJECT_MAP.md", "warn");
    }
  });

  pi.on("before_agent_start", async (event, ctx) => {
    const mapPath = findMap(ctx.cwd);
    if (!mapPath) return;
    let mtime: number;
    try {
      mtime = statSync(mapPath).mtimeMs;
    } catch {
      return;
    }
    if (mtime === injectedMtime) return;
    let content: string;
    try {
      content = readFileSync(mapPath, "utf8");
    } catch {
      return;
    }
    let truncated = false;
    if (Buffer.byteLength(content, "utf8") > MAX_INJECT_BYTES) {
      content = content.slice(0, MAX_INJECT_BYTES);
      truncated = true;
    }
    const guide = [
      `<!-- project-map:mtime:${mtime} -->`,
      "",
      "【项目空间地图】根目录有 PROJECT_MAP.md，全文如下。先据此建立全局认知：",
      "1. 定位文件用本图，需要细节再 read 具体源码；不要每次全量扫仓库",
      "2. 图中没有的细节（函数体、参数、调用链）直接 read 对应文件",
      "3. 上下文被压缩导致地图丢失时，用 read 重读 PROJECT_MAP.md",
      "4. 代码大改（增删文件、改架构）后，用 project_map 工具刷新地图",
      truncated ? `5. 地图超过 ${MAX_INJECT_BYTES} 字节已截断，按需 read 剩余部分` : "",
      "",
      content,
    ]
      .filter(Boolean)
      .join("\n");
    injectedMtime = mtime;
    return { message: { customType: "project-map", content: guide, display: true } };
  });

  pi.registerCommand("map", {
    description: "生成或刷新当前项目的 PROJECT_MAP.md 项目空间地图",
    handler: async (args, ctx) => {
      const target = args?.trim() ? path.resolve(ctx.cwd, args.trim()) : ctx.cwd;
      const { ok, output } = runGenerator(target);
      if (ok) {
        ctx.ui.notify(`代码地图已刷新：${output.split("\n")[0]}`, "info");
      } else {
        ctx.ui.notify(`生成失败：${output || "未知错误"}`, "error");
      }
      return output || undefined;
    },
  });

  pi.registerTool({
    name: "project_map",
    label: "Codebase Map",
    description:
      "检查、生成或刷新项目根目录的 PROJECT_MAP.md 项目空间地图（项目结构 + 源码符号摘要）。" +
      "用它替代全量扫描源码：进入没有地图的项目先 generate；大改代码后刷新。" +
      "地图注入由全局扩展自动完成，本工具只在需要显式检查或刷新时调用。",
    parameters: Type.Object({
      action: Type.Union([Type.Literal("status"), Type.Literal("generate")], {
        description: "status 检查地图是否存在；generate 生成或刷新地图",
      }),
      path: Type.Optional(
        Type.String({ description: "目标目录，默认当前工作目录" }),
      ),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const target = params.path ? path.resolve(ctx.cwd, params.path) : ctx.cwd;
      const mapPath = findMap(target);
      if (params.action === "status") {
        const info = mapPath
          ? `存在：${mapPath}`
          : `不存在。运行 generate 生成，或在 TUI 输入 /map`;
        return { content: [{ type: "text", text: info }], details: {} };
      }
      const { ok, output } = runGenerator(target);
      return {
        content: [
          {
            type: "text",
            text: ok ? `已生成/刷新代码地图：\n${output}` : `生成失败：\n${output}`,
          },
        ],
        details: { isError: !ok },
      };
    },
  });
}
