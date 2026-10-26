// Le badge peut-il se rafraichir avec le jeton de la page, sans login ?
//
//   1. la liste des messages renvoie-t-elle un compteur de non-lus ?
//   2. la reponse renouvelle-t-elle le jeton (en-tete x-token different) ?
//   3. le jeton de depart repond-il toujours apres l'appel ?
//
// Un login simule la session de la page. La liste des messages est lue en
// lecture seule : rien n'est marque comme lu.
//
// Lancer avec :
//   NODE_ENV=development env -u ELECTRON_RUN_AS_NODE ./node_modules/.bin/electron scripts/diag-page-token.js
//
// Ne journalise jamais de secret : codes, noms de champs et compteurs.
const { app, session, safeStorage } = require("electron");
const path = require("path");

app.setName("Mon EcoleDirecte");
const { resolveUserDataPath } = require("../src/main/lib/paths");
const userDataPath = resolveUserDataPath();

const { createEdApi } = require("../src/main/auth/ed-api");
const { createCredentialsStore } = require("../src/main/auth/credentials-store");
const { messagerieBadgeCount } = require("../src/main/auth/session-payload");

const log = (...a) => process.stdout.write("[diag] " + a.join(" ") + "\n");
const redact = (v) => (v ? `<${String(v).length} caracteres>` : "<vide>");

const API = "https://api.ecoledirecte.com/v3";
const VERSION = "4.101.2";

async function call(ses, url, token, payload = {}) {
  const res = await ses.fetch(`${url}${url.includes("?") ? "&" : "?"}v=${VERSION}`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", "X-Token": token },
    body: "data=" + encodeURIComponent(JSON.stringify(payload)),
  });
  const json = await res.json().catch(() => ({}));
  return { json, xToken: res.headers.get("x-token"), xCode: res.headers.get("x-code") };
}

// Champs numeriques d'un objet, sans descendre : de quoi reperer un compteur.
const numbers = (obj) =>
  JSON.stringify(Object.fromEntries(Object.entries(obj || {}).filter(([, v]) => typeof v === "number")));

app.whenReady().then(async () => {
  const ses = session.defaultSession;
  const store = createCredentialsStore(path.join(userDataPath, "credentials.json"), safeStorage);
  const creds = store.read();
  if (!creds.username || !creds.password) {
    log("Aucun identifiant enregistre dans", userDataPath);
    return app.exit(1);
  }

  const edApi = createEdApi({
    fetchImpl: (url, init) => ses.fetch(url, init),
    readGtkCookie: async () => {
      const cookies = await ses.cookies.get({ name: "GTK" });
      return cookies.length > 0 ? cookies[0].value : "";
    },
    userAgent: ses.getUserAgent(),
  });

  const login = await edApi.login({
    identifiant: creds.username, motdepasse: creds.password,
    uuid: store.ensureDeviceUuid(), fa: creds.faKeys,
  });
  log("login        : code", login.code, "jeton", redact(login.token));
  if (login.code !== 200) return app.exit(1);

  const account = (login.data.accounts || [])[0] || {};
  const token = login.token;
  log("badge login  :", messagerieBadgeCount({ accounts: login.data.accounts }));

  // ---- 1. Messagerie, jeton de la « page » ----
  const messages = await call(
    ses,
    `${API}/eleves/${account.id}/messages.awp?force=false&typeRecuperation=received&idClasseur=0` +
      "&orderBy=date&order=desc&query=&onlyRead=&page=0&itemsPerPage=1&getAll=0&verbe=get",
    token,
    { anneeMessages: "" }
  );
  const data = messages.json.data || {};
  log("messages     : code", messages.json.code, "| x-code", messages.xCode, "|", messages.json.message || "-");
  log("  champs data:", Object.keys(data).join(", ") || "<aucun>");
  log("  pagination :", numbers(data.pagination));

  // ---- 2. Rotation du jeton ----
  log("x-token      :", redact(messages.xToken), "| identique au jeton envoye ?",
    messages.xToken === token ? "oui" : "non");

  // ---- 3. Le jeton de depart vit-il encore ? ----
  const again = await call(
    ses,
    `${API}/eleves/${account.id}/messages.awp?force=false&typeRecuperation=received&idClasseur=0` +
      "&orderBy=date&order=desc&query=&onlyRead=&page=0&itemsPerPage=1&getAll=0&verbe=get",
    token,
    { anneeMessages: "" }
  );
  log("jeton apres  : code", again.json.code, "| x-code", again.xCode);

  const counter = data.pagination && typeof data.pagination.messagesRecusNotReadCount === "number";
  const ok = messages.json.code === 200 && counter && again.json.code === 200;
  log("");
  log(ok
    ? "VERDICT : le jeton de la page suffit, compteur present, jeton intact."
    : "VERDICT : pas utilisable tel quel, voir le detail ci-dessus.");
  app.exit(ok ? 0 : 2);
});
