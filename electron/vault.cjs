const crypto = require("node:crypto");
const fs = require("node:fs/promises");
const path = require("node:path");

const MAGIC = Buffer.from("MXVAULT1");
const KEY_CONTEXT = "manxu-studio-vault-key:v1:";
const KEY_FILE = "key.wrap";
const NONCE_BYTES = 12;
const TAG_BYTES = 16;
const HEADER_BYTES = MAGIC.length + NONCE_BYTES + TAG_BYTES;
const MAX_WRAPPED_KEY_BYTES = 64 * 1024;
const DEFAULT_RECORD_LIMIT = 128 * 1024 * 1024;
const decoder = new TextDecoder("utf-8", { fatal: true });

async function readFileLimited(file, maxBytes) {
  let handle;
  try {
    handle = await fs.open(file, "r");
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
  try {
    const info = await handle.stat();
    if (!info.isFile() || info.size > maxBytes)
      throw new Error("加密存储文件类型或大小无效。");
    const bytes = await handle.readFile();
    if (bytes.length > maxBytes) throw new Error("加密存储文件过大。");
    return bytes;
  } finally {
    await handle.close();
  }
}

async function syncDirectory(directory) {
  const handle = await fs.open(directory, "r");
  try {
    await handle.sync();
  } catch (error) {
    if (error.code !== "EINVAL" && error.code !== "ENOTSUP") throw error;
  } finally {
    await handle.close();
  }
}

// The temporary file always contains ciphertext. Sync it before publishing it.
async function atomicWrite(directory, name, bytes, createOnly = false) {
  const target = path.join(directory, name);
  const temporary = path.join(directory, `.${crypto.randomUUID()}.tmp`);
  const handle = await fs.open(temporary, "wx", 0o600);
  try {
    try {
      await handle.writeFile(bytes);
      await handle.sync();
    } finally {
      await handle.close();
    }
    if (createOnly) {
      // Key creation is exclusive so simultaneous launches cannot replace it.
      try {
        await fs.link(temporary, target);
      } catch (error) {
        if (error.code === "EEXIST") return false;
        throw error;
      }
    } else {
      await fs.rename(temporary, target);
    }
    await syncDirectory(directory);
    return true;
  } finally {
    await fs.rm(temporary, { force: true });
  }
}

function recordFile(name) {
  if (typeof name !== "string" || !/^[a-z][a-z0-9-]{0,47}$/.test(name))
    throw new Error("无效的加密记录名称。");
  return `${name}.enc`;
}

function recordAAD(name) {
  return Buffer.from(`manxu-studio-vault-record:v1:${name}`, "utf8");
}

function createVault({
  directory,
  safeStorage,
  maxRecordBytes = DEFAULT_RECORD_LIMIT,
}) {
  let queue = Promise.resolve();

  function run(fn) {
    const operation = queue.then(fn);
    queue = operation.catch(() => {});
    return operation;
  }

  async function requireKeychain() {
    let available;
    try {
      available = await safeStorage.isAsyncEncryptionAvailable();
    } catch {}
    if (!available)
      throw new Error("系统钥匙串暂不可用，无法读取或保存加密数据。");
  }

  async function wrapKey(key) {
    try {
      const result = await safeStorage.encryptStringAsync(
        KEY_CONTEXT + key.toString("base64"),
      );
      if (
        !Buffer.isBuffer(result) ||
        !result.length ||
        result.length > MAX_WRAPPED_KEY_BYTES
      )
        throw new TypeError("invalid wrapped key");
      return result;
    } catch {
      throw new Error("系统钥匙串无法保护加密存储密钥。");
    }
  }

  async function unwrapKey(wrapped) {
    let unwrapped;
    try {
      unwrapped = await safeStorage.decryptStringAsync(wrapped);
      if (
        typeof unwrapped.result !== "string" ||
        !unwrapped.result.startsWith(KEY_CONTEXT)
      )
        throw new TypeError("invalid key format");
      const encoded = unwrapped.result.slice(KEY_CONTEXT.length);
      const key = Buffer.from(encoded, "base64");
      if (key.length !== 32 || encoded !== key.toString("base64")) {
        key.fill(0);
        throw new TypeError("invalid key length");
      }
      if (unwrapped.shouldReEncrypt) {
        try {
          await atomicWrite(directory, KEY_FILE, await wrapKey(key));
        } catch (error) {
          key.fill(0);
          throw error;
        }
      }
      return key;
    } catch {
      throw new Error("无法解封本机加密密钥，请检查钥匙串或从加密备份恢复。");
    }
  }

  async function loadKey(create) {
    await requireKeychain();
    await fs.mkdir(directory, { recursive: true, mode: 0o700 });
    const wrapped = await readFileLimited(
      path.join(directory, KEY_FILE),
      MAX_WRAPPED_KEY_BYTES,
    );
    if (wrapped) return unwrapKey(wrapped);
    if ((await fs.readdir(directory)).some((name) => name.endsWith(".enc")))
      throw new Error("本机加密密钥缺失，现有加密数据未被修改。");
    if (!create) return null;
    const key = crypto.randomBytes(32);
    try {
      if (await atomicWrite(directory, KEY_FILE, await wrapKey(key), true))
        return key;
    } catch (error) {
      key.fill(0);
      throw error;
    }
    key.fill(0);
    const keyCreatedElsewhere = await readFileLimited(
      path.join(directory, KEY_FILE),
      MAX_WRAPPED_KEY_BYTES,
    );
    if (!keyCreatedElsewhere) throw new Error("无法读取本机加密密钥。");
    return unwrapKey(keyCreatedElsewhere);
  }

  async function readRecord(name, filename, key) {
    const bytes = await readFileLimited(
      path.join(directory, filename),
      maxRecordBytes + HEADER_BYTES,
    );
    if (!bytes) return null;
    if (!key) throw new Error("本机加密密钥缺失，现有加密数据未被修改。");
    let plaintext;
    try {
      if (
        bytes.length <= HEADER_BYTES ||
        !bytes.subarray(0, MAGIC.length).equals(MAGIC)
      )
        throw new Error("unexpected file format");
      const ivEnd = MAGIC.length + NONCE_BYTES;
      const decipher = crypto.createDecipheriv(
        "aes-256-gcm",
        key,
        bytes.subarray(MAGIC.length, ivEnd),
        { authTagLength: TAG_BYTES },
      );
      decipher.setAAD(recordAAD(name));
      decipher.setAuthTag(bytes.subarray(ivEnd, HEADER_BYTES));
      // Parse only after authentication succeeds. Clear the buffer on bad tags too.
      plaintext = decipher.update(bytes.subarray(HEADER_BYTES));
      decipher.final();
      const value = JSON.parse(decoder.decode(plaintext));
      if (value === null) throw new Error("invalid record");
      return value;
    } catch {
      throw new Error("加密记录无法通过完整性验证，原文件未被覆盖。");
    } finally {
      plaintext?.fill(0);
    }
  }

  async function writeRecord(name, filename, value, key) {
    if (value == null) throw new Error("无法保存空加密记录。");
    const json = JSON.stringify(value);
    if (
      typeof json !== "string" ||
      Buffer.byteLength(json, "utf8") > maxRecordBytes
    )
      throw new Error("加密记录过大或无法保存。");
    const plaintext = Buffer.from(json, "utf8");
    let blob;
    try {
      const nonce = crypto.randomBytes(NONCE_BYTES);
      const cipher = crypto.createCipheriv("aes-256-gcm", key, nonce, {
        authTagLength: TAG_BYTES,
      });
      cipher.setAAD(recordAAD(name));
      const ciphertext = cipher.update(plaintext);
      const tail = cipher.final();
      blob = Buffer.concat([
        MAGIC,
        nonce,
        cipher.getAuthTag(),
        ciphertext,
        tail,
      ]);
    } finally {
      plaintext.fill(0);
    }
    await atomicWrite(directory, filename, blob);
  }

  return {
    read: (name) =>
      run(async () => {
        const file = recordFile(name);
        const key = await loadKey(false);
        try {
          return await readRecord(name, file, key);
        } finally {
          key?.fill(0);
        }
      }),
    write: (name, value) =>
      run(async () => {
        const file = recordFile(name);
        const key = await loadKey(true);
        try {
          // Never replace an unreadable existing record with new data.
          await readRecord(name, file, key);
          await writeRecord(name, file, value, key);
        } finally {
          key.fill(0);
        }
      }),
    remove: (name) =>
      run(async () => {
        const file = recordFile(name);
        const key = await loadKey(false);
        try {
          if ((await readRecord(name, file, key)) !== null) {
            await fs.rm(path.join(directory, file));
            await syncDirectory(directory);
          }
        } finally {
          key?.fill(0);
        }
      }),
    // The callback may read legacy data but must not call these queued methods.
    // The caller can remove legacy data only after this Promise has resolved.
    readOrMigrate: (name, readLegacy) =>
      run(async () => {
        const file = recordFile(name);
        let key = await loadKey(false);
        try {
          const existing = await readRecord(name, file, key);
          if (existing !== null) return existing;
          const legacy = await readLegacy();
          if (legacy == null) return null;
          key ??= await loadKey(true);
          await writeRecord(name, file, legacy, key);
          return legacy;
        } finally {
          key?.fill(0);
        }
      }),
  };
}

module.exports = { createVault };
