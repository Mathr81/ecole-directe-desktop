const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");
const { createCredentialsStore } = require("../src/main/auth/credentials-store");

// Bouchon de safeStorage : prefixe "enc:" et refuse tout le reste, comme le
// vrai safeStorage qui leve sur un chiffre qu'il ne sait pas dechiffrer.
const fakeSafeStorage = {
  isEncryptionAvailable: () => true,
  encryptString: (s) => Buffer.from("enc:" + s, "utf8"),
  decryptString: (b) => {
    const s = b.toString("utf8");
    if (!s.startsWith("enc:")) throw new Error("Error while decrypting");
    return s.slice(4);
  },
};

const unavailableSafeStorage = {
  isEncryptionAvailable: () => false,
  encryptString: () => { throw new Error("indisponible"); },
  decryptString: () => { throw new Error("indisponible"); },
};

function tmpFile() {
  return path.join(os.tmpdir(), `ed-creds-${crypto.randomUUID()}.json`);
}

function writeLegacy(file) {
  // Format historique en production : uniquement username et password.
  fs.writeFileSync(file, JSON.stringify({
    username: fakeSafeStorage.encryptString("jdoe").toString("base64"),
    password: fakeSafeStorage.encryptString("s3cret").toString("base64"),
  }));
}

test("lit un fichier au format historique sans deviceUuid ni faKeys", () => {
  const file = tmpFile();
  writeLegacy(file);
  const store = createCredentialsStore(file, fakeSafeStorage);

  const creds = store.read();
  assert.equal(creds.username, "jdoe");
  assert.equal(creds.password, "s3cret");
  assert.equal(creds.deviceUuid, null);
  assert.deepEqual(creds.faKeys, []);
  fs.unlinkSync(file);
});

test("ensureDeviceUuid genere puis conserve le meme uuid", () => {
  const file = tmpFile();
  writeLegacy(file);
  const store = createCredentialsStore(file, fakeSafeStorage);

  const first = store.ensureDeviceUuid();
  assert.match(first, /^[0-9a-f-]{36}$/);
  assert.equal(store.ensureDeviceUuid(), first);
  fs.unlinkSync(file);
});

test("ensureDeviceUuid ne detruit pas les identifiants existants", () => {
  const file = tmpFile();
  writeLegacy(file);
  const store = createCredentialsStore(file, fakeSafeStorage);

  store.ensureDeviceUuid();
  const creds = store.read();
  assert.equal(creds.username, "jdoe");
  assert.equal(creds.password, "s3cret");
  fs.unlinkSync(file);
});

test("saveFaKeys puis clearFaKeys", () => {
  const file = tmpFile();
  writeLegacy(file);
  const store = createCredentialsStore(file, fakeSafeStorage);

  store.saveFaKeys([{ cn: "C", cv: "V", uniq: false }]);
  assert.deepEqual(store.read().faKeys, [{ cn: "C", cv: "V", uniq: false }]);

  store.clearFaKeys();
  assert.deepEqual(store.read().faKeys, []);
  assert.equal(store.read().username, "jdoe", "la purge 2FA ne touche pas aux identifiants");
  fs.unlinkSync(file);
});

test("read renvoie des valeurs nulles sur un fichier absent", () => {
  const store = createCredentialsStore(tmpFile(), fakeSafeStorage);
  const creds = store.read();
  assert.equal(creds.username, null);
  assert.equal(creds.password, null);
  assert.deepEqual(creds.faKeys, []);
});

test("read tolere un contenu indechiffrable sans lever", () => {
  const file = tmpFile();
  fs.writeFileSync(file, JSON.stringify({
    username: Buffer.from("pas chiffre").toString("base64"),
    password: Buffer.from("pas chiffre").toString("base64"),
  }));
  const store = createCredentialsStore(file, fakeSafeStorage);

  const creds = store.read();
  assert.equal(creds.username, null);
  assert.equal(creds.password, null);
  fs.unlinkSync(file);
});

test("read tolere un JSON corrompu sans lever", () => {
  const file = tmpFile();
  fs.writeFileSync(file, "{ pas du json");
  const store = createCredentialsStore(file, fakeSafeStorage);

  assert.equal(store.read().username, null);
  fs.unlinkSync(file);
});

test("writeCredentials puis read fait un aller-retour", () => {
  const file = tmpFile();
  const store = createCredentialsStore(file, fakeSafeStorage);

  store.writeCredentials("alice", "hunter2");
  const creds = store.read();
  assert.equal(creds.username, "alice");
  assert.equal(creds.password, "hunter2");
  fs.unlinkSync(file);
});

test("sans chiffrement disponible, read ne leve pas", () => {
  const file = tmpFile();
  writeLegacy(file);
  const store = createCredentialsStore(file, unavailableSafeStorage);

  const creds = store.read();
  assert.equal(creds.username, null);
  assert.deepEqual(creds.faKeys, []);
  fs.unlinkSync(file);
});

test("clearAccount efface identifiants et cles 2FA, garde l'uuid d'appareil", () => {
  const file = tmpFile();
  const store = createCredentialsStore(file, fakeSafeStorage);
  store.writeCredentials("u", "p");
  store.saveFaKeys([{ cn: "a", cv: "b" }]);
  const uuid = store.ensureDeviceUuid();

  store.clearAccount();

  const after = store.read();
  assert.equal(after.username, null);
  assert.equal(after.password, null);
  assert.deepEqual(after.faKeys, []);
  assert.equal(after.deviceUuid, uuid);
});
