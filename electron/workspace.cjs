const fs = require("node:fs/promises");
const path = require("node:path");
const { randomUUID } = require("node:crypto");

async function optionalJson(file) {
  try {
    return JSON.parse(await fs.readFile(file, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw new Error("旧版配置无法读取；为避免数据丢失，未改动原文件。");
  }
}

function assertWorkspace(data) {
  if (
    !data ||
    !Array.isArray(data.projects) ||
    !data.projects.length ||
    !data.projects.every(
      (p) => p && typeof p.id === "string" && typeof p.name === "string",
    ) ||
    !data.workspaces ||
    typeof data.workspaces !== "object" ||
    Array.isArray(data.workspaces)
  )
    throw new Error("工作区格式无法读取；为避免丢失，未覆盖原数据。");
  for (const w of Object.values(data.workspaces)) {
    if (
      !w ||
      !Array.isArray(w.roles) ||
      !Array.isArray(w.shots) ||
      !Array.isArray(w.history)
    )
      throw new Error("工作区的项目资料不完整，未覆盖原数据。");
  }
  return data;
}

async function migrateBundledImages(data, legacyAssets) {
  if (!legacyAssets) return data;
  const images = new Map();
  for (const w of Object.values(data.workspaces)) {
    for (const entry of [...w.roles, ...w.shots]) {
      const name = entry?.image;
      if (
        typeof name !== "string" ||
        !/^(portrait|costume|expression|hallway|shot-[1-4])\.png$/.test(name)
      )
        continue;
      if (!images.has(name)) {
        const file = path.join(legacyAssets, name);
        let size;
        try {
          size = (await fs.stat(file)).size;
        } catch (error) {
          if (error.code !== "ENOENT") throw error;
        }
        if (!size || size > 4 * 1024 * 1024) continue;
        const content = await fs.readFile(file);
        if (
          !content
            .subarray(0, 8)
            .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
        )
          continue;
        images.set(name, "data:image/png;base64," + content.toString("base64"));
      }
      if (images.has(name)) entry.image = images.get(name);
    }
  }
  return data;
}

function createWorkspaceStore(vault, { legacyAssets } = {}) {
  return {
    async load(legacy) {
      const record = await vault.readOrMigrate("workspace", async () => {
        if (legacy == null) return null;
        if (
          typeof legacy !== "string" ||
          Buffer.byteLength(legacy) > 16 * 1024 * 1024
        )
          throw new Error("旧版工作区无法迁移，原始数据已保留。");
        let data;
        try {
          data = JSON.parse(legacy);
        } catch {
          throw new Error("旧版工作区无法读取，原始数据已保留。");
        }
        return migrateBundledImages(assertWorkspace(data), legacyAssets);
      });
      return record === null ? null : assertWorkspace(record);
    },
    save: (data) => vault.write("workspace", assertWorkspace(data)),
  };
}

function registerWorkspaceIpc(
  handle,
  { vault, dialog, getWindow, legacyAssets },
) {
  const workspace = createWorkspaceStore(vault, { legacyAssets });
  handle("workspace:load", (legacy) => workspace.load(legacy));
  handle("workspace:save", (data) => workspace.save(data));
  handle("file:export", async (encrypted) => {
    const { parsePortableEnvelope, PORTABLE_EXTENSION } =
      await import("../src/portable.js");
    const canonical = JSON.stringify(parsePortableEnvelope(encrypted));
    const extension = PORTABLE_EXTENSION.slice(1);
    const result = await dialog.showSaveDialog(getWindow(), {
      title: "保存加密文件",
      defaultPath: `漫序-加密文件-${randomUUID().slice(0, 8)}.${extension}`,
      filters: [{ name: "漫序加密文件", extensions: [extension] }],
    });
    if (result.canceled || !result.filePath) return { canceled: true };
    // Avoid overwriting an existing file with a partially written export.
    const destination = result.filePath
      .toLowerCase()
      .endsWith(PORTABLE_EXTENSION)
      ? result.filePath
      : result.filePath + PORTABLE_EXTENSION;
    const tmp = path.join(path.dirname(destination), `.${randomUUID()}.tmp`);
    try {
      const fd = await fs.open(tmp, "wx", 0o600);
      try {
        await fd.writeFile(canonical, "utf8");
        await fd.sync();
      } finally {
        await fd.close();
      }
      // When we append a missing extension the OS did not approve replacing
      // that other filename, so create it without overwriting.
      if (destination === result.filePath) await fs.rename(tmp, destination);
      else await fs.link(tmp, destination);
    } finally {
      await fs.rm(tmp, { force: true });
    }
    return { saved: true };
  });
}

module.exports = { optionalJson, createWorkspaceStore, registerWorkspaceIpc };
