const { BrowserWindow, ipcMain } = require("electron");
const path = require("path");
const { normalizeLinks } = require("../features/palette");

const WIDTH = 520;
const HEIGHT = 380;

let current = null;

// Releve les destinations sur la page elle-meme. Aucune classe, aucun
// selecteur specifique a EcoleDirecte : seulement <a href>, ce qui survit
// aux refontes du site.
const COLLECT = `
  Array.from(document.querySelectorAll("a[href]")).map((a) => ({
    href: a.href,
    text: a.textContent,
  }))
`;

async function collectEntries(mainWindow) {
  if (!mainWindow || mainWindow.isDestroyed()) return [];
  try {
    const raw = await mainWindow.webContents.executeJavaScript(COLLECT, true);
    return normalizeLinks(raw);
  } catch (err) {
    console.warn("Relevé des destinations impossible :", err.message);
    return [];
  }
}

async function showPalette(mainWindow) {
  if (current && !current.isDestroyed()) {
    current.focus();
    return current;
  }

  const entries = await collectEntries(mainWindow);
  if (entries.length === 0) {
    console.warn("Palette : aucune destination trouvée sur la page.");
    return null;
  }

  const win = new BrowserWindow({
    width: WIDTH,
    height: HEIGHT,
    useContentSize: true,
    frame: false,
    resizable: false,
    show: false,
    // Une palette est une surface transitoire : elle appartient a la
    // fenetre qu'elle sert et disparait des qu'on la quitte.
    parent: mainWindow && !mainWindow.isDestroyed() ? mainWindow : undefined,
    modal: false,
    webPreferences: { sandbox: true, contextIsolation: true, preload: path.join(__dirname, "..", "..", "preload", "ui.js") },
  });

  current = win;

  const go = (_event, href) => {
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.loadURL(href);
    if (!win.isDestroyed()) win.close();
  };
  const close = () => { if (!win.isDestroyed()) win.close(); };

  ipcMain.on("palette:go", go);
  ipcMain.on("palette:close", close);

  win.on("blur", close);
  win.on("closed", () => {
    ipcMain.removeListener("palette:go", go);
    ipcMain.removeListener("palette:close", close);
    if (current === win) current = null;
  });

  await win.loadFile(path.join(__dirname, "..", "..", "renderer", "palette", "palette.html"));
  win.webContents.send("palette:entries", entries);
  win.show();

  return win;
}

module.exports = { showPalette, collectEntries };
