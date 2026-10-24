const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("moonLauncher", Object.freeze({
  getVersions: () => ipcRenderer.invoke("versions:list"),
  getInstances: () => ipcRenderer.invoke("instances:list"),
  createInstance: (input) => ipcRenderer.invoke("instances:create", input),
  importModpack: () => ipcRenderer.invoke("modpacks:import"),
  searchModpacks: (query) => ipcRenderer.invoke("modpacks:search", query),
  installModrinthPack: (project) => ipcRenderer.invoke("modpacks:install", project),
  onModpackProgress: (callback) => {
    if (typeof callback !== "function") return () => {};
    const listener = (_event, progress) => callback(progress);
    ipcRenderer.on("modpacks:progress", listener);
    return () => ipcRenderer.removeListener("modpacks:progress", listener);
  },
  openModrinthProject: (slug) => ipcRenderer.invoke("modpacks:open", slug),
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