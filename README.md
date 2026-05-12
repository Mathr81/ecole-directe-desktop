# Mon ÉcoleDirecte 🎓

Une application desktop qui se connecte automatiquement à [ÉcoleDirecte](https://www.ecoledirecte.com), avec des fonctionnalités pensées pour un usage quotidien au lycée.

Construite avec [Electron](https://www.electronjs.org/) et [Puppeteer](https://pptr.dev/).

---

## Fonctionnalités

- **Connexion automatique** — les identifiants sont sauvegardés chiffrés localement (via `safeStorage` d'Electron) et remplis automatiquement à chaque démarrage
- **Re-login automatique** — si la session expire et qu'ÉcoleDirecte affiche une popup de reconnexion, l'application la détecte et rentre le mot de passe sans intervention
- **Support d'extensions** — chargement automatique de l'extension [CustomDirecte](https://github.com/Bottersnike/CustomDirecte) pour améliorer l'interface d'ÉcoleDirecte
- **Badge de notifications** — le nombre de notifications non lues s'affiche sur l'icône dans la barre des tâches Windows
- **Liens externes dans une popup intégrée** — les liens ouverts depuis ÉcoleDirecte s'affichent dans une mini-fenêtre avec barre d'outils (copier l'URL, ouvrir dans le navigateur)
- **Raccourcis clavier** — `F5` / `Ctrl+R` pour recharger, `F12` pour les DevTools, `Alt+←/→` pour naviguer dans l'historique
- **Mises à jour automatiques** — l'application vérifie et télécharge les nouvelles versions en arrière-plan via GitHub Releases

---

## Installation

Télécharge le dernier installeur `.exe` depuis les [Releases GitHub](../../releases/latest) et lance-le.

Au premier démarrage, une fenêtre te demande tes identifiants ÉcoleDirecte. Ils sont ensuite sauvegardés chiffrés et tu n'as plus à les retaper.

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

### Construire l'installeur

```bash
pnpm run build
```

L'installeur `.exe` est généré dans le dossier `dist/`.

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
├── index.js              # Point d'entrée principal (main process)
├── login.html            # Fenêtre de saisie des identifiants
├── popup.html            # Fenêtre pour les liens externes
├── CustomDirecte/        # Extension chargée dans l'app
├── assets/
│   └── icons/            # Icônes de l'application
└── .github/
    └── workflows/
        └── release.yml   # CI/CD — build et publication automatique
```

---

## Données personnelles

Les identifiants sont chiffrés localement avec l'API `safeStorage` d'Electron (chiffrement natif du système d'exploitation) et ne quittent jamais ta machine.

---

## Licence

MIT