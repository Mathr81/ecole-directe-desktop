const { autoUpdater } = require("electron-updater");
const { app, ipcMain, shell } = require("electron");
const fs = require("fs");
const path = require("path");
const { createUpdateState, describe, nextAttempt, installLooksBroken } = require("./update-state");
const { showUpdateWindow, getUpdateWindow, closeUpdateWindow } = require("../windows/update-window");

const CHECK_INTERVAL_MS = 60 * 60 * 1000;
const RELEASES_URL = "https://github.com/Mathr81/ecole-directe-desktop/releases/latest";

// macOS refuse d'installer la mise a jour d'une application non signee, et
// le build n'est pas signe (pas de certificat Apple). Telecharger pour rien
// serait pire que de le dire : on montre la version et la page ou la prendre.
const MANUAL_ONLY = process.platform === "darwin";

// Suivi des tentatives d'installation, dans son propre fichier : rien de
// sensible, et separe de window-state.json qui a une autre duree de vie.
function recordFile() {
  return path.join(app.getPath("userData"), "update-attempts.json");
}

function readRecord() {
  try {
    return JSON.parse(fs.readFileSync(recordFile(), "utf8"));
  } catch {
    return null;
  }
}

function writeRecord(record) {
  try {
    fs.writeFileSync(recordFile(), JSON.stringify(record));
  } catch (err) {
    console.warn("Suivi des mises à jour non enregistré :", err.message);
  }
}

function clearRecord() {
  try { fs.unlinkSync(recordFile()); } catch { /* deja absent */ }
}

function setupAutoUpdater(mainWindow) {
  if (process.env.NODE_ENV === "development") {
    console.log("Auto-updater désactivé en mode développement.");
    return null;
  }

  const state = createUpdateState();
  let downloadedFile = null;

  // On tourne enfin sur la version qu'on n'arrivait pas a poser : le
  // compteur d'echecs n'a plus lieu d'etre.
  const previous = readRecord();
  if (previous && previous.version === app.getVersion()) {
    console.log(`Mise à jour v${previous.version} finalement installée.`);
    clearRecord();
  }

  // Les journaux internes d'electron-updater passent par console, donc par
  // app.log. C'est la seule trace exploitable de ce qui se passe a la
  // fermeture, d'ou l'ecriture synchrone cote logger.
  autoUpdater.logger = console;
  autoUpdater.autoDownload = !MANUAL_ONLY;
  // La verification horaire ne doit pas rouvrir la fenetre a chaque fois
  // pour la meme version.
  let manualShownFor = null;

  // DELIBEREMENT false. La pose silencieuse a la fermeture (`--updated /S`)
  // echouait sans un mot : le processus etant deja mort, ni l'erreur ni le
  // journal n'arrivaient nulle part, et l'application re-telechargeait la
  // meme version a chaque demarrage — constate trois fois de suite le
  // 03/09/2026 avant une reinstallation manuelle. On passe donc par une
  // action explicite, avec l'interface de l'installateur visible.
  autoUpdater.autoInstallOnAppQuit = false;

  // C'est ce reglage-la, et non l'argument de quitAndInstall, qui decide de
  // la relance apres une installation non silencieuse. Il vaut deja true par
  // defaut ; on l'ecrit pour que l'intention soit lisible ici.
  autoUpdater.autoRunAppAfterInstall = true;

  const render = async ({ open = false } = {}) => {
    const view = describe(state.value);
    if (open) await showUpdateWindow(mainWindow);
    const win = getUpdateWindow();
    if (win) win.webContents.send("update:view", view, state.value.percent);
  };

  autoUpdater.on("checking-for-update", () => {
    console.log("Vérification des mises à jour…");
    state.checking();
    render();
  });

  autoUpdater.on("update-not-available", () => {
    console.log("Application à jour.");
    state.upToDate();
    render();
  });

  autoUpdater.on("update-available", (info) => {
    console.log(`Mise à jour disponible : v${info.version}`);
    if (MANUAL_ONLY) {
      state.manual(info.version);
      render({ open: manualShownFor !== info.version });
      manualShownFor = info.version;
      return;
    }
    state.available(info.version);
    render();
  });

  autoUpdater.on("download-progress", (progress) => {
    state.progress(progress.percent);
    render();
  });

  autoUpdater.on("update-downloaded", (info) => {
    downloadedFile = info.downloadedFile || null;

    // Re-telecharger une version deja telechargee prouve que la pose
    // precedente n'a pas abouti : c'est notre seul detecteur d'echec.
    const record = nextAttempt(readRecord(), info.version);
    writeRecord(record);

    console.log(
      `Mise à jour v${info.version} téléchargée (tentative ${record.attempts}) : ${downloadedFile}`
    );
    if (installLooksBroken(record)) {
      console.warn(
        `L'installation de v${info.version} a déjà échoué ${record.attempts - 1} fois.`
      );
    }

    state.downloaded(info.version, record.attempts);
    render({ open: true });
  });

  autoUpdater.on("error", (err) => {
    console.error("Erreur auto-updater :", err);

    // Une verification qui echoue est ordinaire : hors ligne, GitHub
    // indisponible, DNS lent. L'imposer a l'ecran toutes les heures serait
    // du bruit. On ne derange que si un telechargement etait engage, donc
    // si l'utilisateur attend quelque chose.
    const engaged = ["available", "downloading", "downloaded"].includes(state.value.phase);
    state.failed(err && err.message ? err.message : String(err));
    render({ open: engaged });
  });

  // ---- Actions de la fenetre ----------------------------------------

  ipcMain.on("update:ready", () => render());

  ipcMain.on("update:install", () => {
    console.log("Installation demandée par l'utilisateur.");
    // isSilent = false : l'installateur assiste montre son interface, donc
    // un echec devient visible au lieu d'etre avale.
    //
    // Le second argument (isForceRunAfter) est DELIBEREMENT omis : hors mode
    // silencieux, electron-updater l'ignore et consulte
    // `autoRunAppAfterInstall` a la place (BaseUpdater.quitAndInstall).
    // Le passer donnerait l'illusion de commander la relance.
    try {
      autoUpdater.quitAndInstall(false);
    } catch (err) {
      console.error("quitAndInstall a échoué :", err);
      state.failed(err.message);
      render({ open: true });
    }
  });

  ipcMain.on("update:open-installer", () => {
    if (!downloadedFile) {
      console.warn("Aucun installateur téléchargé à ouvrir.");
      return;
    }
    console.log("Ouverture manuelle de l'installateur :", downloadedFile);
    shell.openPath(downloadedFile).then((err) => {
      if (err) console.error("Ouverture de l'installateur impossible :", err);
    });
  });

  ipcMain.on("update:dismiss", () => closeUpdateWindow());

  ipcMain.on("update:download-page", () => {
    shell.openExternal(RELEASES_URL).catch((err) => console.error("Page des versions inaccessible :", err.message));
    closeUpdateWindow();
  });

  // ---- Cadence -------------------------------------------------------

  const check = () => autoUpdater.checkForUpdates().catch((err) => {
    console.error("Impossible de vérifier les mises à jour :", err.message);
  });

  check();
  const timer = setInterval(check, CHECK_INTERVAL_MS);
  app.on("will-quit", () => clearInterval(timer));

  // Verification demandee : contrairement a la cadence horaire, on montre
  // le resultat, meme « a jour ».
  return { checkNow: () => check().then(() => render({ open: true })) };
}

module.exports = { setupAutoUpdater };
