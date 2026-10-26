const test = require("node:test");
const assert = require("node:assert/strict");
const { normalizeSettings, DEFAULTS } = require("../src/main/lib/settings");

test("sans fichier, les reglages par defaut", () => {
  assert.deepEqual(normalizeSettings(null), DEFAULTS);
  assert.deepEqual(normalizeSettings("x"), DEFAULTS);
});

test("une valeur du mauvais type est ignoree, pas devinee", () => {
  assert.equal(normalizeSettings({ runInBackground: "false" }).runInBackground, true);
  assert.equal(normalizeSettings({ runInBackground: false }).runInBackground, false);
});

test("les cles inconnues sont abandonnees", () => {
  assert.equal("intrus" in normalizeSettings({ intrus: 1 }), false);
});

const { startedHidden } = require("../src/main/features/tray");

test("le demarrage reduit ne se declenche que sur --hidden", () => {
  assert.equal(startedHidden(["app.exe", "--hidden"]), true);
  assert.equal(startedHidden(["app.exe"]), false);
});
