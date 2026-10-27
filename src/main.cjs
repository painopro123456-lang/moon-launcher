const { app, BrowserWindow, dialog, ipcMain, safeStorage, shell } = require("electron");
const { spawnSync } = require("node:child_process");
const { autoUpdater } = require("electron-updater");
const http = require("node:http");
const os = require("node:os");
const AdmZip = require("adm-zip");
const crypto = require("node:crypto");
const fs = require("node:fs/promises");
const path = require("node:path");

const MANIFEST_URL = "https://launchermeta.mojang.com/mc/game/version_manifest_v2.json";
const MODRINTH_API = "https://api.modrinth.com/v2";
const MOON_MENU_RELEASE_API = "https://api.github.com/repos/painopro123456-lang/glassmenu/releases/latest";
const MAX_MOON_MENU_JAR_BYTES = 100 * 1024 * 1024;
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
let launcherPreferences = {
  gameDirectory: app.getPath("userData"),
  memoryGb: "auto",
  downloadConnections: 4,
  fullscreen: false
};

function getStatePath() {
  return path.join(app.getPath("userData"), "moon-launcher.json");
}

function getInstancesPath() {
  return path.join(launcherPreferences.gameDirectory, "instances");
}

function getLauncherPreferencesPath() {
  return path.join(app.getPath("userData"), "launcher-preferences.json");
}

function validateLauncherPreferences(input = {}) {
  const memory = input.memoryGb === "auto" ? "auto" : Number(input.memoryGb);
  const connections = Number(input.downloadConnections);
  const directory = typeof input.gameDirectory === "string" && input.gameDirectory.trim()
    ? path.resolve(input.gameDirectory)
    : app.getPath("userData");
  return {
    gameDirectory: directory,
    memoryGb: memory === "auto" || (Number.isInteger(memory) && memory >= 2 && memory <= 16) ? memory : "auto",
    downloadConnections: Number.isInteger(connections) && connections >= 2 && connections <= 8 ? connections : 4,
    fullscreen: input.fullscreen === true
  };
}

async function loadLauncherPreferences() {
  try {
    launcherPreferences = validateLauncherPreferences(JSON.parse(await fs.readFile(getLauncherPreferencesPath(), "utf8")));
  } catch (error) {
    if (error.code !== "ENOENT") console.error("Could not read launcher preferences:", error);
    launcherPreferences = validateLauncherPreferences({});
  }
}

async function writeLauncherPreferences(next) {
  const valid = validateLauncherPreferences({ ...launcherPreferences, ...next });
  const target = getLauncherPreferencesPath();
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(target + ".tmp", JSON.stringify(valid, null, 2), "utf8");
  await fs.rename(target + ".tmp", target);
  launcherPreferences = valid;
  return { ...launcherPreferences };
}

async function pathExists(target) {
  try { await fs.access(target); return true; } catch { return false; }
}

async function moveManagedDataDirectory(nextDirectory) {
  const requestedDirectory = String(nextDirectory || "").trim();
  if (!requestedDirectory || requestedDirectory.length > 320) throw new Error("Choose a valid folder path.");
  const newRoot = path.resolve(requestedDirectory);
  const oldRoot = path.resolve(launcherPreferences.gameDirectory);
  if (newRoot.toLowerCase() === oldRoot.toLowerCase()) return { ...launcherPreferences };
  if (typeof activeLaunches !== "undefined" && activeLaunches.size) throw new Error("Close Minecraft before moving the Moon Launcher folder.");
  const relativeOld = path.relative(oldRoot, newRoot);
  const relativeNew = path.relative(newRoot, oldRoot);
  if ((!relativeOld.startsWith("..") && !path.isAbsolute(relativeOld)) || (!relativeNew.startsWith("..") && !path.isAbsolute(relativeNew))) {
    throw new Error("Choose a folder outside the current Moon Launcher folder.");
  }

  const managedNames = ["instances", "minecraft"];
  const sources = [];
  for (const name of managedNames) {
    const source = path.join(oldRoot, name);
    const destination = path.join(newRoot, name);
    if (!(await pathExists(source))) continue;
    if (await pathExists(destination)) {
      const items = await fs.readdir(destination).catch(() => ["not-empty"]);
      if (items.length) throw new Error("That folder already has Moon Launcher data. Choose an empty folder.");
    }
    sources.push({ name, source, destination });
  }

  await fs.mkdir(newRoot, { recursive: true });
  const staging = path.join(newRoot, ".moon-launcher-moving-" + crypto.randomUUID());
  const created = [];
  await fs.mkdir(staging, { recursive: true });
  try {
    for (const item of sources) await fs.cp(item.source, path.join(staging, item.name), { recursive: true, errorOnExist: true, force: false });
    for (const item of sources) {
      if (await pathExists(item.destination)) await fs.rmdir(item.destination);
      await fs.rename(path.join(staging, item.name), item.destination);
      created.push(item.destination);
    }
    const saved = await writeLauncherPreferences({ gameDirectory: newRoot });
    await fs.rm(staging, { recursive: true, force: true }).catch(() => {});
    for (const item of sources) await fs.rm(item.source, { recursive: true, force: true }).catch((error) => console.error("Could not clean up old launcher data:", error));
    return saved;
  } catch (error) {
    if (launcherPreferences.gameDirectory.toLowerCase() === oldRoot.toLowerCase()) {
      for (const destination of created) await fs.rm(destination, { recursive: true, force: true }).catch(() => {});
    }
    await fs.rm(staging, { recursive: true, force: true }).catch(() => {});
    throw error;
  }
}

async function chooseLauncherDirectory() {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: "Choose Moon Launcher folder",
    defaultPath: launcherPreferences.gameDirectory,
    properties: ["openDirectory", "createDirectory"]
  });
  if (result.canceled || !result.filePaths[0]) return { ...launcherPreferences, canceled: true };
  return moveManagedDataDirectory(result.filePaths[0]);
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

async function deleteInstance(instanceId) {
  const id = String(instanceId || "");
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw new Error("Choose a valid Minecraft instance.");
  if (activeLaunches.has(id)) throw new Error("Close Minecraft before deleting this instance.");
  const instances = await readInstances();
  const instance = instances.find((item) => item.id === id);
  if (!instance) throw new Error("That Minecraft instance could not be found.");
  const instancesRoot = path.resolve(getInstancesPath());
  const instanceDirectory = path.resolve(instancesRoot, id);
  if (path.dirname(instanceDirectory) !== instancesRoot || path.basename(instanceDirectory) !== id) {
    throw new Error("The instance data path is invalid.");
  }
  await fs.rm(instanceDirectory, { recursive: true, force: true });
  await writeInstances(instances.filter((item) => item.id !== id));
  return { deleted: true, instanceId: id };
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

async function getLatestMoonMenuAsset() {
  const response = await fetch(MOON_MENU_RELEASE_API, {
    headers: { Accept: "application/vnd.github+json", "User-Agent": MODRINTH_USER_AGENT },
    signal: AbortSignal.timeout(20000)
  });
  if (!response.ok) return null;
  const release = await response.json();
  const asset = (release.assets || []).find((item) => /^glassmenu-[0-9][A-Za-z0-9.+_-]*\.jar$/i.test(item.name || ""));
  if (!asset || !asset.browser_download_url || Number(asset.size) > MAX_MOON_MENU_JAR_BYTES) return null;
  return { release, asset };
}

async function downloadMoonMenuJar(releaseInfo) {
  const info = releaseInfo || await getLatestMoonMenuAsset();
  if (!info) throw new Error("Moon Menu's published JAR is currently unavailable.");
  const { release, asset } = info;
  const url = new URL(asset.browser_download_url);
  if (url.protocol !== "https:" || !["github.com", "release-assets.githubusercontent.com", "objects.githubusercontent.com"].includes(url.hostname)) {
    throw new Error("Moon Menu's release uses an unsupported download host.");
  }
  const jarResponse = await fetch(url, { headers: { "User-Agent": MODRINTH_USER_AGENT }, signal: AbortSignal.timeout(60000) });
  if (!jarResponse.ok) throw new Error("Moon Menu download failed (HTTP " + jarResponse.status + ").");
  const bytes = Buffer.from(await jarResponse.arrayBuffer());
  if (!bytes.length || bytes.length > MAX_MOON_MENU_JAR_BYTES || (asset.size && bytes.length !== Number(asset.size))) {
    throw new Error("The downloaded Moon Menu JAR did not match the published file size.");
  }
  if (asset.digest && /^sha256:[a-f0-9]{64}$/i.test(asset.digest)) {
    const digest = crypto.createHash("sha256").update(bytes).digest("hex");
    if (digest.toLowerCase() !== asset.digest.slice(7).toLowerCase()) throw new Error("Moon Menu's downloaded JAR failed its SHA-256 integrity check.");
  }
  if (bytes.subarray(0, 2).toString("hex") !== "504b") throw new Error("The published Moon Menu file is not a valid JAR archive.");
  return { bytes, version: String(release.tag_name || release.name || "latest"), fileName: asset.name };
}

async function installMrpackArchive(archiveBytes, metadata = {}) {
  const { zip, manifest, pack } = parseMrpackArchive(archiveBytes);
  const projectId = String(metadata.projectId || "");
  const progressId = projectId || "local-import";
  let includeMoonMenu = false;
  let moonMenuRelease = null;
  const isFabricApiPath = (value) => {
    const normalized = String(value || "").replace(/\\/g, "/").toLowerCase();
    return normalized.startsWith("mods/") && normalized.endsWith(".jar") && normalized.split("/").pop().includes("fabric-api");
  };
  const hasFabricApi = manifest.files.some((file) => isFabricApiPath(file?.path))
    || zip.getEntries().some((entry) => {
      const normalized = String(entry.entryName || "").replace(/\\/g, "/");
      return (normalized.startsWith("overrides/") || normalized.startsWith("client-overrides/"))
        && isFabricApiPath(normalized.slice(normalized.indexOf("/") + 1));
    });
  const compatibleMoonMenuPack = pack.version === "26.2"
    && Object.prototype.hasOwnProperty.call(manifest.dependencies || {}, "fabric-loader")
    && hasFabricApi;
  if (compatibleMoonMenuPack) {
    const releaseInfo = await getLatestMoonMenuAsset().catch(() => null);
    if (releaseInfo) {
      const choice = await dialog.showMessageBox(mainWindow, {
        type: "question",
        buttons: ["Include Moon Menu", "No thanks"],
        defaultId: 0,
        cancelId: 1,
        title: "Include Moon Menu?",
        message: "Add Moon Menu to this modpack?",
        detail: "This Minecraft 26.2 Fabric pack includes Fabric API, which Moon Menu requires. The mod will be installed into this instance's mods folder."
      });
      includeMoonMenu = choice.response === 0;
      if (includeMoonMenu) {
        reportModpackProgress(progressId, "Downloading Moon Menu…", 0, 0);
        moonMenuRelease = await downloadMoonMenuJar(releaseInfo);
      }
    }
  }

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
    if (moonMenuRelease) {
      const modsDirectory = path.join(stagingDirectory, "mods");
      await fs.mkdir(modsDirectory, { recursive: true });
      const safeJarName = path.basename(moonMenuRelease.fileName);
      const jarPath = path.join(modsDirectory, safeJarName);
      if (uniquePaths.has(("mods/" + safeJarName).toLowerCase())) {
        throw new Error("This modpack already contains a file with the Moon Menu JAR name.");
      }
      await fs.writeFile(jarPath, moonMenuRelease.bytes, { flag: "wx" });
      installedFiles++;
    }

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

async function getModrinthPackVersions(project) {
  const projectId = String(project?.id || project?.slug || "");
  if (!/^[A-Za-z0-9_-]{1,100}$/.test(projectId)) throw new Error("This Modrinth project link is invalid.");
  const versions = await fetchModrinthJson(MODRINTH_API + "/project/" + encodeURIComponent(projectId) + "/version?include_changelog=false");
  if (!Array.isArray(versions)) throw new Error("Modrinth returned an invalid pack version list.");
  return versions.slice().sort((left, right) => (Date.parse(right.date_published || "") || 0) - (Date.parse(left.date_published || "") || 0))
    .map((version) => {
      const file = (version.files || []).find((item) => item.primary && /\.mrpack$/i.test(item.filename || ""))
        || (version.files || []).find((item) => /\.mrpack$/i.test(item.filename || ""));
      if (!file) return null;
      return {
        id: String(version.id || ""),
        name: String(version.name || version.version_number || "Unnamed version"),
        versionNumber: String(version.version_number || version.name || ""),
        gameVersions: Array.isArray(version.game_versions) ? version.game_versions : [],
        loaders: Array.isArray(version.loaders) ? version.loaders : [],
        type: String(version.version_type || "release"),
        published: String(version.date_published || ""),
        fileName: String(file.filename || "modpack.mrpack"),
        size: Number(file.size) || 0
      };
    }).filter(Boolean);
}

async function installModrinthPack(project, requestedVersionId) {
  const projectId = String(project?.id || project?.slug || "");
  if (!/^[A-Za-z0-9_-]{1,100}$/.test(projectId)) throw new Error("This Modrinth project link is invalid.");

  reportModpackProgress(projectId, "Finding modpack versions…", 0, 0);
  const versions = await fetchModrinthJson(MODRINTH_API + "/project/" + encodeURIComponent(projectId) + "/version?include_changelog=false");
  if (!Array.isArray(versions)) throw new Error("Modrinth returned an invalid pack version list.");
  const orderedVersions = versions.slice().sort((left, right) => (Date.parse(right.date_published || "") || 0) - (Date.parse(left.date_published || "") || 0));
  const candidates = orderedVersions.map((version) => ({
    version,
    file: (version.files || []).find((item) => item.primary && /\.mrpack$/i.test(item.filename || ""))
      || (version.files || []).find((item) => /\.mrpack$/i.test(item.filename || ""))
  })).filter((item) => item.file);
  const selected = requestedVersionId
    ? candidates.find((item) => String(item.version.id) === String(requestedVersionId))
    : candidates.find((item) => item.version.version_type === "release") || candidates[0];
  if (!selected) throw new Error(requestedVersionId
    ? "That modpack version is no longer available. Reopen the version picker and try again."
    : "This Modrinth project does not have a downloadable .mrpack file.");

  reportModpackProgress(projectId, "Downloading " + (selected.version.name || selected.version.version_number || "modpack") + "…", 0, 0);
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


const MICROSOFT_AUTHORIZE_URL = "https://login.microsoftonline.com/consumers/oauth2/v2.0/authorize";
const MICROSOFT_TOKEN_URL = "https://login.microsoftonline.com/consumers/oauth2/v2.0/token";
// Public OAuth client ID for Moon Launcher. This is an identifier, not a secret.
const DEFAULT_MICROSOFT_CLIENT_ID = "09e6a2a2-90ee-47a6-92c4-f8810958de91";
const XBOX_USER_AUTH_URL = "https://user.auth.xboxlive.com/user/authenticate";
const XBOX_XSTS_URL = "https://xsts.auth.xboxlive.com/xsts/authorize";
const MINECRAFT_LOGIN_URL = "https://api.minecraftservices.com/authentication/login_with_xbox";
const MINECRAFT_PROFILE_URL = "https://api.minecraftservices.com/minecraft/profile";
const MINECRAFT_ENTITLEMENTS_URL = "https://api.minecraftservices.com/entitlements/mcstore";
const ADOPTIUM_ASSETS_URL = "https://api.adoptium.net/v3/assets/latest/";
const MAX_JAVA_ARCHIVE_BYTES = 450 * 1024 * 1024;
const MAX_JAVA_UNPACKED_BYTES = 1024 * 1024 * 1024;
let authInProgress = false;
let authCancelRequested = false;
const activeLaunches = new Map();
const pendingLaunches = new Set();

function getMinecraftRootPath() { return path.join(launcherPreferences.gameDirectory, "minecraft"); }
function getMicrosoftClientIdPath() { return path.join(app.getPath("userData"), "microsoft-client.json"); }
function getEncryptedAccountPath() { return path.join(app.getPath("userData"), "microsoft-account.bin"); }
function getAccountVaultPath() { return path.join(app.getPath("userData"), "microsoft-accounts-vault.bin"); }
function getServersPath() { return path.join(app.getPath("userData"), "servers.json"); }
function getBackgroundPath() { return path.join(app.getPath("userData"), "custom-background"); }
function sendWindowEvent(channel, payload) {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(channel, payload);
}
function reportAuthProgress(status, message, details = {}) {
  sendWindowEvent("auth:progress", { status, message, ...details });
}
function reportLaunchProgress(instanceId, status, message, extra = {}) {
  sendWindowEvent("launcher:progress", { instanceId, status, message, ...extra });
}
async function readMicrosoftClientId() {
  try {
    const data = JSON.parse(await fs.readFile(getMicrosoftClientIdPath(), "utf8"));
    const savedClientId = String(data.clientId || "").trim();
    return savedClientId || DEFAULT_MICROSOFT_CLIENT_ID;
  } catch (error) {
    if (error.code !== "ENOENT") console.error("Could not read Microsoft app ID:", error);
    return DEFAULT_MICROSOFT_CLIENT_ID;
  }
}
async function saveMicrosoftClientId(value) {
  const clientId = String(value || "").trim();
  if (clientId && !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(clientId)) {
    throw new Error("Paste the Microsoft Application (client) ID. It should look like a GUID.");
  }
  const target = getMicrosoftClientIdPath();
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(target + ".tmp", JSON.stringify({ clientId }, null, 2), "utf8");
  await fs.rename(target + ".tmp", target);
  return { configured: Boolean(clientId), clientId };
}
async function readEncryptedAccountFile(filePath) {
  try {
    if (!safeStorage.isEncryptionAvailable()) throw new Error("Secure account storage is unavailable on this Windows account.");
    return JSON.parse(safeStorage.decryptString(await fs.readFile(filePath)));
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw new Error(error.message || "The saved Minecraft sign-in could not be read. Sign in again.");
  }
}
async function writeEncryptedAccountFile(filePath, account) {
  if (!safeStorage.isEncryptionAvailable()) throw new Error("Windows secure storage is unavailable, so Moon Launcher cannot safely save this account.");
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath + ".tmp", safeStorage.encryptString(JSON.stringify(account)));
  await fs.rename(filePath + ".tmp", filePath);
}
async function readAccountVault() {
  const saved = await readEncryptedAccountFile(getAccountVaultPath()).catch((error) => {
    if (error.code === "ENOENT") return null;
    throw error;
  });
  if (saved && Array.isArray(saved.accounts)) return saved;
  const legacy = await readEncryptedAccountFile(getEncryptedAccountPath());
  return { accounts: legacy?.profile ? [legacy] : [], activeId: legacy?.profile?.id || "" };
}
async function writeAccountVault(vault) {
  const target = getAccountVaultPath();
  if (!safeStorage.isEncryptionAvailable()) throw new Error("Windows secure storage is unavailable, so Moon Launcher cannot safely save these accounts.");
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(target + ".tmp", safeStorage.encryptString(JSON.stringify(vault)));
  await fs.rename(target + ".tmp", target);
}
async function readSavedAccount() {
  return readEncryptedAccountFile(getEncryptedAccountPath());
}
async function saveAccount(account) {
  const vault = await readAccountVault();
  const id = String(account?.profile?.id || "");
  if (id) {
    const index = vault.accounts.findIndex((item) => String(item?.profile?.id || "").toLowerCase() === id.toLowerCase());
    if (index >= 0) vault.accounts[index] = account;
    else vault.accounts.push(account);
    vault.activeId = id;
    await writeAccountVault(vault);
  }
  await writeEncryptedAccountFile(getEncryptedAccountPath(), account);
}
async function listSavedAccounts() {
  const vault = await readAccountVault();
  const active = await readSavedAccount();
  return vault.accounts.filter((item) => item?.profile?.id && item?.profile?.name).map((item) => ({
    uuid: String(item.profile.id),
    username: String(item.profile.name),
    offline: item.offline === true,
    active: String(active?.profile?.id || "").toLowerCase() === String(item.profile.id).toLowerCase()
  }));
}
async function switchSavedAccount(uuid) {
  const wanted = String(uuid || "");
  const vault = await readAccountVault();
  const account = vault.accounts.find((item) => String(item?.profile?.id || "").toLowerCase() === wanted.toLowerCase());
  if (!account) throw new Error("That saved Minecraft account was not found. Sign in again to add it.");
  vault.activeId = account.profile.id;
  await writeAccountVault(vault);
  await writeEncryptedAccountFile(getEncryptedAccountPath(), account);
  return getAccountStatus();
}
async function removeSavedAccount(uuid) {
  const wanted = String(uuid || "");
  const vault = await readAccountVault();
  const active = await readSavedAccount();
  vault.accounts = vault.accounts.filter((item) => String(item?.profile?.id || "").toLowerCase() !== wanted.toLowerCase());
  if (!vault.accounts.some((item) => String(item?.profile?.id || "").toLowerCase() === String(vault.activeId || "").toLowerCase())) {
    vault.activeId = vault.accounts[0]?.profile?.id || "";
  }
  await writeAccountVault(vault);
  if (String(active?.profile?.id || "").toLowerCase() === wanted.toLowerCase()) {
    const replacement = vault.accounts.find((item) => String(item?.profile?.id || "").toLowerCase() === String(vault.activeId || "").toLowerCase());
    if (replacement) await writeEncryptedAccountFile(getEncryptedAccountPath(), replacement);
    else await fs.rm(getEncryptedAccountPath(), { force: true });
  }
  return { accounts: await listSavedAccounts(), status: await getAccountStatus() };
}
async function getAccountStatus() {
  const account = await readSavedAccount();
  const clientId = await readMicrosoftClientId();
  return account?.profile
    ? { signedIn: true, username: String(account.profile.name || "Minecraft player"), uuid: String(account.profile.id || ""), clientId, offline: account.offline === true }
    : { signedIn: false, clientId, offline: false };
}
function offlineUuid(username) {
  const bytes = crypto.createHash("md5").update("OfflinePlayer:" + username, "utf8").digest();
  bytes[6] = (bytes[6] & 0x0f) | 0x30;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return hex.slice(0, 8) + "-" + hex.slice(8, 12) + "-" + hex.slice(12, 16) + "-" + hex.slice(16, 20) + "-" + hex.slice(20);
}
async function createOfflineAccount(value) {
  const username = String(value || "").trim();
  if (!/^[A-Za-z0-9_]{3,16}$/.test(username)) {
    throw new Error("Offline usernames must be 3–16 characters and use only letters, numbers, and underscores.");
  }
  const account = {
    offline: true,
    profile: { id: offlineUuid(username), name: username },
    xuid: "",
    minecraftAccessToken: "0",
    minecraftExpiresAt: 0
  };
  await saveAccount(account);
  return { signedIn: true, username, uuid: account.profile.id, offline: true };
}
async function signOutMicrosoft() {
  await fs.rm(getEncryptedAccountPath(), { force: true });
  return { signedIn: false };
}
function sleep(milliseconds) { return new Promise((resolve) => setTimeout(resolve, milliseconds)); }
async function readJsonResponse(response, context) {
  let data = {};
  try { data = await response.json(); } catch {}
  if (!response.ok) {
    // Minecraft Services uses `errorMessage` (not `message`) for errors such as
    // "Invalid app registration". Preserve that provider detail so users can
    // distinguish an app-registration rejection from account/ownership errors.
    const detail = String(data.errorMessage || data.error_description || data.Message || data.message || data.error || "").replace(/[\r\n]+/g, " ").slice(0, 220);
    const path = typeof data.path === "string" ? data.path.replace(/[\r\n]+/g, " ").slice(0, 120) : "";
    const status = " (HTTP " + response.status + ").";
    const normalizedDetail = detail.toLowerCase();
    if (context === "Minecraft account sign-in failed" && response.status === 403) {
      if (normalizedDetail.includes("invalid app registration") || normalizedDetail.includes("appreginfo")) {
        throw new Error("Minecraft Services rejected Moon Launcher's Microsoft Client ID because it is not approved for Minecraft API access. Register this app's Client ID using Minecraft's official app review process: https://aka.ms/mce-reviewappid. Approval is required on Microsoft's side; changing launcher code cannot bypass it." + (path ? " [" + path + "]" : ""));
      }
      if (normalizedDetail.includes("account_suspended") || normalizedDetail.includes("account has been suspended")) {
        throw new Error("Minecraft Services reports that this account is suspended. Wait and retry later, or contact Minecraft Support." + (path ? " [" + path + "]" : ""));
      }
      throw new Error("Minecraft Services returned HTTP 403 during game-token exchange. This can mean the app's Client ID needs Minecraft API approval, or that the account is restricted. " + (detail ? "Server response: " + detail : "The server returned no additional details.") + " If the response says 'Invalid app registration', submit the Client ID at https://aka.ms/mce-reviewappid." + (path ? " [" + path + "]" : ""));
    }
    throw new Error(context + (detail ? ": " + detail : status) + (path ? " [" + path + "]" : ""));
  }
  return data;
}
async function postFormJson(url, fields, context) {
  const body = new URLSearchParams();
  for (const [key, value] of Object.entries(fields)) body.set(key, String(value));
  const response = await fetch(url, {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded", "Accept": "application/json" },
    body, signal: AbortSignal.timeout(30000)
  });
  return readJsonResponse(response, context);
}
async function postJson(url, payload, context) {
  const response = await fetch(url, {
    method: "POST", headers: { "Content-Type": "application/json", "Accept": "application/json" },
    body: JSON.stringify(payload), signal: AbortSignal.timeout(30000)
  });
  return readJsonResponse(response, context);
}
async function fetchJson(url, context) {
  const response = await fetch(url, { headers: { "Accept": "application/json" }, signal: AbortSignal.timeout(30000) });
  return readJsonResponse(response, context);
}
function xstsError(body) {
  const code = Number(body?.XErr);
  if (code === 2148916233) return "This Microsoft account needs an Xbox profile before it can sign in.";
  if (code === 2148916238) return "This child account needs family approval before it can sign in.";
  if (code === 2148916235) return "Xbox services are not available for this account's region.";
  return "";
}
async function exchangeMicrosoftForMinecraft(msAccessToken, requireOwnership) {
  reportAuthProgress("xbox", "Connecting to Xbox services…");
  const xbox = await postJson(XBOX_USER_AUTH_URL, {
    Properties: { AuthMethod: "RPS", SiteName: "user.auth.xboxlive.com", RpsTicket: "d=" + msAccessToken },
    RelyingParty: "http://auth.xboxlive.com", TokenType: "JWT"
  }, "Xbox sign-in failed");
  const xboxUser = xbox?.DisplayClaims?.xui?.[0];
  if (!xbox?.Token || !xboxUser?.uhs) throw new Error("Xbox did not return a valid sign-in token.");

  reportAuthProgress("xsts", "Checking your Xbox account…");
  const xstsResponse = await fetch(XBOX_XSTS_URL, {
    method: "POST", headers: { "Content-Type": "application/json", "Accept": "application/json" },
    body: JSON.stringify({
      Properties: { SandboxId: "RETAIL", UserTokens: [xbox.Token] },
      RelyingParty: "rp://api.minecraftservices.com/", TokenType: "JWT"
    }), signal: AbortSignal.timeout(30000)
  });
  let xstsBody = {};
  try { xstsBody = await xstsResponse.clone().json(); } catch {}
  let xsts;
  try { xsts = await readJsonResponse(xstsResponse, "Xbox account check failed"); }
  catch (error) { throw new Error(xstsError(xstsBody) || error.message); }
  const xstsUser = xsts?.DisplayClaims?.xui?.[0] || xboxUser;
  if (!xsts?.Token || !xstsUser?.uhs) throw new Error("Xbox did not return a valid security token.");

  reportAuthProgress("minecraft", "Checking Minecraft ownership…");
  const minecraft = await postJson(MINECRAFT_LOGIN_URL, {
    identityToken: "XBL3.0 x=" + xstsUser.uhs + ";" + xsts.Token
  }, "Minecraft account sign-in failed");
  if (!minecraft?.access_token) throw new Error("Minecraft did not return a valid game token.");

  if (requireOwnership) {
    const response = await fetch(MINECRAFT_ENTITLEMENTS_URL, {
      headers: { "Authorization": "Bearer " + minecraft.access_token, "Accept": "application/json" },
      signal: AbortSignal.timeout(30000)
    });
    const entitlements = await readJsonResponse(response, "Could not check Minecraft ownership");
    if (!(entitlements.items || []).some((item) => ["game_minecraft", "product_minecraft"].includes(String(item.name || "").toLowerCase()))) {
      throw new Error("This Microsoft account does not appear to own Minecraft: Java Edition. Sign in with the account that owns the game.");
    }
  }

  const profileResponse = await fetch(MINECRAFT_PROFILE_URL, {
    headers: { "Authorization": "Bearer " + minecraft.access_token, "Accept": "application/json" },
    signal: AbortSignal.timeout(30000)
  });
  const profile = await readJsonResponse(profileResponse, "Could not load the Minecraft profile");
  if (!profile?.id || !profile?.name) throw new Error("This account has no Minecraft: Java Edition profile. Finish creating one, then sign in again.");
  return {
    accessToken: minecraft.access_token,
    expiresAt: Date.now() + Math.max(60, Number(minecraft.expires_in || 86400)) * 1000,
    profile: { id: profile.id, name: profile.name },
    xuid: String(xstsUser.xid || xboxUser.xid || "")
  };
}
async function waitForMicrosoftAuthorization(server, expectedState, redirectUri) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (error, value) => {
      if (settled) return;
      settled = true;
      clearInterval(cancelPoll);
      clearTimeout(timeout);
      server.close();
      if (error) reject(error);
      else resolve(value);
    };

    const timeout = setTimeout(() => finish(new Error("Microsoft sign-in timed out. Please try again.")), 5 * 60 * 1000);
    const cancelPoll = setInterval(() => {
      if (authCancelRequested) finish(new Error("Microsoft sign-in was canceled."));
    }, 250);

    server.on("request", (request, response) => {
      let callbackUrl;
      try { callbackUrl = new URL(request.url || "/", redirectUri); }
      catch {
        response.writeHead(400, { "Content-Type": "text/plain; charset=utf-8" });
        response.end("Invalid sign-in response. You can close this tab.");
        return;
      }

      if (callbackUrl.pathname !== "/" && callbackUrl.pathname !== "/callback") {
        response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
        response.end("Not found.");
        return;
      }

      const returnedState = callbackUrl.searchParams.get("state");
      const authorizationError = callbackUrl.searchParams.get("error");
      if (authorizationError) {
        const detail = callbackUrl.searchParams.get("error_description") || authorizationError;
        response.writeHead(400, { "Content-Type": "text/html; charset=utf-8" });
        response.end("<!doctype html><html><head><meta charset=\"utf-8\"><title>Moon Launcher</title></head><body style=\"font:16px sans-serif;padding:40px\"><h2>Microsoft sign-in was not completed</h2><p>You can close this tab and return to Moon Launcher.</p></body></html>");
        finish(new Error("Microsoft sign-in was not completed: " + String(detail).replace(/[\\r\\n]+/g, " ").slice(0, 180)));
        return;
      }
      if (!returnedState || returnedState !== expectedState) {
        response.writeHead(400, { "Content-Type": "text/plain; charset=utf-8" });
        response.end("The sign-in response could not be verified. Return to Moon Launcher and try again.");
        finish(new Error("Microsoft sign-in could not be verified. Please try again."));
        return;
      }

      const code = callbackUrl.searchParams.get("code");
      if (!code) {
        response.writeHead(400, { "Content-Type": "text/plain; charset=utf-8" });
        response.end("Microsoft did not return an authorization code. Return to Moon Launcher and try again.");
        finish(new Error("Microsoft did not return an authorization code."));
        return;
      }

      response.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
      response.end("<!doctype html><html><head><meta charset=\"utf-8\"><title>Moon Launcher</title></head><body style=\"font:16px sans-serif;padding:40px;background:#f7f7fb;color:#222\"><h2>You're signed in</h2><p>Microsoft sign-in is complete. You can close this tab and return to Moon Launcher.</p></body></html>");
      finish(null, code);
    });
  });
}

async function signInWithMicrosoft() {
  if (authInProgress) throw new Error("A Microsoft sign-in is already running.");
  const clientId = await readMicrosoftClientId();
  if (!clientId) throw new Error("Add your Microsoft Application (client) ID in Settings first.");
  authInProgress = true;
  authCancelRequested = false;
  let callbackServer;
  try {
    reportAuthProgress("starting", "Opening Microsoft sign-in in your browser…");

    const verifier = crypto.randomBytes(32).toString("base64url");
    const challenge = crypto.createHash("sha256").update(verifier).digest("base64url");
    const state = crypto.randomBytes(24).toString("hex");

    callbackServer = http.createServer();
    await new Promise((resolve, reject) => {
      callbackServer.once("error", reject);
      callbackServer.listen(0, "127.0.0.1", resolve);
    });
    const address = callbackServer.address();
    if (!address || typeof address === "string") throw new Error("Could not start the secure local sign-in callback.");
    const redirectUri = "http://localhost:" + address.port;

    const authorizeUrl = new URL(MICROSOFT_AUTHORIZE_URL);
    authorizeUrl.search = new URLSearchParams({
      client_id: clientId,
      response_type: "code",
      redirect_uri: redirectUri,
      response_mode: "query",
      scope: "XboxLive.signin offline_access",
      state,
      code_challenge: challenge,
      code_challenge_method: "S256",
      prompt: "select_account"
    }).toString();

    reportAuthProgress("browser-login", "Sign in to your Microsoft account in the browser. Moon Launcher will continue automatically.");
    await shell.openExternal(authorizeUrl.href);

    const authorizationCode = await waitForMicrosoftAuthorization(callbackServer, state, redirectUri);
    callbackServer = null;

    reportAuthProgress("token-exchange", "Finishing Microsoft sign-in…");
    const microsoftToken = await postFormJson(MICROSOFT_TOKEN_URL, {
      client_id: clientId,
      grant_type: "authorization_code",
      code: authorizationCode,
      redirect_uri: redirectUri,
      code_verifier: verifier,
      scope: "XboxLive.signin offline_access"
    }, "Could not complete Microsoft sign-in");

    if (!microsoftToken.access_token) throw new Error("Microsoft did not return an access token.");
    const session = await exchangeMicrosoftForMinecraft(microsoftToken.access_token, true);
    const account = {
      clientId, profile: session.profile, xuid: session.xuid,
      microsoftAccessToken: microsoftToken.access_token,
      microsoftExpiresAt: Date.now() + Math.max(60, Number(microsoftToken.expires_in || 3600)) * 1000,
      microsoftRefreshToken: String(microsoftToken.refresh_token || ""),
      minecraftAccessToken: session.accessToken, minecraftExpiresAt: session.expiresAt
    };
    if (!account.microsoftRefreshToken) throw new Error("Microsoft did not provide a refresh token. Check the app's public-client settings and try again.");
    await saveAccount(account);
    reportAuthProgress("signed-in", "Signed in as " + session.profile.name + ".");
    return { signedIn: true, username: session.profile.name, uuid: session.profile.id };
  } catch (error) {
    if (callbackServer?.listening) callbackServer.close();
    reportAuthProgress("error", error.message || "Microsoft sign-in failed.");
    throw error;
  } finally { authInProgress = false; }
}
async function getUsableMinecraftAccount(instanceId) {
  const account = await readSavedAccount();
  if (account?.offline === true && account?.profile?.id && account?.profile?.name) return account;
  if (!account?.profile?.id || !account.microsoftRefreshToken) throw new Error("Sign in with the Microsoft account that owns Minecraft: Java Edition first.");
  const currentClientId = await readMicrosoftClientId();
  if (!currentClientId || currentClientId !== account.clientId) throw new Error("The Microsoft app ID changed. Restore the ID used for sign-in, or sign out and sign in again.");
  const now = Date.now() + 120000;
  if (account.minecraftAccessToken && Number(account.minecraftExpiresAt) > now) return account;

  let msAccessToken = account.microsoftAccessToken;
  if (!msAccessToken || Number(account.microsoftExpiresAt) <= now) {
    reportLaunchProgress(instanceId, "auth", "Refreshing Microsoft sign-in…");
    const refreshed = await postFormJson(MICROSOFT_TOKEN_URL, {
      client_id: account.clientId, grant_type: "refresh_token",
      refresh_token: account.microsoftRefreshToken, scope: "XboxLive.signin offline_access"
    }, "Microsoft sign-in expired. Sign in again to continue.");
    msAccessToken = refreshed.access_token;
    if (!msAccessToken) throw new Error("Microsoft did not refresh the sign-in. Please sign in again.");
    account.microsoftAccessToken = msAccessToken;
    account.microsoftExpiresAt = Date.now() + Math.max(60, Number(refreshed.expires_in || 3600)) * 1000;
    if (refreshed.refresh_token) account.microsoftRefreshToken = refreshed.refresh_token;
  }
  const session = await exchangeMicrosoftForMinecraft(msAccessToken, false);
  if (session.profile.id.toLowerCase() !== String(account.profile.id).toLowerCase()) {
    throw new Error("Microsoft returned a different Minecraft account. Sign in again before launching.");
  }
  account.profile = session.profile;
  account.xuid = session.xuid;
  account.minecraftAccessToken = session.accessToken;
  account.minecraftExpiresAt = session.expiresAt;
  await saveAccount(account);
  return account;
}
async function fetchMinecraftVersionDetails(versionId) {
  const manifestResponse = await fetch(MANIFEST_URL, { headers: { "Accept": "application/json" }, signal: AbortSignal.timeout(30000) });
  const manifest = await readJsonResponse(manifestResponse, "Could not load Minecraft's version catalog");
  const version = (manifest.versions || []).find((item) => item.id === versionId);
  if (!version?.url) throw new Error("Minecraft version " + versionId + " was not found in the official catalog.");
  const response = await fetch(version.url, { headers: { "Accept": "application/json" }, signal: AbortSignal.timeout(30000) });
  const details = await readJsonResponse(response, "Could not load Minecraft version details");
  return { type: String(version.type || "release"), javaMajor: Number(details.javaVersion?.majorVersion || 8) };
}
async function getAdoptiumPackage(javaMajor) {
  for (const imageType of ["jre", "jdk"]) {
    const url = new URL(ADOPTIUM_ASSETS_URL + encodeURIComponent(javaMajor) + "/hotspot");
    url.search = new URLSearchParams({ architecture: "x64", image_type: imageType, os: "windows", vendor: "eclipse", project: "jdk" }).toString();
    const response = await fetch(url, { headers: { "Accept": "application/json" }, signal: AbortSignal.timeout(30000) });
    if (!response.ok) continue;
    const assets = await response.json();
    const result = Array.isArray(assets) && assets.find((asset) => asset.binary?.package?.link && asset.binary.package.checksum);
    if (result) return result.binary.package;
  }
  return null;
}
async function findJavaExecutable(root) {
  const pending = [{ directory: root, depth: 0 }];
  while (pending.length) {
    const current = pending.shift();
    if (current.depth > 8) continue;
    let entries;
    try { entries = await fs.readdir(current.directory, { withFileTypes: true }); } catch { continue; }
    for (const entry of entries) {
      const itemPath = path.join(current.directory, entry.name);
      if (entry.isFile() && entry.name.toLowerCase() === "javaw.exe") return itemPath;
      if (entry.isDirectory()) pending.push({ directory: itemPath, depth: current.depth + 1 });
    }
  }
  return "";
}
async function installJavaRuntime(javaMajor, instanceId) {
  const runtimeDirectory = path.join(getMinecraftRootPath(), "runtimes", "temurin-" + javaMajor);
  const existing = await findJavaExecutable(runtimeDirectory);
  if (existing) return existing;
  reportLaunchProgress(instanceId, "installing-java", "Preparing Java " + javaMajor + " for Minecraft…");
  const packageInfo = await getAdoptiumPackage(javaMajor);
  if (!packageInfo?.link || !packageInfo?.checksum) throw new Error("A Java " + javaMajor + " runtime is not available for this Windows computer.");
  const packageUrl = new URL(packageInfo.link);
  if (packageUrl.protocol !== "https:" || !["github.com", "api.adoptium.net", "adoptium.net"].some((host) => packageUrl.hostname === host || packageUrl.hostname.endsWith("." + host))) {
    throw new Error("The Java runtime download came from an unsupported location.");
  }
  reportLaunchProgress(instanceId, "downloading-java", "Downloading Java " + javaMajor + "…");
  const response = await fetch(packageUrl, { headers: { "Accept": "application/octet-stream" }, signal: AbortSignal.timeout(600000) });
  if (!response.ok) throw new Error("The Java runtime could not be downloaded (HTTP " + response.status + ").");
  const archive = await readLimitedResponse(response, MAX_JAVA_ARCHIVE_BYTES);
  if (crypto.createHash("sha256").update(archive).digest("hex").toLowerCase() !== String(packageInfo.checksum).toLowerCase()) {
    throw new Error("The Java runtime download failed its SHA-256 check.");
  }
  let zip;
  try { zip = new AdmZip(archive); } catch { throw new Error("The Java runtime download was not a valid ZIP file."); }
  const entries = zip.getEntries();
  if (!entries.length || entries.length > 16000) throw new Error("The Java runtime archive contains an unsupported number of files.");
  const stageDirectory = runtimeDirectory + "." + crypto.randomUUID() + ".installing";
  let unpackedBytes = 0;
  await fs.mkdir(stageDirectory, { recursive: true });
  try {
    for (const entry of entries) {
      const name = String(entry.entryName || "").replace(/\\/g, "/").replace(/\/$/, "");
      if (!name) continue;
      const relative = safeInstanceRelativePath(name);
      const mode = (Number(entry.header?.attr || 0) >>> 16) & 0xf000;
      if (mode === 0xa000) throw new Error("The Java runtime archive contains an unexpected symbolic link.");
      const destination = resolveInstanceFile(stageDirectory, relative);
      if (entry.isDirectory) { await fs.mkdir(destination, { recursive: true }); continue; }
      const declared = Number(entry.header?.size || 0);
      unpackedBytes += declared;
      if (!Number.isSafeInteger(declared) || declared < 0 || unpackedBytes > MAX_JAVA_UNPACKED_BYTES) throw new Error("The Java runtime archive is larger than Moon Launcher allows.");
      const bytes = entry.getData();
      if (bytes.length !== declared) throw new Error("A Java runtime file did not unpack correctly.");
      await fs.mkdir(path.dirname(destination), { recursive: true });
      await fs.writeFile(destination, bytes, { flag: "wx" });
    }
    const javaPath = await findJavaExecutable(stageDirectory);
    if (!javaPath) throw new Error("The Java runtime archive did not contain javaw.exe.");
    await fs.mkdir(path.dirname(runtimeDirectory), { recursive: true });
    await fs.rm(runtimeDirectory, { recursive: true, force: true });
    await fs.rename(stageDirectory, runtimeDirectory);
    return path.join(runtimeDirectory, path.relative(stageDirectory, javaPath));
  } catch (error) {
    await fs.rm(stageDirectory, { recursive: true, force: true }).catch(() => {});
    throw error;
  }
}
async function installFabricLoader(javaPath, minecraftRoot, minecraftVersion, loader, instanceId) {
  const match = String(loader || "").match(/fabric-loader\s+([0-9][A-Za-z0-9.+_-]*)/i);
  if (!match) throw new Error("This Fabric modpack does not specify a valid Fabric Loader version.");
  const loaderVersion = match[1];
  const profileId = "fabric-loader-" + loaderVersion + "-" + minecraftVersion;
  const profilePath = path.join(minecraftRoot, "versions", profileId, profileId + ".json");
  if (await pathExists(profilePath)) return profileId;

  reportLaunchProgress(instanceId, "installing-loader", "Installing Fabric Loader " + loaderVersion + "…");
  const metadataResponse = await fetch("https://meta.fabricmc.net/v2/versions/installer", {
    headers: { "Accept": "application/json" }, signal: AbortSignal.timeout(30000)
  });
  if (!metadataResponse.ok) throw new Error("Could not retrieve the official Fabric installer list (HTTP " + metadataResponse.status + ").");
  const installers = await metadataResponse.json();
  const installer = Array.isArray(installers) && (installers.find((item) => item.stable) || installers[0]);
  if (!installer?.version) throw new Error("The official Fabric installer is currently unavailable.");
  const installerVersion = String(installer.version);
  if (!/^[0-9A-Za-z.+_-]{1,40}$/.test(installerVersion)) throw new Error("Fabric returned an invalid installer version.");
  const installerUrl = "https://maven.fabricmc.net/net/fabricmc/fabric-installer/" + encodeURIComponent(installerVersion) + "/fabric-installer-" + encodeURIComponent(installerVersion) + ".jar";
  const installerResponse = await fetch(installerUrl, { headers: { "Accept": "application/java-archive" }, signal: AbortSignal.timeout(120000) });
  if (!installerResponse.ok) throw new Error("Could not download the official Fabric installer (HTTP " + installerResponse.status + ").");
  const installerBytes = await readLimitedResponse(installerResponse, 32 * 1024 * 1024);
  if (installerBytes.subarray(0, 2).toString("hex") !== "504b") throw new Error("The Fabric installer download was not a valid JAR file.");

  const downloadDirectory = path.join(minecraftRoot, "launcher-downloads");
  await fs.mkdir(downloadDirectory, { recursive: true });
  const installerPath = path.join(downloadDirectory, "fabric-installer-" + installerVersion + ".jar");
  await fs.writeFile(installerPath, installerBytes);
  const result = spawnSync(javaPath, [
    "-jar", installerPath, "client", "-dir", minecraftRoot,
    "-mcversion", minecraftVersion, "-loader", loaderVersion
  ], { encoding: "utf8", timeout: 180000, windowsHide: true, maxBuffer: 4 * 1024 * 1024 });
  if (result.error) {
    if (result.error.code === "ETIMEDOUT") throw new Error("Fabric Loader installation timed out. Try again.");
    throw new Error("Could not run the Fabric installer: " + result.error.message);
  }
  if (result.status !== 0 || !(await pathExists(profilePath))) {
    const detail = String(result.stderr || result.stdout || "").replace(/[\\r\\n]+/g, " ").trim().slice(-240);
    throw new Error("Fabric Loader could not be installed." + (detail ? " " + detail : " Check the Logs page and try again."));
  }
  return profileId;
}

async function launchInstanceInternal(instanceId) {
  const id = String(instanceId || "");
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw new Error("This Minecraft instance is invalid.");
  if (activeLaunches.has(id)) throw new Error("This Minecraft instance is already running.");
  const instances = await readInstances();
  const instance = instances.find((item) => item.id === id);
  if (!instance) throw new Error("This Minecraft instance could not be found.");
  const loader = String(instance.pack?.loader || "Vanilla");
  const isFabricPack = /(?:^|[,\s])fabric-loader\s+[0-9][A-Za-z0-9.+_-]*/i.test(loader);
  const isVanillaPack = !loader || loader === "Vanilla";
  if (!isVanillaPack && !isFabricPack) {
    throw new Error("This pack uses " + loader + ". Moon Launcher can currently launch Vanilla and Fabric modpacks; Forge/NeoForge support is not available yet.");
  }

  const account = await getUsableMinecraftAccount(id);
  reportLaunchProgress(id, "preparing", "Checking Minecraft files…");
  const versionDetails = await fetchMinecraftVersionDetails(instance.minecraftVersion);
  const javaPath = await installJavaRuntime(versionDetails.javaMajor, id);
  const minecraftRoot = getMinecraftRootPath();
  const instanceDirectory = path.join(getInstancesPath(), id);
  await fs.mkdir(minecraftRoot, { recursive: true });
  await fs.mkdir(instanceDirectory, { recursive: true });
  const launchVersion = isFabricPack
    ? await installFabricLoader(javaPath, minecraftRoot, instance.minecraftVersion, loader, id)
    : instance.minecraftVersion;
  const installedVersionDirectory = path.join(minecraftRoot, "versions", launchVersion);
  const installedVersionJson = path.join(installedVersionDirectory, launchVersion + ".json");
  const installedVersionJar = path.join(installedVersionDirectory, launchVersion + ".jar");
  const minecraftAlreadyInstalled = await pathExists(installedVersionJson) && await pathExists(installedVersionJar);
  reportLaunchProgress(
    id,
    minecraftAlreadyInstalled ? "preparing" : "downloading-game",
    minecraftAlreadyInstalled
      ? "Minecraft " + instance.minecraftVersion + " is already installed. Skipping game-file verification…" 
      : "Installing Minecraft " + instance.minecraftVersion + "…"
  );

  const { Client } = require("minecraft-launcher-core");
  const launcher = new Client();
  let lastProgressAt = 0;
  launcher.on("progress", () => {
    const now = Date.now();
    if (now - lastProgressAt < 350) return;
    lastProgressAt = now;
    reportLaunchProgress(id, "downloading-game", "Downloading Minecraft files…");
  });
  const totalMemoryGb = Math.floor(os.totalmem() / 1024 / 1024 / 1024);
  const requestedMemoryGb = launcherPreferences.memoryGb === "auto"
    ? Math.max(2, Math.min(6, Math.floor(totalMemoryGb / 3)))
    : Number(launcherPreferences.memoryGb);
  const maximumMemoryGb = Math.max(2, Math.min(requestedMemoryGb, Math.max(2, totalMemoryGb - 1)));
  let gameProcess;
  try {
    gameProcess = await launcher.launch({
      authorization: {
        access_token: account.minecraftAccessToken,
        client_token: crypto.randomUUID(),
        uuid: account.profile.id,
        name: account.profile.name,
        user_properties: "{}",
        meta: account.offline === true
          ? { type: "mojang", demo: false }
          : { type: "msa", demo: false, xuid: account.xuid, clientId: account.clientId }
      },
      root: minecraftRoot,
      version: { number: launchVersion, type: versionDetails.type },
      // Skip update verification when the selected version metadata and client JAR already exist.
      skipUpdate: minecraftAlreadyInstalled,
      javaPath, memory: { min: "1G", max: maximumMemoryGb + "G" },
      overrides: { gameDirectory: instanceDirectory, maxSockets: launcherPreferences.downloadConnections },
      window: { fullscreen: launcherPreferences.fullscreen }
    });
  } catch (error) {
    reportLaunchProgress(id, "error", "Minecraft could not start.");
    if (error.code === "ENOENT") throw new Error("Java could not start. Try reinstalling this instance's Java runtime.");
    throw new Error(error.message || "Minecraft could not start.");
  }
  activeLaunches.set(id, gameProcess);
  const forwardMinecraftOutput = (chunk, logLevel) => {
    const lines = String(chunk || "").split(/\r?\n/);
    for (const line of lines) {
      const message = line.trimEnd();
      if (message) reportLaunchProgress(id, "game-log", message, { logLevel });
    }
  };
  if (gameProcess.stdout) gameProcess.stdout.on("data", (chunk) => forwardMinecraftOutput(chunk, "info"));
  if (gameProcess.stderr) gameProcess.stderr.on("data", (chunk) => forwardMinecraftOutput(chunk, "warning"));
  gameProcess.once("error", (error) => {
    activeLaunches.delete(id);
    reportLaunchProgress(id, "error", error.code === "ENOENT" ? "Java could not start." : "Minecraft failed to start.");
  });
  gameProcess.once("close", (code) => {
    activeLaunches.delete(id);
    reportLaunchProgress(id, "closed", code === 0 ? "Minecraft closed." : "Minecraft closed with an error.");
  });
  const latestInstances = await readInstances();
  const index = latestInstances.findIndex((item) => item.id === id);
  if (index >= 0 && latestInstances[index].installState !== "installed") {
    latestInstances[index] = { ...latestInstances[index], installState: "installed" };
    await writeInstances(latestInstances);
  }
  reportLaunchProgress(id, "running", "Minecraft is running.");
  return { started: true, instanceId: id };
}

async function launchInstance(instanceId) {
  const id = String(instanceId || "");
  if (activeLaunches.has(id) || pendingLaunches.has(id)) {
    throw new Error("This Minecraft instance is already running or starting.");
  }
  // Reserve the instance synchronously before any async setup work so rapid clicks
  // cannot start two launch sequences for the same instance.
  pendingLaunches.add(id);
  try {
    return await launchInstanceInternal(id);
  } finally {
    pendingLaunches.delete(id);
  }
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

async function searchModpacks(input) {
  const options = input && typeof input === "object" ? input : { query: input };
  const query = String(options.query || "").slice(0, 100);
  const page = Math.max(1, Math.min(500, Math.floor(Number(options.page) || 1)));
  const limit = 20;
  const params = new URLSearchParams({
    query,
    facets: '[["project_type:modpack"]]',
    limit: String(limit),
    offset: String((page - 1) * limit),
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
  return {
    projects: (data.hits || []).map((project) => ({
      id: project.project_id,
      slug: project.slug,
      title: project.title,
      description: project.description,
      iconUrl: project.icon_url,
      downloads: project.downloads
    })),
    total: Number(data.total) || 0,
    page,
    pageSize: limit
  };
}

function openProject(slug) {
  const safeSlug = String(slug || "");
  if (!/^[a-zA-Z0-9_-]+$/.test(safeSlug)) throw new Error("Invalid Modrinth project link.");
  return shell.openExternal("https://modrinth.com/modpack/" + encodeURIComponent(safeSlug));
}

async function findInstance(instanceId) {
  const id = String(instanceId || "");
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw new Error("Choose a valid Minecraft instance.");
  const instance = (await readInstances()).find((item) => item.id === id);
  if (!instance) throw new Error("That Minecraft instance could not be found.");
  return instance;
}
async function listInstanceMods(instanceId) {
  const instance = await findInstance(instanceId);
  const directory = path.join(getInstancesPath(), instance.id, "mods");
  await fs.mkdir(directory, { recursive: true });
  const entries = await fs.readdir(directory, { withFileTypes: true });
  const mods = [];
  for (const entry of entries) {
    if (!entry.isFile() || !/\.jar(?:\.disabled)?$/i.test(entry.name)) continue;
    const stat = await fs.stat(path.join(directory, entry.name));
    mods.push({ name: entry.name, enabled: !entry.name.toLowerCase().endsWith(".jar.disabled"), size: stat.size });
  }
  return { instanceId: instance.id, instanceName: instance.name, directory, mods: mods.sort((a, b) => a.name.localeCompare(b.name)) };
}
async function toggleInstanceMod(instanceId, fileName) {
  const instance = await findInstance(instanceId);
  const name = String(fileName || "");
  if (!name || name !== path.basename(name) || !/\.jar(?:\.disabled)?$/i.test(name)) throw new Error("Invalid mod file name.");
  const directory = path.join(getInstancesPath(), instance.id, "mods");
  const source = path.join(directory, name);
  const stat = await fs.lstat(source).catch(() => null);
  if (!stat?.isFile() || stat.isSymbolicLink()) throw new Error("That mod file was not found.");
  const destinationName = name.toLowerCase().endsWith(".jar.disabled") ? name.slice(0, -9) : name + ".disabled";
  await fs.rename(source, path.join(directory, destinationName));
  return listInstanceMods(instance.id);
}
async function deleteInstanceMod(instanceId, fileName) {
  const instance = await findInstance(instanceId);
  const name = String(fileName || "");
  if (!name || name !== path.basename(name) || !/\.jar(?:\.disabled)?$/i.test(name)) throw new Error("Invalid mod file name.");
  const target = path.join(getInstancesPath(), instance.id, "mods", name);
  const stat = await fs.lstat(target).catch(() => null);
  if (!stat?.isFile() || stat.isSymbolicLink()) throw new Error("That mod file was not found.");
  await fs.rm(target);
  return listInstanceMods(instance.id);
}
async function openInstanceModsFolder(instanceId) {
  const instance = await findInstance(instanceId);
  const directory = path.join(getInstancesPath(), instance.id, "mods");
  await fs.mkdir(directory, { recursive: true });
  const error = await shell.openPath(directory);
  if (error) throw new Error(error);
  return true;
}
async function readServers() {
  try {
    const data = JSON.parse(await fs.readFile(getServersPath(), "utf8"));
    return Array.isArray(data.servers) ? data.servers : [];
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw new Error("The saved server list could not be read.");
  }
}
async function writeServers(servers) {
  const target = getServersPath();
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(target + ".tmp", JSON.stringify({ servers }, null, 2), "utf8");
  await fs.rename(target + ".tmp", target);
  return servers;
}
function validateServerAddress(value) {
  const address = String(value || "").trim();
  if (address.length > 255 || /[\s/\\?#@]/.test(address)) throw new Error("Enter a server hostname or hostname:port, without a URL.");
  const match = address.match(/^([a-zA-Z0-9.-]+)(?::([0-9]{1,5}))?$/);
  if (!match || match[1].startsWith(".") || match[1].endsWith(".") || match[1].includes("..")) throw new Error("Enter a valid server address, such as play.example.net:25565.");
  if (match[2] && (Number(match[2]) < 1 || Number(match[2]) > 65535)) throw new Error("Server port must be between 1 and 65535.");
  return address;
}
async function addServer(input = {}) {
  const name = cleanName(input.name);
  const address = validateServerAddress(input.address);
  if (!name) throw new Error("Enter a name for this server.");
  const servers = await readServers();
  if (servers.some((item) => item.address.toLowerCase() === address.toLowerCase())) throw new Error("That server address is already saved.");
  servers.unshift({ id: crypto.randomUUID(), name, address, createdAt: new Date().toISOString() });
  return writeServers(servers);
}
async function removeServer(serverId) {
  const servers = await readServers();
  return writeServers(servers.filter((item) => item.id !== String(serverId || "")));
}
async function chooseCustomBackground() {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: "Choose Moon Launcher background",
    properties: ["openFile"],
    filters: [{ name: "Images", extensions: ["png", "jpg", "jpeg", "webp"] }]
  });
  if (result.canceled || !result.filePaths[0]) return { canceled: true };
  const source = result.filePaths[0];
  const stat = await fs.stat(source);
  if (!stat.isFile() || stat.size > 12 * 1024 * 1024) throw new Error("Choose an image smaller than 12 MB.");
  const extension = path.extname(source).toLowerCase();
  const target = getBackgroundPath() + extension;
  for (const ext of [".png", ".jpg", ".jpeg", ".webp"]) await fs.rm(getBackgroundPath() + ext, { force: true });
  await fs.copyFile(source, target);
  return { dataUrl: await readBackgroundDataUrl(target), extension };
}
async function readBackgroundDataUrl(filePath) {
  const bytes = await fs.readFile(filePath);
  const mime = { ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp" }[path.extname(filePath).toLowerCase()];
  return "data:" + mime + ";base64," + bytes.toString("base64");
}
async function getCustomBackground() {
  for (const ext of [".png", ".jpg", ".jpeg", ".webp"]) {
    const target = getBackgroundPath() + ext;
    if (await pathExists(target)) return { dataUrl: await readBackgroundDataUrl(target), extension: ext };
  }
  return { dataUrl: "", extension: "" };
}
async function resetCustomBackground() {
  for (const ext of [".png", ".jpg", ".jpeg", ".webp"]) await fs.rm(getBackgroundPath() + ext, { force: true });
  return { dataUrl: "" };
}


autoUpdater.autoDownload = true;
autoUpdater.autoInstallOnAppQuit = true;
autoUpdater.allowPrerelease = false;

function sendUpdateStatus(status) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send("updates:status", status);
  }
}

autoUpdater.on("checking-for-update", () => sendUpdateStatus({ state: "checking", message: "Checking for updates…" }));
autoUpdater.on("update-available", (info) => sendUpdateStatus({ state: "available", message: "Update " + info.version + " found. Downloading…", version: info.version }));
autoUpdater.on("update-not-available", (info) => sendUpdateStatus({ state: "current", message: "Moon Launcher is up to date.", version: info.version }));
autoUpdater.on("download-progress", (progress) => sendUpdateStatus({
  state: "downloading",
  message: "Downloading update… " + Math.round(progress.percent) + "%",
  percent: Math.round(progress.percent)
}));
autoUpdater.on("update-downloaded", (info) => sendUpdateStatus({
  state: "downloaded",
  message: "Update " + info.version + " is ready to install. Restart Moon Launcher to finish.",
  version: info.version
}));
autoUpdater.on("error", (error) => {
  console.error("Moon Launcher update check failed:", error);
  const detail = String(error?.message || "Unknown updater error").replace(/[\\r\\n]+/g, " ").slice(0, 220);
  sendUpdateStatus({ state: "error", message: "Update check failed: " + detail });
});

async function checkForLauncherUpdates() {
  if (!app.isPackaged) {
    const result = { state: "development", message: "Updates are available in the installed version of Moon Launcher." };
    sendUpdateStatus(result);
    return result;
  }
  try {
    await autoUpdater.checkForUpdates();
    return { state: "checking", message: "Checking for updates…" };
  } catch (error) {
    console.error("Moon Launcher update check failed:", error);
    const detail = String(error?.message || "Unknown updater error").replace(/[\\r\\n]+/g, " ").slice(0, 220);
    const result = { state: "error", message: "Update check failed: " + detail };
    sendUpdateStatus(result);
    return result;
  }
}

ipcMain.handle("updates:check", checkForLauncherUpdates);
ipcMain.handle("updates:install", () => {
  if (!app.isPackaged) throw new Error("Install updates from a packaged build.");
  autoUpdater.quitAndInstall(false, true);
  return true;
});
ipcMain.handle("versions:list", fetchVersions);
ipcMain.handle("instances:list", readInstances);
ipcMain.handle("instances:delete", (_event, instanceId) => deleteInstance(instanceId));
ipcMain.handle("instances:create", (_event, input) => createInstance(input || {}));
ipcMain.handle("modpacks:import", importModpack);
ipcMain.handle("modpacks:search", (_event, query) => searchModpacks(query));
ipcMain.handle("modpacks:versions", (_event, project) => getModrinthPackVersions(project || {}));
ipcMain.handle("modpacks:install", (_event, project, versionId) => installModrinthPack(project || {}, versionId));
ipcMain.handle("modpacks:open", (_event, slug) => openProject(slug));
ipcMain.handle("mods:list", (_event, instanceId) => listInstanceMods(instanceId));
ipcMain.handle("mods:toggle", (_event, instanceId, fileName) => toggleInstanceMod(instanceId, fileName));
ipcMain.handle("mods:delete", (_event, instanceId, fileName) => deleteInstanceMod(instanceId, fileName));
ipcMain.handle("mods:open-folder", (_event, instanceId) => openInstanceModsFolder(instanceId));
ipcMain.handle("servers:list", readServers);
ipcMain.handle("servers:add", (_event, input) => addServer(input || {}));
ipcMain.handle("servers:remove", (_event, serverId) => removeServer(serverId));
ipcMain.handle("appearance:choose-background", chooseCustomBackground);
ipcMain.handle("appearance:get-background", getCustomBackground);
ipcMain.handle("appearance:reset-background", resetCustomBackground);
ipcMain.handle("auth:profiles", listSavedAccounts);
ipcMain.handle("auth:switch-profile", (_event, uuid) => switchSavedAccount(uuid));
ipcMain.handle("auth:remove-profile", (_event, uuid) => removeSavedAccount(uuid));
ipcMain.handle("auth:status", getAccountStatus);
ipcMain.handle("auth:save-client-id", (_event, clientId) => saveMicrosoftClientId(clientId));
ipcMain.handle("auth:sign-in", signInWithMicrosoft);
ipcMain.handle("auth:create-offline", (_event, username) => createOfflineAccount(username));
ipcMain.handle("auth:cancel", () => { authCancelRequested = true; return true; });
ipcMain.handle("auth:sign-out", signOutMicrosoft);
ipcMain.handle("auth:open-verification", async (_event, value) => {
  const url = new URL(String(value || ""));
  if (url.protocol !== "https:" || !["microsoft.com", "www.microsoft.com", "login.microsoftonline.com"].includes(url.hostname.toLowerCase())) throw new Error("This Microsoft sign-in link is not trusted.");
  await shell.openExternal(url.href);
  return true;
});
ipcMain.handle("auth:open-registration", async () => { await shell.openExternal("https://entra.microsoft.com/#view/Microsoft_AAD_RegisteredApps/ApplicationsListBlade"); return true; });
ipcMain.handle("launcher:launch-instance", (_event, instanceId) => launchInstance(instanceId));
ipcMain.handle("settings:get", () => ({ ...launcherPreferences }));
ipcMain.handle("settings:save", (_event, settings = {}) => writeLauncherPreferences({
  memoryGb: settings.memoryGb,
  downloadConnections: settings.downloadConnections,
  fullscreen: settings.fullscreen === true
}));
ipcMain.handle("settings:choose-directory", chooseLauncherDirectory);
ipcMain.handle("launcher:open-data-folder", async () => {
  await fs.mkdir(getInstancesPath(), { recursive: true });
  return shell.openPath(launcherPreferences.gameDirectory);
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

app.whenReady().then(async () => {
  await loadLauncherPreferences();
  createWindow();
  if (app.isPackaged) setTimeout(() => { checkForLauncherUpdates(); }, 8000);
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});