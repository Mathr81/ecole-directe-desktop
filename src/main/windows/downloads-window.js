const { BrowserWindow, screen } = require("electron");
const path = require("path");
const { computeWindowSize } = require("./fit-to-content");

// Panneau etroit ancre dans le coin bas-droit de la fenetre principale, a
// la maniere de la zone de telechargement d'un navigateur.
const WIDTH = 340;
const MIN_HEIGHT = 96;
const MAX_HEIGHT = 340;
const MARGIN = 16;

let current = null;
let followParent = null;

/**
 * Coin bas-droit de la fenetre parente, decale de MARGIN.
 *
 * Partie decidable sans Electron, donc testable — y compris pour des
 * positions de parent qu'on ne peut pas reproduire ici.
 */
function anchorPosition(parentBounds, size, margin = MARGIN) {
  return {
    x: Math.round(parentBounds.x + parentBounds.width - size.width - margin),
    y: Math.round(parentBounds.y + parentBounds.height - size.height - margin),
  };
}

function reposition(win, parent) {
  if (!win || win.isDestroyed() || !parent || parent.isDestroyed()) return;
  const [width, height] = win.getSize();
  const { x, y } = anchorPosition(parent.getBounds(), { width, height });
  win.setPosition(x, y);
}

/**
 * Panneau unique : un second telechargement s'ajoute a la liste du panneau
 * ouvert, il n'en ouvre pas un autre.
 *
 * Affiche avec showInactive : un telechargement ne doit jamais voler le
 * focus a ce que l'utilisateur est en train de lire.
 */
async function showDownloads(parent) {
  if (current && !current.isDestroyed()) {
    if (!current.isVisible()) current.showInactive();
    reposition(current, parent);
    return current;
  }

  const win = new BrowserWindow({
    width: WIDTH,
    height: MIN_HEIGHT,
    minWidth: WIDTH,
    minHeight: MIN_HEIGHT,
    useContentSize: true,
    frame: false,
    resizable: false,
    show: false,
    skipTaskbar: true,
    // Enfant de la fenetre principale : il reste au-dessus d'elle et
    // disparait avec elle, sans encombrer la barre des taches.
    parent: parent && !parent.isDestroyed() ? parent : undefined,
    webPreferences: { nodeIntegration: true, contextIsolation: false },
  });

  current = win;

  await win.loadFile(
    path.join(__dirname, "..", "..", "renderer", "downloads", "downloads.html")
  );

  // Le panneau suit la fenetre principale : sans cela, deplacer celle-ci
  // laisserait le panneau en plan au milieu de l'ecran.
  if (parent && !parent.isDestroyed()) {
    followParent = () => reposition(win, parent);
    parent.on("move", followParent);
    parent.on("resize", followParent);
  }

  win.on("closed", () => {
    if (parent && !parent.isDestroyed() && followParent) {
      parent.removeListener("move", followParent);
      parent.removeListener("resize", followParent);
    }
    followParent = null;
    if (current === win) current = null;
  });

  reposition(win, parent);
  win.showInactive();

  return win;
}

// Mesure la hauteur que le contenu VEUT occuper.
//
// On ne peut pas reutiliser fitWindowToContent ici : il mesure le deficit
// d'un conteneur `.ed-body`, ce qui ne sait que faire grandir une fenetre.
// Le panneau, lui, doit aussi rapetisser — il passe de trois lignes a une
// seule d'un telechargement au suivant. On additionne donc l'entete et la
// hauteur reelle du contenu de la liste, que `scrollHeight` donne sans se
// laisser borner par la hauteur visible.
const MEASURE = `(() => {
  const head = document.querySelector(".dl__head");
  const list = document.querySelector(".dl__list");
  const empty = document.querySelector(".dl__empty");
  const body = (list && list.scrollHeight)
    || (empty && !empty.hidden ? empty.offsetHeight : 0);
  return (head ? head.offsetHeight : 0) + body;
})()`;

/** Reajuste la hauteur au nombre de lignes, puis reancre le panneau. */
async function fitDownloads(parent) {
  const win = getDownloadsWindow();
  if (!win) return;

  let natural = MIN_HEIGHT;
  try {
    // +2 pour les bordures haute et basse, que la mesure du contenu ignore.
    natural = (await win.webContents.executeJavaScript(MEASURE, true)) + 2;
  } catch {
    // Mesure impossible : on garde une fenetre au minimum utilisable.
  }

  const workArea = screen.getDisplayMatching(win.getBounds()).workAreaSize;
  const height = computeWindowSize({
    natural,
    min: MIN_HEIGHT,
    max: MAX_HEIGHT,
    workArea: workArea.height,
  });

  if (win.isDestroyed()) return;
  win.setContentSize(WIDTH, Math.round(height));
  reposition(win, parent);
}

function getDownloadsWindow() {
  return current && !current.isDestroyed() ? current : null;
}

// On masque au lieu de detruire : le panneau resservira au telechargement
// suivant, et recharger son document a chaque fois serait du gaspillage.
function hideDownloads() {
  if (current && !current.isDestroyed()) current.hide();
}

function closeDownloads() {
  if (current && !current.isDestroyed()) current.close();
  current = null;
}

module.exports = {
  showDownloads, getDownloadsWindow, hideDownloads, closeDownloads, fitDownloads,
  anchorPosition, WIDTH, MIN_HEIGHT, MAX_HEIGHT, MARGIN,
};
