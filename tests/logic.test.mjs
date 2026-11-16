import test from "node:test";
import assert from "node:assert/strict";
import { buildPrompt, demoPrompt, validateProject } from "../src/logic.js";
const role = {
  name: "测试角色",
  appearance: "黑发、红外套",
  locked: "左手提包",
  negative: "包换手",
};
test("prompt includes user intent and linked character locks", () => {
  const prompt = buildPrompt({
    idea: "在雨中等最后一班车",
    role,
    style: "手绘",
    ratio: "9:16",
    duration: 15,
    mode: "视频提示词",
    instruction: "动作克制",
  });
  for (const text of [
    "在雨中等最后一班车",
    "左手提包",
    "包换手",
    "动作克制",
    "15秒",
  ])
    assert.ok(prompt.includes(text));
});
test("demo output respects user idea and identifies its template origin", () => {
  const output = demoPrompt({
    idea: "雨停了。她打开伞。",
    role,
    style: "手绘",
    ratio: "9:16",
    duration: 15,
    mode: "视频提示词",
  });
  for (const text of ["雨停了", "她打开伞", "左手提包", "本地模板"])
    assert.ok(output.includes(text));
});
test("project imports validate format and remove unknown or remote character fields", () => {
  const data = validateProject({
    schema: 1,
    projects: [{ id: "a", name: "测试", apiKey: "private" }],
    roles: [
      {
        id: "r",
        name: "角色",
        image: "https://example.com/p.png",
        apiKey: "private",
      },
    ],
    shots: [],
  });
  assert.equal(data.projects[0].apiKey, undefined);
  assert.equal(data.roles[0].apiKey, undefined);
  assert.equal(data.roles[0].image, undefined);
  assert.throws(() => validateProject({ schema: 2 }), /文件格式/);
});
