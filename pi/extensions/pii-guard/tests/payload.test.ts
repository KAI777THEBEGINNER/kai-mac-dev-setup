/**
 * index.ts 里两个可导出纯函数的单测（fixtures 全为虚构数据）。
 * 覆盖 2026-10-12 审核后续发现的缺陷：对象 key 里的真值改不掉。
 *
 * ⚠️ 本文件在 pii-guard 生效的会话里被改写时，**不要写「<<标签:数字>>」形式的字面量**：
 * 工具参数还原会把它当成真实占位符，替换成你自己的真值写进文件（2026-10-12 实际踩过）。
 * 需要构造 token 时用下面的 T() 在运行时拼接。
 *
 * 运行：node --test tests/payload.test.ts
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { collectStrings, isBinaryDataUri, isBinaryLike, isImageBlockNode, locateValue, transformInPlace } from "../src/index.ts";
import { Masker, type MaskState } from "../src/engine.ts";

/** 运行时拼出占位符，避免源码里出现可被还原的字面 token */
const T = (label: string, n: number): string => `<<${label}:${n}>>`;

test("transformInPlace：改 value", () => {
  const payload: Record<string, unknown> = { text: "联系 王小明 确认", n: 1 };
  const changed = transformInPlace(payload, (s) => s.replaceAll("王小明", T("PERSON", 1)));
  assert.equal(changed, true);
  assert.equal(payload.text, `联系 ${T("PERSON", 1)} 确认`);
  assert.equal(payload.n, 1);
});

test("transformInPlace：改对象 key（审核后续发现：key 里的真值原来改不掉）", () => {
  const payload: Record<string, unknown> = {
    王小明: "a",
    nested: { 李四: "b" },
    arr: [{ 张三: "c" }],
  };
  const map: Record<string, string> = {
    王小明: T("PERSON", 1),
    李四: T("PERSON", 2),
    张三: T("PERSON", 3),
  };
  const changed = transformInPlace(payload, (s) => map[s] ?? s);
  assert.equal(changed, true);
  const keys = Object.keys(payload).sort();
  assert.deepEqual(keys, [T("PERSON", 1), "arr", "nested"]);
  assert.deepEqual(Object.keys(payload.nested as object), [T("PERSON", 2)]);
  assert.deepEqual(Object.keys((payload.arr as object[])[0] as object), [T("PERSON", 3)]);
});

test("transformInPlace：无变更时返回 false（避免无谓的 payload 替换）", () => {
  const payload = { a: "1", b: { c: "2" } };
  assert.equal(transformInPlace(payload, (s) => s), false);
});

test("locateValue：给出值路径与上下文（供 leaks.log 定位）", () => {
  const payload = {
    messages: [{ role: "user", content: "麻烦 王小明 周五前回复" }],
  };
  const hits = locateValue(payload, "王小明");
  assert.equal(hits.length, 1);
  assert.equal(hits[0].path, "$.messages[0].content");
  assert.equal(hits[0].where, "value");
  assert.match(hits[0].snippet, /王小明/);
});

test("locateValue：识别对象 key 里的命中", () => {
  const payload = { meta: { 王小明: "x" } };
  const hits = locateValue(payload, "王小明");
  assert.equal(hits.length, 1);
  assert.equal(hits[0].where, "key");
  assert.equal(hits[0].path, "$.meta.(key)");
});

test("locateValue：多处命中全部列出", () => {
  const payload = { a: "王小明", b: ["王小明", { c: "王小明" }] };
  assert.equal(locateValue(payload, "王小明").length, 3);
});

// ---- 2026-10-12 事故回归：图片 base64 绝不能被替换 ----
// 实况：截图 base64 随机串里撞上 3 字母英文名，兜底强替换把手打断，
// provider 报 `Invalid base64 data`（.messages[93].content[1].image_url.url）→ 整个请求 400。
// 图片数据里的"命中"是碰撞不是泄漏，必须整块跳过。
const imgB64 = `iVBORw0KGgoAAAANSUhEUg${"amy"}GgoAAAAANSUhEUg`;
const dataUri = `data:image/png;base64,${imgB64}`;
const replaceAmy = (s: string): string => s.split("amy").join("XX");

test("图片保护：OpenAI image_url 形态整块跳过（含 data URI）", () => {
  const payload = {
    messages: [
      {
        role: "user",
        content: [
          { type: "text", text: "看 {图占位} 里 amy 那张" },
          { type: "image_url", image_url: { url: dataUri, detail: "high" } },
        ],
      },
    ],
  };
  const imageBefore = JSON.stringify(payload.messages[0].content[1]);
  transformInPlace(payload, replaceAmy);
  assert.equal(JSON.stringify(payload.messages[0].content[1]), imageBefore);
  assert.equal(payload.messages[0].content[0].text, "看 {图占位} 里 XX 那张");
});

test("图片保护：Anthropic image + source.base64 形态整块跳过", () => {
  const payload: Record<string, unknown> = {
    content: [{ type: "image", source: { type: "base64", media_type: "image/png", data: imgB64 } }],
  };
  const changed = transformInPlace(payload, replaceAmy);
  assert.equal(changed, false);
  assert.equal((payload.content as Record<string, unknown>[])[0].source.data, imgB64);
});

test("图片保护：pi 内部 image + data 形态整块跳过，同一 payload 里的文本仍被处理", () => {
  const payload: Record<string, unknown> = {
    messages: [
      { role: "toolResult", content: [
        { type: "text", text: "amy 的截图" },
        { type: "image", data: imgB64, mimeType: "image/png" },
      ] },
    ],
  };
  transformInPlace(payload, replaceAmy);
  const blocks = (payload.messages as Record<string, unknown>[])[0].content as Record<string, unknown>[];
  assert.equal(blocks[0].text, "XX 的截图");
  assert.equal(blocks[1].data, imgB64);
});

test("图片保护：裸 data URI 字符串（数组元素）也不替换", () => {
  const payload: Record<string, unknown> = { parts: [dataUri] };
  const changed = transformInPlace(payload, replaceAmy);
  assert.equal(changed, false);
  assert.equal((payload.parts as string[])[0], dataUri);
});

test("二进制保护：非图片的 base64 data URI（PDF 附件）同样跳过", () => {
  const payload: Record<string, unknown> = {
    messages: [{ role: "user", content: `data:application/pdf;base64,JVBERi${imgB64}` }],
  };
  const changed = transformInPlace(payload, replaceAmy);
  assert.equal(changed, false);
});

test("图片保护：collectStrings 跳过图片数据（泄漏检查不再误报）", () => {
  const payload = {
    messages: [{ role: "user", content: [{ type: "image_url", image_url: { url: dataUri } }] }],
    note: "amy",
  };
  const bag: string[] = [];
  collectStrings(payload, bag);
  assert.ok(!bag.some((s) => s.includes(imgB64)), "图片 base64 不应进入泄漏检查");
  assert.ok(bag.includes("amy"), "普通文本仍要检查");
});

test("图片判定：isBinaryDataUri / isImageBlockNode 边界", () => {
  assert.equal(isBinaryDataUri(dataUri), true);
  assert.equal(isBinaryDataUri("data:image/svg+xml;base64,AAAA"), true);
  assert.equal(isBinaryDataUri("data:application/pdf;base64,AAAA"), true);
  assert.equal(isBinaryDataUri("data:text/plain,hi%20there"), false, "非 base64 的 data URI 是可读文本，不跳过");
  assert.equal(isBinaryDataUri("https://example.com/a.png"), false);
  assert.equal(isImageBlockNode({ type: "image_url" }), true);
  assert.equal(isImageBlockNode({ type: "image" }), true);
  assert.equal(isImageBlockNode({ type: "text" }), false);
  assert.equal(isImageBlockNode([{ type: "image" }]), false);
  assert.equal(isImageBlockNode("image"), false);
});

test("边界不误伤：非 base64 的 data URI 与普通文本照常处理", () => {
  // 取舍：所有 base64 data URI 都跳过（打断载荷的后果 > 理论上被编码进 base64 的文本）；
  // 但非 base64 的 data URI 与普通文本没有这个问题，必须照常脱敏。
  const payload: Record<string, unknown> = { a: "data:text/plain,hi%20amy%20here", b: "amy" };
  transformInPlace(payload, replaceAmy);
  assert.equal(payload.a, "data:text/plain,hi%20XX%20here");
  assert.equal(payload.b, "XX");
});

test("还原标记：mark=true 输出 ⟦真值⟧（显示用），默认不加（工具参数用）", () => {
  const m = new Masker({ version: 1, people: [{ label: "PERSON", canonical: "王小明" }] });
  const state: MaskState = { tokens: {}, values: {}, counters: {} };
  const masked = m.mask("联系 王小明 确认", state);
  assert.notEqual(masked, "联系 王小明 确认"); // 已被替换
  assert.equal(m.restore(masked, state), "联系 王小明 确认");       // 工具参数：纯真值
  assert.equal(m.restore(masked, state, true), "联系 ⟦王小明⟧ 确认"); // 显示：带标记
});

test("base64/长二进制串被识别并跳过（provider 400 修复）", () => {
  const noise = "QUJDREVGR0hJSktMTU5PUFFSU1RVVldYWVphYmNkZWZnaGlqa2xtbm9wcXJzdHV2d3h5ejAxMjM0NTY3ODk";
  let b64 = noise;
  while (b64.length < 2048) b64 += "/amy" + noise.slice(0, 32) + "+";
  assert.equal(isBinaryLike(b64), true);                      // 长且无中文无空格 → 跳过
  assert.equal(isBinaryLike("data:image/jpeg;base64," + b64), true);
  assert.equal(isBinaryLike("正常的中文句子，里面有空格和标点。"), false);
  assert.equal(isBinaryLike("short str"), false);
  // 含中文的长串（正常笔记）不跳过
  const longCn = "中文笔记内容。".repeat(400);
  assert.equal(isBinaryLike(longCn), false);
});
