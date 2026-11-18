const fs = require("node:fs/promises");
const { optionalJson } = require("../electron/workspace.cjs");

// Migrate the former whole metadata record, retaining the already OS-protected
// key until the new vault record is durable. There is no plaintext fallback.
async function migrateConnection(vault, file, safeStorage) {
  const config = await vault.readOrMigrate("connection", async () => {
    const legacy = await optionalJson(file);
    if (legacy === null) return null;
    if (typeof legacy.encryptedKey !== "string" || !legacy.encryptedKey)
      throw new Error("旧版模型配置无法迁移；原文件已保留。");
    const { result: apiKey } = await safeStorage.decryptStringAsync(
      Buffer.from(legacy.encryptedKey, "base64"),
    );
    if (typeof apiKey !== "string" || !apiKey) throw new Error("无法解锁旧版模型密钥。");
    return { baseURL: legacy.baseURL, provider: legacy.provider, model: legacy.model, apiKey };
  });
  if (config !== null) await fs.rm(file, { force: true });
  return config || {};
}

module.exports = { migrateConnection };
