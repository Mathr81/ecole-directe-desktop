const { app } = require("electron");
const fs = require("fs");
const path = require("path");

// Surface minimale de la fenetre qui doit tomber sur un ecran pour qu'on
// accepte de la replacer la. En dessous, elle serait hors de portee de la
// souris — cas classique du portable debranche de son second ecran.
const MIN_VISIBLE = 80;

// Bornes du facteur de zoom, alignees sur ce que propose Chromium.
const MIN_ZOOM = 0.25;
const MAX_ZOOM = 5;

// Conserve la geometrie choisie par l'utilisateur d'une ouverture a
// l'autre. Fichier separe des identifiants : rien de sensible ici.
function stateFile() {
  return path.join(app.getPath("userData"), "window-state.json");
}

function readAll() {
  try {
    if (!fs.existsSync(stateFile())) return {};
    return JSON.parse(fs.readFileSync(stateFile(), "utf8"));
  } catch {
    return {};
  }
}

// ---- Partie decidable sans Electron, donc testable -------------------

function intersectionArea(a, b) {
  const w = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
  const h = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
  return w > 0 && h > 0 ? w * h : 0;
}

/**
 * La position enregistree est-elle encore atteignable ?
 *
 * On exige un carre de MIN_VISIBLE de cote sur un ecran, pas seulement un
 * pixel : une fenetre qui depasse de 3 px reste inutilisable.
 */
function isReachable(bounds, displays, minVisible = MIN_VISIBLE) {
  if (!bounds || !Array.isArray(displays) || displays.length === 0) return false;
  const needed = minVisible * minVisible;
  return displays.some((d) => intersectionArea(bounds, d.workArea || d.bounds) >= needed);
}

function clampZoom(zoom) {
  if (!Number.isFinite(zoom)) return 1;
  return Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, zoom));
}

/**
 * Ne garde d'un enregistrement que ce qui est exploitable.
 *
 * Un fichier tronque, edite a la main ou ecrit par une version anterieure
 * ne doit jamais empecher la fenetre de s'ouvrir : chaque champ est
 * valide separement et les absents retombent sur leur defaut.
 */
function sanitizeState(raw) {
  if (!raw || typeof raw !== "object") return null;

  const size = Number.isFinite(raw.width) && Number.isFinite(raw.height)
    && raw.width > 0 && raw.height > 0
    ? { width: Math.round(raw.width), height: Math.round(raw.height) }
    : null;
  if (!size) return null;

  const position = Number.isFinite(raw.x) && Number.isFinite(raw.y)
    ? { x: Math.round(raw.x), y: Math.round(raw.y) }
    : null;

  return {
    ...size,
    ...(position || {}),
    hasPosition: Boolean(position),
    maximized: raw.maximized === true,
    zoom: clampZoom(raw.zoom),
  };
}

// ---- Cote Electron ---------------------------------------------------

function loadWindowState(name, displays = null) {
  const state = sanitizeState(readAll()[name]);
  if (!state) return null;

  // La position n'est retenue que si elle tombe encore sur un ecran
  // present. Sinon on rend la taille seule et Electron centre.
  if (state.hasPosition && displays && !isReachable(state, displays)) {
    const { x, y, ...rest } = state;
    return { ...rest, hasPosition: false };
  }
  return state;
}

function saveWindowState(name, state) {
  try {
    const all = readAll();
    const previous = all[name] || {};
    const entry = { ...previous };

    if (Number.isFinite(state.width) && Number.isFinite(state.height)) {
      entry.width = Math.round(state.width);
      entry.height = Math.round(state.height);
    }
    if (Number.isFinite(state.x) && Number.isFinite(state.y)) {
      entry.x = Math.round(state.x);
      entry.y = Math.round(state.y);
    }
    if (typeof state.maximized === "boolean") entry.maximized = state.maximized;
    if (Number.isFinite(state.zoom)) entry.zoom = clampZoom(state.zoom);

    all[name] = entry;
    fs.writeFileSync(stateFile(), JSON.stringify(all));
  } catch (err) {
    console.warn("Impossible d'enregistrer l'état de fenêtre :", err.message);
  }
}

module.exports = {
  loadWindowState, saveWindowState,
  isReachable, sanitizeState, clampZoom, intersectionArea,
  MIN_VISIBLE, MIN_ZOOM, MAX_ZOOM,
};
