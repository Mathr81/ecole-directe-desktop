const test = require("node:test");
const assert = require("node:assert/strict");
const {
  isReachable, sanitizeState, clampZoom, intersectionArea, MIN_ZOOM, MAX_ZOOM,
} = require("../src/main/lib/window-state");

const screen1080 = [{ workArea: { x: 0, y: 0, width: 1920, height: 1040 } }];
const twoScreens = [
  { workArea: { x: 0, y: 0, width: 1920, height: 1040 } },
  { workArea: { x: 1920, y: 0, width: 2560, height: 1400 } },
];

// ---- Intersection ---------------------------------------------------

test("deux rectangles disjoints ne se croisent pas", () => {
  assert.equal(intersectionArea({ x: 0, y: 0, width: 10, height: 10 }, { x: 20, y: 20, width: 10, height: 10 }), 0);
});

test("des rectangles qui se touchent par un bord ne se croisent pas", () => {
  assert.equal(intersectionArea({ x: 0, y: 0, width: 10, height: 10 }, { x: 10, y: 0, width: 10, height: 10 }), 0);
});

test("le recouvrement est mesure en surface", () => {
  assert.equal(intersectionArea({ x: 0, y: 0, width: 10, height: 10 }, { x: 5, y: 5, width: 10, height: 10 }), 25);
});

// ---- Position encore atteignable ------------------------------------
//
// Le cas qui compte : le portable rentre a la maison sans son second
// ecran. La fenetre etait a x=2400 ; la rouvrir la serait la rendre
// inaccessible a la souris.

test("une fenetre sur l'ecran principal est atteignable", () => {
  assert.equal(isReachable({ x: 100, y: 100, width: 1400, height: 900 }, screen1080), true);
});

test("une fenetre sur un ecran debranche ne l'est plus", () => {
  assert.equal(isReachable({ x: 2400, y: 200, width: 1400, height: 900 }, screen1080), false);
});

test("la meme fenetre redevient atteignable avec le second ecran", () => {
  assert.equal(isReachable({ x: 2400, y: 200, width: 1400, height: 900 }, twoScreens), true);
});

test("un chevauchement de quelques pixels ne suffit pas", () => {
  assert.equal(isReachable({ x: 1900, y: 1020, width: 1400, height: 900 }, screen1080), false);
});

test("sans aucun ecran connu, on ne restaure pas de position", () => {
  assert.equal(isReachable({ x: 0, y: 0, width: 800, height: 600 }, []), false);
});

// ---- Zoom -----------------------------------------------------------

test("le zoom est borne comme dans Chromium", () => {
  assert.equal(clampZoom(12), MAX_ZOOM);
  assert.equal(clampZoom(0.01), MIN_ZOOM);
  assert.equal(clampZoom(1.25), 1.25);
});

test("un zoom absent ou absurde vaut 1", () => {
  assert.equal(clampZoom(undefined), 1);
  assert.equal(clampZoom(NaN), 1);
  assert.equal(clampZoom("gros"), 1);
});

// ---- Robustesse de l'enregistrement ---------------------------------
//
// Un fichier tronque ou ecrit par une version anterieure ne doit jamais
// empecher la fenetre de s'ouvrir.

test("un enregistrement sans taille est rejete", () => {
  assert.equal(sanitizeState({ x: 10, y: 10 }), null);
  assert.equal(sanitizeState(null), null);
  assert.equal(sanitizeState({ width: 0, height: 0 }), null);
});

test("l'ancien format taille seule reste lisible", () => {
  const s = sanitizeState({ width: 1400, height: 900 });
  assert.equal(s.width, 1400);
  assert.equal(s.hasPosition, false);
  assert.equal(s.maximized, false);
  assert.equal(s.zoom, 1);
});

test("une position partielle est ignoree, pas devinee", () => {
  assert.equal(sanitizeState({ width: 800, height: 600, x: 10 }).hasPosition, false);
});

test("les coordonnees negatives d'un ecran a gauche sont valides", () => {
  const s = sanitizeState({ width: 800, height: 600, x: -1920, y: 0 });
  assert.equal(s.hasPosition, true);
  assert.equal(s.x, -1920);
});

test("les valeurs flottantes sont arrondies", () => {
  const s = sanitizeState({ width: 800.6, height: 600.2, x: 10.7, y: 20.3 });
  assert.deepEqual([s.width, s.height, s.x, s.y], [801, 600, 11, 20]);
});

test("maximized n'est vrai que sur un booleen vrai", () => {
  assert.equal(sanitizeState({ width: 8, height: 6, maximized: "oui" }).maximized, false);
  assert.equal(sanitizeState({ width: 8, height: 6, maximized: true }).maximized, true);
});
