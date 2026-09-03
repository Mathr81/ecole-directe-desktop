const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { initLogger, formatLine, stringify, shouldRotate, MAX_BYTES } = require("../src/main/lib/logger");

// ---- Mise en forme --------------------------------------------------
//
// L'ancienne version faisait args.join(" ") : un objet devenait
// "[object Object]" et une erreur perdait sa pile. Les journaux d'echec
// de mise a jour etaient donc illisibles au moment ou ils comptaient.

test("stringify garde la pile d'une erreur", () => {
  const err = new Error("boum");
  assert.ok(stringify(err).includes("boum"));
  assert.ok(stringify(err).includes("Error"));
});

test("stringify serialise un objet au lieu de [object Object]", () => {
  assert.equal(stringify({ code: 520 }), '{"code":520}');
});

test("stringify survit a une structure circulaire", () => {
  const a = {};
  a.self = a;
  assert.equal(typeof stringify(a), "string");
});

test("stringify distingue null et undefined", () => {
  assert.equal(stringify(null), "null");
  assert.equal(stringify(undefined), "undefined");
});

test("formatLine porte niveau, horodatage et texte", () => {
  const line = formatLine("LOG", ["a", 1], new Date("2026-01-02T03:04:05.000Z"));
  assert.equal(line, '[LOG] 2026-01-02T03:04:05.000Z a 1\n');
});

test("formatLine termine par un saut de ligne", () => {
  assert.ok(formatLine("ERROR", ["x"]).endsWith("\n"));
});

// ---- Rotation -------------------------------------------------------

test("pas de rotation sur un fichier vide", () => {
  assert.equal(shouldRotate(0, 10_000_000), false);
});

test("pas de rotation tant qu'on tient sous la limite", () => {
  assert.equal(shouldRotate(MAX_BYTES - 100, 50), false);
});

test("rotation quand la ligne ferait deborder", () => {
  assert.equal(shouldRotate(MAX_BYTES - 10, 50), true);
});

// ---- Durabilite -----------------------------------------------------
//
// Le coeur de la correction : ce qui est journalise doit etre sur le
// disque immediatement, sans attendre le vidage d'un buffer que la
// fermeture du processus emporterait.

test("la ligne est sur le disque des le retour de console.log", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ed-log-"));
  const original = { log: console.log, warn: console.warn, error: console.error };
  try {
    initLogger(dir);
    console.log("ligne durable");
    const content = fs.readFileSync(path.join(dir, "app.log"), "utf8");
    assert.ok(content.includes("ligne durable"));
  } finally {
    Object.assign(console, original);
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("journaliser n'echoue pas si le dossier disparait", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ed-log-"));
  const original = { log: console.log, warn: console.warn, error: console.error };
  try {
    initLogger(dir);
    fs.rmSync(dir, { recursive: true, force: true });
    assert.doesNotThrow(() => console.log("dans le vide"));
  } finally {
    Object.assign(console, original);
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
