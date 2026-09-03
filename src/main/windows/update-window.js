const { BrowserWindow } = require("electron");
const path = require("path");
const { fitWindowToContent } = require("./fit-to-content");

// Meme largeur que les autres fenetres maison : une colonne de texte court
// ne gagne rien a s'elargir.
const WIDTH = 420;
const MIN_HEIGHT = 190;
const MAX_HEIGHT = 340;

let current = null;

/**
 * Fenetre unique : une mise a jour qui progresse ne doit pas empiler les
 * fenetres a chaque changement d'etat. Les appels suivants reutilisent
 * celle qui est deja ouverte.
 *
 * Volontairement NON modale : l'utilisateur peut continuer a travailler
 * pendant le telechargement, et refermer sans rien decider.
 */
async function showUpdateWindow(parent) {
  if (current && !current.isDestroyed()) {
    current.show();
    return current;
  }

  const win = new BrowserWindow({
    width: WIDTH,
    height: MIN_HEIGHT,
    minWidth: WIDTH,
    minHeight: MIN_HEIGHT,
    useContentSize: true,
    resizable: false,
    show: false,
    parent: parent && !parent.isDestroyed() ? parent : undefined,
    title: "Mise à jour",
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
    },
  });

  win.setMenuBarVisibility(false);
  current = win;
  win.on("closed", () => { if (current === win) current = null; });

  await win.loadFile(path.join(__dirname, "..", "..", "renderer", "update", "update.html"));
  await fitWindowToContent(win, { width: WIDTH, minHeight: MIN_HEIGHT, maxHeight: MAX_HEIGHT });
  win.show();

  return win;
}

function getUpdateWindow() {
  return current && !current.isDestroyed() ? current : null;
}

function closeUpdateWindow() {
  if (current && !current.isDestroyed()) current.close();
  current = null;
}

module.exports = { showUpdateWindow, getUpdateWindow, closeUpdateWindow };
