import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { encryptPortable, decryptPortable } from "../src/portable.js";

const require = createRequire(import.meta.url);
const { createVault } = require("../electron/vault.cjs");
const {
  createWorkspaceStore,
  registerWorkspaceIpc,
} = require("../electron/workspace.cjs");
const fakeKeychain = {
  isAsyncEncryptionAvailable: async () => true,
  encryptStringAsync: async (text) => Buffer.from(text).reverse(),
  decryptStringAsync: async (value) => ({
    result: Buffer.from(value).reverse().toString(),
  }),
};
const fixture = {
  activeId: "test",
  projects: [{ id: "test", name: "fixture-private-title" }],
  workspaces: {
    test: {
      prompt: "fixture-private-prompt",
      roles: [
        {
          id: "r",
          name: "fixture-private-role",
          image: "data:image/png;base64,AQID",
        },
      ],
      shots: [{ id: "s", action: "fixture-private-shot" }],
      history: [{ id: "v1", text: "fixture-private-history" }],
    },
  },
  completed: [1],
};
test("legacy workspace survives encrypted migration with all fields; ciphertext wins later", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "manxu-workspace-test-"));
  try {
    const vault = createVault({ directory: dir, safeStorage: fakeKeychain });
    const store = createWorkspaceStore(vault);
    await assert.rejects(store.load("invalid-json"), /未|保留/);
    assert.deepEqual(await store.load(JSON.stringify(fixture)), fixture);
    assert.deepEqual(await store.load("{ignored"), fixture);
    const raw = await readFile(path.join(dir, "workspace.enc"));
    for (const word of ["fixture-private", "AQID", "completed"])
      assert.ok(!raw.includes(word));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
test("native export rejects plaintext, writes only loadable ciphertext with generic default filename", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "manxu-export-test-"));
  try {
    const handlers = {};
    const target = path.join(dir, "output.manxu");
    let dialogCount = 0;
    registerWorkspaceIpc(
      (k, fn) => {
        handlers[k] = fn;
      },
      {
        vault: {},
        getWindow: () => ({}),
        dialog: {
          showSaveDialog: async (_, opts) => {
            dialogCount++;
            assert.match(
              opts.defaultPath,
              /^漫序-加密文件-[a-f0-9]{8}\.manxu$/,
            );
            return { canceled: false, filePath: target };
          },
        },
      },
    );
    await assert.rejects(
      handlers["file:export"](JSON.stringify(fixture)),
      /加密文件格式/,
    );
    assert.equal(dialogCount, 0);
    const password = "portable-fixture-password";
    const envelope = await encryptPortable(JSON.stringify(fixture), password);
    assert.deepEqual(await handlers["file:export"](envelope), { saved: true });
    const raw = await readFile(target, "utf8");
    assert.ok(!raw.includes(fixture.projects[0].name));
    assert.deepEqual(JSON.parse(await decryptPortable(raw, password)), fixture);
    assert.equal((await stat(target)).mode & 0o777, 0o600);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
