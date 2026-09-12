const test = require("node:test");
const assert = require("node:assert/strict");
const {
  uniqueName, formatBytes, describeDownload, shouldCloseInitiator,
} = require("../src/main/features/downloads");
const { anchorPosition } = require("../src/main/windows/downloads-window");

// ---- Ne jamais ecraser -----------------------------------------------
//
// Deux bulletins du meme trimestre arrivent souvent sous le meme nom.
// Ecraser le premier sans prevenir serait une perte de donnees silencieuse.

const taken = (...names) => (candidate) => names.includes(candidate);

test("un nom libre est garde tel quel", () => {
  assert.equal(uniqueName("bulletin.pdf", taken()), "bulletin.pdf");
});

test("un nom pris est numerote", () => {
  assert.equal(uniqueName("bulletin.pdf", taken("bulletin.pdf")), "bulletin (1).pdf");
});

test("la numerotation continue tant que c'est pris", () => {
  assert.equal(
    uniqueName("bulletin.pdf", taken("bulletin.pdf", "bulletin (1).pdf", "bulletin (2).pdf")),
    "bulletin (3).pdf"
  );
});

test("un fichier sans extension est gere", () => {
  assert.equal(uniqueName("NOTES", taken("NOTES")), "NOTES (1)");
});

test("les points dans le nom ne sont pas pris pour l'extension", () => {
  assert.equal(
    uniqueName("cours.2026.01.pdf", taken("cours.2026.01.pdf")),
    "cours.2026.01 (1).pdf"
  );
});

// ---- Tailles ----------------------------------------------------------

test("les tailles sont lisibles, avec la virgule francaise", () => {
  assert.equal(formatBytes(512), "512 o");
  assert.equal(formatBytes(2048), "2 Ko");
  assert.equal(formatBytes(5 * 1024 * 1024), "5,0 Mo");
});

test("une taille inconnue ne produit pas NaN", () => {
  assert.equal(formatBytes(undefined), "");
  assert.equal(formatBytes(-1), "");
});

// ---- Fermeture du popup reste blanc ----------------------------------
//
// Le cas rapporte : EcoleDirecte ouvre une piece jointe en target="_blank",
// un popup s'ouvre, le serveur repond « Content-Disposition: attachment »,
// la navigation devient un telechargement et la webview ne charge jamais
// rien. Le popup restait affiche, vide.

test("une webview qui n'a rien charge est un popup a refermer", () => {
  assert.equal(shouldCloseInitiator({ type: "webview", url: "" }), true);
  assert.equal(shouldCloseInitiator({ type: "webview", url: "about:blank" }), true);
});

test("une webview qui consulte une page n'est pas fermee", () => {
  assert.equal(
    shouldCloseInitiator({ type: "webview", url: "https://www.ecoledirecte.com/Eleves/1" }),
    false
  );
});

test("une fenetre ordinaire vierge n'est pas fermee sans plus d'indices", () => {
  // C'est la fenetre principale, ou une fenetre que nous avons fabriquee :
  // on n'y touche pas sur le seul fait qu'elle soit vierge.
  assert.equal(shouldCloseInitiator({ type: "window", url: "" }), false);
});

test("un initiateur absent ou inconnu ne declenche rien", () => {
  assert.equal(shouldCloseInitiator(null), false);
  assert.equal(shouldCloseInitiator({}), false);
});

// ---- Le cas reel d'EcoleDirecte : une piece jointe en blob: -----------
//
// La piece jointe passe par POST telechargement.awp puis une URL blob:.
// Celle-ci est autorisee (la refuser casserait le telechargement), Electron
// ouvre donc une fenetre, n'arrive pas a peindre le PDF, convertit en
// telechargement — et laisse la fenetre blanche a l'ecran.

test("la fenetre ouverte par Electron sur un blob: est refermee", () => {
  assert.equal(
    shouldCloseInitiator(
      { type: "window", url: "blob:https://www.ecoledirecte.com/954f4333-0461" },
      { autoCreated: true }
    ),
    true
  );
});

test("idem pour un data: et pour une fenetre restee vierge", () => {
  assert.equal(shouldCloseInitiator({ type: "window", url: "data:application/pdf;base64,AA" }, { autoCreated: true }), true);
  assert.equal(shouldCloseInitiator({ type: "window", url: "" }, { autoCreated: true }), true);
  assert.equal(shouldCloseInitiator({ type: "window", url: "about:blank" }, { autoCreated: true }), true);
});

test("une fenetre qui affiche une vraie page reste ouverte", () => {
  // Meme creee par Electron : l'utilisateur est peut-etre en train de la
  // lire, et un telechargement peut tres bien en partir.
  assert.equal(
    shouldCloseInitiator(
      { type: "window", url: "https://api.ecoledirecte.com/v3/quelquechose" },
      { autoCreated: true }
    ),
    false
  );
});

// ---- Vue du panneau ---------------------------------------------------

const entry = (over = {}) => ({
  id: 1, name: "bulletin.pdf", state: "progressing", received: 0, total: 0, ...over,
});

test("un telechargement en cours peut etre annule, pas ouvert", () => {
  const view = describeDownload(entry({ received: 50, total: 100 }));
  assert.equal(view.canCancel, true);
  assert.equal(view.canOpen, false);
  assert.equal(view.percent, 50);
});

test("un telechargement termine peut etre ouvert, pas annule", () => {
  const view = describeDownload(entry({ state: "completed", received: 100, total: 100 }));
  assert.equal(view.canCancel, false);
  assert.equal(view.canOpen, true);
});

test("sans taille annoncee, le pourcentage est null et non zero", () => {
  // Le panneau doit pouvoir distinguer « 0 % » de « taille inconnue » pour
  // basculer sa barre en indetermine.
  const view = describeDownload(entry({ received: 2048, total: 0 }));
  assert.equal(view.percent, null);
  assert.equal(view.detail, "2 Ko");
});

test("le detail compare recu et total quand la taille est connue", () => {
  const view = describeDownload(entry({ received: 1024 * 1024, total: 3 * 1024 * 1024 }));
  assert.equal(view.detail, "1,0 Mo sur 3,0 Mo");
});

test("un pourcentage reste borne si le serveur ment sur la taille", () => {
  assert.equal(describeDownload(entry({ received: 300, total: 100 })).percent, 100);
});

test("une annulation et une interruption se lisent dans le detail", () => {
  assert.equal(describeDownload(entry({ state: "cancelled" })).detail, "Annulé");
  assert.equal(describeDownload(entry({ state: "interrupted" })).detail, "Interrompu");
});

test("un echec ne propose ni annulation ni ouverture", () => {
  const view = describeDownload(entry({ state: "interrupted", received: 10 }));
  assert.equal(view.canCancel, false);
  assert.equal(view.canOpen, false);
});

// ---- Ancrage du panneau ----------------------------------------------

test("le panneau se cale en bas a droite du parent", () => {
  const pos = anchorPosition({ x: 100, y: 50, width: 1000, height: 800 }, { width: 340, height: 120 }, 16);
  assert.deepEqual(pos, { x: 100 + 1000 - 340 - 16, y: 50 + 800 - 120 - 16 });
});

test("un parent sur un ecran a gauche donne des coordonnees negatives valides", () => {
  const pos = anchorPosition({ x: -1920, y: 0, width: 1920, height: 1040 }, { width: 340, height: 120 }, 16);
  assert.equal(pos.x, -1920 + 1920 - 340 - 16);
});

test("les positions sont arrondies a l'entier", () => {
  const pos = anchorPosition({ x: 0.4, y: 0.6, width: 1000, height: 800 }, { width: 340, height: 120 }, 16);
  assert.ok(Number.isInteger(pos.x) && Number.isInteger(pos.y));
});

// ---- Politique d'ouverture de fenetre --------------------------------
//
// Elle etait ecrite en ligne dans main-window.js, donc posee sur la seule
// fenetre principale. Tout autre contexte — la <webview> d'un popup, par
// exemple — retombait sur le defaut d'Electron : une fenetre nue.

const { decideWindowOpen } = require("../src/main/windows/window-policy");

test("un lien externe ouvre notre popup habille", () => {
  assert.equal(decideWindowOpen("https://example.com/page"), "popup");
});

test("les schemas internes sont laisses a Electron", () => {
  assert.equal(decideWindowOpen("about:blank"), "allow");
  assert.equal(decideWindowOpen("devtools://devtools/bundled/x.html"), "allow");
});

test("blob: et data: n'ouvrent plus de fenetre : elle est toujours morte", () => {
  // Mesure du 12/09/2026 : le document d'une fenetre ouverte sur un blob de
  // PDF est un squelette vide de 159 octets. Aucun fichier n'en sort, donc
  // refuser ne perd rien — et evite la fenetre blanche.
  assert.equal(decideWindowOpen("blob:https://www.ecoledirecte.com/954f4333"), "deny");
  assert.equal(decideWindowOpen("data:application/pdf;base64,AAAA"), "deny");
});

test("l'API EcoleDirecte est autorisee", () => {
  assert.equal(decideWindowOpen("https://api.ecoledirecte.com/v3/telechargement.awp"), "allow");
});

test("une URL absente ou vide n'ouvre rien", () => {
  assert.equal(decideWindowOpen(""), "deny");
  assert.equal(decideWindowOpen(null), "deny");
  assert.equal(decideWindowOpen(undefined), "deny");
});
