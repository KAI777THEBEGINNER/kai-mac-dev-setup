import assert from "node:assert/strict";
import test from "node:test";

import { tokenOf } from "../src/engine.ts";
import { maskCompactionInput } from "../src/index.ts";

const NAME = "测试名";
const TOKEN = tokenOf("PERSON", 1);
const mask = (s: string) => s.split(NAME).join(TOKEN);

test("压缩输入：要发给模型的三处内容都被就地脱敏", () => {
  const event = {
    preparation: {
      messagesToSummarize: [
        { role: "user", content: [{ type: "text", text: `${NAME}说明天交材料` }] },
        {
          role: "assistant",
          content: [{ type: "toolCall", name: "read", arguments: { path: `/tmp/${NAME}.md` } }],
        },
      ],
      turnPrefixMessages: [{ role: "user", content: [{ type: "text", text: `${NAME}又来了` }] }],
      previousSummary: `上一轮聊过${NAME}`,
    },
  };

  maskCompactionInput(event, mask);

  assert.equal(event.preparation.messagesToSummarize[0].content[0].text, `${TOKEN}说明天交材料`);
  assert.equal(event.preparation.turnPrefixMessages[0].content[0].text, `${TOKEN}又来了`);
  assert.equal(event.preparation.previousSummary, `上一轮聊过${TOKEN}`);
});

test("压缩输入：工具参数里的路径也脱敏（否则压缩摘要把本地路径带出去）", () => {
  const event = {
    preparation: {
      messagesToSummarize: [
        {
          role: "assistant",
          content: [{ type: "toolCall", name: "read", arguments: { path: `/tmp/${NAME}.md` } }],
        },
      ],
      turnPrefixMessages: [],
    },
  };

  maskCompactionInput(event, mask);

  const block = event.preparation.messagesToSummarize[0].content[0];
  assert.deepEqual(block.arguments, { path: `/tmp/${TOKEN}.md` });
});

test("压缩输入：重复调用幂等", () => {
  const event = {
    preparation: {
      messagesToSummarize: [{ role: "user", content: [{ type: "text", text: `${NAME}在吗` }] }],
      turnPrefixMessages: [],
    },
  };
  maskCompactionInput(event, mask);
  const once = JSON.stringify(event);
  maskCompactionInput(event, mask);
  assert.equal(JSON.stringify(event), once);
});

test("压缩输入：缺字段不报错（自动压缩和手动压缩的 preparation 不完全一样）", () => {
  const event = { preparation: {} };
  assert.doesNotThrow(() => maskCompactionInput(event, mask));
});
