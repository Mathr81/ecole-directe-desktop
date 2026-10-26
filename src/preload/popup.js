// Pont de la fenetre popup. Elle heberge une <webview> sur des sites tiers :
// son habillage ne doit donc avoir ni Node ni acces direct a shell.
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("popup", {
  onLoadUrl: (callback) => ipcRenderer.on("load-url", (_event, url) => callback(url)),
  copyUrl: (url) => ipcRenderer.send("popup-copy-url", url),
  // Le protocole est verifie dans le processus principal, pas ici.
  openExternal: (url) => ipcRenderer.send("popup-open-external", url),
});
