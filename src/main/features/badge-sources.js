// Sources du compteur du badge, et ce qu'on en tire : la pastille des
// modules et les notifications. Le cadencement vit dans badge.js.
const { Notification } = require("electron");
const { showNotice, clearNotice } = require("./page-notice");
const { showWindow } = require("./tray");
const { filterEntries } = require("./palette");
const { collectEntries } = require("../windows/palette-window");
const { awake } = require("./sleep");
const {
  messagerieBadgeCount,
  pageSessionFromStorage,
  moduleBadges,
  describeModuleBadges,
  badgeCounts,
  describeArrivals,
  arrivalMenu,
} = require("../auth/session-payload");

const ED_ORIGIN = "https://www.ecoledirecte.com/";
// Pastille des compteurs hors messagerie, en bas a gauche.
const MODULES_NOTICE_ID = "ed-modules-notice";

// Source frequente : la messagerie interrogee avec le jeton de la session
// deja ouverte dans la page. Ni login ni mot de passe, et le jeton n'est
// pas renouvele par l'appel (scripts/diag-page-token.js). Sans session
// lisible dans la page — ecran de connexion, session expiree — on rend
// null et la valeur en place est conservee.
//
// La derniere session lue est gardee : en veille (sleep.js) la page est
// dechargee, et c'est elle qui sert alors.
let lastPageSession = null;

async function readBadgeFromPage(mainWindow, edApi) {
  if (mainWindow.isDestroyed()) return null;

  if (mainWindow.webContents.getURL().startsWith(ED_ORIGIN)) {
    const [rawCredentials, rawAccounts] = await mainWindow.webContents.executeJavaScript(
      '[sessionStorage.getItem("credentials"), sessionStorage.getItem("accounts")]'
    );
    lastPageSession = pageSessionFromStorage(rawCredentials, rawAccounts);
  }
  const pageSession = lastPageSession;
  if (!pageSession) return null;

  const count = await edApi.unreadMessagesCount(pageSession);
  if (count !== null) notifyArrivals(mainWindow, { MESSAGERIE: count });
  return count;
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

// Notifie ce qui a augmente depuis le releve precedent. `partial` peut ne
// porter que certains modules (la messagerie seule, pour la source
// frequente) : les autres gardent leur derniere valeur connue.
function notifyArrivals(mainWindow, partial) {
  const counts = { ...lastCounts, ...partial };
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
//
// Au sortir de la veille, le menu n'existe qu'une fois le SPA rendu : on
// laisse quelques secondes a la page pour l'afficher.
async function openArrival(mainWindow, menu) {
  showWindow(mainWindow);
  if (!menu) return;
  await awake();

  for (let attempt = 0; attempt < 5; attempt += 1) {
    if (mainWindow.isDestroyed()) return;
    const [target] = filterEntries(await collectEntries(mainWindow), menu, 1);
    if (target) {
      mainWindow.loadURL(target.href);
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
}

// Source espacee : une connexion complete, seule a connaitre les compteurs
// des notes, des devoirs et de la vie scolaire.
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
    notifyArrivals(mainWindow, badgeCounts(fresh));
  }
  return messagerieBadgeCount(fresh);
}

/** Pose la reference des notifications, sans notifier. */
function rememberCounts(state) {
  lastCounts = badgeCounts(state);
}

module.exports = { readBadgeFromPage, readBadgeFromApi, showModuleBadges, rememberCounts };
