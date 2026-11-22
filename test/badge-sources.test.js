const test = require("node:test");
const assert = require("node:assert/strict");
const { readBadgeFromApi } = require("../src/main/features/badge-sources");

const ACCOUNTS = [{ identifiant: "u", accessToken: "AT2", modules: [{ code: "MESSAGERIE", badge: 4 }] }];

function makeDeps({ reloginToken = null, relogin, loginMobile }) {
  let saved = reloginToken;
  return {
    deps: {
      credentialsStore: {
        read: () => ({ username: "u", password: "p", faKeys: [], reloginToken: saved }),
        ensureDeviceUuid: () => "U1",
        saveReloginToken: (entry) => { saved = entry; },
      },
      edApi: { relogin, loginMobile },
    },
    saved: () => saved,
  };
}

test("le badge passe par le relogin, sans mot de passe, et garde le nouveau jeton", async () => {
  const { deps, saved } = makeDeps({
    reloginToken: { identifiant: "u", typeCompte: "E", accessToken: "AT1" },
    relogin: async ({ accesstoken }) => { assert.equal(accesstoken, "AT1"); return { code: 200, data: { accounts: ACCOUNTS } }; },
    loginMobile: async () => { throw new Error("pas de login complet attendu"); },
  });
  assert.equal(await readBadgeFromApi(deps, null), 4);
  assert.equal(saved().accessToken, "AT2");
});

test("le badge retombe sur le login complet si le relogin est refuse", async () => {
  const warn = console.warn;
  console.warn = () => {};
  try {
    let logins = 0;
    const { deps, saved } = makeDeps({
      reloginToken: { identifiant: "u", typeCompte: "E", accessToken: "MORT" },
      relogin: async () => ({ code: 505, data: {} }),
      loginMobile: async () => { logins += 1; return { code: 200, mode: "mobile", data: { accounts: ACCOUNTS } }; },
    });
    assert.equal(await readBadgeFromApi(deps, null), 4);
    assert.equal(logins, 1);
    assert.equal(saved().accessToken, "AT2", "le login mobile fournit le jeton suivant");
  } finally {
    console.warn = warn;
  }
});

test("sans jeton, le badge se connecte en mode mobile et garde le jeton obtenu", async () => {
  const { deps, saved } = makeDeps({
    relogin: async () => { throw new Error("pas de relogin sans jeton"); },
    loginMobile: async () => ({ code: 200, mode: "mobile", data: { accounts: [{ ...ACCOUNTS[0], typeCompte: "E" }] } }),
  });
  assert.equal(await readBadgeFromApi(deps, null), 4);
  assert.deepEqual(saved(), { identifiant: "u", typeCompte: "E", accessToken: "AT2" });
});

test("en repli navigateur, le badge ne garde aucun jeton", async () => {
  const { deps, saved } = makeDeps({
    loginMobile: async () => ({ code: 200, mode: "browser", data: { accounts: ACCOUNTS } }),
  });
  assert.equal(await readBadgeFromApi(deps, null), 4);
  assert.equal(saved(), null);
});
