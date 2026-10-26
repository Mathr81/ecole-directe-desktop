const test = require("node:test");
const assert = require("node:assert/strict");
const {
  createBadgeState,
  nextRemoteDelay,
  LOCAL_INTERVAL_MS,
  REMOTE_BASE_MS,
  REMOTE_JITTER_MS,
} = require("../src/main/features/badge");

// ---- Conservation de la derniere valeur connue -----------------------
//
// C'est la correction de fond : la lecture DOM renvoyait 0 quand ses
// selecteurs ne correspondaient plus, et effacait le compteur juste obtenu
// a la connexion. Un echec doit valoir null, et null ne doit rien changer.

test("part de la valeur initiale", () => {
  assert.equal(createBadgeState(3).value, 3);
});

test("une valeur initiale invalide retombe a zero", () => {
  assert.equal(createBadgeState(-2).value, 0);
  assert.equal(createBadgeState(undefined).value, 0);
  assert.equal(createBadgeState(1.5).value, 0);
});

test("une lecture nulle conserve la derniere valeur", () => {
  const s = createBadgeState(0);
  s.next(7);
  assert.equal(s.next(null), 7);
  assert.equal(s.value, 7);
});

test("une lecture non entiere conserve aussi", () => {
  const s = createBadgeState(0);
  s.next(4);
  assert.equal(s.next(undefined), 4);
  assert.equal(s.next("3"), 4);
  assert.equal(s.next(NaN), 4);
});

test("un zero explicite est accepte : la messagerie a bien ete vidée", () => {
  const s = createBadgeState(0);
  s.next(7);
  assert.equal(s.next(0), 0);
});

test("un compteur negatif est refuse", () => {
  const s = createBadgeState(0);
  s.next(5);
  assert.equal(s.next(-1), 5);
});

// ---- Cadence du rafraichissement distant ----------------------------

test("le delai reste dans la fenetre annoncee", () => {
  for (const r of [0, 0.5, 1, 0.123, 0.987]) {
    const d = nextRemoteDelay(() => r);
    assert.ok(d >= REMOTE_BASE_MS - REMOTE_JITTER_MS, `trop court pour ${r} : ${d}`);
    assert.ok(d <= REMOTE_BASE_MS + REMOTE_JITTER_MS, `trop long pour ${r} : ${d}`);
  }
});

test("les bornes de l'alea sont bien atteintes", () => {
  assert.equal(nextRemoteDelay(() => 0), REMOTE_BASE_MS - REMOTE_JITTER_MS);
  assert.equal(nextRemoteDelay(() => 1), REMOTE_BASE_MS + REMOTE_JITTER_MS);
  assert.equal(nextRemoteDelay(() => 0.5), REMOTE_BASE_MS);
});

test("l'alea decale reellement d'un tirage a l'autre", () => {
  const delays = new Set(Array.from({ length: 40 }, () => nextRemoteDelay()));
  assert.ok(delays.size > 1, "deux tirages consecutifs identiques a chaque fois");
});

test("la cadence distante reste discrete", () => {
  // Au pire 40 min entre deux, au mieux 20 : trois connexions par heure
  // maximum. L'utilisateur est notifie sur son telephone de toute facon.
  const parHeurePire = 60 / ((REMOTE_BASE_MS - REMOTE_JITTER_MS) / 60000);
  assert.ok(parHeurePire <= 3, `${parHeurePire} connexions par heure, trop`);
  assert.ok(REMOTE_JITTER_MS > 0, "sans alea, la cadence est previsible");
});

test("la lecture locale est plus fréquente que le rafraichissement distant", () => {
  assert.ok(LOCAL_INTERVAL_MS < REMOTE_BASE_MS - REMOTE_JITTER_MS);
});

test("une pastille par valeur jusqu'a 9, puis 9+", () => {
  const { badgeFileName } = require("../src/main/features/badge");
  assert.equal(badgeFileName(1), "1.png");
  assert.equal(badgeFileName(9), "9.png");
  assert.equal(badgeFileName(10), "9plus.png");
  assert.equal(badgeFileName(250), "9plus.png");
});
