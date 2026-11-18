// Local desktop runtime.
const { app, BrowserWindow, ipcMain, dialog, Menu, safeStorage } = require("electron");
const path = require("node:path");
const { createVault } = require("./vault.cjs");
const { registerWorkspaceIpc } = require("./workspace.cjs");
const { mkdirSync } = require("node:fs");
const userData = app.commandLine.getSwitchValue("user-data-dir") || path.join(app.getPath("appData"), "Manxu Studio Public");
mkdirSync(userData, { recursive: true, mode: 0o700 });
app.setPath("userData", userData);
const pending = new Set();
let draining = false;
let win,
  quitting = false;
function handle(name, fn) {
  ipcMain.handle(name, async (event, ...args) => {
    if (
      event.sender !== win?.webContents ||
      event.senderFrame !== win.webContents.mainFrame
    )
      return { ok: false, error: "Invalid caller" };
    const operation = Promise.resolve().then(() => fn(...args));
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
if (!app.requestSingleInstanceLock()) app.exit(0);
app.on("second-instance", () => {
  if (win && !win.isDestroyed()) { win.show(); win.focus(); }
});
app.whenReady().then(async () => {
  const vault = createVault({
    directory: path.join(userData, "vault"),
    safeStorage: process.platform === "darwin" ? safeStorage : null,
  });
  registerWorkspaceIpc(handle, { vault, dialog, getWindow: () => win });
  win = new BrowserWindow({
    width: 1440,
    height: 940,
    minWidth: 1024,
    minHeight: 720,
    title: "漫序 Studio 公开版",
    backgroundColor: "#f7f7f4",
    titleBarStyle: "hidden",
    trafficLightPosition: { x: 20, y: 18 },
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  win.webContents.on("will-navigate", (e) => e.preventDefault());
  win.on("close", (e) => {
    if (process.platform === "darwin" && !quitting) {
      e.preventDefault();
      win.hide();
    }
  });
  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      {
        label: "漫序 Studio",
        submenu: [{ role: "about" }, { role: "hide" }, { role: "quit" }],
      },
      {
        label: "编辑",
        submenu: [
          { role: "undo" },
          { role: "redo" },
          { role: "cut" },
          { role: "copy" },
          { role: "paste" },
          { role: "selectAll" },
        ],
      },
    ]),
  );
  await win.loadFile(path.join(__dirname, "../dist/index.html"));
  if (process.env.STUDIO_SMOKE) {
    for (let index = 0; index < 100; index++) {
      const ready = await win.webContents.executeJavaScript(
        'Boolean(document.querySelector(".sidebar") && window.studio?.saveWorkspace && !window.studio?.generate)'
      );
      if (ready) {
        console.log("MANXU_SMOKE");
        app.quit();
        return;
      }
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    console.error("Public workspace did not start.");
    app.exit(1);
  }
});
app.on("before-quit", (event) => {
  if (pending.size) {
    event.preventDefault();
    if (!draining) {
      draining = true;
      Promise.allSettled([...pending]).then(() => { draining = false; app.quit(); });
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
