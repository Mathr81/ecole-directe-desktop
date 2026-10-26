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

- [ ] **5. Badge distant par connexion complète.** `readBadgeFromApi` refait un
      login avec mot de passe toutes les 20–40 min. Tester si
      `edApi.relogin()` (jeton, sans mot de passe, inutilisé aujourd'hui)
      renvoie bien `accounts[].modules[].badge`. Si oui, basculer dessus.

## Phase 3 — Dette

- [ ] Remplacer `showAuthBanner` / `showAuthNotice` / `clear*` de `index.js`
      par `features/page-notice.js` (tons `error` et `info` déjà présents).
- [ ] Sortir la reprise sur expiration et la lecture du badge de `index.js`
      (576 lignes) vers `auth/` et `features/`.
- [ ] Migrer login, 2FA, palette, téléchargements et mise à jour sous
      preload + `contextIsolation`.
- [ ] README : section « Structure » périmée, mentionner macOS et Linux.
- [ ] Remplacer `canvas` (dépendance native) par des PNG de badge
      pré-générés (1–9, 9+).

## Phase 4 — Fonctionnalités

- [ ] Notifications natives (nouveau message / note / devoir) : comparer les
      compteurs de `moduleBadges` d'un rafraîchissement à l'autre.
- [ ] Icône dans la zone de notification, réduction en arrière-plan.
- [ ] Lancement au démarrage (`app.setLoginItemSettings`).
- [ ] Actions dans la palette Ctrl+K : se déconnecter / changer de compte,
      ouvrir `app.log`, vérifier les mises à jour, recharger.
- [ ] Multi-comptes (parent avec plusieurs enfants) : le badge ne lit que le
      compte courant.
- [ ] Écran hors ligne explicite au lieu de la page d'erreur Chromium.
