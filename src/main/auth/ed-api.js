// Client HTTP de l'API EcoleDirecte.
//
// fetchImpl et readGtkCookie sont injectes : en production ce sont
// session.defaultSession.fetch et la lecture du cookie GTK dans le jar de
// la session, ce qui fait atterrir les cookies directement dans la fenetre.
// En test ce sont des bouchons, ce qui rend ce module testable sans reseau.

const BASE_URL = "https://api.ecoledirecte.com";
// Valeur de packageVersion du SPA courant.
const DEFAULT_API_VERSION = "4.101.2";

// Code renvoye par /v3/login.awp quand la double authentification est requise.
const CODE_2FA_REQUIRED = 250;
// doubleauth n'accepte que cet entete : X-Token y est rejete (code 520).
const HEADER_2FA_TOKEN = "2FA-Token";

const decodeB64 = (v) => Buffer.from(String(v || ""), "base64").toString("utf8");
const encodeB64 = (v) => Buffer.from(String(v || ""), "utf8").toString("base64");

function createEdApi({ fetchImpl, readGtkCookie, apiVersion = DEFAULT_API_VERSION, userAgent }) {
  function encodeBody(payload) {
    return new URLSearchParams({ data: JSON.stringify(payload) }).toString();
  }

  async function post(path, payload, extraHeaders = {}) {
    const url = `${BASE_URL}${path}${path.includes("?") ? "&" : "?"}v=${apiVersion}`;
    const res = await fetchImpl(url, {
      method: "POST",
      credentials: "include",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "User-Agent": userAgent,
        ...extraHeaders,
      },
      body: encodeBody(payload),
    });
    return { json: await res.json(), headers: res.headers };
  }

  // Verifie sur l'API reelle : sur un code 250, le jeton exploitable par
  // doubleauth est celui du CORPS de reponse. La reponse porte aussi un
  // entete x-token, mais il contient un autre jeton, que doubleauth rejette
  // avec un code 520.
  function normalize(json, headers) {
    const code = json.code;
    return {
      code,
      token: json.token || "",
      message: json.message || "",
      data: json.data || {},
      twoFaToken: code === CODE_2FA_REQUIRED
        ? json.token || headers.get("2fa-token") || ""
        : "",
    };
  }

  async function login({ identifiant, motdepasse, uuid, fa }) {
    // Le GTK est obligatoire depuis le 24/03/2025 : sans lui l'API repond
    // "identifiant et/ou mot de passe invalide" meme avec des identifiants
    // corrects.
    await fetchImpl(`${BASE_URL}/v3/login.awp?gtk=1&v=${apiVersion}`, {
      method: "GET",
      credentials: "include",
      headers: { "User-Agent": userAgent },
    });
    const gtk = await readGtkCookie();

    const payload = { identifiant, motdepasse, isReLogin: false, uuid: uuid || "" };
    if (Array.isArray(fa) && fa.length > 0) payload.fa = fa;

    const { json, headers } = await post("/v3/login.awp", payload, gtk ? { "X-Gtk": gtk } : {});
    return normalize(json, headers);
  }

  async function relogin({ identifiant, uuid, typeCompte, accesstoken, fa }) {
    const payload = {
      identifiant,
      uuid: uuid || "",
      isReLogin: true,
      motdepasse: "",
      typeCompte,
      accesstoken,
    };
    if (Array.isArray(fa) && fa.length > 0) payload.fa = fa;

    const { json, headers } = await post("/v3/login.awp", payload);
    return normalize(json, headers);
  }

  async function get2faQuestion(twoFaToken) {
    const { json } = await post(
      "/v3/connexion/doubleauth.awp?verbe=get",
      {},
      { [HEADER_2FA_TOKEN]: twoFaToken }
    );
    const data = json.data || {};
    return {
      code: json.code,
      question: decodeB64(data.question),
      propositions: (data.propositions || []).map(decodeB64),
    };
  }

  async function send2faAnswer(choix, twoFaToken) {
    const { json } = await post(
      "/v3/connexion/doubleauth.awp?verbe=post",
      { choix: encodeB64(choix) },
      { [HEADER_2FA_TOKEN]: twoFaToken }
    );
    const data = json.data || {};
    return { cn: data.cn, cv: data.cv };
  }

  // Compteur de non-lus de la messagerie, avec le jeton d'une session deja
  // ouverte : ni login ni mot de passe. Verifie (scripts/diag-page-token.js) :
  // le jeton n'est pas renouvele par l'appel, et rien n'est marque lu.
  // null si la reponse n'est pas exploitable (jeton expire, typiquement).
  async function unreadMessagesCount({ token, eleveId }) {
    const { json } = await post(
      `/v3/eleves/${encodeURIComponent(eleveId)}/messages.awp?force=false&typeRecuperation=received` +
        "&idClasseur=0&orderBy=date&order=desc&query=&onlyRead=&page=0&itemsPerPage=1&getAll=0&verbe=get",
      { anneeMessages: "" },
      { "X-Token": token }
    );
    const count = json.code === 200 && json.data && json.data.pagination
      ? json.data.pagination.messagesRecusNotReadCount
      : null;
    return Number.isInteger(count) && count >= 0 ? count : null;
  }

  return { login, relogin, get2faQuestion, send2faAnswer, unreadMessagesCount };
}

module.exports = { createEdApi, BASE_URL, DEFAULT_API_VERSION, CODE_2FA_REQUIRED };
