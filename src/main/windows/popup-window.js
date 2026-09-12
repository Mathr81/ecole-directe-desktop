const { BrowserWindow, clipboard, ipcMain, screen } = require("electron");
const path = require("path");
const { getAssetPath } = require("../lib/paths");
const { registerWindowShortcuts } = require("../features/shortcuts");
const { loadWindowState, saveWindowState } = require("../lib/window-state");
const { applyWindowPolicy } = require("./window-policy");

const MIN_WIDTH = 520;
const MIN_HEIGHT = 360;
// Proportion de la zone de travail utilisee par defaut. Une taille en dur
// deborde sur un 1366x768 et parait minuscule sur un grand ecran.
const DEFAULT_RATIO = 0.72;

function defaultPopupSize() {
  const { width, height } = screen.getPrimaryDisplay().workAreaSize;
  return {
    width: Math.max(MIN_WIDTH, Math.min(Math.round(width * DEFAULT_RATIO), width)),
    height: Math.max(MIN_HEIGHT, Math.min(Math.round(height * DEFAULT_RATIO), height)),
  };
}

// Taille retenue de la derniere ouverture, ramenee dans la zone de travail
// au cas ou l'utilisateur aurait change d'ecran depuis.
function popupSize() {
  const { width: maxW, height: maxH } = screen.getPrimaryDisplay().workAreaSize;
  const saved = loadWindowState("popup");
  if (!saved) return defaultPopupSize();
  return {
    width: Math.max(MIN_WIDTH, Math.min(saved.width, maxW)),
    height: Math.max(MIN_HEIGHT, Math.min(saved.height, maxH)),
  };
}

function createPopupWindow(url) {
  const { width, height } = popupSize();

  const popup = new BrowserWindow({
    width,
    height,
    minWidth: MIN_WIDTH,
    minHeight: MIN_HEIGHT,
    useContentSize: true,
    title: "Lien externe",
    icon: getAssetPath("icons", "icon.ico"),
    frame: false,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
      webviewTag: true,
    },
  });

  popup.loadFile(path.join(__dirname, "..", "..", "renderer", "popup", "popup.html"));

  popup.webContents.once("did-finish-load", () => {
    popup.webContents.send("load-url", url);
  });

  // La copie passe par le processus principal : Electron 44 a retire le
  // module clipboard des renderers (navigator.clipboard reste, mais depend
  // d'une activation utilisateur et d'une permission).
  const copyUrl = (event, url) => {
    if (typeof url === "string" && url !== "") clipboard.writeText(url);
  };
  ipcMain.on("popup-copy-url", copyUrl);

  popup.on("closed", () => ipcMain.removeListener("popup-copy-url", copyUrl));

  registerWindowShortcuts(popup);

  // La <webview> porte allowpopups mais n'heritait d'aucune politique : un
  // lien clique dedans ouvrait donc une fenetre nue, sans barre d'adresse
  // ni actions. Elle ouvre maintenant un popup habille, comme la fenetre
  // principale.
  popup.webContents.on("did-attach-webview", (_event, guest) => {
    applyWindowPolicy(guest, { openPopup: createPopupWindow });
  });

  popup.on("resize", () => {
    if (popup.isDestroyed() || popup.isMaximized() || popup.isMinimized()) return;
    const [w, h] = popup.getContentSize();
    saveWindowState("popup", { width: w, height: h });
  });

  return popup;
}

module.exports = { createPopupWindow };
