const test = require("node:test");
const assert = require("node:assert/strict");
const {
  buildSessionState,
  toSessionStorageEntries,
  toLocalStorageEntries,
  messagerieBadgeCount,
} = require("../src/main/auth/session-payload");

const LOGIN_RESPONSE = {
  code: 200,
  token: "TOKEN123",
  message: "",
  data: {
    accounts: [
      {
        idLogin: 1324, id: 1234, identifiant: "jdoe", typeCompte: "E",
        main: true, prenom: "John", nom: "DOE",
        modules: [
          { code: "MESSAGERIE", badge: 3 },
          { code: "NOTES", badge: 0 },
        ],
      },
    ],
  },
};

test("buildSessionState extrait le token et les comptes", () => {
  const state = buildSessionState(LOGIN_RESPONSE, 1000);
  assert.equal(state.authToken, "TOKEN123");
  assert.equal(state.accounts.length, 1);
  assert.equal(state.accounts[0].identifiant, "jdoe");
  assert.equal(state.lastModified, 1000);
});

test("buildSessionState applique les valeurs par defaut du SPA", () => {
  const state = buildSessionState(LOGIN_RESPONSE, 1000);
  assert.equal(state.changementMDP, false);
  assert.equal(state.nbJourMdpExire, 0);
  assert.equal(state.isBloque, false);
  assert.equal(state.urlUnblock, "");
});

test("toSessionStorageEntries produit l'enveloppe payload/lastModified", () => {
  const entries = toSessionStorageEntries(buildSessionState(LOGIN_RESPONSE, 1000));
  const credentials = JSON.parse(entries.credentials);
  assert.deepEqual(credentials, {
    payload: { authToken: "TOKEN123", fcmToken: "", twoFAToken: "" },
    lastModified: 1000,
  });
  const accounts = JSON.parse(entries.accounts);
  assert.equal(accounts.lastModified, 1000);
  assert.equal(accounts.payload.accounts[0].id, 1234);
  assert.equal(accounts.payload.changementMDP, false);
});

test("toSessionStorageEntries n'ecrit jamais edcommonhydration_auth", () => {
  const entries = toSessionStorageEntries(buildSessionState(LOGIN_RESPONSE, 1000));
  assert.deepEqual(Object.keys(entries).sort(), ["accounts", "credentials"]);
});

test("toLocalStorageEntries serialise les cles 2FA", () => {
  const entries = toLocalStorageEntries([{ cn: "a", cv: "b", uniq: false }]);
  assert.deepEqual(JSON.parse(entries.fa), [{ cn: "a", cv: "b", uniq: false }]);
});

test("toLocalStorageEntries renvoie un objet vide sans cles", () => {
  assert.deepEqual(toLocalStorageEntries([]), {});
});

test("messagerieBadgeCount lit le module MESSAGERIE", () => {
  assert.equal(messagerieBadgeCount(buildSessionState(LOGIN_RESPONSE, 1000)), 3);
});

test("messagerieBadgeCount vaut 0 sans module MESSAGERIE", () => {
  const state = buildSessionState({ token: "T", data: { accounts: [{ modules: [] }] } }, 1);
  assert.equal(messagerieBadgeCount(state), 0);
});

test("messagerieBadgeCount vaut 0 sans aucun compte", () => {
  const state = buildSessionState({ token: "T", data: { accounts: [] } }, 1);
  assert.equal(messagerieBadgeCount(state), 0);
});

// ---- Lecture du compteur dans le store de la page --------------------

const { messagerieBadgeFromStoredAccounts } = require("../src/main/auth/session-payload");

// Enveloppe telle que WebStorageService l'ecrit.
function stored(modules) {
  return JSON.stringify({
    payload: { accounts: [{ id: 5618, typeCompte: "E", current: true, modules }] },
    lastModified: 1756900000000,
  });
}

test("lit le compteur dans l'enveloppe du sessionStorage", () => {
  assert.equal(
    messagerieBadgeFromStoredAccounts(stored([{ code: "MESSAGERIE", badge: 1 }])),
    1
  );
});

test("renvoie 0 quand la messagerie est a zero", () => {
  assert.equal(
    messagerieBadgeFromStoredAccounts(stored([{ code: "MESSAGERIE", badge: 0 }])),
    0
  );
});

test("renvoie 0 sans module messagerie, le compte existant", () => {
  assert.equal(messagerieBadgeFromStoredAccounts(stored([{ code: "NOTES", badge: 3 }])), 0);
});

// null et non 0 : un echec de lecture ne doit jamais effacer le badge.
test("renvoie null sur une valeur absente", () => {
  assert.equal(messagerieBadgeFromStoredAccounts(null), null);
  assert.equal(messagerieBadgeFromStoredAccounts(undefined), null);
  assert.equal(messagerieBadgeFromStoredAccounts(""), null);
});

test("renvoie null sur du JSON invalide", () => {
  assert.equal(messagerieBadgeFromStoredAccounts("pas du json"), null);
});

test("renvoie null sans enveloppe payload", () => {
  assert.equal(messagerieBadgeFromStoredAccounts(JSON.stringify({ accounts: [] })), null);
});

test("renvoie null sur une liste de comptes vide", () => {
  assert.equal(
    messagerieBadgeFromStoredAccounts(JSON.stringify({ payload: { accounts: [] } })),
    null
  );
});

// ---- Badges des autres modules --------------------------------------
//
// Ils arrivent dans la MEME reponse de login que le compteur de la
// messagerie : les exploiter ne coute aucune requete de plus, ce qui
// importe puisque la cadence de sondage a ete reglee pour rester discrete
// cote serveur.

const { moduleBadges, describeModuleBadges } = require("../src/main/auth/session-payload");

const withModules = (modules) => ({ accounts: [{ current: true, modules }] });

test("seuls les modules a compteur non nul sont retenus", () => {
  const badges = moduleBadges(withModules([
    { code: "NOTES", badge: 3 },
    { code: "VIE_SCOLAIRE", badge: 0 },
    { code: "CAHIER_DE_TEXTE", badge: 1 },
  ]));
  assert.deepEqual(badges.map((b) => b.code), ["NOTES", "CAHIER_DE_TEXTE"]);
});

test("la messagerie est exclue : elle a sa propre destination", () => {
  const badges = moduleBadges(withModules([{ code: "MESSAGERIE", badge: 4 }]));
  assert.deepEqual(badges, []);
});

test("le libelle s'accorde en nombre", () => {
  assert.equal(moduleBadges(withModules([{ code: "NOTES", badge: 1 }]))[0].label, "nouvelle note");
  assert.equal(moduleBadges(withModules([{ code: "NOTES", badge: 2 }]))[0].label, "nouvelles notes");
});

test("le compte courant prime sur le premier de la liste", () => {
  const state = { accounts: [
    { current: false, modules: [{ code: "NOTES", badge: 9 }] },
    { current: true, modules: [{ code: "NOTES", badge: 2 }] },
  ] };
  assert.equal(moduleBadges(state)[0].count, 2);
});

test("une reponse sans modules ne fait pas tomber la lecture", () => {
  assert.deepEqual(moduleBadges({}), []);
  assert.deepEqual(moduleBadges({ accounts: [] }), []);
  assert.deepEqual(moduleBadges({ accounts: [{ current: true }] }), []);
  assert.deepEqual(moduleBadges(null), []);
});

test("un badge non numerique est ignore, pas devine", () => {
  assert.deepEqual(moduleBadges(withModules([{ code: "NOTES", badge: "3" }])), []);
});

test("rien a signaler donne une chaine vide, pas un resume vide", () => {
  assert.equal(describeModuleBadges([]), "");
  assert.equal(describeModuleBadges(null), "");
});

test("le resume enumere les modules", () => {
  const badges = moduleBadges(withModules([
    { code: "NOTES", badge: 3 },
    { code: "CAHIER_DE_TEXTE", badge: 1 },
  ]));
  assert.equal(describeModuleBadges(badges), "3 nouvelles notes · 1 devoir");
});
