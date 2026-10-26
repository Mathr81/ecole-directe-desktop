// Pont commun des fenetres maison (connexion, 2FA, palette, telechargements,
// mise a jour). Elles tournent sous sandbox + contextIsolation : plus de
// require("electron") dans les pages, seulement ces canaux-la.
const { contextBridge, ipcRenderer } = require("electron");

const SEND = new Set([
  "submit-credentials",
  "twofa-answer",
  "palette:go",
  "palette:close",
  "downloads:ready",
  "downloads:rendered",
  "downloads:dismiss",
  "downloads:cancel",
  "downloads:open",
  "downloads:reveal",
  "update:ready",
  "update:install",
  "update:open-installer",
  "update:dismiss",
  "update:download-page",
]);

const RECEIVE = new Set([
  "login-error",
  "twofa-question",
  "palette:entries",
  "downloads:state",
  "update:view",
]);

contextBridge.exposeInMainWorld("ed", {
  send(channel, ...args) {
    if (SEND.has(channel)) ipcRenderer.send(channel, ...args);
  },
  on(channel, callback) {
    if (RECEIVE.has(channel)) ipcRenderer.on(channel, (_event, ...args) => callback(...args));
  },
});
