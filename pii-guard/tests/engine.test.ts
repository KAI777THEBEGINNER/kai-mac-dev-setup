/**
 * 引擎单测。fixtures 全部为虚构数据。
 * 运行：node --test tests/
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { Masker, emptyState, tokenOf, type MaskState, type Wordlist } from "../src/engine.ts";

const WORDLIST: Wordlist = {
  version: 1,
  people: [
    { label: "PERSON", canonical: "李四", aliases: ["李叁"] },
    { label: "PERSON", canonical: "zhangsan", aliases: ["zhangsan4", "zhangsan5", "zhangsan3"] },
  ],
};

function fresh(): { m: Masker; s: MaskState } {
  return { m: new Masker(WORDLIST), s: emptyState() };
}

test("手机号：脱敏与还原", () => {
  const { m, s } = fresh();
  const masked = m.mask("联系电话 13800001234，备用 13800001234", s);
  assert.equal(masked, "联系电话 <<PHONE:1>>，备用 <<PHONE:1>>");
  assert.equal(m.restore(masked, s), "联系电话 13800001234，备用 13800001234");
});

test("手机号紧贴汉字也能命中（piighost 的边界坑）", () => {
  const { m, s } = fresh();
  assert.equal(m.mask("电话13800001234联系我", s), "电话<<PHONE:1>>联系我");
});

test("邮箱：脱敏与还原", () => {
  const { m, s } = fresh();
  const masked = m.mask("发到 wuzhuo@scu.edu.cn 抄送 a@b.co", s);
  assert.equal(masked, "发到 <<EMAIL:1>> 抄送 <<EMAIL:2>>");
  assert.equal(m.restore(masked, s), "发到 wuzhuo@scu.edu.cn 抄送 a@b.co");
});

test("身份证 18 位（含 X）", () => {
  const { m, s } = fresh();
  const masked = m.mask("证件号 11010119900307721X 已登记", s);
  assert.equal(masked, "证件号 <<ID_CARD:1>> 已登记");
  assert.equal(m.restore(masked, s), "证件号 11010119900307721X 已登记");
});

test("银行卡：Luhn 有效才挡，订单号不误伤", () => {
  const { m, s } = fresh();
  // 4111 1111 1111 1111 是 Luhn 有效的测试卡号
  assert.equal(m.mask("卡号 4111111111111111", s), "卡号 <<BANK_CARD:1>>");
  // 首位 1 的 16 位数字不是卡段，放过
  assert.equal(m.mask("订单号 1234567890123456", s), "订单号 1234567890123456");
});

test("人名与别名：同一实体不同写法分别保真", () => {
  const { m, s } = fresh();
  const masked = m.mask("李叁和李四都提到了 zhangsan4", s);
  assert.equal(masked, "<<PERSON:1>>和<<PERSON:2>>都提到了 <<PERSON:3>>");
  assert.equal(m.restore(masked, s), "李叁和李四都提到了 zhangsan4");
});

test("英文名边界：只看词首——前面是字母才不命中（2026-10-13 修复）", () => {
  const wl: Wordlist = { version: 1, people: [{ label: "PERSON", canonical: "amy" }] };
  const m = new Masker(wl);
  assert.equal(m.mask("xamy 是变量名", emptyState()), "xamy 是变量名");   // 前面是字母 → 不动
  assert.notEqual(m.mask("amys_digital_chatbot", emptyState()), "amys_digital_chatbot"); // 词首+后跟字母 → 命中
  assert.notEqual(m.mask("/Users/amy/notes.md", emptyState()), "/Users/amy/notes.md");
  assert.notEqual(m.mask("amy 在开会", emptyState()), "amy 在开会");
});

test("ASCII 别名的边界：下划线/连字符/点是边界，字母数字不是（2026-10-12 修复）", () => {
  const wl: Wordlist = {
    version: 1,
    people: [{ label: "PERSON", canonical: "amy" }],
  };
  const m = new Masker(wl);
  const cases: Array<[string, boolean]> = [
    ["amy_vault", true],       // 目录名
    ["amys_digital", true],    // 名字后直接跟字母（真实文件名，原来漏检）
    ["amy-notes", true],
    ["amy.md", true],
    ["和 amy 确认", true],
    ["xamylase", false],       // 前面是字母 → 不是词首 → 不命中
    ["amy123", true],          // 词首 + 后跟数字：宁可多挡不可漏（用户为 3 字母拼音名）
  ];
  for (const [text, shouldHit] of cases) {
    const masked = m.mask(text, emptyState());
    assert.equal(masked !== text, shouldHit, `"${text}" 期望命中=${shouldHit}`);
  }
});

test("幂等：mask 两次结果一致", () => {
  const { m, s } = fresh();
  const once = m.mask("李叁的手机 13800001234", s);
  const twice = m.mask(once, s);
  assert.equal(twice, once);
});

test("还原容忍空格变体，未知占位符原样保留", () => {
  const { m, s } = fresh();
  m.mask("李叁", s);
  assert.equal(m.restore("<< PERSON : 1 >>", s), "李叁");
  assert.equal(m.restore("<<PERSON:99>> 不存在", s), "<<PERSON:99>> 不存在");
});

test("凭据：API key 与私钥块", () => {
  const { m, s } = fresh();
  // 运行时拼装：仓库里不出现完整的 key / 私钥形态，也避免被密钥扫描误报
  const key = ["sk", "test", "0123456789abcdef0123456789"].join("-");
  const pem = ["-----BEGIN", "PRIVATE KEY-----", "MIIBOgIBAAJBAK", "-----END", "PRIVATE KEY-----"].join(" ");
  const text = `key=${key} 以及 ${pem}`;
  const masked = m.mask(text, s);
  assert.ok(masked.includes(tokenOf("SECRET", 1)), masked);
  assert.ok(masked.includes(tokenOf("SECRET", 2)), masked);
  assert.equal(m.restore(masked, s), text);
});

test("银行卡：Amex 15 位 / Diners 14 位也命中（审核发现 S7）", () => {
  const a = fresh();
  assert.equal(a.m.mask("amex 378282246310005 结束", a.s), "amex <<BANK_CARD:1>> 结束");
  const b = fresh();
  assert.equal(b.m.mask("diners 30569309025904 结束", b.s), "diners <<BANK_CARD:1>> 结束");
});

test("智谱 GLM key 与上下文锚定凭据（审核发现 S8）", () => {
  const a = fresh();
  const glm = `key=${"a".repeat(32)}.${"b".repeat(16)}`;
  assert.equal(a.m.mask(glm, a.s), "key=<<SECRET:1>>");
  const b = fresh();
  assert.equal(b.m.mask('api_key: "Zx9Qw8Er7Ty6Ui5Op4As3Df2"', b.s), 'api_key: "<<SECRET:1>>"');
});

test("词表里的坏正则被跳过而非让整个 Masker 抛错（审核发现 S9）", () => {
  const bad: Wordlist = {
    version: 1,
    people: [{ label: "PERSON", canonical: "张三" }],
    extraPatterns: [{ label: "X", regex: "([unclosed" }],
  };
  const m = new Masker(bad);
  assert.equal(m.skippedPatterns.length, 1);
  assert.equal(m.mask("张三", emptyState()), "<<PERSON:1>>");
});

test("重叠消解：身份证不被拆成两段", () => {
  const { m, s } = fresh();
  const masked = m.mask("11010119900307721X", s);
  assert.equal(masked, "<<ID_CARD:1>>");
});

test("学习范围：learn=false 时不登记，后续裸提及不再命中", () => {
  const m = new Masker({ version: 1, people: [] });
  const st = emptyState();
  const first = m.mask("王四老师说的", st, { learn: false });
  assert.ok(first.includes(tokenOf("PERSON", 1)), first);
  assert.equal(m.mask("王四来了", st), "王四来了");
});

test("学习范围：默认会登记，后续裸提及也被挡", () => {
  const m = new Masker({ version: 1, people: [] });
  const st = emptyState();
  m.mask("王四老师说的", st);
  assert.ok(m.mask("王四来了", st).includes(tokenOf("PERSON", 1)));
});
