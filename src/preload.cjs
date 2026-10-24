const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("moonLauncher", Object.freeze({
  getVersions: () => ipcRenderer.invoke("versions:list"),
  getInstances: () => ipcRenderer.invoke("instances:list"),
  createInstance: (input) => ipcRenderer.invoke("instances:create", input),
  importModpack: () => ipcRenderer.invoke("modpacks:import"),
  searchModpacks: (query) => ipcRenderer.invoke("modpacks:search", query),
  openModrinthProject: (slug) => ipcRenderer.invoke("modpacks:open", slug),
  openInstanceFolder: () => ipcRenderer.invoke("launcher:open-data-folder")
}));