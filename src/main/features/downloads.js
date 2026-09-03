// Telechargements.
//
// Sans gestionnaire, Electron ouvre une boite « Enregistrer sous » et ne
// montre plus rien ensuite : ni avancement, ni resultat, ni moyen d'ouvrir
// le fichier. Sur EcoleDirecte, ou l'essentiel des pieces jointes sont des
// PDF de quelques centaines de kilo-octets, c'est trois clics pour rien.
//
// On se comporte donc comme un navigateur : depot direct dans le dossier
// Telechargements, avancement dans un bandeau, et le fichier revele dans
// l'explorateur une fois pose.

const { app, shell } = require("electron");
const fs = require("fs");
const path = require("path");
const { showNotice, clearNotice } = require("./page-notice");

const NOTICE_ID = "ed-download-notice";
// En bas a droite, comme dans un navigateur, et hors du chemin du bandeau
// de reconnexion qui occupe le haut.
const PLACEMENT = "bottom-right";
// Delai avant effacement du bandeau de fin, assez long pour etre lu.
const DONE_LINGER_MS = 6000;

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

function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes < 0) return "";
  if (bytes < 1024) return `${bytes} o`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} Ko`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} Mo`;
}

/**
 * Texte du bandeau. `total` vaut 0 quand le serveur n'annonce pas de
 * taille — cas frequent des pieces jointes generees a la volee : on montre
 * alors les octets recus, sans pourcentage invente.
 */
function progressLabel(filename, received, total) {
  if (total > 0) {
    const percent = Math.max(0, Math.min(100, Math.round((received / total) * 100)));
    return `Téléchargement de ${filename} — ${percent} % (${formatBytes(total)})`;
  }
  return `Téléchargement de ${filename} — ${formatBytes(received)}`;
}

function setupDownloads(targetSession, mainWindow, deps = {}) {
  const {
    downloadsDir = app.getPath("downloads"),
    fileExists = (p) => fs.existsSync(p),
    reveal = (p) => shell.showItemInFolder(p),
  } = deps;

  targetSession.on("will-download", (event, item) => {
    const name = uniqueName(item.getFilename(), (candidate) =>
      fileExists(path.join(downloadsDir, candidate))
    );
    const savePath = path.join(downloadsDir, name);

    // Poser savePath supprime la boite de dialogue : c'est ce qui rend le
    // telechargement immediat.
    item.setSavePath(savePath);
    console.log(`Téléchargement démarré : ${name}`);

    item.on("updated", (_event, state) => {
      if (state === "interrupted") {
        showNotice(mainWindow, NOTICE_ID, `Téléchargement interrompu : ${name}`, { tone: "error", placement: PLACEMENT });
        return;
      }
      if (item.isPaused()) return;
      showNotice(
        mainWindow, NOTICE_ID,
        progressLabel(name, item.getReceivedBytes(), item.getTotalBytes()),
        { placement: PLACEMENT }
      );
    });

    item.once("done", (_event, state) => {
      if (state === "completed") {
        console.log(`Téléchargement terminé : ${savePath}`);
        showNotice(mainWindow, NOTICE_ID, `${name} — enregistré dans Téléchargements`, { tone: "done", placement: PLACEMENT });
        reveal(savePath);
      } else {
        console.warn(`Téléchargement ${state} : ${name}`);
        showNotice(mainWindow, NOTICE_ID, `Téléchargement ${state === "cancelled" ? "annulé" : "échoué"} : ${name}`, { tone: "error", placement: PLACEMENT });
      }
      setTimeout(() => clearNotice(mainWindow, NOTICE_ID), DONE_LINGER_MS);
    });
  });
}

module.exports = { setupDownloads, uniqueName, formatBytes, progressLabel, DONE_LINGER_MS };
