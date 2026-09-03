const test = require("node:test");
const assert = require("node:assert/strict");
const { uniqueName, formatBytes, progressLabel } = require("../src/main/features/downloads");

// ---- Ne jamais ecraser -----------------------------------------------
//
// Deux bulletins du meme trimestre arrivent souvent sous le meme nom.
// Ecraser le premier sans prevenir serait une perte de donnees silencieuse.

const taken = (...names) => (candidate) => names.includes(candidate);

test("un nom libre est garde tel quel", () => {
  assert.equal(uniqueName("bulletin.pdf", taken()), "bulletin.pdf");
});

test("un nom pris est numerote", () => {
  assert.equal(uniqueName("bulletin.pdf", taken("bulletin.pdf")), "bulletin (1).pdf");
});

test("la numerotation continue tant que c'est pris", () => {
  assert.equal(
    uniqueName("bulletin.pdf", taken("bulletin.pdf", "bulletin (1).pdf", "bulletin (2).pdf")),
    "bulletin (3).pdf"
  );
});

test("un fichier sans extension est gere", () => {
  assert.equal(uniqueName("NOTES", taken("NOTES")), "NOTES (1)");
});

test("les points dans le nom ne sont pas pris pour l'extension", () => {
  assert.equal(
    uniqueName("cours.2026.01.pdf", taken("cours.2026.01.pdf")),
    "cours.2026.01 (1).pdf"
  );
});

// ---- Tailles ----------------------------------------------------------

test("les tailles sont lisibles", () => {
  assert.equal(formatBytes(512), "512 o");
  assert.equal(formatBytes(2048), "2 Ko");
  assert.equal(formatBytes(5 * 1024 * 1024), "5.0 Mo");
});

test("une taille inconnue ne produit pas NaN", () => {
  assert.equal(formatBytes(undefined), "");
  assert.equal(formatBytes(-1), "");
});

// ---- Avancement --------------------------------------------------------
//
// Le serveur n'annonce pas toujours la taille : les pieces jointes
// generees a la volee arrivent avec total = 0. On montre alors ce qui est
// recu, sans inventer de pourcentage.

test("avec une taille connue, on donne le pourcentage", () => {
  assert.match(progressLabel("a.pdf", 50, 100), /50 %/);
});

test("sans taille annoncee, pas de pourcentage invente", () => {
  const label = progressLabel("a.pdf", 2048, 0);
  assert.doesNotMatch(label, /%/);
  assert.match(label, /2 Ko/);
});

test("le pourcentage reste borne si le serveur ment sur la taille", () => {
  assert.match(progressLabel("a.pdf", 300, 100), /100 %/);
});
