import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdtemp, readFile, rm, writeFile, stat } from "node:fs/promises";
import { scryptSync, randomBytes } from "node:crypto";
import { tmpdir } from "node:os";
import path from "node:path";
const require = createRequire(import.meta.url);
const { createAdminStore } = require("../electron/admin.cjs");
const { createVault } = require("../electron/vault.cjs");
test("legacy admin hashed password migrates encrypted and remains usable; password changes persist", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "manxu-admin-test-"));
  try {
    const file = path.join(dir, "admin.json");
    const salt = randomBytes(24).toString("hex");
    const password = "fixture-previous-password";
    const hash = scryptSync(password, salt, 64).toString("hex");
    await writeFile(
      file,
      JSON.stringify({
        username: "fixture-account",
        salt,
        hash,
        isDefault: false,
      }),
    );
    const vault = createVault({
      directory: path.join(dir, "vault"),
      safeStorage: {
        isAsyncEncryptionAvailable: async () => true,
        encryptStringAsync: async (text) => Buffer.from(text).reverse(),
        decryptStringAsync: async (value) => ({
          result: Buffer.from(value).reverse().toString(),
        }),
      },
    });
    const admin = createAdminStore(file, vault);
    assert.equal((await admin.status()).authenticated, false);
    await assert.rejects(stat(file), { code: "ENOENT" });
    assert.throws(() => admin.require(), /登录/);
    await assert.rejects(
      admin.login({ username: "fixture-account", password: "wrong" }),
      /不正确/,
    );
    await admin.login({ username: "fixture-account", password });
    admin.require();
    await admin.changePassword({
      currentPassword: password,
      newPassword: "fixture-new-password",
    });
    const raw = await readFile(path.join(dir, "vault", "admin.enc"));
    for (const word of ["fixture-account", "fixture-new-password", salt, hash])
      assert.ok(!raw.includes(word));
    admin.logout();
    await assert.rejects(
      admin.login({ username: "fixture-account", password }),
    );
    const restarted = createAdminStore(file, vault);
    assert.equal((await restarted.status()).authenticated, false);
    await restarted.login({
      username: "fixture-account",
      password: "fixture-new-password",
    });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("public first-run enrolls one account, encrypts credentials and requires login after restart", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "manxu-setup-test-"));
  try {
    const file = path.join(dir, "admin.json");
    const vault = createVault({
      directory: path.join(dir, "vault"),
      safeStorage: {
        isAsyncEncryptionAvailable: async () => true,
        encryptStringAsync: async (text) => Buffer.from(text).reverse(),
        decryptStringAsync: async (value) => ({ result: Buffer.from(value).reverse().toString() }),
      },
    });
    const account = createAdminStore(file, vault);
    assert.deepEqual(await account.status(), {
      authenticated: false, needsSetup: true, username: "", isDefault: false,
    });
    await assert.rejects(account.login({username: "visitor", password: "unregistered"}), /创建/);
    await assert.rejects(account.create({username: "visitor", password: "short"}), /8–128/);
    const password = randomBytes(18).toString("hex");
    const attempts = await Promise.allSettled([
      account.create({ username: " test creator ", password }),
      account.create({ username: "different", password }),
    ]);
    assert.deepEqual(attempts.map(a => a.status), ["fulfilled", "rejected"]);
    assert.equal(attempts[0].value.needsSetup, false);
    assert.equal(attempts[0].value.authenticated, true);
    assert.equal(attempts[0].value.username, "test creator");
    account.require();
    const bytes = await readFile(path.join(dir, "vault", "admin.enc"));
    assert.ok(!bytes.includes(password) && !bytes.includes("test creator"));
    const restarted = createAdminStore(file, vault);
    await assert.rejects(restarted.create({ username: "different", password }), /已有管理员/);
    assert.equal((await restarted.status()).authenticated, false);
    assert.equal((await restarted.login({username: "test creator", password})).authenticated, true);
  } finally { await rm(dir, {recursive:true, force:true}); }
});

test("public setup does not replace an unreadable existing record", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "manxu-setup-damaged-"));
  try {
    const file = path.join(dir, "admin.json");
    await writeFile(file, JSON.stringify({username: "damaged-record"}));
    const account = createAdminStore(file, { readOrMigrate: (_, read) => read() });
    await assert.rejects(account.create({username:"new-user",password:"test-password"}), /原记录已保留/);
    assert.throws(() => account.require(), /登录/);
    assert.equal(JSON.parse(await readFile(file, "utf8")).username, "damaged-record");
  } finally { await rm(dir, {recursive:true,force:true}); }
});
