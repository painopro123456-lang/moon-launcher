const { app, BrowserWindow, dialog, ipcMain, shell } = require("electron");
const AdmZip = require("adm-zip");
const crypto = require("node:crypto");
const fs = require("node:fs/promises");
const path = require("node:path");

const MANIFEST_URL = "https://launchermeta.mojang.com/mc/game/version_manifest_v2.json";
const MODRINTH_API = "https://api.modrinth.com/v2";
const MAX_MANIFEST_BYTES = 2 * 1024 * 1024;
const MAX_PACK_ARCHIVE_BYTES = 256 * 1024 * 1024;
const MAX_PACK_FILE_BYTES = 256 * 1024 * 1024;
const MAX_PACK_TOTAL_BYTES = 2 * 1024 * 1024 * 1024;
const MAX_OVERRIDE_TOTAL_BYTES = 512 * 1024 * 1024;
const MAX_PACK_FILES = 4000;
const MODRINTH_USER_AGENT = "MoonLauncher/0.1.0 (https://github.com/painopro123456-lang/moon-launcher)";
const MODRINTH_DOWNLOAD_HOSTS = new Set([
  "cdn.modrinth.com",
  "github.com",
  "raw.githubusercontent.com",
  "gitlab.com",
  "objects.githubusercontent.com",
  "release-assets.githubusercontent.com",
  "github-releases.githubusercontent.com",
  "storage.googleapis.com"
]);
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


function reportModpackProgress(projectId, message, completed = 0, total = 0) {
  if (!projectId || !mainWindow || mainWindow.isDestroyed()) return;
  mainWindow.webContents.send("modpacks:progress", { projectId, message, completed, total });
}

async function fetchModrinthJson(url) {
  const response = await fetch(url, {
    headers: { "Accept": "application/json", "User-Agent": MODRINTH_USER_AGENT },
    signal: AbortSignal.timeout(30000)
  });
  if (response.status === 429) throw new Error("Modrinth is receiving too many requests. Please wait a moment and try again.");
  if (!response.ok) throw new Error("Modrinth request failed (HTTP " + response.status + ").");
  return response.json();
}

function validateModrinthDownloadUrl(value) {
  let url;
  try { url = new URL(value); }
  catch { throw new Error("A modpack contains an invalid download link."); }

  const host = url.hostname.toLowerCase();
  const trustedHost = MODRINTH_DOWNLOAD_HOSTS.has(host)
    || host.endsWith(".githubusercontent.com")
    || host.endsWith(".gitlab.com");
  if (url.protocol !== "https:" || !trustedHost || url.username || url.password || (url.port && url.port !== "443")) {
    throw new Error("A modpack contains a download link from an unsupported host.");
  }
  return url;
}

async function readLimitedResponse(response, maxBytes) {
  const declaredLength = Number(response.headers.get("content-length") || 0);
  if (declaredLength > maxBytes) throw new Error("A modpack file is larger than Moon Launcher allows.");

  if (!response.body) {
    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.length > maxBytes) throw new Error("A modpack file is larger than Moon Launcher allows.");
    return bytes;
  }

  const reader = response.body.getReader();
  const chunks = [];
  let received = 0;
  try {
    while (true) {
      const result = await reader.read();
      if (result.done) break;
      received += result.value.byteLength;
      if (received > maxBytes) {
        await reader.cancel();
        throw new Error("A modpack file is larger than Moon Launcher allows.");
      }
      chunks.push(Buffer.from(result.value));
    }
  } catch (error) {
    await reader.cancel().catch(() => {});
    throw error;
  }
  return Buffer.concat(chunks, received);
}

async function downloadTrustedModrinthFile(value, maxBytes) {
  let url = validateModrinthDownloadUrl(value);
  for (let redirects = 0; redirects <= 3; redirects++) {
    const response = await fetch(url, {
      headers: { "Accept": "*/*", "User-Agent": MODRINTH_USER_AGENT },
      redirect: "manual",
      signal: AbortSignal.timeout(120000)
    });
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      if (redirects === 3) throw new Error("A modpack download redirected too many times.");
      const location = response.headers.get("location");
      if (!location) throw new Error("A modpack download has an invalid redirect.");
      await response.body?.cancel().catch(() => {});
      url = validateModrinthDownloadUrl(new URL(location, url).href);
      continue;
    }
    if (!response.ok) throw new Error("A modpack file could not be downloaded (HTTP " + response.status + ").");
    return readLimitedResponse(response, maxBytes);
  }
  throw new Error("A modpack file could not be downloaded.");
}

function safeInstanceRelativePath(value) {
  if (typeof value !== "string" || !value || value.includes("\0")) {
    throw new Error("A modpack contains an invalid file path.");
  }
  const normalized = value.replace(/\\/g, "/");
  if (normalized.startsWith("/") || /^[a-z]:/i.test(normalized)) {
    throw new Error("A modpack contains a file path outside its instance.");
  }
  const segments = normalized.split("/");
  const reserved = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/i;
  if (segments.some((segment) =>
    !segment
    || segment === "."
    || segment === ".."
    || /[<>:"|?*\x00-\x1f]/.test(segment)
    || /[. ]$/.test(segment)
    || reserved.test(segment)
  )) {
    throw new Error("A modpack contains an unsafe file path.");
  }
  return segments.join("/");
}

function resolveInstanceFile(instanceDirectory, relativePath) {
  const safePath = safeInstanceRelativePath(relativePath);
  const destination = path.resolve(instanceDirectory, ...safePath.split("/"));
  const relative = path.relative(instanceDirectory, destination);
  if (!relative || relative.startsWith(".." + path.sep) || relative === ".." || path.isAbsolute(relative)) {
    throw new Error("A modpack contains a file path outside its instance.");
  }
  return destination;
}

function verifyModrinthHashes(bytes, hashes, label, requireBoth = false) {
  const algorithms = ["sha1", "sha512"];
  let checked = 0;
  for (const algorithm of algorithms) {
    const expected = String(hashes?.[algorithm] || "").toLowerCase();
    if (!expected) {
      if (requireBoth) throw new Error("A modpack is missing a required " + algorithm.toUpperCase() + " checksum.");
      continue;
    }
    const expectedLength = algorithm === "sha1" ? 40 : 128;
    if (!new RegExp("^[a-f0-9]{" + expectedLength + "}$").test(expected)) {
      throw new Error("A modpack contains an invalid checksum.");
    }
    const actual = crypto.createHash(algorithm).update(bytes).digest("hex");
    if (actual !== expected) throw new Error("Checksum verification failed for " + label + ".");
    checked++;
  }
  if (!checked) throw new Error("A modpack file has no checksum to verify.");
}

function parseMrpackArchive(archiveBytes) {
  if (!Buffer.isBuffer(archiveBytes) || archiveBytes.length > MAX_PACK_ARCHIVE_BYTES) {
    throw new Error("This modpack archive is too large.");
  }
  let zip;
  try { zip = new AdmZip(archiveBytes); }
  catch { throw new Error("This modpack file is not a valid ZIP archive."); }

  const indexEntry = zip.getEntry("modrinth.index.json");
  if (!indexEntry) throw new Error("This file does not contain a Modrinth modpack manifest.");
  if (indexEntry.header.size > MAX_MANIFEST_BYTES) throw new Error("The modpack manifest is too large.");

  let manifest;
  try { manifest = JSON.parse(indexEntry.getData().toString("utf8")); }
  catch { throw new Error("The Modrinth modpack manifest could not be read."); }

  if (manifest.formatVersion !== 1 || manifest.game !== "minecraft" || !manifest.dependencies?.minecraft) {
    throw new Error("This Modrinth modpack format is not supported.");
  }
  if (!Array.isArray(manifest.files) || manifest.files.length > MAX_PACK_FILES) {
    throw new Error("This modpack contains too many files or has an invalid file list.");
  }

  const loaders = Object.entries(manifest.dependencies)
    .filter(([key, value]) => key !== "minecraft" && typeof value === "string" && value)
    .map(([key, value]) => key + " " + value);

  return {
    zip,
    manifest,
    pack: {
      source: "modrinth",
      name: cleanName(manifest.name) || "Modrinth modpack",
      version: String(manifest.dependencies.minecraft),
      loader: loaders.join(", ") || "Vanilla",
      files: manifest.files.length,
      versionId: String(manifest.versionId || "")
    }
  };
}

async function applyMrpackOverrides(zip, prefix, instanceDirectory, totals, projectId) {
  let copied = 0;
  for (const entry of zip.getEntries()) {
    const entryName = String(entry.entryName || "").replace(/\\/g, "/");
    if (!entryName.startsWith(prefix) || entry.isDirectory) continue;

    const relativePath = entryName.slice(prefix.length);
    const destination = resolveInstanceFile(instanceDirectory, relativePath);
    const declaredSize = Number(entry.header?.size || 0);
    if (declaredSize > MAX_PACK_FILE_BYTES) throw new Error("A bundled pack file is too large.");
    totals.bytes += declaredSize;
    if (totals.bytes > MAX_OVERRIDE_TOTAL_BYTES) throw new Error("The modpack's bundled settings are too large.");

    const bytes = entry.getData();
    if (bytes.length > MAX_PACK_FILE_BYTES || totals.bytes - declaredSize + bytes.length > MAX_OVERRIDE_TOTAL_BYTES) {
      throw new Error("The modpack's bundled settings are too large.");
    }
    totals.bytes = totals.bytes - declaredSize + bytes.length;
    await fs.mkdir(path.dirname(destination), { recursive: true });
    await fs.writeFile(destination, bytes);
    copied++;
    if (copied % 25 === 0) reportModpackProgress(projectId, "Applying pack settings…", copied, 0);
  }
  return copied;
}

async function installMrpackArchive(archiveBytes, metadata = {}) {
  const { zip, manifest, pack } = parseMrpackArchive(archiveBytes);
  const projectId = String(metadata.projectId || "");
  const progressId = projectId || "local-import";
  const instanceId = crypto.randomUUID();
  const instanceName = cleanName(pack.name || metadata.projectName) || "Modrinth modpack";
  const instancesDirectory = getInstancesPath();
  const stagingDirectory = path.join(instancesDirectory, "." + instanceId + ".installing");
  const instanceDirectory = path.join(instancesDirectory, instanceId);

  const installableFiles = [];
  const uniquePaths = new Set();
  let declaredTotalBytes = 0;
  for (const file of manifest.files) {
    const relativePath = safeInstanceRelativePath(file?.path);
    const pathKey = relativePath.toLowerCase();
    if (uniquePaths.has(pathKey)) throw new Error("The modpack lists the same file path more than once.");
    uniquePaths.add(pathKey);

    if (file?.env?.client === "unsupported") continue;
    if (!Array.isArray(file?.downloads) || file.downloads.length === 0) {
      throw new Error("A modpack file has no download link: " + relativePath);
    }
    if (!file.hashes || !file.hashes.sha1 || !file.hashes.sha512) {
      throw new Error("A modpack file is missing its required checksums: " + relativePath);
    }
    if (file.fileSize !== undefined) {
      const size = Number(file.fileSize);
      if (!Number.isSafeInteger(size) || size < 0 || size > MAX_PACK_FILE_BYTES) {
        throw new Error("A modpack file has an invalid or unsupported size: " + relativePath);
      }
      declaredTotalBytes += size;
      if (declaredTotalBytes > MAX_PACK_TOTAL_BYTES) throw new Error("This modpack is larger than Moon Launcher allows.");
    }
    installableFiles.push({ file, relativePath });
  }

  await fs.mkdir(stagingDirectory, { recursive: true });
  let installedFiles = 0;
  let downloadedBytes = 0;
  let overrideFiles = 0;
  try {
    for (let index = 0; index < installableFiles.length; index++) {
      const { file, relativePath } = installableFiles[index];
      const destination = resolveInstanceFile(stagingDirectory, relativePath);
      let bytes;
      let lastError;
      for (const downloadUrl of file.downloads) {
        try {
          bytes = await downloadTrustedModrinthFile(downloadUrl, MAX_PACK_FILE_BYTES);
          break;
        } catch (error) {
          lastError = error;
        }
      }
      if (!bytes) {
        throw new Error("Could not download " + relativePath + (lastError?.message ? ": " + lastError.message : "."));
      }
      if (file.fileSize !== undefined && bytes.length !== Number(file.fileSize)) {
        throw new Error("The downloaded file size did not match the modpack manifest: " + relativePath);
      }
      verifyModrinthHashes(bytes, file.hashes, relativePath, true);
      downloadedBytes += bytes.length;
      if (downloadedBytes > MAX_PACK_TOTAL_BYTES) throw new Error("This modpack is larger than Moon Launcher allows.");

      await fs.mkdir(path.dirname(destination), { recursive: true });
      await fs.writeFile(destination, bytes, { flag: "wx" });
      installedFiles++;
      reportModpackProgress(progressId, "Downloading files (" + installedFiles + "/" + installableFiles.length + ")…", installedFiles, installableFiles.length);
    }

    reportModpackProgress(progressId, "Applying pack settings…", installedFiles, installableFiles.length);
    const overrideTotals = { bytes: 0 };
    overrideFiles += await applyMrpackOverrides(zip, "overrides/", stagingDirectory, overrideTotals, progressId);
    overrideFiles += await applyMrpackOverrides(zip, "client-overrides/", stagingDirectory, overrideTotals, progressId);

    const instance = {
      id: instanceId,
      name: instanceName,
      minecraftVersion: pack.version,
      source: "modrinth",
      pack: {
        ...pack,
        projectId: projectId || null,
        slug: metadata.slug || null,
        packVersion: metadata.packVersion || pack.versionId || "Imported file",
        installedFiles,
        overrideFiles
      },
      createdAt: new Date().toISOString(),
      installState: "files-ready"
    };

    await fs.rename(stagingDirectory, instanceDirectory);
    try {
      const instances = await readInstances();
      instances.unshift(instance);
      await writeInstances(instances);
    } catch (error) {
      await fs.rm(instanceDirectory, { recursive: true, force: true });
      throw error;
    }
    reportModpackProgress(progressId, "Pack files are ready", installedFiles, installableFiles.length);
    return instance;
  } catch (error) {
    await fs.rm(stagingDirectory, { recursive: true, force: true }).catch(() => {});
    throw error;
  }
}

async function installModrinthPack(project) {
  const projectId = String(project?.id || project?.slug || "");
  if (!/^[A-Za-z0-9_-]{1,100}$/.test(projectId)) throw new Error("This Modrinth project link is invalid.");

  reportModpackProgress(projectId, "Finding the latest pack…", 0, 0);
  const versionsUrl = MODRINTH_API + "/project/" + encodeURIComponent(projectId) + "/version?include_changelog=false";
  const versions = await fetchModrinthJson(versionsUrl);
  if (!Array.isArray(versions)) throw new Error("Modrinth returned an invalid pack version list.");

  const orderedVersions = versions.slice().sort((left, right) => {
    const leftDate = Date.parse(left.date_published || "") || 0;
    const rightDate = Date.parse(right.date_published || "") || 0;
    return rightDate - leftDate;
  });
  const candidates = orderedVersions.map((version) => ({
    version,
    file: (version.files || []).find((item) => item.primary && /\.mrpack$/i.test(item.filename || ""))
      || (version.files || []).find((item) => /\.mrpack$/i.test(item.filename || ""))
  })).filter((item) => item.file);

  const selected = candidates.find((item) => item.version.version_type === "release") || candidates[0];
  if (!selected) throw new Error("This Modrinth project does not have a downloadable .mrpack file.");

  reportModpackProgress(projectId, "Downloading the modpack…", 0, 0);
  if (Number(selected.file.size) > MAX_PACK_ARCHIVE_BYTES) throw new Error("This modpack archive is larger than Moon Launcher allows.");
  const archiveBytes = await downloadTrustedModrinthFile(selected.file.url, MAX_PACK_ARCHIVE_BYTES);
  if (selected.file.size && archiveBytes.length !== Number(selected.file.size)) {
    throw new Error("The downloaded modpack archive did not match its listed size.");
  }
  verifyModrinthHashes(archiveBytes, selected.file.hashes, "modpack archive");

  return installMrpackArchive(archiveBytes, {
    projectId,
    slug: project?.slug,
    projectName: project?.title,
    packVersion: selected.version.version_number || selected.version.name || selected.version.id
  });
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

  const archivePath = result.filePaths[0];
  const fileInfo = await fs.stat(archivePath);
  if (fileInfo.size > MAX_PACK_ARCHIVE_BYTES) throw new Error("This modpack archive is too large.");
  const zip = new AdmZip(archivePath);
  if (zip.getEntry("modrinth.index.json")) {
    return installMrpackArchive(await fs.readFile(archivePath), {});
  }

  const pack = readPackManifest(archivePath);
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
      "User-Agent": MODRINTH_USER_AGENT
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
ipcMain.handle("modpacks:install", (_event, project) => installModrinthPack(project || {}));
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