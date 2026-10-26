// Formes reverse-engineerees du SPA EcoleDirecte.
//
//   AuthStore        -> sessionStorage["accounts"]
//   CredentialsStore -> sessionStorage["credentials"]
//
// Les deux sont serialises par WebStorageService avec l'enveloppe
// { payload, lastModified }. L'intercepteur HTTP du SPA lit le token dans
// credentialsStore.snapshot.authToken et le pose en en-tete X-Token.
//
// Ne jamais ecrire "edcommonhydration_auth" : malgre son nom et son
// enveloppe { payload }, c'est un feature-state NgRx de selection d'annee
// et de variante, pas de l'authentification.

function buildSessionState(loginResponse, now) {
  const data = loginResponse.data || {};
  return {
    authToken: loginResponse.token || "",
    accounts: Array.isArray(data.accounts) ? data.accounts : [],
    changementMDP: data.changementMDP !== undefined ? data.changementMDP : false,
    nbJourMdpExire: data.nbJourMdpExire !== undefined ? data.nbJourMdpExire : 0,
    isBloque: data.isBloque !== undefined ? data.isBloque : false,
    urlUnblock: data.urlUnblock !== undefined ? data.urlUnblock : "",
    lastModified: now,
  };
}

function toSessionStorageEntries(state) {
  return {
    credentials: JSON.stringify({
      payload: { authToken: state.authToken, fcmToken: "", twoFAToken: "" },
      lastModified: state.lastModified,
    }),
    accounts: JSON.stringify({
      payload: {
        accounts: state.accounts,
        changementMDP: state.changementMDP,
        nbJourMdpExire: state.nbJourMdpExire,
        isBloque: state.isBloque,
        urlUnblock: state.urlUnblock,
      },
      lastModified: state.lastModified,
    }),
  };
}

function toLocalStorageEntries(faKeys) {
  if (!Array.isArray(faKeys) || faKeys.length === 0) return {};
  return { fa: JSON.stringify(faKeys) };
}

// La reponse de login porte deja le compteur affiche par le menu lateral,
// dans accounts[].modules[] sous le code MESSAGERIE.
function messagerieBadgeCount(state) {
  const accounts = state.accounts || [];
  const account = accounts.find((a) => a.current) || accounts[0];
  if (!account || !Array.isArray(account.modules)) return 0;
  const mod = account.modules.find((m) => m.code === "MESSAGERIE");
  return mod && typeof mod.badge === "number" ? mod.badge : 0;
}

// Modules dont le compteur nous interesse, avec leur libelle au singulier
// et au pluriel. La messagerie n'y est pas : elle a son propre traitement
// et sa propre destination, le badge de la barre des taches.
const WATCHED_MODULES = [
  { code: "NOTES", one: "nouvelle note", many: "nouvelles notes" },
  { code: "VIE_SCOLAIRE", one: "élément de vie scolaire", many: "éléments de vie scolaire" },
  { code: "CAHIER_DE_TEXTE", one: "devoir", many: "devoirs" },
];

/**
 * Compteurs des modules autres que la messagerie.
 *
 * Ils sont deja dans la reponse de login qu'on recupere pour le badge :
 * les lire ne coute AUCUNE requete supplementaire, ce qui compte ici parce
 * que la cadence de sondage a ete choisie pour rester discrete cote
 * serveur. Jusqu'ici cette partie de la reponse etait simplement jetee.
 */
function moduleBadges(state) {
  const accounts = (state && state.accounts) || [];
  const account = accounts.find((a) => a.current) || accounts[0];
  if (!account || !Array.isArray(account.modules)) return [];

  return WATCHED_MODULES.map(({ code, one, many }) => {
    const mod = account.modules.find((m) => m.code === code);
    const count = mod && typeof mod.badge === "number" ? mod.badge : 0;
    return { code, count, label: count > 1 ? many : one };
  }).filter((entry) => entry.count > 0);
}

/**
 * Resume affichable, ou "" s'il n'y a rien a dire.
 *
 * Rendu volontairement fade : c'est une information d'appoint, elle ne doit
 * pas concurrencer le contenu du site.
 */
function describeModuleBadges(badges) {
  if (!Array.isArray(badges) || badges.length === 0) return "";
  return badges.map((b) => `${b.count} ${b.label}`).join(" · ");
}

const MESSAGERIE_LABEL = { code: "MESSAGERIE", one: "nouveau message", many: "nouveaux messages" };

/**
 * Compteurs bruts par module, messagerie comprise : la base de comparaison
 * des notifications d'un rafraichissement a l'autre.
 */
function badgeCounts(state) {
  const accounts = (state && state.accounts) || [];
  const account = accounts.find((a) => a.current) || accounts[0];
  const out = {};
  if (!account || !Array.isArray(account.modules)) return out;

  for (const { code } of [MESSAGERIE_LABEL, ...WATCHED_MODULES]) {
    const mod = account.modules.find((m) => m.code === code);
    out[code] = mod && typeof mod.badge === "number" ? mod.badge : 0;
  }
  return out;
}

/**
 * Ce qui est arrive entre deux releves, ou "" s'il n'y a rien de neuf. Une
 * baisse (elements lus entre-temps) ne compte pas.
 */
function describeArrivals(prev, next) {
  return [MESSAGERIE_LABEL, ...WATCHED_MODULES]
    .map(({ code, one, many }) => {
      const delta = ((next && next[code]) || 0) - ((prev && prev[code]) || 0);
      return delta > 0 ? `${delta} ${delta > 1 ? many : one}` : null;
    })
    .filter(Boolean)
    .join(" · ");
}

/**
 * Meme compteur, mais lu dans le sessionStorage de la page plutot que dans
 * une reponse de login : c'est la source gratuite, sans requete.
 *
 * `raw` est la valeur brute de sessionStorage["accounts"], enveloppe
 * { payload, lastModified } comprise. Renvoie null — et non zero — des que
 * la valeur est absente ou illisible : un echec de lecture ne doit jamais
 * effacer un compteur juste.
 */
function messagerieBadgeFromStoredAccounts(raw) {
  if (typeof raw !== "string" || raw === "") return null;

  try {
    const parsed = JSON.parse(raw);
    const accounts = parsed && parsed.payload ? parsed.payload.accounts : null;
    if (!Array.isArray(accounts) || accounts.length === 0) return null;
    return messagerieBadgeCount({ accounts });
  } catch {
    return null;
  }
}

module.exports = {
  buildSessionState,
  messagerieBadgeFromStoredAccounts,
  toSessionStorageEntries,
  toLocalStorageEntries,
  messagerieBadgeCount,
  moduleBadges,
  describeModuleBadges,
  badgeCounts,
  describeArrivals,
  WATCHED_MODULES,
};
