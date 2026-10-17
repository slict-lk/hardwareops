import { app, BrowserWindow, dialog } from "electron";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import dotenv from "dotenv";
import { getDatabaseConfig } from "../database-config.js";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const userEnvPath = join(app.getPath("userData"), ".env");
const envPath = existsSync(userEnvPath)
  ? userEnvPath
  : app.isPackaged
    ? join(process.resourcesPath, ".env")
    : join(projectRoot, ".env");
dotenv.config({ path: envPath });

let stopServer;
let apiServer;
let isShuttingDown = false;

async function createWindow(apiUrl) {
  const window = new BrowserWindow({
    width: 1440,
    height: 960,
    minWidth: 900,
    minHeight: 650,
    webPreferences: {
      preload: join(projectRoot, "electron", "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      additionalArguments: [`--hardwareops-api=${apiUrl}`]
    }
  });

  const appUrl = pathToFileURL(join(projectRoot, "index.html")).href;
  window.webContents.on("will-navigate", (event, url) => {
    if (url !== appUrl) event.preventDefault();
  });
  window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  await window.loadFile(join(projectRoot, "index.html"));
}

app.whenReady().then(async () => {
  try {
    getDatabaseConfig();

    const serverModule = await import("../server.js");
    stopServer = serverModule.stopServer;
    apiServer = await serverModule.startServer(0, "127.0.0.1");
    const address = apiServer.address();
    if (!address || typeof address === "string") {
      throw new Error("The local HardwareOps API did not provide a valid network address.");
    }
    await createWindow(`http://127.0.0.1:${address.port}`);
  } catch (error) {
    console.error("Failed to start HardwareOps desktop app:", error);
    await dialog.showMessageBox({
      type: "error",
      title: "HardwareOps could not start",
      message: "HardwareOps could not start.",
      detail: error instanceof Error ? error.message : String(error)
    });
    if (stopServer) await stopServer();
    app.quit();
  }
});

app.on("before-quit", event => {
  if (!stopServer || isShuttingDown) return;
  event.preventDefault();
  isShuttingDown = true;
  stopServer()
    .catch(error => console.error("Failed to stop HardwareOps API:", error))
    .finally(() => app.quit());
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0 && apiServer) {
    const address = apiServer.address();
    if (address && typeof address !== "string") {
      createWindow(`http://127.0.0.1:${address.port}`).catch(error => {
        console.error("Failed to reopen HardwareOps window:", error);
        dialog.showErrorBox("HardwareOps could not open", error.message);
      });
    }
  }
});
