const { app, dialog, ipcMain, Menu, net, Notification, safeStorage, session, shell } = require("electron");
const { ElectronChromeExtensions } = require("electron-chrome-extensions");
const path = require("path");

const { resolveUserDataPath } = require("./lib/paths");
const { initLogger } = require("./lib/logger");
const { loadCustomExtension } = require("./features/extensions");
const { setupAutoUpdater } = require("./features/updater");
const { startBadgePolling, stopBadgePolling, applyBadge } = require("./features/badge");
const { setupDownloads } = require("./features/downloads");
const { setupTray, showWindow, startedHidden } = require("./features/tray");
const { setupOfflineRecovery, waitUntilOnline } = require("./features/offline");
const { showNotice, clearNotice } = require("./features/page-notice");
const { createMainWindow } = require("./windows/main-window");
const { createLoginWindow } = require("./windows/login-window");
const { createTwoFaWindow } = require("./windows/twofa-window");
const { setPaletteActions } = require("./windows/palette-window");
const { createEdApi } = require("./auth/ed-api");
const { createAuthFlow } = require("./auth/auth-flow");
const { createReloginGuard } = require("./auth/relogin-guard");
const { createExpiryWatcher, readApiCode, GRACE_MS } = require("./auth/expiry-watcher");
const { createCredentialsStore } = require("./auth/credentials-store");
const {
  toSessionStorageEntries,
  toLocalStorageEntries,
  messagerieBadgeCount,
  messagerieBadgeFromStoredAccounts,
  moduleBadges,
  describeModuleBadges,
  badgeCounts,
  describeArrivals,
} = require("./auth/session-payload");

// Pastille des compteurs hors messagerie, en bas a gauche.
const MODULES_NOTICE_ID = "ed-modules-notice";

const ED_ORIGIN = "https://www.ecoledirecte.com/";
// Code de /v3/login.awp pour « identifiant et/ou mot de passe invalide ».
const CODE_BAD_CREDENTIALS = 505;
const LOADING_PAGE = path.join(__dirname, "..", "renderer", "loading", "loading.html");
const HOME_URL = "https://www.ecoledirecte.com/Accueil";
const LOGIN_URL = "https://www.ecoledirecte.com/login?cameFrom=%2FAccueil";

// =========================
// CHEMINS ET LOGGING
// =========================

console.log("NODE_ENV =", process.env.NODE_ENV);

const userDataPath = resolveUserDataPath();
initLogger(userDataPath);

console.log("userData =", userDataPath);

// =========================
// AMORCAGE DE SESSION (lu par src/preload/ed-session.js)
// =========================

let currentSessionSeed = null;

function setSessionSeed(state, faKeys) {
  currentSessionSeed = state
    ? { session: toSessionStorageEntries(state), local: toLocalStorageEntries(faKeys) }
    : null;
}

// Le preload filtre deja l'origine ; on le reverifie ici, cote confiance :
// la session ne doit sortir que vers le site lui-meme.
ipcMain.on("ed:session-seed", (event) => {
  const frameUrl = event.senderFrame ? event.senderFrame.url : "";
  event.returnValue = frameUrl.startsWith(ED_ORIGIN) ? currentSessionSeed : null;
});

// =========================
// ECRAN D'ATTENTE
// =========================

// La fenetre principale est sandboxee : elle n'a pas ipcRenderer. On pilote
// donc le texte depuis ici.
function setLoadingStatus(mainWindow, text) {
  if (mainWindow.isDestroyed()) return;
  mainWindow.webContents.executeJavaScript(`
    (() => {
      const el = document.getElementById('status');
      if (el) el.textContent = ${JSON.stringify(text)};
    })()
  `).catch(() => {});
}

// =========================
// BANDEAUX D'AUTHENTIFICATION
// =========================

// Non bloquant : le formulaire EcoleDirecte reste utilisable en dessous.
const AUTH_BANNER_ID = "ed-auth-banner";
// Information, pas une panne : sans lui, la page se rechargerait sans
// explication au milieu de la session. Le rechargement l'emporte avec la
// page ; on ne l'efface a la main que si la reprise echoue.
const AUTH_NOTICE_ID = "ed-auth-notice";

function showAuthBanner(mainWindow, code) {
  showNotice(
    mainWindow,
    AUTH_BANNER_ID,
    `Connexion automatique impossible (${code}). ` +
      "Connectez-vous manuellement ci-dessous. Détails dans app.log.",
    { tone: "error" }
  );
}

// =========================
// FENETRES D'IDENTIFICATION
// =========================

// Renvoie true si des identifiants ont ete saisis, false si la fenetre a
// ete fermee sans valider.
async function promptCredentials(parent, credentialsStore, errorMessage = null) {
  const loginWindow = await createLoginWindow(parent);
  if (errorMessage) loginWindow.webContents.send("login-error", errorMessage);

  let submitted = false;
  const onSubmit = (event, credentials) => {
    if (event.sender !== loginWindow.webContents) return;
    const { username, password } = credentials || {};
    if (typeof username !== "string" || typeof password !== "string") return;
    credentialsStore.writeCredentials(username, password);
    submitted = true;
    console.log("Identifiants enregistrés.");
    if (!loginWindow.isDestroyed()) loginWindow.close();
  };
  ipcMain.on("submit-credentials", onSubmit);

  await new Promise((resolve) => loginWindow.on("closed", resolve));
  // Sans ce retrait, une fenetre fermee sans valider laissait son ecouteur
  // en place, et il s'ajoutait a celui de la fenetre suivante.
  ipcMain.removeListener("submit-credentials", onSubmit);
  return submitted;
}

async function promptTwoFa(parent, { question, propositions }) {
  const twoFaWindow = await createTwoFaWindow(parent, { question, propositions });

  return new Promise((resolve) => {
    let answered = false;

    ipcMain.once("twofa-answer", (event, answer) => {
      answered = true;
      if (!twoFaWindow.isDestroyed()) twoFaWindow.close();
      resolve(answer);
    });

    twoFaWindow.on("closed", () => {
      if (answered) return;
      ipcMain.removeAllListeners("twofa-answer");
      resolve(null);
    });
  });
}

// =========================
// AUTHENTIFICATION
// =========================

async function ensureAuthenticated(mainWindow, deps) {
  const { authFlow, credentialsStore, reloginGuard } = deps;

  let result = await authFlow.authenticate();

  if (result.status === "failed" && result.code === "NO_CREDENTIALS") {
    await promptCredentials(mainWindow, credentialsStore);
    result = await authFlow.authenticate();
  }

  // Mot de passe change depuis l'enregistrement : sans cette invite,
  // l'application echouait a chaque demarrage jusqu'a ce qu'on supprime
  // credentials.json a la main. Une seule invite par appel : le reloginGuard
  // borne deja le nombre d'appels.
  if (result.status === "failed" && result.code === CODE_BAD_CREDENTIALS) {
    console.warn("Identifiants refusés par ÉcoleDirecte, nouvelle saisie demandée.");
    const submitted = await promptCredentials(
      mainWindow,
      credentialsStore,
      "Identifiant ou mot de passe refusé par ÉcoleDirecte. Vérifiez-les."
    );
    if (submitted) result = await authFlow.authenticate();
  }

  if (result.status === "needs2fa") {
    console.log("Double authentification demandée.");
    const answer = await promptTwoFa(mainWindow, result);

    result = answer === null
      ? { status: "failed", code: "2FA_ANNULEE", message: "Fenêtre 2FA fermée." }
      : await authFlow.submit2faAnswer(answer);
  }

  if (result.status === "ok") {
    setSessionSeed(result.state, credentialsStore.read().faKeys);
    reloginGuard.reset();
    console.log(`Authentification réussie (${result.state.accounts.length} compte(s)).`);
    return result.state;
  }

  console.error(`Authentification échouée (${result.code}) : ${result.message}`);
  setSessionSeed(null, []);
  return null;
}

// =========================
// RE-LOGIN SUR REDIRECTION
// =========================

function setupReloginOnRedirect(mainWindow, deps) {
  let inProgress = false;

  mainWindow.webContents.on("did-navigate", async (event, navUrl) => {
    if (!navUrl.includes("/login") || inProgress) return;

    if (!deps.reloginGuard.shouldRetry()) {
      console.error("Reconnexion automatique abandonnée après trop de tentatives.");
      showAuthBanner(mainWindow, "TROP_DE_TENTATIVES");
      return;
    }

    inProgress = true;
    try {
      const delay = deps.reloginGuard.nextDelay();
      deps.reloginGuard.recordAttempt();
      console.log(`Redirection login détectée, nouvelle tentative dans ${delay} ms.`);
      await new Promise((resolve) => setTimeout(resolve, delay));

      const state = await ensureAuthenticated(mainWindow, deps);
      if (state) {
        clearNotice(mainWindow, AUTH_BANNER_ID);
        await mainWindow.loadURL(HOME_URL);
        applyBadge(messagerieBadgeCount(state), mainWindow);
      } else {
        showAuthBanner(mainWindow, "AUTH_ECHOUEE");
      }
    } finally {
      inProgress = false;
    }
  });
}

// =========================
// REPRISE SUR SESSION EXPIREE
// =========================

// EcoleDirecte est un SPA : quand le jeton meurt pendant une periode
// d'inactivite, il n'y a aucune navigation a intercepter. Le site affiche sa
// propre modale « Votre session est invalide ou expiree, identifiez-vous a
// nouveau », qui redemande le mot de passe. On la devance.

// Ecrit la session fraiche dans la page avant de la recharger. Le
// sessionStorage survit a un rechargement dans le meme onglet : au reboot
// d'Angular, l'hydratation trouve donc le nouveau jeton. Le preload voit une
// session valide et n'a rien a re-semer.
async function writeSessionIntoPage(mainWindow, state, faKeys) {
  const seed = {
    session: toSessionStorageEntries(state),
    local: toLocalStorageEntries(faKeys),
  };

  await mainWindow.webContents.executeJavaScript(`
    (() => {
      const seed = ${JSON.stringify(seed)};
      for (const [key, value] of Object.entries(seed.session)) {
        sessionStorage.setItem(key, value);
      }
      for (const [key, value] of Object.entries(seed.local)) {
        localStorage.setItem(key, value);
      }
    })()
  `);
}

function setupExpiryRecovery(mainWindow, deps) {
  const watcher = createExpiryWatcher();
  let timer = null;
  let inProgress = false;

  const cancelTimer = () => {
    if (timer === null) return;
    clearTimeout(timer);
    timer = null;
  };

  async function recover() {
    cancelTimer();
    if (inProgress || mainWindow.isDestroyed()) return;

    if (!deps.reloginGuard.shouldRetry()) {
      console.error("Session expirée : trop de tentatives, reprise abandonnée.");
      showAuthBanner(mainWindow, "TROP_DE_TENTATIVES");
      return;
    }

    inProgress = true;
    try {
      // On revient sur la page ou l'utilisateur se trouvait, pas sur
      // l'accueil. Si l'on n'est pas sur le site — ecran d'attente encore
      // affiche, par exemple — l'accueil est le seul repli sensé.
      const current = mainWindow.webContents.getURL();
      const target = current.startsWith(ED_ORIGIN) ? current : HOME_URL;

      console.log("Session expirée détectée, réauthentification par API.");
      showNotice(mainWindow, AUTH_NOTICE_ID, "Session expirée, reconnexion…");
      deps.reloginGuard.recordAttempt();

      const state = await ensureAuthenticated(mainWindow, deps);
      if (!state) {
        clearNotice(mainWindow, AUTH_NOTICE_ID);
        showAuthBanner(mainWindow, "SESSION_EXPIREE");
        return;
      }

      await writeSessionIntoPage(mainWindow, state, deps.credentialsStore.read().faKeys);
      await mainWindow.loadURL(target);

      clearNotice(mainWindow, AUTH_BANNER_ID);
      applyBadge(messagerieBadgeCount(state), mainWindow);
      console.log("Session rétablie sans intervention.");
    } catch (err) {
      console.error("Reprise sur session expirée impossible :", err.message);
      clearNotice(mainWindow, AUTH_NOTICE_ID);
      showAuthBanner(mainWindow, "SESSION_EXPIREE");
    } finally {
      inProgress = false;
      watcher.reset();
    }
  }

  session.defaultSession.webRequest.onHeadersReceived(
    { urls: ["*://api.ecoledirecte.com/*"] },
    (details, callback) => {
      // Rendre la main tout de suite : la reponse ne doit pas attendre.
      callback({});

      const action = watcher.note({ url: details.url, code: readApiCode(details.responseHeaders) });

      if (action === "arm") {
        cancelTimer();
        timer = setTimeout(() => {
          if (watcher.graceElapsed() === "fire") recover();
        }, GRACE_MS);
      } else if (action === "cancel") {
        cancelTimer();
      } else if (action === "fire") {
        recover();
      }
    }
  );

  mainWindow.on("closed", cancelTimer);
}

// =========================
// LECTURE DU BADGE
// =========================

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

// Source payante : une connexion dediee, seule capable de faire apparaitre
// un nouveau message.
//
// Volontairement en dehors d'authFlow : sur un code 250, celui-ci effacerait
// les cles fa et demanderait la question de double authentification. Un
// rafraichissement de badge doit rester en lecture seule.
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
  lastCounts = counts;
  if (!summary || !Notification.isSupported()) return;

  const notification = new Notification({ title: "Mon ÉcoleDirecte", body: summary });
  notification.on("click", () => showWindow(mainWindow));
  notification.show();
  console.log("Notification :", summary);
}

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

// =========================
// ACTIONS DE LA PALETTE (Ctrl+K)
// =========================

// Repart de zero : identifiants, cles 2FA, et le stockage du site qui les
// recopie (localStorage["fa"]). Le redemarrage rouvre la fenetre de connexion.
async function switchAccount(mainWindow, deps) {
  const { response } = await dialog.showMessageBox(mainWindow, {
    type: "question",
    buttons: ["Changer de compte", "Annuler"],
    defaultId: 1,
    cancelId: 1,
    title: "Changer de compte",
    message: "Oublier les identifiants enregistrés et redémarrer ?",
    detail: "La fenêtre de connexion s'ouvrira au redémarrage.",
  });
  if (response !== 0) return;

  deps.credentialsStore.clearAccount();
  await session.defaultSession.clearStorageData({
    origin: "https://www.ecoledirecte.com",
    storages: ["localstorage"],
  });
  console.log("Changement de compte : identifiants effacés, redémarrage.");
  app.relaunch();
  app.exit(0);
}

function paletteActions(mainWindow, deps, updater) {
  const actions = [
    { id: "reload", label: "Recharger la page", run: () => mainWindow.webContents.reload() },
    { id: "switch-account", label: "Changer de compte", run: () => switchAccount(mainWindow, deps) },
    {
      id: "open-log",
      label: "Ouvrir le journal (app.log)",
      run: () => shell.openPath(path.join(userDataPath, "app.log")),
    },
  ];
  if (updater) {
    actions.push({ id: "check-update", label: "Vérifier les mises à jour", run: updater.checkNow });
  }
  return actions;
}

// =========================
// MAIN
// =========================

let mainWindowRef = null;

async function main() {
  const credentialsStore = createCredentialsStore(
    path.join(userDataPath, "credentials.json"),
    safeStorage
  );

  const ses = session.defaultSession;

  const edApi = createEdApi({
    fetchImpl: (url, init) => ses.fetch(url, init),
    readGtkCookie: async () => {
      const cookies = await ses.cookies.get({ name: "GTK" });
      return cookies.length > 0 ? cookies[0].value : "";
    },
    userAgent: ses.getUserAgent(),
  });

  const deps = {
    edApi,
    authFlow: createAuthFlow({ edApi, credentialsStore }),
    credentialsStore,
    reloginGuard: createReloginGuard(),
  };

  const extensions = new ElectronChromeExtensions({ session: ses, license: "GPL-3.0" });
  await loadCustomExtension(ses);

  const mainWindow = createMainWindow();
  mainWindowRef = mainWindow;
  extensions.addTab(mainWindow.webContents, mainWindow);

  Menu.setApplicationMenu(null);
  setupTray(mainWindow);
  if (startedHidden()) mainWindow.hide();

  setupReloginOnRedirect(mainWindow, deps);
  setupExpiryRecovery(mainWindow, deps);

  // Sans cela la fenetre reste blanche pendant toute l'authentification puis
  // le chargement du site, soit environ trois secondes ou l'application
  // parait figee. L'ecran sert aussi d'arriere-plan aux fenetres de
  // connexion et de double authentification.
  await mainWindow.loadFile(LOADING_PAGE);
  setupOfflineRecovery(mainWindow, {
    loadingPage: LOADING_PAGE,
    showStatus: (text) => setLoadingStatus(mainWindow, text),
  });

  // Demarrage sans reseau (portable en veille, wifi coupe) : on attend son
  // retour plutot que d'echouer l'authentification et d'afficher une page
  // d'erreur.
  if (!net.isOnline()) {
    console.warn("Démarrage hors ligne, attente du réseau.");
    setLoadingStatus(mainWindow, "Pas de connexion à Internet. Reprise automatique dès son retour…");
    await waitUntilOnline();
  }
  setLoadingStatus(mainWindow, "Authentification…");

  // L'authentification a lieu AVANT toute navigation vers le site : le
  // preload trouve ainsi la session prete et l'ecrit avant le boot d'Angular.
  const state = await ensureAuthenticated(mainWindow, deps);

  setLoadingStatus(mainWindow, "Chargement d'ÉcoleDirecte…");
  // Un echec de chargement ne doit pas interrompre la suite (badge, mises a
  // jour, telechargements) : la reprise hors ligne rechargera la page.
  await mainWindow.loadURL(state ? HOME_URL : LOGIN_URL).catch((err) => {
    console.warn("Chargement initial du site échoué :", err.message);
  });

  // Si l'injection de session avait echoue, le SPA nous renverrait ici
  // vers /login : cette ligne est le temoin le plus direct.
  console.log("URL après chargement :", mainWindow.webContents.getURL());

  if (state) {
    // Le compteur du badge est deja dans la reponse de login, inutile
    // d'attendre le premier scrutage du DOM.
    applyBadge(messagerieBadgeCount(state), mainWindow);
    showModuleBadges(mainWindow, state);
    lastCounts = badgeCounts(state);
  } else {
    showAuthBanner(mainWindow, "AUTH_ECHOUEE");
  }

  startBadgePolling({
    mainWindow,
    readLocalCount: () => readBadgeFromPage(mainWindow),
    refreshRemoteCount: () => readBadgeFromApi(deps, mainWindow),
    initialCount: state ? messagerieBadgeCount(state) : 0,
  });
  const updater = setupAutoUpdater(mainWindow);
  setPaletteActions(paletteActions(mainWindow, deps, updater));

  // Les pieces jointes d'EcoleDirecte partent directement dans le dossier
  // Telechargements, sans boite de dialogue, avec l'avancement en bas a
  // droite — comme dans un navigateur.
  setupDownloads(session.defaultSession, mainWindow);
}

// =========================
// APP LIFECYCLE
// =========================

// Deux processus Chromium sur un meme profil ne peuvent plus ecrire le
// cache ni la base des service workers : l'extension cesse silencieusement
// de fonctionner. Le verrou empeche ce cas, y compris lorsqu'on lance
// l'application installee deux fois.
if (!app.requestSingleInstanceLock()) {
  console.warn("Une autre instance utilise déjà ce profil, fermeture.");
  app.quit();
} else {
  app.on("second-instance", () => {
    if (!mainWindowRef || mainWindowRef.isDestroyed()) return;
    // La fenetre peut etre cachee dans la zone de notification.
    showWindow(mainWindowRef);
  });

  // Meme identifiant que l'installeur (build.appId) : sous Windows, les
  // notifications sont rattachees a l'application par cet identifiant.
  if (process.platform === "win32") app.setAppUserModelId("desktop.ecole-directe.app");

  app.whenReady().then(() => {
    main().catch((err) => {
      console.error("Erreur lors du lancement :", err);
    });
  });
}

app.on("window-all-closed", () => {
  stopBadgePolling();
  if (process.platform !== "darwin") app.quit();
});

app.on("will-quit", () => {
  stopBadgePolling();
});
