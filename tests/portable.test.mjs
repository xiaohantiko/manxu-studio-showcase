import test from "node:test";
import assert from "node:assert/strict";
import {
  decryptPortable,
  encryptPortable,
  MAX_PLAINTEXT_BYTES,
  MAX_PORTABLE_BYTES,
  parsePortableEnvelope,
} from "../src/portable.js";

const password = "十四个字符组成的演示密码-24";
const project = JSON.stringify({
  name: "虚构测试项目",
  content: "🐈\n特殊字元；故事内容",
});

test("portable exports hide project data, use fresh salt and IV, and round-trip", async () => {
  const [first, second] = await Promise.all([
    encryptPortable(project, password),
    encryptPortable(project, password),
  ]);
  const a = parsePortableEnvelope(first);
  const b = parsePortableEnvelope(second);
  assert.doesNotMatch(first, /虚构测试项目|故事内容/);
  assert.notEqual(a.salt, b.salt);
  assert.notEqual(a.iv, b.iv);
  assert.notEqual(a.ciphertext, b.ciphertext);
  assert.equal(await decryptPortable(first, password), project);
});

test("portable imports reject the wrong password and valid-looking tampering", async () => {
  const text = await encryptPortable(project, password);
  const encrypted = parsePortableEnvelope(text);
  const modified = {
    ...encrypted,
    ciphertext:
      (encrypted.ciphertext[0] === "A" ? "B" : "A") +
      encrypted.ciphertext.slice(1),
  };
  await Promise.all([
    assert.rejects(
      decryptPortable(text, "incorrect-file-password"),
      /密码不正确/,
    ),
    assert.rejects(
      decryptPortable(JSON.stringify(modified), password),
      /已被修改/,
    ),
    assert.rejects(
      decryptPortable(
        JSON.stringify({
          ...encrypted,
          salt: Buffer.alloc(16, 7).toString("base64"),
        }),
        password,
      ),
      /已被修改/,
    ),
  ]);
});

test("portable files reject unexpected fields, version, costs, and malformed parameters before deriving a key", () => {
  const envelope = {
    format: "manxu-encrypted-export",
    version: 1,
    kdf: "PBKDF2-SHA256",
    iterations: 600_000,
    cipher: "AES-256-GCM",
    salt: Buffer.alloc(16).toString("base64"),
    iv: Buffer.alloc(12).toString("base64"),
    ciphertext: Buffer.alloc(16).toString("base64"),
  };
  assert.deepEqual(parsePortableEnvelope(JSON.stringify(envelope)), envelope);
  for (const change of [
    { version: 2 },
    { iterations: 1 },
    { iterations: 10_000_000 },
    { kdf: "unknown" },
    { title: "plaintext" },
    { iv: "invalid!" },
    { salt: envelope.salt.replace(/A==$/, "B==") },
    { ciphertext: "AAAA====" },
    { ciphertext: "" },
  ])
    assert.throws(
      () => parsePortableEnvelope(JSON.stringify({ ...envelope, ...change })),
      /格式不正确/,
    );
  assert.throws(
    () => parsePortableEnvelope("a".repeat(MAX_PORTABLE_BYTES + 1)),
    /过大/,
  );
});

test("export enforces password and UTF-8 byte limits", async () => {
  await assert.rejects(encryptPortable(project, "too-short"), /文件密码/);
  await assert.rejects(
    encryptPortable(
      "长".repeat(Math.ceil(MAX_PLAINTEXT_BYTES / 3) + 1),
      password,
    ),
    /超过 25 MiB/,
  );
});
