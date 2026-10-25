const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("moonLauncher", Object.freeze({
  checkForUpdates: () => ipcRenderer.invoke("updates:check"),
  installUpdate: () => ipcRenderer.invoke("updates:install"),
  onUpdateStatus: (callback) => {
    if (typeof callback !== "function") return () => {};
    const listener = (_event, status) => callback(status);
    ipcRenderer.on("updates:status", listener);
    return () => ipcRenderer.removeListener("updates:status", listener);
  },
  getVersions: () => ipcRenderer.invoke("versions:list"),
  getInstances: () => ipcRenderer.invoke("instances:list"),
  createInstance: (input) => ipcRenderer.invoke("instances:create", input),
  importModpack: () => ipcRenderer.invoke("modpacks:import"),
  searchModpacks: (options) => ipcRenderer.invoke("modpacks:search", options),
  getModrinthPackVersions: (project) => ipcRenderer.invoke("modpacks:versions", project),
  installModrinthPack: (project, versionId) => ipcRenderer.invoke("modpacks:install", project, versionId),
  onModpackProgress: (callback) => {
    if (typeof callback !== "function") return () => {};
    const listener = (_event, progress) => callback(progress);
    ipcRenderer.on("modpacks:progress", listener);
    return () => ipcRenderer.removeListener("modpacks:progress", listener);
  },
  openModrinthProject: (slug) => ipcRenderer.invoke("modpacks:open", slug),
  listInstanceMods: (instanceId) => ipcRenderer.invoke("mods:list", instanceId),
  toggleInstanceMod: (instanceId, fileName) => ipcRenderer.invoke("mods:toggle", instanceId, fileName),
  deleteInstanceMod: (instanceId, fileName) => ipcRenderer.invoke("mods:delete", instanceId, fileName),
  openInstanceModsFolder: (instanceId) => ipcRenderer.invoke("mods:open-folder", instanceId),
  getServers: () => ipcRenderer.invoke("servers:list"),
  addServer: (server) => ipcRenderer.invoke("servers:add", server),
  removeServer: (serverId) => ipcRenderer.invoke("servers:remove", serverId),
  chooseCustomBackground: () => ipcRenderer.invoke("appearance:choose-background"),
  getCustomBackground: () => ipcRenderer.invoke("appearance:get-background"),
  resetCustomBackground: () => ipcRenderer.invoke("appearance:reset-background"),
  getSavedAccounts: () => ipcRenderer.invoke("auth:profiles"),
  switchSavedAccount: (uuid) => ipcRenderer.invoke("auth:switch-profile", uuid),
  removeSavedAccount: (uuid) => ipcRenderer.invoke("auth:remove-profile", uuid),
  getAccountStatus: () => ipcRenderer.invoke("auth:status"),
  saveMicrosoftClientId: (clientId) => ipcRenderer.invoke("auth:save-client-id", clientId),
  signInMicrosoft: () => ipcRenderer.invoke("auth:sign-in"),
  cancelSignIn: () => ipcRenderer.invoke("auth:cancel"),
  signOutMicrosoft: () => ipcRenderer.invoke("auth:sign-out"),
  openMicrosoftVerification: (url) => ipcRenderer.invoke("auth:open-verification", url),
  openMicrosoftRegistration: () => ipcRenderer.invoke("auth:open-registration"),
  launchInstance: (instanceId) => ipcRenderer.invoke("launcher:launch-instance", instanceId),
  getSettings: () => ipcRenderer.invoke("settings:get"),
  saveSettings: (settings) => ipcRenderer.invoke("settings:save", settings),
  chooseLauncherDirectory: () => ipcRenderer.invoke("settings:choose-directory"),
  onAuthProgress: (callback) => {
    if (typeof callback !== "function") return () => {};
    const listener = (_event, progress) => callback(progress);
    ipcRenderer.on("auth:progress", listener);
    return () => ipcRenderer.removeListener("auth:progress", listener);
  },
  onLauncherProgress: (callback) => {
    if (typeof callback !== "function") return () => {};
    const listener = (_event, progress) => callback(progress);
    ipcRenderer.on("launcher:progress", listener);
    return () => ipcRenderer.removeListener("launcher:progress", listener);
  },
  openInstanceFolder: () => ipcRenderer.invoke("launcher:open-data-folder"),
  minimizeWindow: () => ipcRenderer.invoke("window:minimize"),
  toggleMaximizeWindow: () => ipcRenderer.invoke("window:toggle-maximize"),
  closeWindow: () => ipcRenderer.invoke("window:close")
}));