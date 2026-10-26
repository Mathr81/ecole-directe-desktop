const { BrowserWindow, ipcMain } = require("electron");
const path = require("path");
const { normalizeLinks } = require("../features/palette");

const WIDTH = 520;
const HEIGHT = 380;

let current = null;

// Actions de l'application, proposees apres les destinations du site :
// [{ id, label, run }]. Fournies par index.js, qui seul a le contexte.
let actions = [];
const ACTION_PREFIX = "action:";

function setPaletteActions(list) {
  actions = Array.isArray(list) ? list : [];
}

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

  const entries = [
    ...(await collectEntries(mainWindow)),
    ...actions.map((a) => ({ href: ACTION_PREFIX + a.id, label: a.label })),
  ];
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

  const go = (event, href) => {
    // Seules les entrees proposees sont acceptees : la page de la palette
    // ne doit pas pouvoir faire charger n'importe quelle URL.
    if (event.sender !== win.webContents || !entries.some((e) => e.href === href)) return;
    if (!win.isDestroyed()) win.close();

    if (href.startsWith(ACTION_PREFIX)) {
      const action = actions.find((a) => ACTION_PREFIX + a.id === href);
      if (action) Promise.resolve().then(action.run).catch((err) => console.error("Action de palette :", err));
      return;
    }
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.loadURL(href);
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

module.exports = { showPalette, collectEntries, setPaletteActions };
