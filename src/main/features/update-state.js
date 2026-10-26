// Etat de la mise a jour, sans Electron : c'est ici qu'on decide QUOI dire
// a l'utilisateur, et le module de cablage se contente de l'afficher.
//
// L'ancienne version n'avait pas d'etat du tout : elle injectait deux
// phrases figees dans le DOM du site et s'en remettait pour le reste a
// `autoInstallOnAppQuit`, un mecanisme entierement invisible. Quand
// l'installation echouait, rien ne le disait et le telechargement
// recommencait a chaque demarrage.

// Nombre de telechargements de la MEME version avant de considerer que la
// pose automatique ne marche pas et de proposer l'installateur a la main.
const FAILED_INSTALL_THRESHOLD = 2;

/**
 * Compte les tentatives sur une version donnee.
 *
 * On ne peut pas observer l'echec de l'installateur : il s'execute apres
 * la mort du processus. En revanche, re-telecharger une version qu'on a
 * deja telechargee prouve qu'on ne tourne toujours pas dessus, donc que la
 * precedente pose n'a pas abouti.
 */
function nextAttempt(record, version) {
  if (!record || record.version !== version) return { version, attempts: 1 };
  return { version, attempts: record.attempts + 1 };
}

function installLooksBroken(record, threshold = FAILED_INSTALL_THRESHOLD) {
  return Boolean(record) && record.version && record.attempts >= threshold;
}

function createUpdateState() {
  let state = { phase: "idle", version: null, percent: 0, message: "", attempts: 0 };
  const set = (patch) => { state = { ...state, ...patch }; return state; };

  return {
    get value() { return state; },
    checking: () => set({ phase: "checking", message: "" }),
    upToDate: () => set({ phase: "up-to-date", message: "" }),
    available: (version) => set({ phase: "available", version, percent: 0, message: "" }),
    // Disponible, mais a installer a la main (macOS, application non signee).
    manual: (version) => set({ phase: "manual", version, percent: 0, message: "" }),
    // Le pourcentage est borne : electron-updater peut renvoyer un flottant
    // legerement superieur a 100 sur le dernier morceau.
    progress: (percent) => set({
      phase: "downloading",
      percent: Math.max(0, Math.min(100, Math.round(percent || 0))),
    }),
    downloaded: (version, attempts = 1) => set({ phase: "downloaded", version, percent: 100, attempts }),
    failed: (message) => set({ phase: "error", message: String(message || "Erreur inconnue") }),
  };
}

/**
 * Traduit l'etat en ce que la fenetre doit montrer.
 *
 * `canOpenInstaller` n'apparait qu'apres plusieurs echecs : tant que la
 * pose normale n'a pas fait ses preuves d'echec, on ne noie pas
 * l'utilisateur sous les options.
 */
function describe(state) {
  const version = state.version ? `v${state.version}` : "";
  switch (state.phase) {
    case "checking":
      return { title: "Recherche de mises à jour…", detail: "", showProgress: false, canInstall: false, canOpenInstaller: false, isError: false };
    case "up-to-date":
      return { title: "L'application est à jour.", detail: "", showProgress: false, canInstall: false, canOpenInstaller: false, isError: false };
    case "available":
      return { title: `Mise à jour ${version} disponible`, detail: "Téléchargement en cours…", showProgress: true, canInstall: false, canOpenInstaller: false, isError: false };
    case "downloading":
      return { title: `Téléchargement de ${version}`, detail: `${state.percent} %`, showProgress: true, canInstall: false, canOpenInstaller: false, isError: false };
    case "manual":
      return {
        title: `Mise à jour ${version} disponible`,
        detail: "Sur macOS, elle s'installe à la main : télécharge le .dmg depuis la page des versions, puis remplace l'application.",
        showProgress: false, canInstall: false, canOpenInstaller: false, canDownload: true, isError: false,
      };
    case "downloaded":
      return installLooksBroken({ version: state.version, attempts: state.attempts })
        ? {
            title: `Mise à jour ${version} prête`,
            detail: `L'installation automatique a déjà échoué ${state.attempts - 1} fois. Lance l'installateur toi-même : il te dira ce qui bloque.`,
            showProgress: false, canInstall: true, canOpenInstaller: true, isError: false,
          }
        : {
            title: `Mise à jour ${version} prête`,
            detail: "L'application va se fermer, s'installer, puis se rouvrir.",
            showProgress: false, canInstall: true, canOpenInstaller: false, isError: false,
          };
    case "error":
      return { title: "La mise à jour a échoué", detail: state.message, showProgress: false, canInstall: false, canOpenInstaller: true, isError: true };
    default:
      return { title: "", detail: "", showProgress: false, canInstall: false, canOpenInstaller: false, isError: false };
  }
}

module.exports = { createUpdateState, describe, nextAttempt, installLooksBroken, FAILED_INSTALL_THRESHOLD };
