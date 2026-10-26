// Hors ligne : plutot que la page d'erreur de Chromium, l'ecran d'attente
// dit ce qui se passe, et l'on repart seul quand le reseau revient.
const { net } = require("electron");

// Codes reseau de Chromium qui signifient « pas de reseau » ou « serveur
// injoignable ». ERR_ABORTED (-3) n'en fait pas partie : c'est une
// navigation annulee, par le SPA lui-meme ou par un telechargement.
const OFFLINE_ERRORS = new Set([
  -21,  // ERR_NETWORK_CHANGED
  -100, // ERR_CONNECTION_CLOSED
  -101, // ERR_CONNECTION_RESET
  -102, // ERR_CONNECTION_REFUSED
  -105, // ERR_NAME_NOT_RESOLVED
  -106, // ERR_INTERNET_DISCONNECTED
  -109, // ERR_ADDRESS_UNREACHABLE
  -118, // ERR_CONNECTION_TIMED_OUT
  -137, // ERR_NAME_RESOLUTION_FAILED
]);

const POLL_MS = 3000;

function isOfflineError(code) {
  return OFFLINE_ERRORS.has(code);
}

// shortcut: net.isOnline() ne voit que la connexion locale, pas un
// EcoleDirecte en panne ; ce cas-la reste couvert par le bandeau d'erreur.
function waitUntilOnline(pollMs = POLL_MS) {
  return new Promise((resolve) => {
    if (net.isOnline()) return resolve();
    const timer = setInterval(() => {
      if (!net.isOnline()) return;
      clearInterval(timer);
      resolve();
    }, pollMs);
  });
}

/**
 * Sur un echec reseau du document principal, affiche l'ecran d'attente puis
 * recharge l'URL perdue des que le reseau revient.
 */
function setupOfflineRecovery(mainWindow, { loadingPage, showStatus }) {
  let waiting = false;

  mainWindow.webContents.on("did-fail-load", async (_event, code, _desc, url, isMainFrame) => {
    if (!isMainFrame || !isOfflineError(code) || waiting) return;
    if (!url.startsWith("https://")) return;

    waiting = true;
    console.warn(`Hors ligne (${code}) en chargeant ${url.slice(0, 110)}`);
    try {
      await mainWindow.loadFile(loadingPage);
      showStatus("Pas de connexion à Internet. Reprise automatique dès son retour…");
      await waitUntilOnline();
      if (!mainWindow.isDestroyed()) await mainWindow.loadURL(url);
    } catch (err) {
      console.error("Reprise après coupure réseau impossible :", err.message);
    } finally {
      waiting = false;
    }
  });
}

module.exports = { isOfflineError, waitUntilOnline, setupOfflineRecovery, OFFLINE_ERRORS };
