// Veille : fenetre cachee dans la zone de notification, le site est decharge.
//
// Une fenetre cachee garde le SPA d'EcoleDirecte en memoire, avec ses
// scripts, ses minuteurs et ceux de l'extension. Au bout d'une minute cachee,
// on la remplace par about:blank ; elle revient a l'URL quittee quand la
// fenetre reapparait. Le sessionStorage survit a ces navigations dans le meme
// onglet : le site retrouve sa session au reveil, et le badge continue avec
// le jeton garde en memoire par badge-sources.js.

const ED_ORIGIN = "https://www.ecoledirecte.com/";

// Delai avant veille : rouvrir juste apres une fermeture reste instantane.
const SLEEP_DELAY_MS = 60 * 1000;

// Un brouillon en cours (message, formulaire) serait perdu au dechargement :
// dans ce cas on reste eveille.
const HAS_DRAFT = `[...document.querySelectorAll('textarea, input[type="text"], [contenteditable="true"]')]
  .some((el) => String(el.value ?? el.textContent ?? "").trim() !== "")`;

let waking = null;

function setupSleep(mainWindow, { loadingPage, showStatus }) {
  let timer = null;
  let asleepUrl = null;

  const cancel = () => {
    clearTimeout(timer);
    timer = null;
  };

  async function sleep() {
    timer = null;
    if (mainWindow.isDestroyed() || mainWindow.isVisible()) return;

    const url = mainWindow.webContents.getURL();
    if (!url.startsWith(ED_ORIGIN)) return;

    const hasDraft = await mainWindow.webContents.executeJavaScript(HAS_DRAFT).catch(() => true);
    if (hasDraft) {
      console.log("Veille reportée : un texte est en cours de saisie.");
      return;
    }

    // Un beforeunload du site peut refuser la navigation : loadURL rejette
    // alors, et la page reste en place, intacte.
    await mainWindow.webContents.loadURL("about:blank");
    asleepUrl = url;
    console.log("Veille : page du site déchargée.");
  }

  async function wake() {
    const url = asleepUrl;
    asleepUrl = null;
    console.log("Réveil : rechargement de", url.slice(0, 110));
    await mainWindow.loadFile(loadingPage);
    showStatus("Chargement d'ÉcoleDirecte…");
    await mainWindow.loadURL(url).catch((err) => console.warn("Réveil incomplet :", err.message));
  }

  mainWindow.on("hide", () => {
    cancel();
    timer = setTimeout(() => {
      sleep().catch((err) => console.warn("Veille impossible :", err.message));
    }, SLEEP_DELAY_MS);
  });

  mainWindow.on("show", () => {
    cancel();
    if (asleepUrl) waking = wake().finally(() => { waking = null; });
  });

  mainWindow.on("closed", cancel);
}

/** Resolue une fois la page du site revenue, si un reveil est en cours. */
function awake() {
  return waking || Promise.resolve();
}

module.exports = { setupSleep, awake, SLEEP_DELAY_MS };
