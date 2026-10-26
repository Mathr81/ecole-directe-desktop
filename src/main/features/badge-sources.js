// Sources du compteur du badge, et ce qu'on en tire : la pastille des
// modules et les notifications. Le cadencement vit dans badge.js.
const { Notification } = require("electron");
const { showNotice, clearNotice } = require("./page-notice");
const { showWindow } = require("./tray");
const { filterEntries } = require("./palette");
const { collectEntries } = require("../windows/palette-window");
const {
  messagerieBadgeCount,
  messagerieBadgeFromStoredAccounts,
  moduleBadges,
  describeModuleBadges,
  badgeCounts,
  describeArrivals,
  arrivalMenu,
} = require("../auth/session-payload");

const ED_ORIGIN = "https://www.ecoledirecte.com/";
// Pastille des compteurs hors messagerie, en bas a gauche.
const MODULES_NOTICE_ID = "ed-modules-notice";

// Source gratuite : le store du SPA, deja dans la page. Il ne bouge que
// quand le site se reconnecte de lui-meme, mais ca ne coute rien de le lire.
async function readBadgeFromPage(mainWindow) {
  if (mainWindow.isDestroyed()) return null;
  if (!mainWindow.webContents.getURL().startsWith(ED_ORIGIN)) return null;

  const raw = await mainWindow.webContents.executeJavaScript(
    'sessionStorage.getItem("accounts")'
  );
  return messagerieBadgeFromStoredAccounts(raw);
}

/**
 * Montre les compteurs des modules autres que la messagerie.
 *
 * Ces valeurs voyagent dans la reponse de login qu'on recupere DEJA pour le
 * badge : les afficher ne declenche aucune requete de plus. La pastille
 * disparait d'elle-meme quand il n'y a plus rien a signaler.
 */
function showModuleBadges(mainWindow, state) {
  const summary = describeModuleBadges(moduleBadges(state));
  if (!summary) {
    clearNotice(mainWindow, MODULES_NOTICE_ID);
    return;
  }
  showNotice(mainWindow, MODULES_NOTICE_ID, summary, { placement: "bottom-left" });
}

// Compteurs du releve precedent. null tant qu'aucune connexion n'a reussi :
// le premier releve sert de reference, il ne notifie rien.
let lastCounts = null;

// Le rafraichissement distant est la seule source capable de voir arriver
// du nouveau : c'est donc lui, et lui seul, qui notifie.
function notifyArrivals(mainWindow, state) {
  const counts = badgeCounts(state);
  const summary = lastCounts ? describeArrivals(lastCounts, counts) : "";
  const menu = lastCounts ? arrivalMenu(lastCounts, counts) : null;
  lastCounts = counts;
  if (!summary || !Notification.isSupported()) return;

  const notification = new Notification({ title: "Mon ÉcoleDirecte", body: summary });
  notification.on("click", () => openArrival(mainWindow, menu));
  notification.show();
  console.log("Notification :", summary);
}

// Ramene la fenetre et, si le menu du site a un lien de ce nom, l'ouvre.
// Le lien est cherche dans la page, comme pour la palette : aucune route
// d'EcoleDirecte n'est codee en dur.
async function openArrival(mainWindow, menu) {
  showWindow(mainWindow);
  if (!menu) return;
  const [target] = filterEntries(await collectEntries(mainWindow), menu, 1);
  if (target && !mainWindow.isDestroyed()) mainWindow.loadURL(target.href);
}

// Source payante : une connexion dediee, seule capable de faire apparaitre
// un nouveau message.
//
// Volontairement en dehors d'authFlow : sur un code 250, celui-ci effacerait
// les cles fa et demanderait la question de double authentification. Un
// rafraichissement de badge doit rester en lecture seule.
async function readBadgeFromApi(deps, mainWindow) {
  const { username, password, faKeys } = deps.credentialsStore.read();
  if (!username || !password) return null;

  const res = await deps.edApi.login({
    identifiant: username,
    motdepasse: password,
    uuid: deps.credentialsStore.ensureDeviceUuid(),
    fa: faKeys,
  });

  if (res.code !== 200) {
    console.warn(`Rafraîchissement du badge : code ${res.code}, valeur conservée.`);
    return null;
  }

  const fresh = { accounts: (res.data && res.data.accounts) || [] };
  if (mainWindow) {
    showModuleBadges(mainWindow, fresh);
    notifyArrivals(mainWindow, fresh);
  }
  return messagerieBadgeCount(fresh);
}

/** Pose la reference des notifications, sans notifier. */
function rememberCounts(state) {
  lastCounts = badgeCounts(state);
}

module.exports = { readBadgeFromPage, readBadgeFromApi, showModuleBadges, rememberCounts };
