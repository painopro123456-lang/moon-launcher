const { app, BrowserWindow, dialog, ipcMain, shell } = require("electron");
const AdmZip = require("adm-zip");
const crypto = require("node:crypto");
const fs = require("node:fs/promises");
const path = require("node:path");

const MANIFEST_URL = "https://launchermeta.mojang.com/mc/game/version_manifest_v2.json";
const MODRINTH_API = "https://api.modrinth.com/v2";
const MAX_MANIFEST_BYTES = 2 * 1024 * 1024;
let mainWindow;

function getStatePath() {
  return path.join(app.getPath("userData"), "moon-launcher.json");
}

function getInstancesPath() {
  return path.join(app.getPath("userData"), "instances");
}

function cleanName(value) {
  return String(value || "")
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, "")
    .trim()
    .slice(0, 80);
}

async function readInstances() {
  try {
    const raw = await fs.readFile(getStatePath(), "utf8");
    const data = JSON.parse(raw);
    return Array.isArray(data.instances) ? data.instances : [];
  } catch (error) {
    if (error.code !== "ENOENT") console.error("Could not read launcher state:", error);
    return [];
  }
}

async function writeInstances(instances) {
  const statePath = getStatePath();
  await fs.mkdir(path.dirname(statePath), { recursive: true });
  const temporaryPath = statePath + ".tmp";
  await fs.writeFile(temporaryPath, JSON.stringify({ schema: 1, instances }, null, 2), "utf8");
  await fs.rename(temporaryPath, statePath);
}

async function fetchVersions() {
  const response = await fetch(MANIFEST_URL, { headers: { "Accept": "application/json" } });
  if (!response.ok) throw new Error("Minecraft version catalog returned HTTP " + response.status);
  const manifest = await response.json();
  return {
    latest: manifest.latest,
    versions: manifest.versions.map((version) => ({
      id: version.id,
      type: version.type,
      releaseTime: version.releaseTime
    }))
  };
}

async function createInstance({ name, version, source = "vanilla", pack = null }) {
  const safeName = cleanName(name);
  const safeVersion = String(version || "").trim();
  if (!safeName) throw new Error("Enter a name for this instance.");
  if (!safeVersion) throw new Error("Choose a Minecraft version.");

  const instances = await readInstances();
  const instance = {
    id: crypto.randomUUID(),
    name: safeName,
    minecraftVersion: safeVersion,
    source,
    pack,
    createdAt: new Date().toISOString(),
    installState: "not-installed"
  };

  const instanceDirectory = path.join(getInstancesPath(), instance.id);
  await fs.mkdir(instanceDirectory, { recursive: true });
  instances.unshift(instance);
  await writeInstances(instances);
  return instance;
}

function readPackManifest(zipPath) {
  const zip = new AdmZip(zipPath);
  const mrpackEntry = zip.getEntry("modrinth.index.json");
  if (mrpackEntry) {
    if (mrpackEntry.header.size > MAX_MANIFEST_BYTES) throw new Error("The modpack manifest is too large.");
    const manifest = JSON.parse(mrpackEntry.getData().toString("utf8"));
    if (manifest.formatVersion !== 1 || !manifest.dependencies?.minecraft) {
      throw new Error("This .mrpack manifest is not supported.");
    }
    const loaders = Object.entries(manifest.dependencies)
      .filter(([key]) => key !== "minecraft")
      .map(([key, value]) => key + " " + value);
    return {
      source: "modrinth",
      name: cleanName(manifest.name) || "Imported Modrinth pack",
      version: String(manifest.dependencies.minecraft),
      loader: loaders.join(", ") || "Vanilla",
      files: Array.isArray(manifest.files) ? manifest.files.length : 0
    };
  }

  const curseEntry = zip.getEntry("manifest.json");
  if (curseEntry) {
    if (curseEntry.header.size > MAX_MANIFEST_BYTES) throw new Error("The modpack manifest is too large.");
    const manifest = JSON.parse(curseEntry.getData().toString("utf8"));
    if (!manifest.minecraft?.version) throw new Error("This CurseForge manifest has no Minecraft version.");
    const loaders = (manifest.minecraft.modLoaders || []).map((loader) => loader.id);
    return {
      source: "curseforge",
      name: cleanName(manifest.name) || "Imported CurseForge pack",
      version: String(manifest.minecraft.version),
      loader: loaders.join(", ") || "Vanilla",
      files: Array.isArray(manifest.files) ? manifest.files.length : 0
    };
  }

  throw new Error("This ZIP does not contain a Modrinth or CurseForge modpack manifest.");
}

async function importModpack() {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: "Import a modpack",
    properties: ["openFile"],
    filters: [{ name: "Minecraft modpacks", extensions: ["mrpack", "zip"] }]
  });
  if (result.canceled || !result.filePaths[0]) return null;

  const pack = readPackManifest(result.filePaths[0]);
  return createInstance({
    name: pack.name,
    version: pack.version,
    source: pack.source,
    pack
  });
}

async function searchModpacks(query) {
  const params = new URLSearchParams({
    query: String(query || "").slice(0, 100),
    facets: '[["project_type:modpack"]]',
    limit: "20",
    index: "downloads"
  });
  const response = await fetch(MODRINTH_API + "/search?" + params.toString(), {
    headers: {
      "Accept": "application/json",
      "User-Agent": "MoonLauncher/0.1.0 (github.com/painopro123456-lang/moon-launcher)"
    }
  });
  if (!response.ok) throw new Error("Modrinth search returned HTTP " + response.status);
  const data = await response.json();
  return (data.hits || []).map((project) => ({
    id: project.project_id,
    slug: project.slug,
    title: project.title,
    description: project.description,
    iconUrl: project.icon_url,
    downloads: project.downloads
  }));
}

function openProject(slug) {
  const safeSlug = String(slug || "");
  if (!/^[a-zA-Z0-9_-]+$/.test(safeSlug)) throw new Error("Invalid Modrinth project link.");
  return shell.openExternal("https://modrinth.com/modpack/" + encodeURIComponent(safeSlug));
}

ipcMain.handle("versions:list", fetchVersions);
ipcMain.handle("instances:list", readInstances);
ipcMain.handle("instances:create", (_event, input) => createInstance(input || {}));
ipcMain.handle("modpacks:import", importModpack);
ipcMain.handle("modpacks:search", (_event, query) => searchModpacks(query));
ipcMain.handle("modpacks:open", (_event, slug) => openProject(slug));
ipcMain.handle("launcher:open-data-folder", async () => {
  await fs.mkdir(getInstancesPath(), { recursive: true });
  return shell.openPath(getInstancesPath());
});

ipcMain.handle("window:minimize", () => {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.minimize();
});
ipcMain.handle("window:toggle-maximize", () => {
  if (!mainWindow || mainWindow.isDestroyed()) return false;
  if (mainWindow.isMaximized()) mainWindow.unmaximize();
  else mainWindow.maximize();
  return mainWindow.isMaximized();
});
ipcMain.handle("window:close", () => {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.close();
});

function createWindow() {
  mainWindow = new BrowserWindow({
    frame: false,
    roundedCorners: true,
    width: 1180,
    height: 780,
    minWidth: 860,
    minHeight: 620,
    backgroundColor: "#0e0d13",
    title: "Moon Launcher",
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });
  mainWindow.removeMenu();
  mainWindow.loadFile(path.join(__dirname, "index.html"));
}

app.whenReady().then(() => {
  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});