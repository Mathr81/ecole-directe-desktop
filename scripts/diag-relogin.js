// Le badge distant peut-il passer par un relogin (jeton) plutot que par un
// login complet avec mot de passe ? Trois questions :
//
//   1. relogin.awp repond-il 200 avec accounts[].accessToken ?
//      (avec et sans en-tete X-Token, le SPA envoyant le sien)
//   2. sa reponse porte-t-elle les memes compteurs de modules ?
//   3. le jeton de la page survit-il au relogin ?
//
// Lancer avec :
//   NODE_ENV=development env -u ELECTRON_RUN_AS_NODE ./node_modules/.bin/electron scripts/diag-relogin.js
//
// Ne journalise jamais de secret : uniquement des longueurs et des codes.
const { app, session, safeStorage } = require("electron");
const path = require("path");

app.setName("Mon EcoleDirecte");
const { resolveUserDataPath } = require("../src/main/lib/paths");
const userDataPath = resolveUserDataPath();

const { createEdApi } = require("../src/main/auth/ed-api");
const { createCredentialsStore } = require("../src/main/auth/credentials-store");
const { messagerieBadgeCount, moduleBadges } = require("../src/main/auth/session-payload");

const log = (...a) => process.stdout.write("[diag] " + a.join(" ") + "\n");
const redact = (v) => (v ? `<${String(v).length} caracteres>` : "<vide>");

const API = "https://api.ecoledirecte.com/v3";
const VERSION = "4.101.2";

async function tokenStillValid(ses, token, eleveId) {
  const res = await ses.fetch(`${API}/eleves/${eleveId}/notes.awp?verbe=get&v=${VERSION}`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", "X-Token": token },
    body: "data={}",
  });
  const json = await res.json().catch(() => ({}));
  return json.code;
}

const counters = (accounts) =>
  JSON.stringify({ messagerie: messagerieBadgeCount({ accounts }), modules: moduleBadges({ accounts }) });

app.whenReady().then(async () => {
  const ses = session.defaultSession;
  const store = createCredentialsStore(path.join(userDataPath, "credentials.json"), safeStorage);
  const creds = store.read();
  if (!creds.username || !creds.password) {
    log("Aucun identifiant enregistre dans", userDataPath);
    return app.exit(1);
  }

  const makeApi = (extraHeaders = {}) =>
    createEdApi({
      fetchImpl: (url, init) => ses.fetch(url, { ...init, headers: { ...init.headers, ...extraHeaders } }),
      readGtkCookie: async () => {
        const cookies = await ses.cookies.get({ name: "GTK" });
        return cookies.length > 0 ? cookies[0].value : "";
      },
      userAgent: ses.getUserAgent(),
    });

  const uuid = store.ensureDeviceUuid();
  const first = await makeApi().login({
    identifiant: creds.username, motdepasse: creds.password, uuid, fa: creds.faKeys,
  });
  log("login        : code", first.code, "jeton", redact(first.token));
  if (first.code !== 200) return app.exit(1);

  const account = (first.data.accounts || [])[0] || {};
  log("accessToken  :", redact(account.accessToken), "| typeCompte", account.typeCompte);
  log("compteurs    :", counters(first.data.accounts));

  const attempt = async (label, api) => {
    const res = await api.relogin({
      identifiant: account.identifiant,
      uuid,
      typeCompte: account.typeCompte,
      accesstoken: account.accessToken,
      fa: creds.faKeys,
    });
    log(`${label}: code`, res.code, "|", res.message || "-", "| jeton", redact(res.token));
    if (res.code === 200) log("  compteurs  :", counters(res.data.accounts));
    return res;
  };

  const plain = await attempt("relogin      ", makeApi());
  const withToken = plain.code === 200 ? null : await attempt("relogin+XTok ", makeApi({ "X-Token": first.token }));

  log("jeton login apres relogin : code", await tokenStillValid(ses, first.token, account.id));

  const ok = plain.code === 200 || (withToken && withToken.code === 200);
  log("");
  log(ok ? "VERDICT : relogin utilisable pour le badge." : "VERDICT : relogin refuse, garder le login complet.");
  app.exit(ok ? 0 : 2);
});
