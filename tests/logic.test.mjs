import test from "node:test";
import assert from "node:assert/strict";
import {
  demoPrompt,
  validateProject,
} from "../src/logic.js";
const role = {
  name: "测试角色",
  appearance: "黑发、红外套",
  locked: "左手提包",
  negative: "包换手",
};
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
test("revisions include the editable prior draft along with the requested change", () => {
  const params = {
    role,
    idea: "等车",
    previous: "新增的人工编辑：收起雨伞",
    instruction: "保留收伞，改为近景",
    style: "手绘",
    ratio: "9:16",
    duration: 15,
    mode: "视频提示词",
  };
  const text = demoPrompt(params);
  assert.ok(text.includes(params.previous));
  assert.ok(text.includes(params.instruction));
});
test("project imports validate format and remove unknown or remote character fields", () => {
  const data = validateProject({
    schema: 1,
    projects: [{ id: "a", name: "测试", unrelatedField: "private" }],
    roles: [
      {
        id: "r",
        name: "角色",
        image: "https://example.com/p.png",
        unrelatedField: "private",
      },
    ],
    shots: [],
  });
  assert.equal(data.projects[0].unrelatedField, undefined);
  assert.equal(data.roles[0].unrelatedField, undefined);
  assert.equal(data.roles[0].image, undefined);
  assert.throws(() => validateProject({ schema: 2 }), /文件格式/);
});
