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
// Reseau present mais EcoleDirecte muet (maintenance, panne) : on ne
// martele pas le serveur.
const RETRY_MS = 30 * 1000;

const OFFLINE_TEXT = "Pas de connexion à Internet. Reprise automatique dès son retour…";
const UNREACHABLE_TEXT = "ÉcoleDirecte ne répond pas. Nouvelle tentative dans 30 secondes…";

function isOfflineError(code) {
  return OFFLINE_ERRORS.has(code);
}

// net.isOnline() ne voit que la connexion locale : un EcoleDirecte en panne
// est traite a part, par waitBeforeRetry.
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
 * Attend le moment de reessayer, en disant pourquoi : retour du reseau s'il
 * est coupe, sinon un delai fixe.
 */
async function waitBeforeRetry(showStatus, retryMs = RETRY_MS) {
  if (!net.isOnline()) {
    showStatus(OFFLINE_TEXT);
    await waitUntilOnline();
    return;
  }
  showStatus(UNREACHABLE_TEXT);
  await new Promise((resolve) => setTimeout(resolve, retryMs));
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
      for (;;) {
        await mainWindow.loadFile(loadingPage);
        await waitBeforeRetry(showStatus);
        if (mainWindow.isDestroyed()) return;
        try {
          await mainWindow.loadURL(url);
          return;
        } catch (err) {
          // Seul un nouvel echec reseau justifie de recommencer : une
          // navigation annulee par le site lui-meme n'en est pas un.
          if (!isOfflineError(err.errno)) return;
          console.warn(`Toujours injoignable (${err.errno}).`);
        }
      }
    } catch (err) {
      console.error("Reprise après coupure réseau impossible :", err.message);
    } finally {
      waiting = false;
    }
  });
}

module.exports = { isOfflineError, waitUntilOnline, waitBeforeRetry, setupOfflineRecovery, OFFLINE_ERRORS };
