// Orchestration de l'authentification.
//
// Ce module n'ouvre aucune fenetre : il retourne un etat discrimine et
// c'est main/index.js qui decide de l'affichage. C'est ce qui le rend
// testable sans Electron.
//
//   { status: "ok",       state }
//   { status: "needs2fa", question, propositions }
//   { status: "failed",   code, message }

const { buildSessionState } = require("./session-payload");
const { CODE_2FA_REQUIRED } = require("./ed-api");

const CODE_OK = 200;

function createAuthFlow({ edApi, credentialsStore, now = Date.now }) {
  let pendingTwoFaToken = null;

  function runLogin(faKeys) {
    const { username, password } = credentialsStore.read();
    return edApi.login({
      identifiant: username,
      motdepasse: password,
      uuid: credentialsStore.ensureDeviceUuid(),
      fa: faKeys,
    });
  }

  function failed(code, message) {
    return { status: "failed", code, message };
  }

  function fromLoginResponse(res) {
    if (res.code !== CODE_OK) {
      return failed(res.code, res.message || "Connexion refusée.");
    }
    return { status: "ok", state: buildSessionState(res, now()) };
  }

  async function askTwoFaQuestion(res, hadFaKeys) {
    // Un 250 alors qu'on a envoye des cles signifie que le couple cn/cv
    // est mort. Le conserver ferait renvoyer eternellement des cles
    // invalides.
    if (hadFaKeys) credentialsStore.clearFaKeys();

    pendingTwoFaToken = res.twoFaToken;
    const question = await edApi.get2faQuestion(pendingTwoFaToken);

    return {
      status: "needs2fa",
      question: question.question,
      propositions: question.propositions,
    };
  }

  async function authenticate() {
    const { username, password, faKeys } = credentialsStore.read();
    if (!username || !password) {
      return failed("NO_CREDENTIALS", "Aucun identifiant enregistré.");
    }

    try {
      const res = await runLogin(faKeys);
      if (res.code === CODE_2FA_REQUIRED) {
        return await askTwoFaQuestion(res, Array.isArray(faKeys) && faKeys.length > 0);
      }
      return fromLoginResponse(res);
    } catch (err) {
      return failed("NETWORK_ERROR", err.message);
    }
  }

  async function submit2faAnswer(answer) {
    if (!pendingTwoFaToken) {
      return failed("NO_2FA_PENDING", "Aucune double authentification en attente.");
    }

    try {
      const { cn, cv } = await edApi.send2faAnswer(answer, pendingTwoFaToken);
      if (!cn || !cv) {
        return failed("BAD_2FA_ANSWER", "Réponse incorrecte.");
      }

      // Les cles cn/cv ne sont pas a usage unique : les conserver evite de
      // redemander la question a chaque demarrage.
      const faKeys = [{ cn, cv, uniq: false }];
      credentialsStore.saveFaKeys(faKeys);
      pendingTwoFaToken = null;

      return fromLoginResponse(await runLogin(faKeys));
    } catch (err) {
      return failed("NETWORK_ERROR", err.message);
    }
  }

  return { authenticate, submit2faAnswer };
}

module.exports = { createAuthFlow };
