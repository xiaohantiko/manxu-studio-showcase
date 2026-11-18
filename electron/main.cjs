const {
  app,
  BrowserWindow,
  ipcMain,
  dialog,
  safeStorage,
  Menu,
} = require("electron");
const path = require("node:path");
const fs = require("node:fs/promises");
const { createVault } = require("./vault.cjs");
const { registerWorkspaceIpc } = require("./workspace.cjs");
const { migrateConnection } = require("../services/connection.cjs");
const tencent = require("../services/cloud-client.cjs");
const { backupConfig, provisionBackup } = require("../services/backup-config.cjs");
const { createAdminStore } = require("./admin.cjs");
const { mkdirSync } = require("node:fs");
const userData = app.commandLine.getSwitchValue("user-data-dir") ||
  path.join(app.getPath("appData"), "Manxu Studio Public");
mkdirSync(userData, { recursive: true, mode: 0o700 });
app.setPath("userData", userData);
let admin;
let win;
let quitting = false;
let config;
let vault;
let configLoad;
let backup = {};
async function loadBackup() {
  const modelConnection = await loadConfig();
  backup = (await vault.readOrMigrate("cloud-backup", async () =>
    modelConnection.provider === "tencent" && !modelConnection.separateBackup
      ? backupConfig({baseURL:modelConnection.baseURL, token:modelConnection.apiKey}) : null
  )) || {};
  return backup;
}
const pending = new Set();
let draining = false;
const api = require("../services/api.cjs");
const configPath = () => path.join(app.getPath("userData"), "connection.json");
async function loadConfig() {
  if (config) return config;
  if (!configLoad)
    configLoad = migrateConnection(vault, configPath(), safeStorage)
      .then((value) => (config = value))
      .finally(() => {
        configLoad = undefined;
      });
  return configLoad;
}
function publicSettings() {
  let authorized = false;
  try {
    admin.require();
    authorized = true;
  } catch {}
  return {
    baseURL: authorized ? config.baseURL || "" : "",
    model: authorized ? config.model || "" : "",
    provider: authorized ? config.provider || (config.apiKey ? "custom" : "openai") : "custom",
    openAIPreset: authorized ? api.openAIPreset : undefined,
    cloudModel: authorized ? tencent.model : undefined,
    cloudBackups: !!backup.apiKey,
    backupURL: authorized ? backup.baseURL || "" : "",
    hasKey: !!config.apiKey,
    apiAvailable: true,
  };
}
function handle(name, fn) {
  ipcMain.handle(name, async (event, ...args) => {
    if (
      event.sender !== win?.webContents ||
      event.senderFrame !== win.webContents.mainFrame
    )
      return { ok: false, error: "无效的调用来源。" };
    const operation = Promise.resolve().then(() => fn(...args));
    if (
      name === "workspace:save" ||
      name === "workspace:load" ||
      name.startsWith("settings:") ||
      name.startsWith("admin:")
    )
      pending.add(operation);
    try {
      return { ok: true, data: await operation };
    } catch (e) {
      return { ok: false, error: e.message };
    } finally {
      pending.delete(operation);
    }
  });
}
const provisioning = app.commandLine.hasSwitch("provision-cloud-backup");
if (!app.requestSingleInstanceLock()) {
  if (provisioning) process.stderr.write("请先退出正在运行的漫序 Studio。\n");
  app.exit(provisioning ? 2 : 0);
}
app.on("second-instance", () => {
  if (win && !win.isDestroyed()) {
    win.show();
    win.focus();
  }
});
app.whenReady().then(async () => {
  vault = createVault({
    directory: path.join(app.getPath("userData"), "vault"),
    safeStorage: process.platform === "darwin" ? safeStorage : null,
  });
  if (provisioning) {
    try {
      await provisionBackup(vault, app.getPath("userData"));
      process.stdout.write("BACKUP_PROVISIONED\n");
      app.exit(0);
    } catch {
      process.stderr.write("备份预置失败，请核对文件权限、服务连通性以及当前绑定。\n");
      app.exit(1);
    }
    return;
  }
  admin = createAdminStore(
    path.join(app.getPath("userData"), "admin.json"),
    vault,
  );
  registerWorkspaceIpc(handle, {
    vault,
    dialog,
    getWindow: () => win,
  });
  // Upgrade old account and connection records even if the user never opens Settings.
  if (process.platform === "darwin") {
    admin.status().catch(() => {});
    loadConfig().catch(() => {});
  }
  handle("admin:status", () => admin.status());
  handle("admin:create", (data) => admin.create(data));
  handle("admin:login", async (data) => admin.login(data));
  handle("admin:logout", () => admin.logout());
  handle("admin:password", async (data) => admin.changePassword(data));
  handle("settings:get", async () => {
    await loadBackup();
    return publicSettings();
  });
  handle("settings:backup-save", async (data) => {
    admin.require();
    const next = backupConfig(data, await loadBackup());
    await vault.write("cloud-backup",next);
    backup = next;
    return publicSettings();
  });
  handle("settings:backup-test", async () => {
    admin.require();
    await tencent.connect(await loadBackup()).list();
    return {message:"已验证加密备份服务"};
  });
  handle("settings:backup-remove", async () => {
    admin.require();
    await loadConfig();
    await vault.write("cloud-backup",{});
    backup = {};
    return publicSettings();
  });
  handle("settings:save", async (data) => {
    admin.require();
    await loadConfig();
    const cloud = data.provider === "tencent";
    const address = cloud ? tencent.baseURL(data.baseURL) : data.baseURL;
    if (!cloud) api.endpoint(address, data.provider);
    if (config.apiKey && !data.apiKey && (
      (config.provider === "tencent") !== cloud ||
      (cloud && tencent.baseURL(config.baseURL) !== address)
    )) throw new Error("连接用途或云服务地址已改变，请重新填写对应凭据。");
    if (
      config.apiKey &&
      !data.apiKey &&
      config.baseURL &&
      new URL(config.baseURL).origin !== new URL(data.baseURL).origin
    )
      throw new Error("服务商地址已改变，请重新填写对应的 API Key。");
    if (!cloud && (
      typeof data.model !== "string" ||
      !data.model.trim() ||
      data.model.length > 200
    ))
      throw new Error("请填写服务商提供的模型 ID。");
    if (
      data.apiKey &&
      (typeof data.apiKey !== "string" || data.apiKey.length > 5000)
    )
      throw new Error("API Key 格式错误。");
    const apiKey = data.apiKey?.trim() || config.apiKey;
    if (!apiKey) throw new Error("请填写 API Key。");
    if (data.apiKey && !data.apiKey.trim()) throw new Error("API Key 不能为空格。");
    if (cloud && !/^[A-Za-z0-9_=-]{32,256}$/.test(apiKey))
      throw new Error("请填写服务器配置的 32 至 256 个字符的云服务令牌。");
    const next = {
      provider: String(data.provider || "custom").slice(0, 50),
      baseURL: address,
      model: cloud ? tencent.model : data.model.trim(),
      ...(cloud ? {separateBackup:true} : {}),
      apiKey,
    };
    await vault.write("connection", next);
    config = next;
    return publicSettings();
  });
  handle("settings:disconnect", async () => {
    admin.require();
    await loadConfig();
    await fs.rm(configPath(), { force: true });
    await vault.remove("connection");
    config = {};
    return publicSettings();
  });
  handle("ai:generate", async (data) => {
    const saved = await loadConfig();
    return saved.provider === "tencent" ? tencent.connect(saved).generate(data) : api.request(saved, data);
  });
  handle("ai:test", async () => {
    admin.require();
    const saved = await loadConfig();
    return saved.provider === "tencent" ? tencent.connect(saved).test() : api.testConnection(saved);
  });
  handle("backup:upload", async (ciphertext) => tencent.connect(await loadBackup()).upload(ciphertext));
  handle("backup:list", async () => tencent.connect(await loadBackup()).list());
  handle("backup:download", async (id) => tencent.connect(await loadBackup()).download(id));
  win = new BrowserWindow({
    width: 1440,
    height: 940,
    minWidth: 1024,
    minHeight: 720,
    title: "漫序 Studio 公开版",
    backgroundColor: "#f6f6f3",
    titleBarStyle: "hidden",
    trafficLightPosition: { x: 20, y: 18 },
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  win.on("close", (event) => {
    if (process.platform === "darwin" && !quitting) {
      event.preventDefault();
      win.hide();
    }
  });
  win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  win.webContents.on("will-navigate", (event) => event.preventDefault());
  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      {
        label: app.name,
        submenu: [
          { role: "about" },
          { type: "separator" },
          { role: "hide" },
          { role: "hideOthers" },
          { type: "separator" },
          { role: "quit" },
        ],
      },
      {
        label: "编辑",
        submenu: [
          { role: "undo" },
          { role: "redo" },
          { type: "separator" },
          { role: "cut" },
          { role: "copy" },
          { role: "paste" },
          { role: "selectAll" },
        ],
      },
      {
        label: "视图",
        submenu: [
          { role: "reload" },
          { role: "togglefullscreen" },
          { role: "resetZoom" },
          { role: "zoomIn" },
          { role: "zoomOut" },
        ],
      },
      {
        label: "窗口",
        submenu: [{ role: "minimize" }, { role: "zoom" }, { role: "front" }],
      },
    ]),
  );
  await win.loadFile(path.join(__dirname, "../dist/index.html"), {
    hash: app.commandLine.hasSwitch("model-settings") ? "settings" : "",
  });
  if (process.env.STUDIO_SMOKE) {
    for (let attempt = 0; attempt < 100; attempt++) {
      const ready = await win.webContents.executeJavaScript(
        'Boolean(document.querySelector(".sidebar") && ["adminCreate","saveSettings","generate","saveWorkspace","uploadBackup","downloadBackup"].every(name => typeof window.studio?.[name] === "function"))'
      );
      if (ready) {
        const { parsePortableEnvelope } = await import("../src/portable.js");
        if (typeof parsePortableEnvelope !== "function") break;
        console.log("MANXU_SMOKE");
        app.quit();
        return;
      }
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    console.error("公开版创作工作区启动失败。");
    app.exit(1);
  }
});
app.on("before-quit", (event) => {
  if (pending.size) {
    event.preventDefault();
    if (!draining) {
      draining = true;
      Promise.allSettled([...pending]).then(() => {
        draining = false;
        app.quit();
      });
    }
    return;
  }
  quitting = true;
});
app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
app.on("activate", () => {
  if (win && !win.isDestroyed()) win.show();
});
