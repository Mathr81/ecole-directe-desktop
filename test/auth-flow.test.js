const test = require("node:test");
const assert = require("node:assert/strict");
const { createAuthFlow } = require("../src/main/auth/auth-flow");

function makeStore(initial = {}) {
  let data = { username: "u", password: "p", deviceUuid: "U1", faKeys: [], ...initial };
  return {
    read: () => data,
    writeCredentials: (username, password) => { data = { ...data, username, password }; },
    ensureDeviceUuid: () => data.deviceUuid,
    saveFaKeys: (faKeys) => { data = { ...data, faKeys }; },
    clearFaKeys: () => { data = { ...data, faKeys: [] }; },
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
