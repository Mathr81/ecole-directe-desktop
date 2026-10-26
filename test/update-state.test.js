const test = require("node:test");
const assert = require("node:assert/strict");
const {
  createUpdateState, describe, nextAttempt, installLooksBroken, FAILED_INSTALL_THRESHOLD,
} = require("../src/main/features/update-state");

// ---- Comptage des tentatives ----------------------------------------
//
// On ne voit jamais l'installateur echouer : il tourne apres la mort du
// processus. Le seul signal exploitable est de re-telecharger une version
// deja telechargee, ce qui prouve qu'on ne tourne pas dessus.

test("premiere rencontre d'une version : une tentative", () => {
  assert.deepEqual(nextAttempt(null, "2.2.0"), { version: "2.2.0", attempts: 1 });
});

test("re-telecharger la meme version incremente", () => {
  assert.deepEqual(nextAttempt({ version: "2.2.0", attempts: 1 }, "2.2.0"), { version: "2.2.0", attempts: 2 });
});

test("une nouvelle version repart de zero", () => {
  assert.deepEqual(nextAttempt({ version: "2.2.0", attempts: 3 }, "2.3.0"), { version: "2.3.0", attempts: 1 });
});

test("une seule tentative ne vaut pas panne", () => {
  assert.equal(installLooksBroken({ version: "2.2.0", attempts: 1 }), false);
});

test("au seuil, la pose automatique est declaree cassee", () => {
  assert.equal(installLooksBroken({ version: "2.2.0", attempts: FAILED_INSTALL_THRESHOLD }), true);
});

test("pas de dossier de suivi : rien a signaler", () => {
  assert.equal(installLooksBroken(null), false);
});

// ---- Machine a etats ------------------------------------------------

test("l'etat de depart ne montre rien", () => {
  const s = createUpdateState();
  assert.equal(s.value.phase, "idle");
  assert.equal(describe(s.value).title, "");
});

test("le pourcentage est arrondi et borne", () => {
  const s = createUpdateState();
  s.progress(42.7);
  assert.equal(s.value.percent, 43);
  s.progress(101.4);
  assert.equal(s.value.percent, 100);
  s.progress(-5);
  assert.equal(s.value.percent, 0);
});

test("un progres sans valeur ne casse pas l'etat", () => {
  const s = createUpdateState();
  s.progress(undefined);
  assert.equal(s.value.percent, 0);
});

test("le telechargement conserve la version annoncee", () => {
  const s = createUpdateState();
  s.available("2.3.0");
  s.progress(10);
  assert.equal(s.value.version, "2.3.0");
});

// ---- Ce que voit l'utilisateur --------------------------------------

test("une mise a jour prete propose de l'installer", () => {
  const s = createUpdateState();
  s.downloaded("2.3.0", 1);
  const view = describe(s.value);
  assert.equal(view.canInstall, true);
  assert.equal(view.canOpenInstaller, false);
  assert.match(view.title, /2\.3\.0/);
});

test("apres plusieurs echecs, l'installateur manuel est propose", () => {
  const s = createUpdateState();
  s.downloaded("2.2.0", 3);
  const view = describe(s.value);
  assert.equal(view.canOpenInstaller, true);
  assert.match(view.detail, /échoué 2 fois/);
});

test("une erreur est montree, jamais avalee", () => {
  const s = createUpdateState();
  s.failed("ENOENT installer introuvable");
  const view = describe(s.value);
  assert.equal(view.isError, true);
  assert.match(view.detail, /ENOENT/);
});

test("une erreur sans message reste affichable", () => {
  const s = createUpdateState();
  s.failed(undefined);
  assert.equal(describe(s.value).detail, "Erreur inconnue");
});

test("a jour : rien a proposer", () => {
  const s = createUpdateState();
  s.upToDate();
  const view = describe(s.value);
  assert.equal(view.canInstall, false);
  assert.equal(view.isError, false);
});

test("macOS : une version disponible se telecharge a la main", () => {
  const state = createUpdateState();
  state.manual("2.5.0");
  const view = describe(state.value);
  assert.equal(view.title, "Mise à jour v2.5.0 disponible");
  assert.equal(view.canDownload, true);
  assert.equal(view.canInstall, false);
  assert.equal(view.showProgress, false);
});
