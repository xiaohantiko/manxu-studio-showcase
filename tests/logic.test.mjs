import test from "node:test";
import assert from "node:assert/strict";
import {
  buildPrompt,
  demoPrompt,
  parseExercise,
  validateProject,
} from "../src/logic.js";
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
  for (const text of [buildPrompt(params), demoPrompt(params)]) {
    assert.ok(text.includes(params.previous));
    assert.ok(text.includes(params.instruction));
  }
});
test("a model exercise becomes editable project records and retains its report on import", () => {
  const shot = {
    title: "候车亭",
    duration: 4,
    scale: "中景",
    movement: "固定",
    action: "收起雨伞",
    audio: "雨滴",
  };
  const draft = {
    name: "末班车",
    genre: "日常",
    summary: "雨停时收到一封旧信。",
    prompt: "让候车亭先入画，再切到伞柄特写。",
    role: {
      ...role,
      tag: "主角",
      age: "24",
      personality: "沉静",
      description: "车站管理员",
      image: "https://example.com/unsolicited.png",
    },
    shots: [shot, { ...shot, scale: "特写", duration: 3 }],
  };
  const report = "参考片在中景后切入了道具特写。";
  const { project, workspace } = parseExercise(JSON.stringify(draft), report);
  assert.equal(project.duration, "7");
  assert.equal(workspace.history[0].text, draft.prompt);
  assert.equal(workspace.history[0].demo, false);
  assert.equal(workspace.prompt, draft.summary);
  assert.equal(workspace.roles[0].image, undefined);
  assert.deepEqual(
    workspace.shots.map((s) => s.number),
    ["01", "02"],
  );
  const restored = validateProject({
    schema: 1,
    projects: [project],
    ...workspace,
  });
  assert.equal(restored.referenceReport, report);
  assert.deepEqual(restored.history, workspace.history);
  assert.deepEqual(restored.shots, workspace.shots);
  assert.throws(() => parseExercise("{}", report), /不完整/);
  assert.throws(
    () =>
      parseExercise(
        JSON.stringify({
          ...draft,
          shots: [shot, { ...shot, duration: -1 }],
        }),
        report,
      ),
    /不完整/,
  );
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
