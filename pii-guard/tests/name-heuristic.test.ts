import assert from "node:assert/strict";
import test from "node:test";

import { Masker, emptyState, tokenOf } from "../src/engine.ts";

const PERSON_1 = tokenOf("PERSON", 1);

const wordlist = { version: 1, people: [] as { label: string; canonical: string }[] };

test("未知人名：称谓后缀能挡住词表外的新名字", () => {
  const m = new Masker(wordlist);
  const out = m.mask("王小梅老师说明天交材料", emptyState());
  assert.ok(out.startsWith(tokenOf("PERSON", 1)) && out.endsWith("老师说明天交材料"), out);
});

test("未知人名：引导词能挡住词表外的新名字", () => {
  const m = new Masker(wordlist);
  for (const s of ["我朋友叫陈雨桐", "姓名：李昊天", "联系人：周雨"]) {
    assert.ok(m.mask(s, emptyState()).includes(tokenOf("PERSON", 1)), s);
  }
});

test("未知人名：复姓按 3~4 字整体识别", () => {
  const m = new Masker(wordlist);
  const out = m.mask("欧阳娜娜老师说下周一交", emptyState());
  assert.ok(out.startsWith(tokenOf("PERSON", 1)) && out.endsWith("老师说下周一交"), out);
});

test("未知人名：老师说法的各种写法都能认出来", () => {
  const cases = [
    ["王老师说下周一交", "老师说下周一交"],
    ["小梅老师说下周一交", "老师说下周一交"],
    ["王小明老师说下周一交", "老师说下周一交"],
    ["Wang老师说下周一交", "老师说下周一交"],
    ["zhang老师说下周一交", "老师说下周一交"],
    ["Zhang San老师说下周一交", "老师说下周一交"],
  ];
  for (const [input, tail] of cases) {
    const m = new Masker(wordlist);
    const out = m.mask(input, emptyState());
    assert.ok(out.startsWith(tokenOf("PERSON", 1)) && out.endsWith(tail), input + " → " + out);
  }
});

test("未知人名：老师说法的常见词不误伤", () => {
  for (const s of ["语文老师说下周一交", "各位老师都到了", "项目老师很负责", "任课老师签字"]) {
    const m = new Masker(wordlist);
    assert.equal(m.mask(s, emptyState()), s, s);
  }
});

test("未知人名：单字姓只挡这一次，不登记（避免「张」到处被替换）", () => {
  const m = new Masker(wordlist);
  const state = emptyState();
  const first = m.mask("王老师说", state);
  assert.ok(first.startsWith(tokenOf("PERSON", 1)), first);
  assert.equal(m.mask("张王李赵", state), "张王李赵");
});

test("未知人名：常见词不误伤", () => {
  const m = new Masker(wordlist);
  for (const s of ["高兴地说明天交材料", "项目老师很负责", "任何老师都能看", "马上就到"]) {
    assert.equal(m.mask(s, emptyState()), s, s);
  }
});

test("未知人名：引导词后面的谓语不会被吃进名字", () => {
  const m = new Masker(wordlist);
  const out = m.mask("叫张三明天来", emptyState());
  assert.ok(!out.includes("张三天"), out);
});

test("未知人名：认出一次后，裸提及也会被挡（同会话记忆）", () => {
  const m = new Masker(wordlist);
  const state = emptyState();
  const first = m.mask("王小梅老师说的", state);
  const second = m.mask("王小梅后来改口了", state);
  assert.ok(first.startsWith(PERSON_1) || first.includes(PERSON_1), "first=" + first);
  assert.ok(second.includes(PERSON_1), "second=" + second);
});

test("未知人名：同一名字复用同一个 token", () => {
  const m = new Masker(wordlist);
  const state = emptyState();
  m.mask("王小梅老师说", state);
  const out = m.mask("王小梅又说", state);
  assert.equal(out, PERSON_1 + "又说");
});

test("未知人名：allow 豁免生效", () => {
  const m = new Masker({ version: 1, people: [], allow: ["王小梅"] });
  assert.equal(m.mask("王小梅老师说", emptyState()), "王小梅老师说");
});

test("未知人名：nameHeuristics=false 时完全不猜人名", () => {
  const m = new Masker(wordlist, undefined, { nameHeuristics: false });
  const s = "王小梅老师说明天交材料";
  assert.equal(m.mask(s, emptyState()), s);
});

test("未知人名：普通词不会被学成人名（2026-10-23 误伤）", () => {
  const cases = [
    "而老师说的",
    "之前开老师会",
    "before 老师说的",
    "是不是老师",
    "就是老师说的",
  ];
  for (const t of cases) {
    const m = new Masker(wordlist);
    assert.equal(m.mask(t, emptyState()), t, t);
  }
});

test("未知人名：真名在各种写法下仍能认出来", () => {
  for (const t of ["王四老师说的", "Alice老师说的", "zhangsan老师说的"]) {
    const m = new Masker(wordlist);
    assert.ok(m.mask(t, emptyState()).includes(PERSON_1), t);
  }
});
