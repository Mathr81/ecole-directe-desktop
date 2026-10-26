// Icone de la zone de notification, et vie en arriere-plan.
//
// Fermer la fenetre la cache au lieu de quitter (reglable) : le badge et les
// notifications n'ont de sens que si l'application tourne. On quitte
// vraiment par le menu de l'icone, ou par une mise a jour.
const { app, Menu, Notification, Tray, nativeImage } = require("electron");
const { getAssetPath } = require("../lib/paths");
const { loadSettings, saveSettings } = require("../lib/settings");

let tray = null;
let quitting = false;

// Argument pose sur l'entree de demarrage : lancee avec l'ordinateur,
// l'application part directement dans la zone de notification. Sous
// Windows, getLoginItemSettings doit recevoir les memes arguments que
// setLoginItemSettings pour lire la bonne entree.
const HIDDEN_ARG = "--hidden";
const LOGIN_ITEM = { args: [HIDDEN_ARG] };

function startedHidden(argv = process.argv) {
  return argv.includes(HIDDEN_ARG);
}

// La pastille de la barre des taches disparait avec la fenetre cachee :
// l'infobulle de l'icone prend le relais.
function trayTooltip(count) {
  if (!Number.isInteger(count) || count <= 0) return "Mon ÉcoleDirecte";
  return `Mon ÉcoleDirecte — ${count} message${count > 1 ? "s" : ""} non lu${count > 1 ? "s" : ""}`;
}

function setTrayCount(count) {
  if (tray && !tray.isDestroyed()) tray.setToolTip(trayTooltip(count));
}

function showWindow(mainWindow) {
  if (mainWindow.isDestroyed()) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

// L'icone source fait 512 px ; la zone de notification affiche du 16 px,
// 32 px sur un ecran a 200 %. Les deux tailles sont fournies, reduites avec
// le meilleur filtre : sans cela Windows reduit lui-meme, et mal.
function trayIcon() {
  const source = nativeImage.createFromPath(getAssetPath("icons", "icon.png"));
  if (source.isEmpty()) console.warn("Icône de la zone de notification introuvable.");
  const icon = source.resize({ width: 16, height: 16, quality: "best" });
  icon.addRepresentation({
    scaleFactor: 2,
    buffer: source.resize({ width: 32, height: 32, quality: "best" }).toPNG(),
  });
  return icon;
}

function buildMenu(mainWindow) {
  const settings = loadSettings();
  return Menu.buildFromTemplate([
    { label: "Ouvrir Mon ÉcoleDirecte", click: () => showWindow(mainWindow) },
    { type: "separator" },
    {
      label: "Garder ouvert en arrière-plan",
      type: "checkbox",
      checked: settings.runInBackground,
      click: (item) => saveSettings({ runInBackground: item.checked }),
    },
    {
      label: "Lancer au démarrage de l'ordinateur",
      type: "checkbox",
      checked: app.getLoginItemSettings(LOGIN_ITEM).openAtLogin,
      // En developpement, on inscrirait electron.exe au demarrage.
      enabled: app.isPackaged,
      click: (item) => app.setLoginItemSettings({ ...LOGIN_ITEM, openAtLogin: item.checked }),
    },
    { type: "separator" },
    { label: "Quitter", click: () => app.quit() },
  ]);
}

function setupTray(mainWindow) {
  tray = new Tray(trayIcon());
  tray.setToolTip("Mon ÉcoleDirecte");
  tray.on("click", () => showWindow(mainWindow));
  // Reconstruit a chaque ouverture : les cases refletent l'etat du moment.
  tray.on("right-click", () => tray.popUpContextMenu(buildMenu(mainWindow)));
  if (process.platform !== "win32") tray.setContextMenu(buildMenu(mainWindow));

  // before-quit precede la fermeture des fenetres, y compris pour
  // quitAndInstall de la mise a jour : la fermeture redevient alors reelle.
  app.on("before-quit", () => { quitting = true; });

  mainWindow.on("close", (event) => {
    if (quitting) return;
    const settings = loadSettings();
    if (!settings.runInBackground) return;

    event.preventDefault();
    mainWindow.hide();

    if (!settings.backgroundHintShown && Notification.isSupported()) {
      new Notification({
        title: "Mon ÉcoleDirecte reste ouvert",
        body: "Elle continue en arrière-plan pour le badge et les notifications. Pour la quitter : Ctrl+Q, ou clic droit sur son icône près de l'horloge.",
      }).show();
      saveSettings({ backgroundHintShown: true });
    }
  });

  // macOS : un clic sur l'icone du Dock ramene la fenetre cachee.
  app.on("activate", () => showWindow(mainWindow));

  return tray;
}

module.exports = { setupTray, showWindow, startedHidden, setTrayCount, trayTooltip };
