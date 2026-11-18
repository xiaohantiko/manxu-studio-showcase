const crypto = require("node:crypto");
const fs = require("node:fs/promises");
const { optionalJson } = require("./workspace.cjs");
const { promisify } = require("node:util");
const scrypt = promisify(crypto.scrypt);

function checkRecord(value) {
  if (typeof value?.username !== "string" || !value.username.trim() ||
      typeof value.salt !== "string" || !/^[a-f0-9]{48}$/.test(value.salt) ||
      typeof value.hash !== "string" || !/^[a-f0-9]{128}$/.test(value.hash))
    throw new Error("管理员资料无法读取，原记录已保留。");
  return value;
}

function checkNewPassword(password) {
  if (typeof password !== "string" || password.length < 8 || password.length > 128)
    throw new Error("管理员密码应为 8–128 个字符。");
}

async function passwordRecord(username, password) {
  const salt = crypto.randomBytes(24).toString("hex");
  const hash = await scrypt(password, salt, 64);
  return { username, salt, hash: hash.toString("hex"), isDefault: false };
}

function createAdminStore(file, vault) {
  let authenticated = false;
  let record = null;
  let failed = 0;
  let lockedUntil = 0;
  let pending = Promise.resolve();

  function sequential(action) {
    return (...args) => {
      const result = pending.then(() => action(...args));
      pending = result.catch(() => {});
      return result;
    };
  }

  async function load(makeRecord) {
    if (record) return;
    const saved = await vault.readOrMigrate("admin", async () => {
      const old = await optionalJson(file);
      if (old !== null) return checkRecord(old);
      return makeRecord ? makeRecord() : null;
    });
    if (saved !== null) {
      const valid = checkRecord(saved);
      await fs.rm(file, { force: true });
      record = valid;
    }
  }

  function status() {
    return {
      needsSetup: !record,
      authenticated,
      username: record?.username || "",
      isDefault: record?.isDefault === true,
    };
  }

  async function matches(password) {
    if (!record || typeof password !== "string" || password.length > 256) return false;
    const candidate = await scrypt(password, record.salt, 64);
    return crypto.timingSafeEqual(candidate, Buffer.from(record.hash, "hex"));
  }

  function requireSession() {
    if (!authenticated) throw new Error("请先登录管理员后台。");
  }

  return {
    status: sequential(async () => { await load(); return status(); }),
    create: sequential(async ({ username, password } = {}) => {
      const name = typeof username === "string" ? username.trim() : "";
      if (!name || name.length > 64) throw new Error("管理员账号应为 1–64 个字符。");
      checkNewPassword(password);
      let created = false;
      await load(async () => {
        created = true;
        return passwordRecord(name, password);
      });
      if (!created) throw new Error("这台 Mac 已有管理员，请登录。");
      authenticated = true;
      return status();
    }),
    login: sequential(async ({ username, password } = {}) => {
      await load();
      if (!record) throw new Error("请先创建本机管理员。");
      if (Date.now() < lockedUntil) throw new Error("尝试次数较多，请 30 秒后重试。");
      const valid = await matches(password);
      if (username !== record.username || !valid) {
        if (++failed >= 5) {
          failed = 0;
          lockedUntil = Date.now() + 30000;
        }
        throw new Error("账号或密码不正确。");
      }
      failed = 0;
      authenticated = true;
      return status();
    }),
    logout: sequential(async () => {
      authenticated = false;
      return { authenticated: false };
    }),
    require: requireSession,
    changePassword: sequential(async ({ currentPassword, newPassword } = {}) => {
      requireSession();
      if (!(await matches(currentPassword))) throw new Error("当前密码不正确。");
      checkNewPassword(newPassword);
      const next = await passwordRecord(record.username, newPassword);
      await vault.write("admin", next);
      record = next;
      return { changed: true };
    }),
  };
}
module.exports = { createAdminStore };
