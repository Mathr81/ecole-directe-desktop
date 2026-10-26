// Politique d'ouverture de fenetre, appliquee a TOUS les webContents.
//
// Elle vivait en ligne dans main-window.js, et n'etait donc posee que sur la
// fenetre principale. Or setWindowOpenHandler est attache a un webContents,
// pas a l'application : tout autre contexte retombait sur le comportement
// par defaut d'Electron, c'est-a-dire une fenetre nue.
//
// Deux consequences constatees le 12/09/2026 :
//
//   - un lien clique DANS la <webview> d'un popup (qui porte allowpopups,
//     mais aucune politique) ouvrait une fenetre sans habillage, sans les
//     boutons Copier / Navigateur ;
//   - le blob: d'une piece jointe EcoleDirecte, autorise par la politique,
//     ouvrait une fenetre qu'Electron ne sait pas peindre — le PDF etait
//     converti en telechargement et la fenetre restait blanche a l'ecran.

// Fenetres creees par Electron lui-meme, sur un verdict « allow ». On les
// suit pour pouvoir refermer celles qui ne servent finalement a rien, comme
// celle d'un blob: qui se transforme en telechargement. Un WeakSet n'empeche
// pas leur ramassage.
const autoCreated = new WeakSet();

/**
 * Verdict pour une URL, sans Electron : donc testable.
 *
 * "allow"  : Electron ouvre la fenetre lui-meme (schemas internes, et les
 *            blob:/data: dont la page a besoin pour ses telechargements) ;
 * "popup"  : notre fenetre habillee, avec barre d'adresse et actions ;
 * "deny"   : rien du tout.
 */
function decideWindowOpen(url) {
  if (typeof url !== "string" || url === "") return "deny";

  // Schemas internes au navigateur : a lui de les traiter.
  if (url.startsWith("about:") || url.startsWith("devtools:")) return "allow";

  // blob: et data: sont des fichiers fabriques par la page, et une fenetre
  // ouverte dessus est TOUJOURS morte. Mesure du 12/09/2026 sur un PDF : le
  // document obtenu est un squelette vide de 159 octets, sans titre ni
  // corps — Electron n'y peint pas le PDF, et ne le telecharge pas non plus.
  // C'est la fenetre blanche que voyait l'utilisateur.
  //
  // On la refuse donc. Et on ne telecharge PAS le blob a la place, meme si
  // contents.downloadURL saurait le faire : le fichier arrive deja par le
  // chemin <a download> de la page, avec son vrai nom (« _1518066406.pdf »
  // dans les journaux), alors que downloadURL sur un blob ne dispose que de
  // son UUID et produirait donc un doublon mal nomme.
  //
  // Refuser ne peut rien perdre : cette fenetre ne rendait aucun fichier.
  if (url.startsWith("blob:") || url.startsWith("data:")) return "deny";

  // Hote exact : un `includes` laissait passer « https://evil.com/?api.ecoledirecte.com ».
  if (hostnameOf(url) === "api.ecoledirecte.com") return "allow";

  return "popup";
}

function hostnameOf(url) {
  try { return new URL(url).hostname; } catch { return ""; }
}

/**
 * Seuls http: et https: partent vers le navigateur du systeme. Les autres
 * schemas (file:, ms-msdt:, search-ms:...) sont une voie connue d'execution
 * de code sous Windows, et une page tierce peut s'y rediriger.
 */
function isSafeExternalUrl(url) {
  try {
    const { protocol } = new URL(url);
    return protocol === "http:" || protocol === "https:";
  } catch {
    return false;
  }
}

/**
 * Pose la politique sur un webContents, et sur les fenetres qu'il ouvrira.
 *
 * `openPopup` est injecte pour eviter un cycle d'imports : c'est
 * popup-window.js qui sait fabriquer un popup, et il applique lui aussi
 * cette politique a ses invites.
 */
function applyWindowPolicy(contents, { openPopup }) {
  if (!contents || contents.isDestroyed()) return;

  contents.setWindowOpenHandler(({ url }) => {
    const decision = decideWindowOpen(url);
    console.log(`Ouverture de fenêtre : ${decision} — ${String(url).slice(0, 110)}`);

    if (decision === "popup") {
      openPopup(url);
      return { action: "deny" };
    }
    return { action: decision === "allow" ? "allow" : "deny" };
  });

  // Les fenetres qu'Electron cree sur un « allow » heritent de la politique,
  // sinon un lien clique depuis l'une d'elles rouvrirait une fenetre nue.
  contents.on("did-create-window", (win) => {
    autoCreated.add(win);
    applyWindowPolicy(win.webContents, { openPopup });
  });
}

/** Cette fenetre a-t-elle ete creee par Electron, et non par nos soins ? */
function isAutoCreated(win) {
  return Boolean(win) && autoCreated.has(win);
}

module.exports = { decideWindowOpen, applyWindowPolicy, isAutoCreated, isSafeExternalUrl };
