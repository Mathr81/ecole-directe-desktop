const test = require("node:test");
const assert = require("node:assert/strict");
const { resolveShortcut } = require("../src/main/features/shortcuts");

// Frappe telle que before-input-event la fournit. Tous les modificateurs
// sont explicites : un champ absent vaut undefined, ce qui masquerait un
// bug de logique.
function key(overrides) {
  return {
    type: "keyDown",
    key: "",
    control: false,
    meta: false,
    alt: false,
    shift: false,
    ...overrides,
  };
}

const WIN = "win32";
const MAC = "darwin";

test("ignore les relachements de touche", () => {
  assert.equal(resolveShortcut(key({ type: "keyUp", key: "F5" }), WIN), null);
});

test("ignore une frappe sans raccourci", () => {
  assert.equal(resolveShortcut(key({ key: "a" }), WIN), null);
});

// ---- Rechargement -----------------------------------------------------

test("F5 recharge", () => {
  assert.equal(resolveShortcut(key({ key: "F5" }), WIN), "reload");
});

test("Ctrl+R recharge sous Windows", () => {
  assert.equal(resolveShortcut(key({ key: "r", control: true }), WIN), "reload");
});

test("Ctrl+Maj+R recharge sans le cache, majuscule comprise", () => {
  assert.equal(resolveShortcut(key({ key: "R", control: true, shift: true }), WIN), "reload-hard");
});

test("R seul ne recharge pas", () => {
  assert.equal(resolveShortcut(key({ key: "r" }), WIN), null);
});

test("Ctrl+F5 et Maj+F5 rechargent sans le cache", () => {
  assert.equal(resolveShortcut(key({ key: "F5", control: true }), WIN), "reload-hard");
  assert.equal(resolveShortcut(key({ key: "F5", shift: true }), WIN), "reload-hard");
});

test("Cmd+R recharge sous macOS", () => {
  assert.equal(resolveShortcut(key({ key: "r", meta: true }), MAC), "reload");
});

test("Ctrl+R ne recharge pas sous macOS, ou la touche commande est Cmd", () => {
  assert.equal(resolveShortcut(key({ key: "r", control: true }), MAC), null);
});

test("Cmd+R ne recharge pas sous Windows", () => {
  assert.equal(resolveShortcut(key({ key: "r", meta: true }), WIN), null);
});

// ---- Outils de developpement -----------------------------------------

test("F12 ouvre les outils", () => {
  assert.equal(resolveShortcut(key({ key: "F12" }), WIN), "devtools");
});

test("Cmd+Alt+I ouvre les outils sous macOS", () => {
  assert.equal(resolveShortcut(key({ key: "i", meta: true, alt: true }), MAC), "devtools");
});

test("Ctrl+Alt+I n'ouvre rien sous Windows", () => {
  assert.equal(resolveShortcut(key({ key: "i", control: true, alt: true }), WIN), null);
});

// ---- Navigation -------------------------------------------------------

test("Alt+Fleches naviguent dans l'historique", () => {
  assert.equal(resolveShortcut(key({ key: "ArrowLeft", alt: true }), WIN), "back");
  assert.equal(resolveShortcut(key({ key: "ArrowRight", alt: true }), WIN), "forward");
});

test("Alt+Fleches naviguent aussi sous macOS", () => {
  assert.equal(resolveShortcut(key({ key: "ArrowLeft", alt: true }), MAC), "back");
});

test("Cmd+Fleches naviguent sous macOS", () => {
  assert.equal(resolveShortcut(key({ key: "ArrowLeft", meta: true }), MAC), "back");
  assert.equal(resolveShortcut(key({ key: "ArrowRight", meta: true }), MAC), "forward");
});

test("les fleches seules ne naviguent pas : elles defilent la page", () => {
  assert.equal(resolveShortcut(key({ key: "ArrowLeft" }), WIN), null);
  assert.equal(resolveShortcut(key({ key: "ArrowRight" }), MAC), null);
});

test("Ctrl+Fleches ne navigue pas sous Windows : c'est le deplacement par mot", () => {
  assert.equal(resolveShortcut(key({ key: "ArrowLeft", control: true }), WIN), null);
});

// ---- Robustesse -------------------------------------------------------

test("une entree absente ne fait pas planter", () => {
  assert.equal(resolveShortcut(null, WIN), null);
  assert.equal(resolveShortcut(undefined, WIN), null);
});

// ---- Zoom -----------------------------------------------------------
//
// Le zoom se resout sur `code` et non sur `key` : sur AZERTY, Ctrl+0
// produit key "à" parce que les chiffres y exigent Shift. Un aiguillage
// sur `key` n'aurait jamais vu passer le raccourci sur le clavier de
// l'utilisateur.

const { nextZoom, ZOOM_LADDER } = require("../src/main/features/shortcuts");

test("Ctrl+0 en AZERTY, ou key vaut 'à', est bien reconnu", () => {
  const input = { type: "keyDown", key: "à", code: "Digit0", control: true };
  assert.equal(resolveShortcut(input, "win32"), "zoom-reset");
});

test("Ctrl+= agrandit, Ctrl+- reduit", () => {
  assert.equal(resolveShortcut({ type: "keyDown", key: "=", code: "Equal", control: true }, "win32"), "zoom-in");
  assert.equal(resolveShortcut({ type: "keyDown", key: "-", code: "Minus", control: true }, "win32"), "zoom-out");
});

test("le pave numerique fait la meme chose", () => {
  assert.equal(resolveShortcut({ type: "keyDown", key: "+", code: "NumpadAdd", control: true }, "win32"), "zoom-in");
  assert.equal(resolveShortcut({ type: "keyDown", key: "0", code: "Numpad0", control: true }, "win32"), "zoom-reset");
});

test("sans Ctrl, un tiret reste un tiret", () => {
  assert.equal(resolveShortcut({ type: "keyDown", key: "-", code: "Minus" }, "win32"), null);
});

test("Cmd+- sur macOS, pas Ctrl+-", () => {
  assert.equal(resolveShortcut({ type: "keyDown", key: "-", code: "Minus", meta: true }, "darwin"), "zoom-out");
  assert.equal(resolveShortcut({ type: "keyDown", key: "-", code: "Minus", control: true }, "darwin"), null);
});

test("les paliers de zoom suivent l'echelle de Chrome", () => {
  assert.equal(nextZoom(1, 1), 1.1);
  assert.equal(nextZoom(1, -1), 0.9);
  assert.equal(nextZoom(1, 0), 1);
});

test("un facteur hors palier se recale sur le plus proche", () => {
  assert.equal(nextZoom(1.13, 1), 1.25);
});

test("les extremites de l'echelle ne debordent pas", () => {
  assert.equal(nextZoom(ZOOM_LADDER[0], -1), ZOOM_LADDER[0]);
  assert.equal(nextZoom(ZOOM_LADDER[ZOOM_LADDER.length - 1], 1), ZOOM_LADDER[ZOOM_LADDER.length - 1]);
});

// ---- Palette --------------------------------------------------------

test("Ctrl+K ouvre la palette", () => {
  assert.equal(resolveShortcut({ type: "keyDown", key: "k", control: true }, "win32"), "palette");
});

test("K seul ne fait rien", () => {
  assert.equal(resolveShortcut({ type: "keyDown", key: "k" }, "win32"), null);
});

test("Ctrl+Q quitte, Cmd+Q sur macOS", () => {
  assert.equal(resolveShortcut({ type: "keyDown", key: "q", control: true }, "win32"), "quit");
  assert.equal(resolveShortcut({ type: "keyDown", key: "q", meta: true }, "darwin"), "quit");
  assert.equal(resolveShortcut({ type: "keyDown", key: "q" }, "win32"), null);
});
