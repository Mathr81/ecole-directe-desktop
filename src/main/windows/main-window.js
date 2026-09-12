const { BrowserWindow, session, screen } = require("electron");
const path = require("path");
const { getAssetPath } = require("../lib/paths");
const { registerWindowShortcuts, runShortcut } = require("../features/shortcuts");
const { loadWindowState, saveWindowState } = require("../lib/window-state");
const { createPopupWindow } = require("./popup-window");
const { showPalette } = require("./palette-window");
const { applyWindowPolicy } = require("./window-policy");

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
  //
  // MUTABLE, et c'est tout l'enjeu : la version precedente capturait la
  // valeur enregistree dans un `const` a la creation de la fenetre. Le
  // raccourci ecrivait bien la nouvelle valeur sur le disque, mais la
  // fermeture capturee gardait l'ancienne et la reappliquait a chaque
  // navigation. Changer de page avec Ctrl+K annulait donc le zoom en
  // cours pour revenir a celui du demarrage.
  let currentZoom = saved ? saved.zoom : 1;

  const applyZoom = () => {
    if (mainWindow.isDestroyed()) return;
    mainWindow.webContents.setZoomFactor(currentZoom);
  };

  const rememberZoom = (factor) => {
    currentZoom = factor;
    saveWindowState("main", { zoom: factor });
  };

  mainWindow.webContents.on("did-finish-load", applyZoom);

  // Ctrl+molette est traite par Chromium lui-meme : sans cette ecoute, un
  // zoom fait a la molette serait perdu a la navigation suivante, puisque
  // seul le chemin des raccourcis mettait `currentZoom` a jour.
  mainWindow.webContents.on("zoom-changed", () => {
    // La valeur n'est lisible qu'apres que Chromium l'a appliquee.
    setImmediate(() => {
      if (!mainWindow.isDestroyed()) rememberZoom(mainWindow.webContents.getZoomFactor());
    });
  });

  // La politique vit dans window-policy.js et s'applique aussi aux invites
  // <webview> des popups : la poser ici seulement laissait tout autre
  // contexte ouvrir des fenetres nues.
  applyWindowPolicy(mainWindow.webContents, { openPopup: createPopupWindow });

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
        rememberZoom(contents.getZoomFactor());
        return true;
      }
      return false;
    },
  });

  return mainWindow;
}

module.exports = { createMainWindow };
