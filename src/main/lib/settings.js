const { app } = require("electron");
const fs = require("fs");
const path = require("path");

// Reglages de l'utilisateur, modifiables depuis l'icone de la zone de
// notification. Le lancement au demarrage n'y figure pas : c'est le systeme
// qui fait foi (app.getLoginItemSettings), un double ici pourrait mentir.
const DEFAULTS = {
  // Fermer la fenetre la cache au lieu de quitter : le badge et les
  // notifications continuent de vivre.
  runInBackground: true,
  // L'avis « l'application reste ouverte » n'est montre qu'une fois.
  backgroundHintShown: false,
};

function settingsFile() {
  return path.join(app.getPath("userData"), "settings.json");
}

/** Partie testable : ne garde que les cles connues, au bon type. */
function normalizeSettings(raw) {
  const out = { ...DEFAULTS };
  if (!raw || typeof raw !== "object") return out;
  for (const key of Object.keys(DEFAULTS)) {
    if (typeof raw[key] === typeof DEFAULTS[key]) out[key] = raw[key];
  }
  return out;
}

function loadSettings() {
  try {
    return normalizeSettings(JSON.parse(fs.readFileSync(settingsFile(), "utf8")));
  } catch {
    return normalizeSettings(null);
  }
}

function saveSettings(patch) {
  const next = normalizeSettings({ ...loadSettings(), ...patch });
  try {
    fs.writeFileSync(settingsFile(), JSON.stringify(next));
  } catch (err) {
    console.warn("Réglages non enregistrés :", err.message);
  }
  return next;
}

module.exports = { loadSettings, saveSettings, normalizeSettings, DEFAULTS };
