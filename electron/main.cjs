// Local desktop runtime.
const { app, BrowserWindow, ipcMain, dialog, Menu } = require("electron");
const path = require("node:path");
const fs = require("node:fs/promises");
const { mkdirSync } = require("node:fs");
const userData = path.join(app.getPath("appData"), "Manxu Studio Public");
mkdirSync(userData, { recursive: true, mode: 0o700 });
app.setPath("userData", userData);
let win,
  quitting = false;
function handle(name, fn) {
  ipcMain.handle(name, async (event, ...args) => {
    if (
      event.sender !== win?.webContents ||
      event.senderFrame !== win.webContents.mainFrame
    )
      return { ok: false, error: "Invalid caller" };
    try {
      return { ok: true, data: await fn(...args) };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });
}
app.whenReady().then(async () => {
  handle("file:export", async ({ name, text }) => {
    if (typeof text !== "string" || text.length > 30000000)
      throw new Error("导出内容过大。");
    const result = await dialog.showSaveDialog(win, {
      defaultPath: String(name).replace(/[/\\]/g, "_"),
    });
    if (result.canceled) return { canceled: true };
    await fs.writeFile(result.filePath, text);
    return { saved: true };
  });
  win = new BrowserWindow({
    width: 1440,
    height: 940,
    minWidth: 1024,
    minHeight: 720,
    title: "漫序 Studio",
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
  if (process.env.STUDIO_SMOKE)
    setTimeout(async () => {
      console.log(
        "MANXU_SMOKE",
        await win.webContents.executeJavaScript(
          `JSON.stringify({title:document.title,heading:document.querySelector('h1')?.textContent,bridge:typeof window.studio?.exportFile})`,
        ),
      );
      app.quit();
    }, 1000);
});
app.on("before-quit", () => (quitting = true));
app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
app.on("activate", () => {
  if (win && !win.isDestroyed()) win.show();
});
