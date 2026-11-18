const test = require("node:test");
const assert = require("node:assert/strict");
const { mkdtemp, readFile, rm, writeFile, stat } = require("node:fs/promises");
const { tmpdir } = require("node:os");
const path = require("node:path");
const { createVault } = require("../electron/vault.cjs");
const { migrateConnection } = require("./connection.cjs");

test("legacy connection migrates metadata and credential together, preserves old record when unavailable", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "manxu-connection-test-"));
  try {
    const file = path.join(dir, "connection.json");
    const vaultDir = path.join(dir, "vault");
    let available = false;
    const keychain = {
      isAsyncEncryptionAvailable: async () => available,
      encryptStringAsync: async (text) => Buffer.from(text).reverse(),
      decryptStringAsync: async (value) => ({ result: Buffer.from(value).reverse().toString() }),
    };
    const legacy = {
      baseURL: "https://fixture-private.example/v1",
      model: "fixture-private-model",
      provider: "fixture-private-provider",
      encryptedKey: (await keychain.encryptStringAsync("example-fixture-key")).toString("base64"),
    };
    await writeFile(file, JSON.stringify(legacy), { mode: 0o600 });
    const vault = createVault({ directory: vaultDir, safeStorage: keychain });
    await assert.rejects(migrateConnection(vault, file, keychain), /钥匙串/);
    assert.deepEqual(JSON.parse(await readFile(file)), legacy);
    available = true;
    const { encryptedKey, ...metadata } = legacy;
    assert.deepEqual(await migrateConnection(vault, file, keychain), { ...metadata, apiKey: "example-fixture-key" });
    await assert.rejects(stat(file), { code: "ENOENT" });
    const raw = await readFile(path.join(vaultDir, "connection.enc"));
    assert.ok(!raw.includes("fixture-private") && !raw.includes("example-fixture-key"));
  } finally { await rm(dir, { recursive: true, force: true }); }
});
