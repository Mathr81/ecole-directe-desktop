const test = require("node:test");
const assert = require("node:assert/strict");
const { createEdApi } = require("../src/main/auth/ed-api");

function makeApi(responses) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url: String(url), init });
    const next = responses.shift();
    return {
      ok: true,
      status: 200,
      headers: { get: (name) => (next.headers || {})[name.toLowerCase()] ?? null },
      json: async () => next.body,
    };
  };
  const api = createEdApi({
    fetchImpl,
    readGtkCookie: async () => "GTKVALUE",
    apiVersion: "4.101.2",
    userAgent: "UA",
  });
  return { api, calls };
}

const OK_BODY = { code: 200, token: "T", data: { accounts: [] } };

test("login appelle gtk puis login et transmet X-Gtk", async () => {
  const { api, calls } = makeApi([{ body: {} }, { body: OK_BODY }]);
  await api.login({ identifiant: "u", motdepasse: "p", uuid: "U1" });

  assert.match(calls[0].url, /login\.awp\?gtk=1/);
  assert.match(calls[1].url, /v=4\.101\.2/);
  assert.equal(calls[1].init.headers["X-Gtk"], "GTKVALUE");
});

test("login encode le corps en data= urlencode", async () => {
  const { api, calls } = makeApi([{ body: {} }, { body: OK_BODY }]);
  await api.login({ identifiant: "u", motdepasse: "p", uuid: "U1" });

  const payload = JSON.parse(new URLSearchParams(calls[1].init.body).get("data"));
  assert.equal(payload.identifiant, "u");
  assert.equal(payload.motdepasse, "p");
  assert.equal(payload.isReLogin, false);
  assert.equal(payload.uuid, "U1");
});

test("login joint les cles fa quand elles existent", async () => {
  const { api, calls } = makeApi([{ body: {} }, { body: OK_BODY }]);
  await api.login({ identifiant: "u", motdepasse: "p", uuid: "U1", fa: [{ cn: "c", cv: "v" }] });

  const payload = JSON.parse(new URLSearchParams(calls[1].init.body).get("data"));
  assert.deepEqual(payload.fa, [{ cn: "c", cv: "v" }]);
});

test("login omet fa quand il n'y a pas de cles", async () => {
  const { api, calls } = makeApi([{ body: {} }, { body: OK_BODY }]);
  await api.login({ identifiant: "u", motdepasse: "p", uuid: "U1", fa: [] });

  const payload = JSON.parse(new URLSearchParams(calls[1].init.body).get("data"));
  assert.equal("fa" in payload, false);
});

// Verifie sur l'API reelle : sur un 250 le jeton exploitable est celui du
// CORPS de reponse. L'entete x-token en porte un autre, que doubleauth
// rejette avec un code 520.
test("login prend le token 2FA dans le corps, pas dans l'entete x-token", async () => {
  const { api } = makeApi([
    { body: {} },
    { body: { code: 250, token: "TWOFA_BODY", data: {} }, headers: { "x-token": "AUTRE_JETON" } },
  ]);
  const res = await api.login({ identifiant: "u", motdepasse: "p", uuid: "U1" });
  assert.equal(res.code, 250);
  assert.equal(res.twoFaToken, "TWOFA_BODY");
});

test("login ne remonte pas de token 2FA quand la connexion reussit", async () => {
  const { api } = makeApi([{ body: {} }, { body: OK_BODY }]);
  const res = await api.login({ identifiant: "u", motdepasse: "p", uuid: "U1" });
  assert.equal(res.twoFaToken, "");
});

test("login remonte le code 505 sans lever d'exception", async () => {
  const { api } = makeApi([
    { body: {} },
    { body: { code: 505, token: "", message: "Mot de passe invalide !", data: {} } },
  ]);
  const res = await api.login({ identifiant: "u", motdepasse: "bad", uuid: "U1" });
  assert.equal(res.code, 505);
  assert.equal(res.message, "Mot de passe invalide !");
});

test("get2faQuestion decode le base64", async () => {
  const { api } = makeApi([
    {
      body: {
        code: 200,
        data: {
          question: Buffer.from("Question ?").toString("base64"),
          propositions: [Buffer.from("Oui").toString("base64")],
        },
      },
    },
  ]);
  const res = await api.get2faQuestion("TWOFA");
  assert.equal(res.question, "Question ?");
  assert.deepEqual(res.propositions, ["Oui"]);
});

// L'API rejette X-Token sur doubleauth (code 520) : seul 2FA-Token passe.
test("get2faQuestion envoie le jeton dans l'entete 2FA-Token", async () => {
  const { api, calls } = makeApi([{ body: { code: 200, data: { question: "", propositions: [] } } }]);
  await api.get2faQuestion("TWOFA");
  assert.equal(calls[0].init.headers["2FA-Token"], "TWOFA");
  assert.equal("X-Token" in calls[0].init.headers, false);
});

test("send2faAnswer envoie le jeton dans l'entete 2FA-Token", async () => {
  const { api, calls } = makeApi([{ body: { code: 200, data: { cn: "C", cv: "V" } } }]);
  await api.send2faAnswer("Oui", "TWOFA");
  assert.equal(calls[0].init.headers["2FA-Token"], "TWOFA");
  assert.equal("X-Token" in calls[0].init.headers, false);
});

test("send2faAnswer encode le choix en base64 et renvoie cn/cv", async () => {
  const { api, calls } = makeApi([{ body: { code: 200, data: { cn: "C", cv: "V" } } }]);
  const res = await api.send2faAnswer("Oui", "TWOFA");

  const payload = JSON.parse(new URLSearchParams(calls[0].init.body).get("data"));
  assert.equal(payload.choix, Buffer.from("Oui").toString("base64"));
  assert.deepEqual(res, { cn: "C", cv: "V" });
});

test("relogin envoie isReLogin et l'accesstoken sans mot de passe", async () => {
  const { api, calls } = makeApi([{ body: OK_BODY }]);
  await api.relogin({ identifiant: "u", uuid: "U1", typeCompte: "E", accesstoken: "AT" });

  const payload = JSON.parse(new URLSearchParams(calls[0].init.body).get("data"));
  assert.equal(payload.isReLogin, true);
  assert.equal(payload.accesstoken, "AT");
  assert.equal(payload.typeCompte, "E");
  assert.equal(payload.motdepasse, "");
});

test("unreadMessagesCount lit le compteur avec le jeton de la page", async () => {
  const { api, calls } = makeApi([{
    body: { code: 200, data: { pagination: { messagesRecusCount: 71, messagesRecusNotReadCount: 3 } } },
  }]);
  const count = await api.unreadMessagesCount({ token: "TOK", eleveId: 5618 });

  assert.equal(count, 3);
  assert.match(calls[0].url, /\/v3\/eleves\/5618\/messages\.awp\?.*verbe=get/);
  assert.match(calls[0].url, /v=4\.101\.2/);
  assert.equal(calls[0].init.headers["X-Token"], "TOK");
});

test("unreadMessagesCount rend null sur un jeton expire", async () => {
  const { api } = makeApi([{ body: { code: 520, message: "Token invalide !" } }]);
  assert.equal(await api.unreadMessagesCount({ token: "OLD", eleveId: 1 }), null);
});
