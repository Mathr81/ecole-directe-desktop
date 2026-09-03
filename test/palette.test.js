const test = require("node:test");
const assert = require("node:assert/strict");
const { normalizeLinks, filterEntries, scoreEntry, fold } = require("../src/main/features/palette");

const ED = "https://www.ecoledirecte.com";

// ---- Nettoyage des liens releves sur la page ------------------------

test("les liens hors EcoleDirecte sont ecartes", () => {
  const out = normalizeLinks([
    { href: `${ED}/Eleves/5618/Notes`, text: "Notes" },
    { href: "https://www.google.com", text: "Google" },
  ]);
  assert.deepEqual(out.map((e) => e.label), ["Notes"]);
});

test("javascript: et ancres sont ecartes", () => {
  const out = normalizeLinks([
    { href: "javascript:void(0)", text: "Menu" },
    { href: "#contenu", text: "Aller au contenu" },
    { href: `${ED}/Eleves/5618/Messagerie`, text: "Messagerie" },
  ]);
  assert.equal(out.length, 1);
});

test("les doublons icone + libelle sont fusionnes", () => {
  const out = normalizeLinks([
    { href: `${ED}/Eleves/5618/Notes`, text: "Notes" },
    { href: `${ED}/Eleves/5618/Notes`, text: "" },
  ]);
  assert.equal(out.length, 1);
  assert.equal(out[0].label, "Notes");
});

test("un lien sans libelle n'a rien a proposer", () => {
  assert.equal(normalizeLinks([{ href: `${ED}/Eleves/5618/Notes`, text: "   " }]).length, 0);
});

test("les libelles sur plusieurs lignes sont remis a plat", () => {
  const out = normalizeLinks([{ href: `${ED}/x`, text: "  Cahier\n  de   texte " }]);
  assert.equal(out[0].label, "Cahier de texte");
});

test("une entree mal formee ne fait pas tomber le nettoyage", () => {
  assert.doesNotThrow(() => normalizeLinks([null, {}, { href: 42 }, undefined]));
  assert.equal(normalizeLinks([null, {}, { href: 42 }]).length, 0);
});

// ---- Repli d'accents et de casse -------------------------------------
//
// Indispensable en francais : personne ne tape « Vie scolaire » avec la
// bonne casse, et « éval » doit trouver « Évaluations ».

test("les accents et la casse sont ignores", () => {
  assert.equal(fold("Évaluations"), "evaluations");
  assert.ok(scoreEntry({ label: "Évaluations" }, "eval") > 0);
  assert.ok(scoreEntry({ label: "Vie scolaire" }, "VIE SCO") > 0);
});

// ---- Classement -------------------------------------------------------

test("un debut de libelle passe avant une occurrence au milieu", () => {
  const entries = [{ label: "Anciennes notes", href: "a" }, { label: "Notes", href: "b" }];
  assert.equal(filterEntries(entries, "notes")[0].href, "b");
});

test("les initiales trouvent l'entree", () => {
  const entries = [{ label: "Cahier de texte", href: "a" }];
  assert.equal(filterEntries(entries, "cdt").length, 1);
});

test("ce qui ne correspond pas disparait", () => {
  const entries = [{ label: "Notes", href: "a" }, { label: "Messagerie", href: "b" }];
  assert.deepEqual(filterEntries(entries, "zzz"), []);
});

test("a requete vide, l'ordre du menu est conserve", () => {
  const entries = [{ label: "B", href: "b" }, { label: "A", href: "a" }];
  assert.deepEqual(filterEntries(entries, "").map((e) => e.href), ["b", "a"]);
});

test("le nombre de propositions est borne", () => {
  const entries = Array.from({ length: 50 }, (_, i) => ({ label: `Item ${i}`, href: `h${i}` }));
  assert.equal(filterEntries(entries, "", 5).length, 5);
});

test("a score egal, l'ordre de la page tranche", () => {
  const entries = [{ label: "Notes", href: "a" }, { label: "Notes", href: "b" }];
  assert.deepEqual(filterEntries(entries, "notes").map((e) => e.href), ["a", "b"]);
});
