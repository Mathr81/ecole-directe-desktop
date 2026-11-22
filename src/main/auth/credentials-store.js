// Stockage chiffre des identifiants, de l'identifiant d'appareil et des
// cles 2FA, via safeStorage.
//
// Le format historique en production ne contient que username et password :
// la lecture doit rester tolerante aux champs absents, sinon on casse les
// installations existantes.

const fs = require("fs");
const crypto = require("crypto");

function createCredentialsStore(filePath, safeStorage) {
  const enc = (v) => safeStorage.encryptString(v).toString("base64");
  const dec = (v) => safeStorage.decryptString(Buffer.from(v, "base64"));

  function readRaw() {
    try {
      if (!fs.existsSync(filePath)) return {};
      return JSON.parse(fs.readFileSync(filePath, "utf8"));
    } catch (err) {
      console.error("Erreur lecture credentials :", err.message);
      return {};
    }
  }

  function writeRaw(next) {
    fs.writeFileSync(filePath, JSON.stringify(next));
  }

  function read() {
    const raw = readRaw();
    if (!safeStorage.isEncryptionAvailable()) {
      return { username: null, password: null, deviceUuid: null, faKeys: [], reloginToken: null };
    }

    const safe = (value, fallback) => {
      try { return value ? dec(value) : fallback; } catch { return fallback; }
    };

    let faKeys = [];
    try {
      faKeys = raw.faKeys ? JSON.parse(dec(raw.faKeys)) : [];
    } catch { faKeys = []; }

    let reloginToken = null;
    try {
      reloginToken = raw.reloginToken ? JSON.parse(dec(raw.reloginToken)) : null;
    } catch { reloginToken = null; }

    return {
      username: safe(raw.username, null),
      password: safe(raw.password, null),
      deviceUuid: safe(raw.deviceUuid, null),
      faKeys: Array.isArray(faKeys) ? faKeys : [],
      reloginToken: reloginToken && reloginToken.accessToken ? reloginToken : null,
    };
  }

  function writeCredentials(username, password) {
    if (!safeStorage.isEncryptionAvailable()) {
      console.error("Le chiffrement n'est pas disponible.");
      return;
    }
    writeRaw({ ...readRaw(), username: enc(username), password: enc(password) });
  }

  // L'uuid d'appareil evite qu'EcoleDirecte considere chaque demarrage
  // comme un nouvel appareil, ce qui redeclencherait la 2FA.
  function ensureDeviceUuid() {
    const current = read().deviceUuid;
    if (current) return current;

    const uuid = crypto.randomUUID();
    if (safeStorage.isEncryptionAvailable()) {
      writeRaw({ ...readRaw(), deviceUuid: enc(uuid) });
    }
    return uuid;
  }

  function saveFaKeys(faKeys) {
    if (!safeStorage.isEncryptionAvailable()) return;
    writeRaw({ ...readRaw(), faKeys: enc(JSON.stringify(faKeys)) });
  }

  function clearFaKeys() {
    const raw = readRaw();
    delete raw.faKeys;
    writeRaw(raw);
  }

  // Changement de compte : identifiants et cles 2FA partent, l'uuid
  // d'appareil reste (c'est toujours le meme appareil).
  function clearAccount() {
    const raw = readRaw();
    delete raw.username;
    delete raw.password;
    delete raw.faKeys;
    delete raw.reloginToken;
    writeRaw(raw);
  }

  // { identifiant, typeCompte, accessToken } du mode mobile, ou null pour
  // l'effacer. L'accessToken change a chaque relogin : on garde le dernier.
  function saveReloginToken(entry) {
    const raw = readRaw();
    if (!entry) {
      delete raw.reloginToken;
    } else {
      if (!safeStorage.isEncryptionAvailable()) return;
      raw.reloginToken = enc(JSON.stringify(entry));
    }
    writeRaw(raw);
  }

  return {
    read,
    writeCredentials,
    ensureDeviceUuid,
    saveFaKeys,
    clearFaKeys,
    saveReloginToken,
    clearAccount,
  };
}

module.exports = { createCredentialsStore };
