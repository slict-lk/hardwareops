import { app, BrowserWindow, dialog } from "electron";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import dotenv from "dotenv";
import { getDatabaseConfig } from "../database-config.js";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const userEnvPath = join(app.getPath("userData"), ".env");
const packagedEnvPath = join(process.resourcesPath, ".env");
const databaseEnvKeys = new Set([
  "DATABASE_TARGET",
  "DATABASE_URL_LOCAL",
  "DATABASE_URL_AIVEN",
  "DATABASE_URL",
  "PGSSLMODE"
]);

if (app.isPackaged && existsSync(packagedEnvPath)) {
  const inheritedKeys = new Set(Object.keys(process.env));
  const packagedValues = dotenv.parse(readFileSync(packagedEnvPath));
  const userValues = existsSync(userEnvPath)
    ? dotenv.parse(readFileSync(userEnvPath))
    : {};

  for (const [key, value] of Object.entries(packagedValues)) {
    if (!inheritedKeys.has(key)) process.env[key] = value;
  }
  for (const [key, value] of Object.entries(userValues)) {
    if (!databaseEnvKeys.has(key) && !inheritedKeys.has(key)) {
      process.env[key] = value;
    }
  }
  for (const key of databaseEnvKeys) {
    if (Object.hasOwn(packagedValues, key)) process.env[key] = packagedValues[key];
  }
} else {
  const envPath = existsSync(userEnvPath)
    ? userEnvPath
    : app.isPackaged
      ? packagedEnvPath
      : join(projectRoot, ".env");
  dotenv.config({ path: envPath });
}

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
