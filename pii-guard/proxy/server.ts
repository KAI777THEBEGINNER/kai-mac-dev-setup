#!/usr/bin/env node
/**
 * Codex CLI → aigocode 的本地 Responses API 脱敏代理。
 *
 * 启动：node proxy/server.ts
 * 配置：PII_PROXY_PORT、PII_PROXY_UPSTREAM、AIGOCODE_API_KEY。
 * 若没有环境变量，会读取 ~/.config/aigocode.key（只在本机使用）。
 */
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";

import { Masker, type MaskState } from "../src/engine.ts";
import { loadState, loadWordlist, saveState } from "../src/store.ts";
import {
  isBinaryLike,
  maskPayloadWithRepair,
  restorePayload,
  restoreProtocolIds,
  restoreSseEvent,
  stripCodexClientItemIds,
  StreamingRestorer,
} from "../src/codex-proxy.ts";
import { appendFileSync, mkdirSync } from "node:fs";

const HOST = process.env.PII_PROXY_HOST ?? "127.0.0.1";
const PORT = Number.parseInt(process.env.PII_PROXY_PORT ?? "8787", 10);
const UPSTREAM = (process.env.PII_PROXY_UPSTREAM ?? "https://api.aigocode.dev/v1").replace(/\/+$/, "");
const SESSION_ID = process.env.PII_CODEX_SESSION_ID ?? "codex-proxy";
const KEY_FILE = process.env.PII_PROXY_KEY_FILE ?? path.join(homedir(), ".config", "aigocode.key");
const REPAIR_LOG = path.join(homedir(), ".pi", "agent", "pii-guard", "codex-proxy-leaks.log");
const MAX_BODY = 50 * 1024 * 1024;

/** 残留修复日志：只记 token 名与数量，绝不写真值或原文。 */
function logRepair(tokens: string[], remasked: number): void {
  try {
    mkdirSync(path.dirname(REPAIR_LOG), { recursive: true, mode: 0o700 });
    appendFileSync(
      REPAIR_LOG,
      `${JSON.stringify({ ts: new Date().toISOString(), repaired: tokens, stillLeaking: remasked })}\n`,
      { mode: 0o600 },
    );
  } catch {
    /* 日志失败不影响转发 */
  }
  console.error(`pii proxy: force-masked ${tokens.length} known value(s) that rules missed: ${tokens.join(", ")}`);
}

function json(res: ServerResponse, status: number, body: unknown): void {
  const data = JSON.stringify(body);
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", "content-length": Buffer.byteLength(data) });
  res.end(data);
}

async function readBody(req: IncomingMessage): Promise<Buffer> {
  const parts: Buffer[] = [];
  let size = 0;
  for await (const part of req) {
    const chunk = Buffer.isBuffer(part) ? part : Buffer.from(part);
    size += chunk.length;
    if (size > MAX_BODY) throw new Error(`request body exceeds ${MAX_BODY} bytes`);
    parts.push(chunk);
  }
  return Buffer.concat(parts);
}

async function readApiKey(): Promise<string> {
  const fromEnv = process.env.AIGOCODE_API_KEY?.trim();
  if (fromEnv) return fromEnv;
  const fromFile = (await readFile(KEY_FILE, "utf8")).trim();
  if (!fromFile) throw new Error(`empty API key file: ${KEY_FILE}`);
  return fromFile;
}

function upstreamHeaders(req: IncomingMessage, key: string): Record<string, string> {
  const headers: Record<string, string> = {
    authorization: `Bearer ${key}`,
    "content-type": "application/json",
    accept: req.headers.accept ?? "application/json, text/event-stream",
  };
  for (const name of ["user-agent", "x-request-id", "openai-beta"]) {
    const value = req.headers[name];
    if (typeof value === "string") headers[name] = value;
  }
  return headers;
}

function clientHeaders(upstream: Response): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [name, value] of upstream.headers) {
    if (["connection", "keep-alive", "transfer-encoding", "content-length", "content-encoding"].includes(name)) continue;
    result[name] = value;
  }
  return result;
}

function looksBinary(value: unknown): boolean {
  return typeof value === "string" && isBinaryLike(value);
}

/** 将一个 SSE event 的文本写入响应；最多延迟到占位符完整后再发出。 */
async function pipeSse(upstream: Response, res: ServerResponse, masker: Masker, state: MaskState): Promise<void> {
  if (!upstream.body) {
    res.end();
    return;
  }
  const reader = upstream.body.getReader();
  const decoder = new TextDecoder();
  const restorer = new StreamingRestorer(masker, state);
  let textCarry = "";
  let pending: Array<{ text: string; appendTail?: (tail: string) => string }> = [];

  const emitReady = (): void => {
    if (restorer.hasCarry) return;
    for (const event of pending) res.write(event.text);
    pending = [];
  };

  const consume = (text: string): void => {
    textCarry += text;
    while (true) {
      const match = textCarry.match(/\r?\n\r?\n/);
      if (!match || match.index === undefined) return;
      const end = match.index + match[0].length;
      const raw = textCarry.slice(0, end);
      textCarry = textCarry.slice(end);
      const event = restoreSseEvent(raw, restorer);
      pending.push(event);
      emitReady();
    }
  };

  while (true) {
    const next = await reader.read();
    if (next.done) break;
    consume(decoder.decode(next.value, { stream: true }));
  }
  consume(decoder.decode());
  if (textCarry) pending.push(restoreSseEvent(textCarry, restorer));
  if (restorer.hasCarry) {
    const tail = restorer.flush();
    const target = [...pending].reverse().find((event) => event.appendTail);
    if (target?.appendTail) {
      target.text = target.appendTail(tail);
    } else if (pending.length > 0) {
      pending[pending.length - 1].text += tail;
    }
  }
  for (const event of pending) res.write(event.text);
  res.end();
}

async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (req.method === "GET" && req.url === "/healthz") {
    json(res, 200, { ok: true, upstream: UPSTREAM, session: SESSION_ID });
    return;
  }
  if (req.method !== "POST" || !req.url?.startsWith("/v1/")) {
    json(res, 404, { error: { message: "pii proxy only accepts POST /v1/*" } });
    return;
  }

  const { wordlist, error } = loadWordlist();
  if (error) {
    json(res, 503, { error: { message: `pii proxy wordlist unavailable: ${error}` } });
    return;
  }
  const masker = new Masker(wordlist);
  const state = loadState(SESSION_ID);
  let body: unknown;
  try {
    body = JSON.parse((await readBody(req)).toString("utf8"));
  } catch (err) {
    json(res, 400, { error: { message: `invalid JSON request: ${String(err)}` } });
    return;
  }

  let outbound: unknown;
  try {
    // 上游不接受 Codex 自己生成的 ctc_ 客户端 item id；这是协议兼容处理，
    // 不影响 call_id，也不改变模型可见的工具参数。
    const protocolClean = restoreProtocolIds(body, masker, state);
    const outcome = maskPayloadWithRepair(stripCodexClientItemIds(protocolClean), masker, state);
    outbound = outcome.payload;
    // 残留是修复信号，不是拒绝理由：能强替换就继续发（与 pi 侧语义一致）。
    // 少量规则外残留也不能阻断整轮 Codex 请求，否则会反复中断并浪费上下文。
    if (outcome.repaired.length > 0) logRepair(outcome.repaired, outcome.leaks.length);
    // 先落盘映射再出站，避免上游成功而本地无法还原。
    saveState(SESSION_ID, state);
  } catch (err) {
    json(res, 503, { error: { message: `pii proxy refused request before upstream: ${String(err)}` } });
    return;
  }

  let upstream: Response;
  try {
    const key = await readApiKey();
    const target = `${UPSTREAM}${req.url.slice(3)}`;
    upstream = await fetch(target, { method: "POST", headers: upstreamHeaders(req, key), body: JSON.stringify(outbound) });
  } catch (err) {
    json(res, 502, { error: { message: `upstream unavailable: ${String(err)}` } });
    return;
  }

  const headers = clientHeaders(upstream);
  const contentType = upstream.headers.get("content-type") ?? "";
  if (contentType.includes("text/event-stream")) {
    res.writeHead(upstream.status, headers);
    await pipeSse(upstream, res, masker, state);
    return;
  }

  const raw = await upstream.text();
  let output: string = raw;
  try {
    const parsed = JSON.parse(raw);
    output = JSON.stringify(restorePayload(parsed, masker, state));
  } catch {
    // 非 JSON 错误体仍尽量还原占位符；二进制/超长内容保持不动。
    if (!looksBinary(raw)) output = masker.restore(raw, state);
  }
  headers["content-length"] = String(Buffer.byteLength(output));
  res.writeHead(upstream.status, headers);
  res.end(output);
}

const server = createServer((req, res) => {
  void handle(req, res).catch((err) => {
    if (!res.headersSent) json(res, 500, { error: { message: `pii proxy internal error: ${String(err)}` } });
    else res.destroy(err as Error);
  });
});

server.listen(PORT, HOST, () => {
  console.log(`pii proxy listening on http://${HOST}:${PORT}/v1 → ${UPSTREAM}`);
});

process.on("SIGINT", () => server.close(() => process.exit(0)));
process.on("SIGTERM", () => server.close(() => process.exit(0)));

