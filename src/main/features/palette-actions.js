// Actions de l'application proposees dans la palette Ctrl+K, apres les
// destinations du site.
const { app, dialog, session, shell } = require("electron");

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

function paletteActions(mainWindow, deps, { updater, logFile }) {
  const actions = [
    { id: "reload", label: "Recharger la page", run: () => mainWindow.webContents.reload() },
    { id: "switch-account", label: "Changer de compte", run: () => switchAccount(mainWindow, deps) },
    {
      id: "open-log",
      label: "Ouvrir le journal (app.log)",
      run: () => shell.openPath(logFile),
    },
  ];
  if (updater) {
    actions.push({ id: "check-update", label: "Vérifier les mises à jour", run: updater.checkNow });
  }
  return actions;
}

module.exports = { paletteActions };
