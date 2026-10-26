# Mon ÉcoleDirecte 🎓

Une application desktop qui se connecte automatiquement à [ÉcoleDirecte](https://www.ecoledirecte.com), avec des fonctionnalités pensées pour un usage quotidien au lycée.

Construite avec [Electron](https://www.electronjs.org/). L'authentification se fait
entièrement par l'API ÉcoleDirecte, sans navigateur piloté.

---

## Fonctionnalités

- **Connexion automatique** — les identifiants sont sauvegardés chiffrés localement (via `safeStorage` d'Electron) et la connexion se fait par appel API au démarrage, sans passer par le formulaire du site
- **Double authentification** — si ÉcoleDirecte pose sa question de vérification, l'application l'affiche et mémorise la réponse pour les connexions suivantes
- **Re-login automatique** — si la session expire, l'application se réauthentifie seule, avec une garde de 3 tentatives et un délai croissant pour ne jamais boucler
- **Support d'extensions** — chargement automatique de l'extension [CustomDirecte](https://github.com/Bottersnike/CustomDirecte) pour améliorer l'interface d'ÉcoleDirecte
- **Écran de démarrage** — l'application indique ce qu'elle fait pendant l'authentification et le chargement du site, au lieu d'une fenêtre blanche
- **Badge de notifications** — le nombre de notifications non lues s'affiche sur l'icône dans la barre des tâches Windows
- **Liens externes dans une popup intégrée** — les liens ouverts depuis ÉcoleDirecte s'affichent dans une mini-fenêtre avec barre d'outils (copier l'URL, ouvrir dans le navigateur)
- **Palette de navigation** — `Ctrl+K` pour aller à n'importe quelle page du site en tapant quelques lettres, ou recharger, changer de compte, ouvrir le journal, vérifier les mises à jour
- **Téléchargements intégrés** — les pièces jointes partent dans le dossier Téléchargements, avec l'avancement et des boutons pour ouvrir le fichier ou son dossier
- **Arrière-plan et notifications** — fermer la fenêtre la garde ouverte dans la zone de notification ; une notification signale les nouveaux messages, notes et devoirs. Le menu de l'icône permet de quitter et de lancer l'app au démarrage
- **Hors ligne** — sans réseau, l'écran d'attente le dit et l'application repart seule au retour de la connexion
- **Raccourcis clavier** — `F5` / `Ctrl+R` pour recharger, `F12` pour les DevTools, `Alt+←/→` pour naviguer dans l'historique, `Ctrl+` / `Ctrl-` / `Ctrl+0` pour le zoom (mémorisé)
- **Mises à jour automatiques** — l'application vérifie et télécharge les nouvelles versions en arrière-plan via GitHub Releases. Sur macOS, l'application n'étant pas signée, elle annonce la nouvelle version et ouvre la page de téléchargement

---

## Installation

Télécharge le dernier installeur depuis les [Releases GitHub](../../releases/latest) :
`.exe` pour Windows, `.dmg` pour macOS (non signé), `.AppImage` pour Linux.

Au premier démarrage, une fenêtre te demande tes identifiants ÉcoleDirecte. Ils sont ensuite sauvegardés chiffrés et tu n'as plus à les retaper.

---

## Documentation technique

Les comportements non documentés de l'API ÉcoleDirecte et les pièges de
packaging rencontrés sont consignés dans
[`docs/ecoledirecte-api.md`](docs/ecoledirecte-api.md).

---

## Développement

### Prérequis

- [Node.js](https://nodejs.org/) v20+
- [pnpm](https://pnpm.io/)

### Lancer en mode développement

```bash
pnpm install
pnpm start
```

`pnpm start` utilise un profil de développement dédié,
`%APPDATA%/Mon EcoleDirecte (dev)`, distinct de celui de l'application
installée. Deux processus Chromium ne peuvent pas partager un profil : le
cache et la base des service workers deviennent inaccessibles et l'extension
CustomDirecte cesse silencieusement de fonctionner.

La session du profil de développement est persistante : la connexion et la
double authentification ne sont demandées qu'au premier lancement.

Pour utiliser un autre profil — repartir de zéro, ou reprendre celui de
l'application installée — définir `ED_DEV_USER_DATA` vers un dossier
**situé hors du dépôt** :

```bash
ED_DEV_USER_DATA=~/.ed-dev-profile pnpm start
```

Ne jamais pointer cette variable dans l'arborescence du projet : le dossier
contient les identifiants chiffrés **et** la clé `Local State` qui permet de
les déchiffrer. Les deux réunis annulent le chiffrement pour quiconque met la
main sur le dossier — une sauvegarde, un dossier synchronisé ou une archive
suffisent, `.gitignore` ne protège que de git.

### Construire l'installeur

```bash
pnpm run build
```

L'installeur de la plateforme courante est généré dans le dossier `dist/`.

### Tests

```bash
pnpm test
```

Ils tournent aussi en CI sur chaque push et pull request, et avant chaque release.

---

## Publier une nouvelle version

1. Mettre à jour le champ `version` dans `package.json`
2. Committer et pousser sur `main`
3. Créer et pousser un tag Git correspondant :

```bash
git tag v1.x.x
git push origin v1.x.x
```

La GitHub Action se charge du build et de la création de la Release automatiquement.

---

## Structure du projet

```
├── src/
│   ├── main/
│   │   ├── index.js      # Point d'entrée : authentification, reprise de session, badge
│   │   ├── auth/         # Client API ÉcoleDirecte, 2FA, identifiants chiffrés
│   │   ├── features/     # Badge, téléchargements, palette, raccourcis, mises à jour
│   │   ├── windows/      # Fenêtres et politique d'ouverture des liens
│   │   └── lib/          # Journal, chemins, géométrie des fenêtres
│   ├── preload/          # Ponts entre le processus principal et les pages
│   └── renderer/         # Pages des fenêtres maison (connexion, 2FA, popup…)
├── test/                 # Tests unitaires (node:test)
├── scripts/              # Patch de l'extension, scripts de diagnostic
├── CustomDirecte/        # Extension chargée dans l'app (sous-module git)
├── assets/               # Icônes et pastilles du badge
├── docs/                 # Comportements de l'API et pièges rencontrés
└── .github/workflows/    # Tests et release
```

---

## Données personnelles

Les identifiants sont chiffrés localement avec l'API `safeStorage` d'Electron (chiffrement natif du système d'exploitation) et ne quittent jamais ta machine.

---

## Licence

MIT