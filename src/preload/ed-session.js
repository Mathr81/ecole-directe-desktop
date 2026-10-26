// S'execute a document-start, avant le boot d'Angular.
//
// Valide par spike : un preload en sandbox + contextIsolation ecrit bien
// dans le storage que la page lit ensuite. Le storage est cloisonne par
// origine, pas par monde isole.
const { ipcRenderer } = require("electron");

try {
  // L'ecran d'attente est une page file:// : on ne seme que sur l'origine
  // EcoleDirecte, sinon on ecrirait la session dans un storage sans rapport.
  // Hote EXACT : un endsWith acceptait « evil-ecoledirecte.com », et la
  // session (jeton, cles 2FA) serait partie chez lui.
  if (location.hostname !== "www.ecoledirecte.com") {
    throw new Error("origine hors EcoleDirecte, amorçage ignoré");
  }

  const isLoginUrl = location.pathname.toLowerCase().startsWith("/login");
  const hasSession = sessionStorage.getItem("credentials") !== null;

  // On ne reamorce pas a chaque navigation : une session en cours
  // d'utilisation peut etre plus fraiche que celle detenue par le
  // processus principal, le token pouvant tourner cote serveur.
  if (isLoginUrl || !hasSession) {
    const seed = ipcRenderer.sendSync("ed:session-seed");

    if (seed) {
      for (const [key, value] of Object.entries(seed.session || {})) {
        sessionStorage.setItem(key, value);
      }
      for (const [key, value] of Object.entries(seed.local || {})) {
        localStorage.setItem(key, value);
      }
    }
  }
} catch (err) {
  // Un preload qui leve empeche la page de se charger. On degrade
  // silencieusement vers le formulaire de login normal.
  console.debug("[ed-session]", err && err.message);
}
