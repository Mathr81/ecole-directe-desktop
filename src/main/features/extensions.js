const fs = require("fs");
const path = require("path");
const { getCustomExtensionPath } = require("../lib/paths");

// loadExtension renvoie une promesse : sans await, un echec passait en rejet
// non gere et le journal annoncait « Extension chargée ! » quand meme.
async function loadCustomExtension(session) {
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
    await session.extensions.loadExtension(extensionPath);
    console.log("Extension chargée !");
    return true;
  } catch (err) {
    console.error("Erreur chargement extension :", err);
    return false;
  }
}

module.exports = { loadCustomExtension };
