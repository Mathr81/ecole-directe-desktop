const { BrowserWindow, session, screen } = require("electron");
const path = require("path");
const { getAssetPath } = require("../lib/paths");
const { registerWindowShortcuts, runShortcut } = require("../features/shortcuts");
const { loadWindowState, saveWindowState } = require("../lib/window-state");
const { createPopupWindow } = require("./popup-window");
const { showPalette } = require("./palette-window");

const DEFAULT_WIDTH = 1400;
const DEFAULT_HEIGHT = 900;
// Un deplacement de fenetre emet des dizaines d'evenements par seconde :
// on n'ecrit sur le disque qu'une fois le geste termine.
const PERSIST_DEBOUNCE_MS = 400;

function debounce(fn, delay) {
  let timer = null;
  const wrapped = (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), delay);
  };
  wrapped.cancel = () => clearTimeout(timer);
  return wrapped;
}

function createMainWindow() {
  const saved = loadWindowState("main", screen.getAllDisplays());

  const mainWindow = new BrowserWindow({
    width: saved ? saved.width : DEFAULT_WIDTH,
    height: saved ? saved.height : DEFAULT_HEIGHT,
    // Sans position enregistree exploitable, on laisse Electron centrer.
    ...(saved && saved.hasPosition ? { x: saved.x, y: saved.y } : {}),
    icon: getAssetPath("icons", "icon.ico"),
    webPreferences: {
      session: session.defaultSession,
      sandbox: true,
      contextIsolation: true,
      devTools: true,
      preload: path.join(__dirname, "..", "..", "preload", "ed-session.js"),
    },
  });

  if (saved && saved.maximized) mainWindow.maximize();

  // ---- Persistance de la geometrie -----------------------------------
  //
  // On n'enregistre que la taille NORMALE : prendre les bornes d'une
  // fenetre maximisee reviendrait a memoriser la taille de l'ecran, et la
  // fenetre ne saurait plus revenir a son format precedent.
  //
  // getNormalBounds et NON useContentSize + getContentBounds. Mesure faite
  // sous Windows 11 en reinjectant la valeur lue au cycle suivant :
  //
  //   getNormalBounds        1111x777 -> 1113x779 -> 1114x780 -> stable
  //   getContentBounds       1111x777 -> 1112x780 -> 1112x782 -> 1112x784…
  //
  // Le second N'A PAS de point fixe : la fenetre grandit de deux pixels a
  // chaque ouverture, indefiniment. Le premier se stabilise apres un
  // ajustement unique de trois pixels. C'est donc lui qu'on garde.
  const persistBounds = debounce(() => {
    if (mainWindow.isDestroyed() || mainWindow.isMinimized()) return;
    if (mainWindow.isMaximized()) return;
    saveWindowState("main", mainWindow.getNormalBounds());
  }, PERSIST_DEBOUNCE_MS);

  mainWindow.on("resize", persistBounds);
  mainWindow.on("move", persistBounds);
  mainWindow.on("maximize", () => saveWindowState("main", { maximized: true }));
  mainWindow.on("unmaximize", () => saveWindowState("main", { maximized: false }));
  mainWindow.on("closed", () => persistBounds.cancel());

  // ---- Zoom ----------------------------------------------------------
  //
  // Le facteur se pose apres chaque chargement : Chromium le remet a 1 en
  // changeant de document, et le SPA navigue beaucoup.
  const zoom = saved ? saved.zoom : 1;
  mainWindow.webContents.on("did-finish-load", () => {
    if (zoom !== 1) mainWindow.webContents.setZoomFactor(zoom);
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith("about:") || url.startsWith("devtools:")) {
      return { action: "allow" };
    }

    // blob: et data: sont des telechargements generes par la page.
    // Electron ne sait pas les telecharger directement, on laisse la
    // page les gerer elle-meme.
    if (url.startsWith("blob:") || url.startsWith("data:")) {
      return { action: "allow" };
    }

    if (url.includes("api.ecoledirecte.com")) {
      return { action: "allow" };
    }

    createPopupWindow(url);
    return { action: "deny" };
  });

  mainWindow.webContents.on("did-finish-load", () => {
    mainWindow.webContents.executeJavaScript(`
      const _originalOpen = window.open.bind(window);
      window.open = function(url, ...args) {
        if (url && (url.startsWith('blob:') || url.startsWith('data:'))) {
          const a = document.createElement('a');
          a.href = url;
          a.download = '';
          document.body.appendChild(a);
          a.click();
          document.body.removeChild(a);
          return null;
        }
        return _originalOpen(url, ...args);
      };
    `).catch(() => {});
  });

  registerWindowShortcuts(mainWindow, {
    onAction: (action, contents) => {
      if (action === "palette") {
        showPalette(mainWindow);
        return true;
      }
      // Le zoom est applique ici plutot que dans runShortcut seul, parce
      // que c'est cette fenetre — et elle seule — qui sait le conserver.
      if (action.startsWith("zoom-")) {
        runShortcut(action, contents);
        saveWindowState("main", { zoom: contents.getZoomFactor() });
        return true;
      }
      return false;
    },
  });

  return mainWindow;
}

module.exports = { createMainWindow };
