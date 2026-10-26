const { app, nativeImage } = require("electron");
const { getAssetPath } = require("../lib/paths");

// Le badge ne se lit plus dans le DOM.
//
// Les selecteurs CSS d'EcoleDirecte ne correspondaient plus a rien — dont un
// `#menuId-5618` code en dur, l'identifiant eleve d'un seul utilisateur. La
// lecture renvoyait donc 0 et EFFACAIT le compteur juste obtenu a la
// connexion, quelques secondes apres l'avoir pose. D'ou la regle centrale
// ici : une lecture qui echoue conserve la derniere valeur connue.
//
// Trois sources, par ordre de cout croissant :
//
//   1. les authentifications qu'on fait de toute facon (demarrage, reprise
//      sur session expiree) : le compteur est deja dans la reponse, gratuit ;
//   2. sessionStorage["accounts"] de la page, relu localement : gratuit
//      aussi, et capte les rafraichissements que le SPA fait de lui-meme ;
//   3. une connexion API dediee, seule capable de faire apparaitre un
//      NOUVEAU message — le corps des reponses du site nous est inaccessible,
//      onHeadersReceived ne donne que les en-tetes.
//
// La source 3 est donc espacee et bruitee : l'utilisateur est de toute facon
// notifie sur son telephone, et on veut rester discret cote serveur.

let localTimer = null;
let remoteTimer = null;

const DEBUG_BADGE = process.env.NODE_ENV === "development";
function badgeLog(...args) { if (DEBUG_BADGE) console.log("[BADGE]", ...args); }

// Lecture locale : aucune requete, on peut se permettre d'etre frequent.
const LOCAL_INTERVAL_MS = 2 * 60 * 1000;

// Rafraichissement distant : une connexion complete. Espace, et decale
// aleatoirement pour ne jamais tomber au meme instant d'un cycle a l'autre.
const REMOTE_BASE_MS = 30 * 60 * 1000;
const REMOTE_JITTER_MS = 10 * 60 * 1000;

// Premiere lecture locale peu apres le demarrage : le temps que le SPA
// hydrate son store.
const FIRST_LOCAL_MS = 5000;

/**
 * Delai avant le prochain rafraichissement distant : 30 min plus ou moins
 * 10, soit 20 a 40 min. Pur, horloge et alea injectes.
 */
function nextRemoteDelay(random = Math.random) {
  const offset = (random() * 2 - 1) * REMOTE_JITTER_MS;
  return Math.round(REMOTE_BASE_MS + offset);
}

/**
 * Retient le dernier compteur connu. Une lecture qui echoue vaut null et
 * laisse la valeur en place : mieux vaut un badge legerement perime qu'un
 * badge efface a tort.
 */
function createBadgeState(initial = 0) {
  let last = Number.isInteger(initial) && initial >= 0 ? initial : 0;

  return {
    next(count) {
      if (Number.isInteger(count) && count >= 0) last = count;
      return last;
    },
    get value() { return last; },
  };
}

function applyBadge(count, mainWindow) {
  if (process.platform === "darwin" || process.platform === "linux") {
    try { app.setBadgeCount(count); badgeLog("setBadgeCount(" + count + ")"); }
    catch (e) { badgeLog("setBadgeCount non supporte :", e.message); }
  }
  if (process.platform === "win32") {
    if (mainWindow.isDestroyed()) return;
    if (count > 0) { mainWindow.setOverlayIcon(createBadgeImage(count), count + " notification(s)"); badgeLog("Overlay applique"); }
    else { mainWindow.setOverlayIcon(null, ""); badgeLog("Overlay supprime"); }
  }
}

// Pastilles pre-rendues dans assets/badges/ : 1 a 9, puis « 9+ ». Elles
// remplacent un dessin a la volee qui imposait canvas, une dependance
// native a recompiler pour Electron, pour une image de 32 px.
function badgeFileName(count) {
  return count > 9 ? "9plus.png" : `${count}.png`;
}

function createBadgeImage(count) {
  return nativeImage.createFromPath(getAssetPath("badges", badgeFileName(count)));
}

/**
 * Cable les deux cadences.
 *
 * `readLocalCount` et `refreshRemoteCount` renvoient un entier, ou null si la
 * lecture n'a rien donne. Le module ne connait ni auth/ ni windows/ : tout
 * lui est injecte, comme le webContents l'etait deja.
 */
function startBadgePolling({
  mainWindow,
  readLocalCount,
  refreshRemoteCount,
  initialCount = 0,
  random = Math.random,
}) {
  const state = createBadgeState(initialCount);

  async function update(label, read) {
    if (mainWindow.isDestroyed()) return;
    try {
      const raw = await read();
      const count = state.next(raw);
      badgeLog(`${label} : lu ${JSON.stringify(raw)}, retenu ${count}`);
      applyBadge(count, mainWindow);
    } catch (err) {
      badgeLog(`${label} : echec (${err.message}), on garde ${state.value}`);
    }
  }

  badgeLog("Demarrage du suivi du badge");

  setTimeout(() => update("lecture locale initiale", readLocalCount), FIRST_LOCAL_MS);
  localTimer = setInterval(() => update("lecture locale", readLocalCount), LOCAL_INTERVAL_MS);

  // Reprogramme a chaque fois : c'est ce qui rend le decalage aleatoire a
  // chaque cycle, la ou un setInterval fixerait la cadence une fois pour
  // toutes.
  const scheduleRemote = () => {
    const delay = nextRemoteDelay(random);
    badgeLog(`Prochain rafraichissement distant dans ${Math.round(delay / 60000)} min`);
    remoteTimer = setTimeout(async () => {
      await update("rafraichissement distant", refreshRemoteCount);
      if (!mainWindow.isDestroyed()) scheduleRemote();
    }, delay);
  };
  scheduleRemote();

  return state;
}

function stopBadgePolling() {
  if (localTimer) { clearInterval(localTimer); localTimer = null; }
  if (remoteTimer) { clearTimeout(remoteTimer); remoteTimer = null; }
}

module.exports = {
  startBadgePolling,
  stopBadgePolling,
  applyBadge,
  createBadgeState,
  badgeFileName,
  nextRemoteDelay,
  LOCAL_INTERVAL_MS,
  REMOTE_BASE_MS,
  REMOTE_JITTER_MS,
};
