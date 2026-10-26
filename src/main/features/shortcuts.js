// Raccourcis clavier de l'application.
//
// Historiquement cables sur globalShortcut, ce qui ne marchait qu'a moitie :
// sous Windows, register() refuse F5, F12 et CommandOrControl+R — il renvoie
// false, sans erreur — la ou il accepte Alt+Left et Alt+Right. Seule la
// navigation fonctionnait donc.
//
// globalShortcut etait de toute facon le mauvais outil : il enregistre des
// hotkeys au niveau du systeme, donc confisques a toutes les autres
// applications, y compris quand la fenetre n'a pas le focus. Ce sont des
// raccourcis d'application. before-input-event est attache a un webContents
// et ne se declenche que sur une frappe qui lui est destinee.

const { app } = require("electron");

// Paliers de zoom de Chrome. On travaille par paliers plutot qu'en
// multipliant un facteur : c'est ce que fait le navigateur, et ça evite de
// deriver vers des valeurs comme 1.0000000002 au fil des appuis.
const ZOOM_LADDER = [0.5, 0.67, 0.75, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5];

/**
 * Palier suivant dans la direction demandee, en se recalant sur le plus
 * proche quand le facteur courant n'est pas exactement sur un palier (le
 * site peut l'avoir change lui-meme).
 */
function nextZoom(current, direction, ladder = ZOOM_LADDER) {
  const nearest = ladder.reduce((best, v) =>
    Math.abs(v - current) < Math.abs(best - current) ? v : best, ladder[0]);
  const index = ladder.indexOf(nearest);
  const moved = index + (direction > 0 ? 1 : direction < 0 ? -1 : 0);
  return ladder[Math.max(0, Math.min(ladder.length - 1, moved))];
}

/**
 * Traduit une frappe en action, ou null. Partie decidable sans Electron,
 * donc testable — y compris pour les conventions macOS qu'on ne peut pas
 * essayer ici.
 *
 * `input` est l'objet fourni par before-input-event.
 */
function resolveShortcut(input, platform) {
  if (!input || input.type !== "keyDown") return null;

  const isMac = platform === "darwin";
  // La touche « commande » du systeme : Cmd sur macOS, Ctrl ailleurs.
  const cmd = isMac ? input.meta : input.control;
  // Un raccourci a Ctrl sur macOS, ou a Cmd ailleurs, n'est pas le notre.
  const wrongCmd = isMac ? input.control : input.meta;
  if (wrongCmd) return null;

  switch (input.key) {
    case "F5":
      return cmd || input.shift ? "reload-hard" : "reload";
    case "F12":
      return "devtools";
    case "r":
    case "R":
      if (!cmd) return null;
      return input.shift ? "reload-hard" : "reload";
    case "I":
    case "i":
      // Cmd+Alt+I sur macOS, la convention y remplace F12.
      return isMac && cmd && input.alt ? "devtools" : null;
    case "ArrowLeft":
      // Alt+Fleche partout, et Cmd+Fleche en plus sur macOS.
      return input.alt || (isMac && cmd) ? "back" : null;
    case "ArrowRight":
      return input.alt || (isMac && cmd) ? "forward" : null;
    case "k":
    case "K":
      return cmd ? "palette" : null;
    case "q":
    case "Q":
      // Quitter pour de bon, meme quand fermer la fenetre ne fait que la
      // cacher dans la zone de notification.
      return cmd ? "quit" : null;
    default:
      break;
  }

  // Le zoom se resout sur `code`, la touche PHYSIQUE, et non sur `key`.
  // Sur un clavier AZERTY les chiffres exigent Shift : Ctrl+0 y produit
  // key "à", et un aiguillage sur key ne verrait jamais passer le
  // raccourci. `code` vaut "Digit0" quelle que soit la disposition.
  if (!cmd) return null;
  switch (input.code) {
    case "Equal":
    case "NumpadAdd":
      return "zoom-in";
    case "Minus":
    case "NumpadSubtract":
      return "zoom-out";
    case "Digit0":
    case "Numpad0":
      return "zoom-reset";
    default:
      return null;
  }
}

// Applique l'action sur le webContents qui porte reellement le contenu.
// Dans la fenetre popup c'est le guest <webview>, pas le document d'habillage :
// recharger celui-ci reviendrait a vider la fenetre.
function runShortcut(action, contents) {
  if (!contents || contents.isDestroyed()) return;

  switch (action) {
    case "reload":
      contents.reload();
      return;
    case "reload-hard":
      contents.reloadIgnoringCache();
      return;
    case "devtools":
      contents.isDevToolsOpened()
        ? contents.closeDevTools()
        : contents.openDevTools({ mode: "detach" });
      return;
    case "back":
      contents.navigationHistory.goBack();
      return;
    case "forward":
      contents.navigationHistory.goForward();
      return;
    case "zoom-in":
      contents.setZoomFactor(nextZoom(contents.getZoomFactor(), 1));
      return;
    case "zoom-out":
      contents.setZoomFactor(nextZoom(contents.getZoomFactor(), -1));
      return;
    case "zoom-reset":
      contents.setZoomFactor(1);
      return;
    case "quit":
      app.quit();
      return;
  }
}

/**
 * Ecoute les frappes d'un webContents et agit sur celui que `target` designe.
 * Par defaut on agit sur celui qui a recu la frappe.
 */
function attachShortcuts(contents, target = () => contents, onAction = null) {
  contents.on("before-input-event", (event, input) => {
    const action = resolveShortcut(input, process.platform);
    if (!action) return;
    event.preventDefault();
    // Les actions qui depassent le webContents (ouvrir la palette, par
    // exemple) sont rendues a l'appelant, qui seul a le contexte pour les
    // traiter. Il signale par `true` qu'il s'en est charge.
    if (onAction && onAction(action, target()) === true) return;
    runShortcut(action, target());
  });
}

/**
 * Cable les raccourcis d'une fenetre, guests <webview> compris.
 *
 * Les frappes faites dans un <webview> ne remontent pas au webContents de la
 * fenetre : sans cet attachement, les raccourcis cessaient de repondre des
 * qu'on cliquait dans la page de la fenetre popup.
 */
function registerWindowShortcuts(win, { onAction = null } = {}) {
  let guest = null;

  win.webContents.on("did-attach-webview", (event, webViewContents) => {
    guest = webViewContents;
    attachShortcuts(webViewContents, () => webViewContents, onAction);
    webViewContents.on("destroyed", () => {
      if (guest === webViewContents) guest = null;
    });
  });

  // Depuis l'habillage de la fenetre, on agit sur le guest s'il y en a un.
  attachShortcuts(win.webContents, () => guest || win.webContents, onAction);
}

module.exports = { resolveShortcut, runShortcut, registerWindowShortcuts, nextZoom, ZOOM_LADDER };
