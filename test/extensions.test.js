const test = require("node:test");
const assert = require("node:assert/strict");
const { staleWorkerIds } = require("../src/main/features/extensions");

const prefs = (version) => ({
  extensions: { settings: { abc: { service_worker_registration_info: { version } } } },
});

test("un service worker enregistre pour une autre version est perime", () => {
  assert.deepEqual(staleWorkerIds(prefs("20.1.5"), "30.0.3"), ["abc"]);
});

test("meme version : rien a nettoyer", () => {
  assert.deepEqual(staleWorkerIds(prefs("30.0.3"), "30.0.3"), []);
});

test("aucun enregistrement : rien a nettoyer", () => {
  assert.deepEqual(staleWorkerIds({}, "30.0.3"), []);
  assert.deepEqual(staleWorkerIds({ extensions: { settings: { abc: {} } } }, "30.0.3"), []);
  assert.deepEqual(staleWorkerIds(null, "30.0.3"), []);
});
