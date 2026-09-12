// Telechargements.
//
// Sans gestionnaire, Electron ouvre une boite « Enregistrer sous » et ne
// montre plus rien ensuite : ni avancement, ni resultat, ni moyen d'ouvrir
// le fichier. Sur EcoleDirecte, ou l'essentiel des pieces jointes sont des
// PDF de quelques centaines de kilo-octets, c'est trois clics pour rien.
//
// On se comporte donc comme un navigateur : depot direct dans le dossier
// Telechargements, et un panneau maison qui montre l'avancement, laisse
// annuler, puis ouvrir le fichier ou son dossier.
//
// La premiere version affichait un bandeau injecte dans la page du site.
// Il ne permettait rien : un element pose par executeJavaScript n'a aucun
// moyen de rappeler le processus principal, donc aucun bouton, donc pas
// d'annulation possible.

const { app, shell, ipcMain, BrowserWindow } = require("electron");
const fs = require("fs");
const path = require("path");
const {
  showDownloads, getDownloadsWindow, hideDownloads,
  fitDownloads,
} = require("../windows/downloads-window");

// Delai avant que le panneau s'efface, une fois tout termine. Assez long
// pour laisser le temps de cliquer sur « Ouvrir ».
const IDLE_HIDE_MS = 8000;

/**
 * Nom libre dans le dossier de destination.
 *
 * Ecraser un fichier existant sans prevenir est inacceptable : deux bulletins
 * telecharges le meme trimestre portent souvent le meme nom. `exists` est
 * injecte pour rendre la regle testable sans toucher au disque.
 */
function uniqueName(filename, exists) {
  if (!exists(filename)) return filename;

  const ext = path.extname(filename);
  const base = path.basename(filename, ext);

  for (let i = 1; i < 1000; i += 1) {
    const candidate = `${base} (${i})${ext}`;
    if (!exists(candidate)) return candidate;
  }
  // Cas pathologique : on prefixe l'horodatage plutot que d'ecraser.
  return `${base} ${Date.now()}${ext}`;
}

// Separateur decimal francais : l'application parle francais partout
// ailleurs, « 2.1 Mo » y detonne.
function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes < 0) return "";
  if (bytes < 1024) return `${bytes} o`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} Ko`;
  return `${(bytes / (1024 * 1024)).toFixed(1).replace(".", ",")} Mo`;
}

/**
 * Faut-il fermer la fenetre qui a declenche ce telechargement ?
 *
 * Quand EcoleDirecte ouvre une piece jointe en target="_blank", le
 * gestionnaire de la fenetre principale ouvre un popup, dont la <webview>
 * tente la navigation. Le serveur repondant « Content-Disposition:
 * attachment », la navigation est convertie en telechargement et la webview
 * reste sur about:blank : le popup demeure affiche, desesperement blanc.
 *
 * Mesure faite sous Electron 44 en rejouant le cas : le webContents
 * initiateur est alors de type "webview", son URL est la chaine vide, et
 * BrowserWindow.fromWebContents sur ce guest renvoie bien la fenetre popup
 * qui le contient.
 *
 * Une webview qui porte DEJA une URL est une vraie session de navigation :
 * on n'y touche pas, l'utilisateur telecharge peut-etre depuis une page
 * qu'il est en train de consulter.
 */
function shouldCloseInitiator(info) {
  if (!info || info.type !== "webview") return false;
  return info.url === "" || info.url === "about:blank";
}

/** Vue destinee au panneau : le renderer ne calcule rien. */
function describeDownload(entry) {
  const total = entry.total > 0 ? entry.total : 0;
  // null, et non zero, quand le serveur n'annonce pas de taille — cas
  // frequent des pieces jointes generees a la volee. La barre passe alors
  // en indetermine plutot que d'afficher un pourcentage invente.
  const percent = total > 0
    ? Math.max(0, Math.min(100, Math.round((entry.received / total) * 100)))
    : null;

  let detail;
  switch (entry.state) {
    case "completed":
      detail = formatBytes(entry.received);
      break;
    case "cancelled":
      detail = "Annulé";
      break;
    case "interrupted":
      detail = "Interrompu";
      break;
    default:
      detail = total > 0
        ? `${formatBytes(entry.received)} sur ${formatBytes(total)}`
        : formatBytes(entry.received);
  }

  return {
    id: entry.id,
    name: entry.name,
    state: entry.state,
    percent,
    detail,
    canCancel: entry.state === "progressing",
    canOpen: entry.state === "completed",
  };
}

function setupDownloads(targetSession, mainWindow, deps = {}) {
  const {
    downloadsDir = app.getPath("downloads"),
    fileExists = (p) => fs.existsSync(p),
    reveal = (p) => shell.showItemInFolder(p),
    openFile = (p) => shell.openPath(p),
  } = deps;

  // id -> { id, name, savePath, state, received, total, item }
  const entries = new Map();
  let nextId = 1;
  let hideTimer = null;

  const views = () => [...entries.values()].map(describeDownload);

  const push = async ({ open = false } = {}) => {
    if (open) await showDownloads(mainWindow);
    const win = getDownloadsWindow();
    if (win) win.webContents.send("downloads:state", views());
  };

  // Le panneau s'efface de lui-meme quand plus rien n'est en cours.
  const scheduleHide = () => {
    clearTimeout(hideTimer);
    if ([...entries.values()].some((e) => e.state === "progressing")) return;
    hideTimer = setTimeout(() => {
      entries.clear();
      hideDownloads();
    }, IDLE_HIDE_MS);
  };

  targetSession.on("will-download", (event, item, initiator) => {
    // Referme le popup laisse blanc derriere le telechargement.
    if (initiator && !initiator.isDestroyed()) {
      const info = { type: initiator.getType(), url: initiator.getURL() };
      if (shouldCloseInitiator(info)) {
        const host = BrowserWindow.fromWebContents(initiator);
        if (host && host !== mainWindow && !host.isDestroyed()) {
          console.log("Fenêtre restée blanche derrière un téléchargement : fermeture.");
          host.close();
        }
      }
    }

    const name = uniqueName(item.getFilename(), (candidate) =>
      fileExists(path.join(downloadsDir, candidate))
    );
    const savePath = path.join(downloadsDir, name);

    // Poser savePath supprime la boite de dialogue : c'est ce qui rend le
    // telechargement immediat.
    item.setSavePath(savePath);

    const entry = {
      id: nextId++,
      name,
      savePath,
      item,
      state: "progressing",
      received: 0,
      total: item.getTotalBytes() || 0,
    };
    entries.set(entry.id, entry);
    clearTimeout(hideTimer);

    console.log(`Téléchargement démarré : ${name}`);
    push({ open: true });

    item.on("updated", (_event, state) => {
      entry.received = item.getReceivedBytes();
      entry.total = item.getTotalBytes() || entry.total;
      entry.state = state === "interrupted" ? "interrupted" : "progressing";
      push();
    });

    item.once("done", (_event, state) => {
      entry.state = state;
      entry.received = item.getReceivedBytes();
      // L'objet DownloadItem n'est plus exploitable une fois termine.
      entry.item = null;

      if (state === "completed") console.log(`Téléchargement terminé : ${savePath}`);
      else console.warn(`Téléchargement ${state} : ${name}`);

      push();
      scheduleHide();
    });
  });

  // ---- Actions du panneau ---------------------------------------------

  const withEntry = (id, fn) => {
    const entry = entries.get(id);
    if (entry) fn(entry);
  };

  ipcMain.on("downloads:cancel", (_event, id) => {
    withEntry(id, (entry) => {
      if (!entry.item) return;
      console.log(`Téléchargement annulé par l'utilisateur : ${entry.name}`);
      entry.item.cancel();
    });
  });

  ipcMain.on("downloads:open", (_event, id) => {
    withEntry(id, (entry) => {
      if (entry.state === "completed") openFile(entry.savePath);
    });
  });

  ipcMain.on("downloads:reveal", (_event, id) => {
    withEntry(id, (entry) => {
      if (entry.state === "completed") reveal(entry.savePath);
    });
  });

  ipcMain.on("downloads:dismiss", () => {
    clearTimeout(hideTimer);
    entries.clear();
    hideDownloads();
  });

  ipcMain.on("downloads:ready", () => push());

  // Le renderer signale qu'il a peint : on peut mesurer sa hauteur reelle
  // et réancrer le panneau. Le processus principal ne peut pas la deviner.
  ipcMain.on("downloads:rendered", () => { fitDownloads(mainWindow); });
}

module.exports = {
  setupDownloads,
  uniqueName,
  formatBytes,
  describeDownload,
  shouldCloseInitiator,
  IDLE_HIDE_MS,
};
