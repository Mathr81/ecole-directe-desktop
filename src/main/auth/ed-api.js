// Client HTTP de l'API EcoleDirecte.
//
// fetchImpl et readGtkCookie sont injectes : en production ce sont
// session.defaultSession.fetch et la lecture du cookie GTK dans le jar de
// la session, ce qui fait atterrir les cookies directement dans la fenetre.
// En test ce sont des bouchons, ce qui rend ce module testable sans reseau.
//
// Deux modes, voir docs/ecoledirecte-api.md :
//   - "mobile" : on se presente comme l'application mobile. Seul ce mode
//     recoit un accessToken, qui permet de se reconnecter sans mot de passe.
//   - "browser" : le site web. Repli si EcoleDirecte refuse le mode mobile
//     (version de l'application changee, typiquement).
// Un jeton est lie au User-Agent qui l'a obtenu : chaque appel qui porte un
// jeton doit repartir dans le mode de ce jeton.

const BASE_URL = "https://api.ecoledirecte.com";
// Valeur de packageVersion du SPA courant.
const DEFAULT_API_VERSION = "4.104.4";

// Version annoncee par l'application mobile. Le login n'accepte l'UA
// EDMOBILE qu'avec la version qui va avec (sinon 505).
const MOBILE_API_VERSION = "8.0.0";
const MOBILE_USER_AGENT =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 " +
  `(KHTML, like Gecko) Mobile/15E148  EDMOBILE v${MOBILE_API_VERSION}`;

// Code renvoye par /v3/login.awp quand la double authentification est requise.
const CODE_2FA_REQUIRED = 250;
const CODE_OK = 200;
// doubleauth n'accepte que cet entete : X-Token y est rejete (code 520).
const HEADER_2FA_TOKEN = "2FA-Token";

const decodeB64 = (v) => Buffer.from(String(v || ""), "base64").toString("utf8");
const encodeB64 = (v) => Buffer.from(String(v || ""), "utf8").toString("base64");

function createEdApi({
  fetchImpl,
  readGtkCookie,
  apiVersion = DEFAULT_API_VERSION,
  userAgent,
  warn = console.warn,
}) {
  const profiles = {
    mobile: { apiVersion: MOBILE_API_VERSION, userAgent: MOBILE_USER_AGENT },
    browser: { apiVersion, userAgent },
  };

  function encodeBody(payload) {
    return new URLSearchParams({ data: JSON.stringify(payload) }).toString();
  }

  async function post(path, payload, extraHeaders = {}, mode = "browser") {
    const profile = profiles[mode];
    const url = `${BASE_URL}${path}${path.includes("?") ? "&" : "?"}v=${profile.apiVersion}`;
    const res = await fetchImpl(url, {
      method: "POST",
      credentials: "include",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "User-Agent": profile.userAgent,
        ...extraHeaders,
      },
      body: encodeBody(payload),
    });
    return { json: await res.json(), headers: res.headers };
  }

  // Le GTK est obligatoire depuis le 24/03/2025 : sans lui l'API repond
  // "identifiant et/ou mot de passe invalide" meme avec des identifiants
  // corrects.
  async function gtkHeaders(mode) {
    const profile = profiles[mode];
    await fetchImpl(`${BASE_URL}/v3/login.awp?gtk=1&v=${profile.apiVersion}`, {
      method: "GET",
      credentials: "include",
      headers: { "User-Agent": profile.userAgent },
    });
    const gtk = await readGtkCookie();
    return gtk ? { "X-Gtk": gtk } : {};
  }

  // Verifie sur l'API reelle : sur un code 250, le jeton exploitable par
  // doubleauth est celui du CORPS de reponse. La reponse porte aussi un
  // entete x-token, mais il contient un autre jeton, que doubleauth rejette
  // avec un code 520.
  function normalize(json, headers, mode) {
    const code = json.code;
    return {
      code,
      mode,
      token: json.token || "",
      message: json.message || "",
      data: json.data || {},
      twoFaToken: code === CODE_2FA_REQUIRED
        ? json.token || headers.get("2fa-token") || ""
        : "",
    };
  }

  async function loginAs(mode, { identifiant, motdepasse, uuid, fa }) {
    const payload = { identifiant, motdepasse, isReLogin: false, uuid: uuid || "" };
    if (Array.isArray(fa) && fa.length > 0) payload.fa = fa;

    const { json, headers } = await post("/v3/login.awp", payload, await gtkHeaders(mode), mode);
    return normalize(json, headers, mode);
  }

  // Mode mobile d'abord. Tout autre code qu'un succes ou une 2FA fait
  // retenter en mode navigateur : un mot de passe faux y echouera pareil,
  // une version mobile perimee non.
  async function login(credentials) {
    const res = await loginAs("mobile", credentials);
    if (res.code === CODE_OK || res.code === CODE_2FA_REQUIRED) return res;

    warn(`Connexion en mode mobile refusée (code ${res.code}), repli sur le mode navigateur.`);
    return loginAs("browser", credentials);
  }

  // Reconnexion sans mot de passe, comme l'application mobile : le SPA
  // natif envoie motdepasse "???" et l'accessToken du compte. N'existe
  // qu'en mode mobile. La reponse porte un nouvel accessToken.
  async function relogin({ identifiant, uuid, typeCompte, accesstoken, fa }) {
    const payload = {
      identifiant,
      uuid: uuid || "",
      isReLogin: true,
      motdepasse: "???",
      typeCompte,
      accesstoken,
    };
    if (Array.isArray(fa) && fa.length > 0) payload.fa = fa;

    const { json, headers } = await post("/v3/login.awp", payload, await gtkHeaders("mobile"), "mobile");
    return normalize(json, headers, "mobile");
  }

  async function get2faQuestion(twoFaToken, mode = "browser") {
    const { json } = await post(
      "/v3/connexion/doubleauth.awp?verbe=get",
      {},
      { [HEADER_2FA_TOKEN]: twoFaToken },
      mode
    );
    const data = json.data || {};
    return {
      code: json.code,
      question: decodeB64(data.question),
      propositions: (data.propositions || []).map(decodeB64),
    };
  }

  async function send2faAnswer(choix, twoFaToken, mode = "browser") {
    const { json } = await post(
      "/v3/connexion/doubleauth.awp?verbe=post",
      { choix: encodeB64(choix) },
      { [HEADER_2FA_TOKEN]: twoFaToken },
      mode
    );
    const data = json.data || {};
    return { cn: data.cn, cv: data.cv };
  }

  // Compteur de non-lus de la messagerie, avec le jeton d'une session deja
  // ouverte : ni login ni mot de passe. Verifie (scripts/diag-page-token.js) :
  // le jeton n'est pas renouvele par l'appel, et rien n'est marque lu.
  // null si la reponse n'est pas exploitable (jeton expire, typiquement).
  async function unreadMessagesCount({ token, eleveId, mode = "browser" }) {
    const { json } = await post(
      `/v3/eleves/${encodeURIComponent(eleveId)}/messages.awp?force=false&typeRecuperation=received` +
        "&idClasseur=0&orderBy=date&order=desc&query=&onlyRead=&page=0&itemsPerPage=1&getAll=0&verbe=get",
      { anneeMessages: "" },
      { "X-Token": token },
      mode
    );
    const count = json.code === 200 && json.data && json.data.pagination
      ? json.data.pagination.messagesRecusNotReadCount
      : null;
    return Number.isInteger(count) && count >= 0 ? count : null;
  }

  return { login, relogin, get2faQuestion, send2faAnswer, unreadMessagesCount };
}

module.exports = {
  createEdApi,
  BASE_URL,
  DEFAULT_API_VERSION,
  MOBILE_USER_AGENT,
  CODE_2FA_REQUIRED,
};
