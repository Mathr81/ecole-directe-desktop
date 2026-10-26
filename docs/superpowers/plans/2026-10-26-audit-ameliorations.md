# Audit du 26/10/2026 — Plan de correctifs et d'améliorations

Cases à cocher pour suivre l'avancement. Ordre = priorité.

## Phase 1 — Sécurité et bugs

- [x] **1. Popup : `openExternal` sans contrôle de protocole.** Le bouton
      « Navigateur » ouvrait l'URL courante de la webview quelle qu'elle soit
      (`file:`, `ms-msdt:`, `search-ms:`…). L'ouverture passe désormais par le
      processus principal, limitée à `http:`/`https:`.
- [x] **2. Fuite possible du jeton de session.** Le preload acceptait tout
      hôte finissant par `ecoledirecte.com` (`evil-ecoledirecte.com`). Hôte
      exact exigé, et le handler IPC `ed:session-seed` vérifie lui aussi
      l'origine de la frame appelante.
- [x] **3. Popup sous `contextIsolation`.** Seule fenêtre maison qui héberge du
      contenu tiers (webview) : passée sous preload + `contextBridge`.
      Les autres fenêtres (login, 2FA, palette, téléchargements, mise à jour)
      ne chargent que des fichiers locaux : à migrer plus tard, phase 3.
- [x] **4. `loadExtension` non attendu.** La promesse n'était pas attendue :
      échec invisible et « Extension chargée ! » mensonger. Branche morte
      `BrowserWindow.addExtension` supprimée.
- [x] **6. Mot de passe changé = échec permanent.** Sur un code 505
      (identifiants refusés), la fenêtre de connexion est reproposée une fois.
- [x] **7. Écouteur `submit-credentials` orphelin** si la fenêtre de connexion
      est fermée sans valider.
- [x] **8. La CI publie sans lancer les tests.** Étape `pnpm test` avant le
      build, et workflow de tests sur push / PR.

- [x] **Services externes (CAS) dans une fenêtre nue.** `goToService.awp`
      s'ouvre en POST (jeton) puis navigue en GET vers le service avec un
      ticket. La fenêtre nue est interceptée sur cette navigation et
      remplacée par le popup habillé. Constaté sur mathlive.fr.

## Phase 2 — À vérifier sur l'API réelle

- [x] **5. Badge distant par connexion complète.** Testé
      (`scripts/diag-relogin.js`) : pour un compte élève, `accessToken` est
      vide et `relogin.awp` répond 505. On garde le login complet, qui ne
      tue pas la session de la page (déjà vérifié).

## Phase 3 — Dette

- [x] Remplacer `showAuthBanner` / `showAuthNotice` / `clear*` de `index.js`
      par `features/page-notice.js` (tons `error` et `info` déjà présents).
- [ ] *Reporté.* Sortir la reprise sur expiration et la lecture du badge de
      `index.js` (527 lignes après le nettoyage des bandeaux). Aucun gain
      fonctionnel ; à faire quand on y touchera pour la phase 2 ou 4.
- [x] Migrer login, 2FA, palette, téléchargements et mise à jour sous
      preload + `contextIsolation`.
- [x] README : section « Structure » périmée, mentionner macOS et Linux.
- [x] Remplacer `canvas` (dépendance native) par des PNG de badge
      pré-générés (1–9, 9+).

## Phase 4 — Fonctionnalités

- [x] Notifications natives (nouveau message / note / devoir) : comparer les
      compteurs de `moduleBadges` d'un rafraîchissement à l'autre.
- [x] Icône dans la zone de notification, réduction en arrière-plan.
- [x] Lancement au démarrage (`app.setLoginItemSettings`), case du menu de
      l'icône, active seulement dans l'application installée.
- [x] Actions dans la palette Ctrl+K : se déconnecter / changer de compte,
      ouvrir `app.log`, vérifier les mises à jour, recharger.
- [ ] *Non fait.* Multi-comptes (parent avec plusieurs enfants) : le badge ne
      lit que le compte courant. Impossible à tester sans compte parent.
- [x] Écran hors ligne explicite au lieu de la page d'erreur Chromium.
