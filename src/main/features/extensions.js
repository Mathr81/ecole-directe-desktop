const fs = require("fs");
const path = require("path");
const { getCustomExtensionPath } = require("../lib/paths");

/**
 * Extensions dont le service worker enregistre date d'une autre version.
 *
 * Electron ne reenregistre pas le service worker d'une extension mise a
 * jour : il garde le script en cache de l'ancienne version et continue de
 * l'executer. Constate le 26/10/2026 avec CustomDirecte : le script V2
 * (20.1.5) tournait encore sous la V3 (30.0.3), reecrivait ses options au
 * format V0 et vidait le stockage, d'ou des preferences remises a zero apres
 * un redemarrage.
 *
 * `preferences` est le contenu du fichier Preferences du profil. Partie
 * testable sans Electron.
 */
function staleWorkerIds(preferences, version) {
  const settings = (preferences && preferences.extensions && preferences.extensions.settings) || {};
  return Object.entries(settings)
    .filter(([, entry]) => {
      const registered = entry && entry.service_worker_registration_info
        ? entry.service_worker_registration_info.version
        : undefined;
      return registered !== undefined && registered !== version;
    })
    .map(([id]) => id);
}

// Efface l'enregistrement perime AVANT le chargement : Electron enregistre
// alors le script de la version presente sur le disque.
async function clearStaleWorkers(session, extensionPath, userDataPath) {
  let version;
  let preferences;
  try {
    version = JSON.parse(fs.readFileSync(path.join(extensionPath, "manifest.json"), "utf8")).version;
    preferences = JSON.parse(fs.readFileSync(path.join(userDataPath, "Preferences"), "utf8"));
  } catch {
    return; // Premier lancement : rien d'enregistre.
  }

  for (const id of staleWorkerIds(preferences, version)) {
    console.warn(`Service worker périmé pour l'extension ${id}, réenregistrement en ${version}.`);
    await session.clearStorageData({ origin: `chrome-extension://${id}`, storages: ["serviceworkers"] });
  }
}

// loadExtension renvoie une promesse : sans await, un echec passait en rejet
// non gere et le journal annoncait « Extension chargée ! » quand meme.
async function loadCustomExtension(session, userDataPath) {
  const extensionPath = getCustomExtensionPath();
  console.log("Chargement extension :", extensionPath);

  if (!fs.existsSync(extensionPath)) {
    console.error("Dossier extension introuvable :", extensionPath);
    return false;
  }

  const manifestPath = path.join(extensionPath, "manifest.json");
  if (!fs.existsSync(manifestPath)) {
    console.error("manifest.json introuvable :", manifestPath);
    return false;
  }

  try {
    await clearStaleWorkers(session, extensionPath, userDataPath);
  } catch (err) {
    console.warn("Nettoyage du service worker de l'extension impossible :", err.message);
  }

  try {
    await session.extensions.loadExtension(extensionPath);
    console.log("Extension chargée !");
    return true;
  } catch (err) {
    console.error("Erreur chargement extension :", err);
    return false;
  }
}

module.exports = { loadCustomExtension, clearStaleWorkers, staleWorkerIds };
