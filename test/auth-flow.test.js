const test = require("node:test");
const assert = require("node:assert/strict");
const { createAuthFlow } = require("../src/main/auth/auth-flow");

function makeStore(initial = {}) {
  let data = { username: "u", password: "p", deviceUuid: "U1", faKeys: [], reloginToken: null, ...initial };
  return {
    read: () => data,
    writeCredentials: (username, password) => { data = { ...data, username, password }; },
    ensureDeviceUuid: () => data.deviceUuid,
    saveFaKeys: (faKeys) => { data = { ...data, faKeys }; },
    clearFaKeys: () => { data = { ...data, faKeys: [] }; },
    saveReloginToken: (reloginToken) => { data = { ...data, reloginToken }; },
  };
}

const OK = { code: 200, token: "T", data: { accounts: [{ id: 1 }] }, message: "" };

test("authenticate renvoie ok et l'etat de session", async () => {
  const flow = createAuthFlow({
    edApi: { login: async () => OK },
    credentialsStore: makeStore(),
    now: () => 1000,
  });
  const res = await flow.authenticate();
  assert.equal(res.status, "ok");
  assert.equal(res.state.authToken, "T");
  assert.equal(res.state.lastModified, 1000);
});

test("authenticate renvoie failed sur 505 sans lever", async () => {
  const flow = createAuthFlow({
    edApi: { login: async () => ({ code: 505, message: "Mot de passe invalide !", data: {} }) },
    credentialsStore: makeStore(),
    now: () => 1000,
  });
  const res = await flow.authenticate();
  assert.equal(res.status, "failed");
  assert.equal(res.code, 505);
});

test("authenticate renvoie needs2fa et n'ouvre aucune fenetre", async () => {
  const flow = createAuthFlow({
    edApi: {
      login: async () => ({ code: 250, twoFaToken: "TF", data: {} }),
      get2faQuestion: async () => ({ question: "Q ?", propositions: ["A", "B"] }),
    },
    credentialsStore: makeStore(),
    now: () => 1000,
  });
  const res = await flow.authenticate();
  assert.equal(res.status, "needs2fa");
  assert.equal(res.question, "Q ?");
  assert.deepEqual(res.propositions, ["A", "B"]);
});

test("un 250 malgre des cles fa purge les cles et redemande la 2FA", async () => {
  const store = makeStore({ faKeys: [{ cn: "vieux", cv: "mort" }] });
  let sentFa = null;
  const flow = createAuthFlow({
    edApi: {
      login: async ({ fa }) => { sentFa = fa; return { code: 250, twoFaToken: "TF", data: {} }; },
      get2faQuestion: async () => ({ question: "Q ?", propositions: ["A"] }),
    },
    credentialsStore: store,
    now: () => 1000,
  });

  const res = await flow.authenticate();
  assert.deepEqual(sentFa, [{ cn: "vieux", cv: "mort" }]);
  assert.equal(res.status, "needs2fa");
  assert.deepEqual(store.read().faKeys, [], "les cles mortes doivent etre purgees");
});

test("submit2faAnswer persiste cn/cv et rejoue le login", async () => {
  const store = makeStore();
  let secondLoginFa = null;
  let loginCount = 0;
  const flow = createAuthFlow({
    edApi: {
      login: async ({ fa }) => {
        loginCount += 1;
        if (loginCount === 1) return { code: 250, twoFaToken: "TF", data: {} };
        secondLoginFa = fa;
        return OK;
      },
      get2faQuestion: async () => ({ question: "Q ?", propositions: ["A"] }),
      send2faAnswer: async () => ({ cn: "C", cv: "V" }),
    },
    credentialsStore: store,
    now: () => 1000,
  });

  await flow.authenticate();
  const res = await flow.submit2faAnswer("A");

  assert.equal(res.status, "ok");
  assert.deepEqual(secondLoginFa, [{ cn: "C", cv: "V", uniq: false }]);
  assert.deepEqual(store.read().faKeys, [{ cn: "C", cv: "V", uniq: false }]);
});

test("submit2faAnswer renvoie failed sur une mauvaise reponse", async () => {
  const flow = createAuthFlow({
    edApi: {
      login: async () => ({ code: 250, twoFaToken: "TF", data: {} }),
      get2faQuestion: async () => ({ question: "Q ?", propositions: ["A"] }),
      send2faAnswer: async () => ({ cn: undefined, cv: undefined }),
    },
    credentialsStore: makeStore(),
    now: () => 1000,
  });
  await flow.authenticate();
  const res = await flow.submit2faAnswer("mauvaise");
  assert.equal(res.status, "failed");
  assert.equal(res.code, "BAD_2FA_ANSWER");
});

test("submit2faAnswer sans 2FA en attente renvoie failed", async () => {
  const flow = createAuthFlow({
    edApi: { login: async () => OK },
    credentialsStore: makeStore(),
    now: () => 1000,
  });
  const res = await flow.submit2faAnswer("A");
  assert.equal(res.status, "failed");
  assert.equal(res.code, "NO_2FA_PENDING");
});

test("authenticate renvoie failed si aucun identifiant n'est enregistre", async () => {
  const flow = createAuthFlow({
    edApi: { login: async () => OK },
    credentialsStore: makeStore({ username: null, password: null }),
    now: () => 1000,
  });
  const res = await flow.authenticate();
  assert.equal(res.status, "failed");
  assert.equal(res.code, "NO_CREDENTIALS");
});

test("une erreur reseau devient un etat failed, pas une exception", async () => {
  const flow = createAuthFlow({
    edApi: { login: async () => { throw new Error("getaddrinfo ENOTFOUND"); } },
    credentialsStore: makeStore(),
    now: () => 1000,
  });
  const res = await flow.authenticate();
  assert.equal(res.status, "failed");
  assert.equal(res.code, "NETWORK_ERROR");
});

const MOBILE_OK = {
  code: 200,
  mode: "mobile",
  token: "T",
  data: { accounts: [{ id: 1, identifiant: "u", typeCompte: "E", accessToken: "AT1" }] },
};
const quiet = () => {};

test("un login mobile memorise l'accessToken et le mode", async () => {
  const store = makeStore();
  const flow = createAuthFlow({ edApi: { login: async () => MOBILE_OK }, credentialsStore: store, now: () => 1 });
  const res = await flow.authenticate();
  assert.equal(res.state.mode, "mobile");
  assert.deepEqual(store.read().reloginToken, { identifiant: "u", typeCompte: "E", accessToken: "AT1" });
});

test("un login en repli navigateur efface l'accessToken memorise", async () => {
  const store = makeStore({ reloginToken: { identifiant: "u", typeCompte: "E", accessToken: "OLD" } });
  const flow = createAuthFlow({ edApi: { login: async () => ({ ...OK, mode: "browser" }) }, credentialsStore: store, now: () => 1 });
  const res = await flow.authenticate();
  assert.equal(res.state.mode, "browser");
  assert.equal(store.read().reloginToken, null);
});

test("refresh se reconnecte par jeton, sans mot de passe, et garde le nouveau jeton", async () => {
  const store = makeStore({ reloginToken: { identifiant: "u", typeCompte: "E", accessToken: "AT0" } });
  let sent = null;
  const flow = createAuthFlow({
    edApi: {
      relogin: async (args) => { sent = args; return MOBILE_OK; },
      login: async () => { throw new Error("pas de login complet attendu"); },
    },
    credentialsStore: store,
    now: () => 1,
  });
  const res = await flow.refresh();
  assert.equal(res.status, "ok");
  assert.equal(sent.accesstoken, "AT0");
  assert.equal(sent.typeCompte, "E");
  assert.equal(store.read().reloginToken.accessToken, "AT1");
});

test("refresh retombe sur le login complet si le jeton est refuse", async () => {
  const store = makeStore({ reloginToken: { identifiant: "u", typeCompte: "E", accessToken: "MORT" } });
  let logins = 0;
  const flow = createAuthFlow({
    edApi: {
      relogin: async () => ({ code: 505, message: "refuse", data: {} }),
      login: async () => { logins += 1; return { ...OK, mode: "browser" }; },
    },
    credentialsStore: store,
    now: () => 1,
    warn: quiet,
  });
  const res = await flow.refresh();
  assert.equal(res.status, "ok");
  assert.equal(logins, 1);
  assert.equal(store.read().reloginToken, null);
});

test("refresh sans jeton memorise fait un login complet", async () => {
  let relogins = 0;
  const flow = createAuthFlow({
    edApi: { relogin: async () => { relogins += 1; }, login: async () => MOBILE_OK },
    credentialsStore: makeStore(),
    now: () => 1,
  });
  assert.equal((await flow.refresh()).status, "ok");
  assert.equal(relogins, 0);
});

test("la 2FA reste dans le mode du login qui l'a demandee", async () => {
  const modes = [];
  const flow = createAuthFlow({
    edApi: {
      login: async () => ({ code: 250, mode: "mobile", twoFaToken: "TF", data: {} }),
      get2faQuestion: async (tok, mode) => { modes.push(mode); return { question: "Q", propositions: [] }; },
      send2faAnswer: async (a, tok, mode) => { modes.push(mode); return {}; },
    },
    credentialsStore: makeStore(),
    now: () => 1,
  });
  await flow.authenticate();
  await flow.submit2faAnswer("A");
  assert.deepEqual(modes, ["mobile", "mobile"]);
});
