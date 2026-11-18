import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import {
  mkdtemp,
  readFile,
  writeFile,
  stat,
  readdir,
  rm,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import vaultModule from "../electron/vault.cjs";

const { createVault } = vaultModule;
const secret = "fictional privacy marker: 漫画角色剧本 834730018";

// Test double for the OS Keychain. It is deliberately not available to the vault.
function fakeKeychain() {
  const secretKey = crypto.randomBytes(32);
  return {
    enabled: true,
    rotate: false,
    wraps: 0,
    async isAsyncEncryptionAvailable() {
      return this.enabled;
    },
    async encryptStringAsync(text) {
      this.wraps++;
      const iv = crypto.randomBytes(12);
      const cipher = crypto.createCipheriv("aes-256-gcm", secretKey, iv);
      const ciphertext = Buffer.concat([
        cipher.update(text, "utf8"),
        cipher.final(),
      ]);
      return Buffer.concat([iv, cipher.getAuthTag(), ciphertext]);
    },
    async decryptStringAsync(bytes) {
      const decipher = crypto.createDecipheriv(
        "aes-256-gcm",
        secretKey,
        bytes.subarray(0, 12),
      );
      decipher.setAuthTag(bytes.subarray(12, 28));
      const result = Buffer.concat([
        decipher.update(bytes.subarray(28)),
        decipher.final(),
      ]).toString("utf8");
      const shouldReEncrypt = this.rotate;
      this.rotate = false;
      return { result, shouldReEncrypt };
    },
  };
}

async function setup(testContext, props = {}) {
  const parent = await mkdtemp(path.join(tmpdir(), "manxu-vault-test-"));
  testContext.after(() => rm(parent, { recursive: true, force: true }));
  const directory = path.join(parent, "vault");
  const safeStorage = fakeKeychain();
  const options = { directory, safeStorage, ...props };
  return { directory, safeStorage, options, vault: createVault(options) };
}

test("vault round trips private workspace and configuration across restarts without plaintext", async (t) => {
  const { directory, options, vault } = await setup(t);
  const workspace = {
    projects: [{ title: secret }],
    image: "data:image/png;base64,eW91ci1pbWFnZQ==",
  };
  const config = {
    apiKey: "fake-test-key-104209",
    baseURL: "https://fictional.invalid",
  };
  assert.equal(await vault.read("workspace"), null);
  await vault.write("workspace", workspace);
  await vault.write("connection", config);
  assert.deepEqual(await createVault(options).read("workspace"), workspace);
  assert.deepEqual(await createVault(options).read("connection"), config);
  const names = (await readdir(directory)).sort();
  assert.deepEqual(names, ["connection.enc", "key.wrap", "workspace.enc"]);
  for (const name of names) {
    const target = path.join(directory, name);
    const bytes = await readFile(target);
    assert.equal((await stat(target)).mode & 0o777, 0o600);
    for (const value of [
      secret,
      workspace.image,
      config.apiKey,
      config.baseURL,
    ])
      assert.ok(!bytes.includes(value));
  }
  assert.equal((await stat(directory)).mode & 0o777, 0o700);
  const currentCiphertext = await readFile(
    path.join(directory, "workspace.enc"),
  );
  await vault.write("workspace", workspace);
  assert.notDeepEqual(
    await readFile(path.join(directory, "workspace.enc")),
    currentCiphertext,
  );
  await vault.remove("connection");
  assert.equal(await vault.read("connection"), null);
  assert.deepEqual(await vault.read("workspace"), workspace);
});

test("migration is once-only and refuses to overwrite tampered records", async (t) => {
  const { directory, vault } = await setup(t);
  let calls = 0;
  const legacy = { draft: secret };
  const migrate = () =>
    vault.readOrMigrate("workspace", async () => {
      calls++;
      return legacy;
    });
  assert.deepEqual(await migrate(), legacy);
  assert.deepEqual(await migrate(), legacy);
  assert.equal(calls, 1);
  const filename = path.join(directory, "workspace.enc");
  const tampered = await readFile(filename);
  tampered[tampered.length - 1] ^= 0b01000000;
  await writeFile(filename, tampered);
  await assert.rejects(migrate(), /完整性/);
  await assert.rejects(
    vault.write("workspace", { replacement: true }),
    /完整性/,
  );
  await assert.rejects(vault.remove("workspace"), /完整性/);
  assert.equal(calls, 1);
  assert.deepEqual(await readFile(filename), tampered);
});

test("ciphertext from another record cannot be read under a different name", async (t) => {
  const { directory, vault } = await setup(t);
  await vault.write("admin", { user: secret });
  const bytes = await readFile(path.join(directory, "admin.enc"));
  await writeFile(path.join(directory, "workspace.enc"), bytes, {
    mode: 0o600,
  });
  await assert.rejects(vault.read("workspace"), /完整性/);
  await assert.rejects(
    vault.write("../private", { private: true }),
    /记录名称/,
  );
});

test("missing or unavailable keys never reset existing encrypted records", async (t) => {
  const { directory, options, vault, safeStorage } = await setup(t);
  await vault.write("workspace", { draft: secret });
  const file = path.join(directory, "workspace.enc");
  const ciphertext = await readFile(file);
  safeStorage.enabled = false;
  await assert.rejects(vault.read("workspace"), /钥匙串暂不可用/);
  await assert.rejects(
    vault.write("workspace", { replacement: true }),
    /钥匙串暂不可用/,
  );
  safeStorage.enabled = true;
  await assert.rejects(
    createVault({ ...options, safeStorage: fakeKeychain() }).read("workspace"),
    /无法解封/,
  );
  await rm(path.join(directory, "key.wrap"));
  await assert.rejects(vault.read("workspace"), /密钥缺失/);
  await assert.rejects(
    vault.write("new-record", { replacement: true }),
    /密钥缺失/,
  );
  assert.deepEqual(await readFile(file), ciphertext);
  assert.deepEqual(await readdir(directory), ["workspace.enc"]);
});

test("a failed migration remains retryable and serialized writes preserve invocation order", async (t) => {
  const { directory, vault } = await setup(t, { maxRecordBytes: 100 });
  await assert.rejects(
    vault.readOrMigrate("workspace", async () => {
      throw new Error("legacy read failed");
    }),
    /legacy read failed/,
  );
  assert.equal(await vault.read("workspace"), null);
  await Promise.all(
    Array.from({ length: 8 }, (_, i) =>
      vault.write("workspace", { sequence: i }),
    ),
  );
  await assert.rejects(
    vault.write("workspace", { text: "x".repeat(200) }),
    /过大/,
  );
  assert.deepEqual(await vault.read("workspace"), { sequence: 7 });
  assert.ok(!(await readdir(directory)).some((name) => name.endsWith(".tmp")));
});

test("a Keychain rotation rewrites only the wrapped key and preserves the project", async (t) => {
  const { directory, vault, safeStorage } = await setup(t);
  await vault.write("workspace", { draft: secret });
  const filepath = path.join(directory, "workspace.enc");
  const projectCiphertext = await readFile(filepath);
  safeStorage.rotate = true;
  assert.deepEqual(await vault.read("workspace"), { draft: secret });
  assert.equal(safeStorage.wraps, 2);
  assert.deepEqual(await readFile(filepath), projectCiphertext);
});
