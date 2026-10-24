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
  openInstanceFolder: () => ipcRenderer.invoke("launcher:open-data-folder"),
  minimizeWindow: () => ipcRenderer.invoke("window:minimize"),
  toggleMaximizeWindow: () => ipcRenderer.invoke("window:toggle-maximize"),
  closeWindow: () => ipcRenderer.invoke("window:close")
}));