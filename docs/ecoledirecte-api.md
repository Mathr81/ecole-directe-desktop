# Faits d'API ÉcoleDirecte et de packaging

Notes de rétro-ingénierie établies pendant la migration vers
l'authentification headless (septembre 2026). Ces comportements ne sont
documentés nulle part officiellement et ont chacun coûté un aller-retour de
débogage. Ils sont vérifiés contre l'API et le build réels, pas déduits.

Base : `https://api.ecoledirecte.com`, paramètre `v=4.101.2`
(valeur `packageVersion` du SPA au moment de l'analyse).

---

## L'en-tête de la double authentification est `2FA-Token`, pas `X-Token`

`/v3/connexion/doubleauth.awp` **rejette** `X-Token` :

```
en-tete X-Token   -> code 520  "Token invalide !"
en-tete 2FA-Token -> code 200  question + propositions
```

Le SPA définit d'ailleurs deux constantes distinctes :
`De = { token: "X-Token", twoFAToken: "2FA-Token", … }`. `X-Token` porte le
jeton de session pour les appels métier ; `2FA-Token` porte le jeton de la
double authentification. Ils ne sont pas interchangeables.

Testé dans `test/ed-api.test.js`.

## Sur un code 250, le jeton exploitable est celui du corps, pas de `x-token`

La réponse `250` d'un login porte **deux** jetons différents :

- `body.token` — celui qui fonctionne avec `2FA-Token` ;
- l'en-tête `x-token` — un autre jeton, qui mène au 520.

Mesuré : `token du corps === entête x-token` → `false`. Les en-têtes présents
sur cette réponse sont `2fa-token`, `x-code` et `x-token`.

C'est contre-intuitif, l'en-tête paraissant le canal naturel. La
documentation non officielle dit seulement « gardez bien le token mis dans la
réponse », sans préciser lequel.

## Le message d'erreur d'un 250 est trompeur

Un code `250` s'accompagne du message
`"Identifiant et/ou mot de passe invalide !"` alors que les identifiants sont
corrects et que la double authentification est simplement requise. **C'est le
code qui fait foi, jamais le message.** Le SPA nomme d'ailleurs cette valeur
`Auht2Factor` dans son énumération.

## Le cookie GTK est obligatoire depuis le 24/03/2025

Sans lui, `/v3/login.awp` répond « identifiant et/ou mot de passe invalide »
même avec des identifiants corrects. Séquence :

1. `GET /v3/login.awp?gtk=1` — pose un cookie `GTK` (~550 à 650 caractères) ;
2. `POST /v3/login.awp` avec sa valeur dans l'en-tête **`X-Gtk`**.

`session.defaultSession.fetch` d'Electron écrit bien les `Set-Cookie` dans le
jar de la session : le cookie est donc relisible via
`session.cookies.get({ name: "GTK" })` et atterrit dans la fenêtre. Vérifié.

## Les clés `cn`/`cv` sont réutilisables, mais peuvent mourir

`doubleauth.awp?verbe=post` renvoie un couple `{ cn, cv }` à joindre au champ
`fa[]` des logins suivants, ce qui évite de reposer la question.

Si un login **renvoie quand même un 250 alors qu'on a envoyé des `fa[]`**, le
couple est mort : il faut le purger et repasser par la question, sinon on
renvoie éternellement des clés invalides. Implémenté dans
`src/main/auth/auth-flow.js`, testé dans `test/auth-flow.test.js`.

## Où le SPA range sa session

Persistance via un `WebStorageService` qui utilise **`sessionStorage`**, avec
l'enveloppe `JSON.stringify({ payload, lastModified })` :

| Clé | Store | `payload` |
|---|---|---|
| `credentials` | `CredentialsStore` | `{ authToken, fcmToken, twoFAToken }` |
| `accounts` | `AuthStore` | `{ accounts[], changementMDP, nbJourMdpExire, isBloque, urlUnblock }` |

L'intercepteur HTTP pose `X-Token: credentialsStore.snapshot.authToken` sur
chaque requête. Les clés 2FA vivent dans `localStorage["fa"]` sous la forme
`[{ cn, cv, uniq }]`, 10 entrées maximum en FIFO.

Comme il s'agit de `sessionStorage`, la session est perdue à chaque
redémarrage de l'application : c'est pour cela qu'il faut réauthentifier et
réinjecter au lancement.

### Piège : `edcommonhydration_auth` n'est pas de l'authentification

La page expose aussi `sessionStorage["edcommonhydration_auth"]`, qui vaut
`{"payload":{}}` hors session. Le nom et l'enveloppe `{ payload }` en font un
sosie convaincant des clés ci-dessus.

C'est en réalité l'hydratation d'un feature-state NgRx de forme
`{ datas, selectedAnneeScolaire, selectedEntityUser, selectedVariant }`, écrit
par un helper distinct préfixant toutes ses clés :
`` Yx = s => `edcommonhydration_${s}` ``. Il ne porte ni jeton ni compte.
**Ne pas l'écrire, ne pas le confondre avec `credentials` / `accounts`.**

## Un preload sandboxé écrit bien dans le storage lu par la page

Vérifié par spike : avec `sandbox: true` et `contextIsolation: true`, un
preload s'exécute à `document.readyState === "loading"`, donc avant le boot
d'Angular, et le monde principal de la page relit exactement ce qu'il a
écrit. Le storage est cloisonné par origine, pas par monde isolé.
`ipcRenderer.sendSync` y fonctionne également.

C'est ce qui rend l'injection de session possible sans piloter le DOM.

## Le badge est dans la réponse de login, et nulle part ailleurs de fiable

`accounts[].modules[]` contient `{ code, badge }`, dont
`{ code: "MESSAGERIE", badge: N }` — la valeur qu'affiche la pastille du menu
latéral. Le menu la lit d'ailleurs de là : `u.badge = Me.getBadgeNumber(e)`,
où `e` est l'objet module.

Le même chiffre reste lisible ensuite **sans aucune requête**, dans
`sessionStorage["accounts"]`, enveloppe `{ payload, lastModified }` comprise.
Vérifié dans la page réelle : `payload.accounts[0].modules[MESSAGERIE].badge`
valait bien `1` avec un message non lu.

Ce store n'est cependant réécrit que quand le SPA se reconnecte de lui-même —
pas quand un message est lu, et pas quand un nouveau arrive. C'est une source
gratuite, pas une source fraîche.

### Le `BadgesStore` du SPA est déclaré mais introuvable

Le bundle contient un store de badges dédié, bien plus fin, mis à jour à
chaque action de l'utilisateur (`updateBadgeForModule` est appelé à la
lecture d'un message, au marquage lu/non lu, à la suppression, au
déplacement). Sa forme :

```js
payload["<id><typeCompte>"]["<CODE_MODULE>"] = { valeur, iconApp }
// exemple : payload["5618E"]["MESSAGERIE"] = { valeur: 1, iconApp: true }
```

`calculBadgesIconApp(id, typeCompte)` somme les `valeur` des modules marqués
`iconApp` : c'est le calcul du badge d'icône d'application fait par le site.

L'énumération des clés de stockage du SPA :

```js
{ CREDENTIALS: "credentials", ACCOUNTS: "accounts", ETABLISSEMENT: "etablissement",
  FINANCES: "finances", PANIER: "panier", BADGES: "badges" }
```

**Mais `sessionStorage["badges"]` vaut `null`**, y compris après un passage
sur la messagerie, là où `credentials` et `accounts` sont bien présents. Le
champ de configuration s'appelle `idDBKey`, ce qui laisse penser à un autre
support — IndexedDB. Non creusé : un store qu'on n'observe pas n'est pas une
base fiable.

### Une seconde connexion ne tue pas le jeton en place

Vérifié par `scripts/diag-badge-api.js` sur le compte réel : après une
seconde connexion, le jeton de la première répond toujours `x-code 200`. Les
jetons sont différents, et les deux vivent.

C'est ce qui autorise à rafraîchir le badge par un `login.awp` dédié sans
casser la session de la page. Sans cette garantie, chaque rafraîchissement
aurait déclenché la reprise sur session expirée, en boucle.

### Le relogin par jeton n'est pas une alternative, du moins pour un élève

Vérifié par `scripts/diag-relogin.js` le 26/10/2026 sur un compte élève
(`typeCompte E`) : la réponse de login porte un `accounts[].accessToken`
**vide**. `relogin.awp` (`isReLogin: true`, sans mot de passe) répond donc
`505 « Identifiant et/ou mot de passe invalide »`, avec ou sans en-tête
`X-Token`. Le badge garde le login complet. Peut-être différent pour un
compte parent, non vérifié.

### Le jeton de la page suffit pour le compteur de la messagerie

Vérifié par `scripts/diag-page-token.js` le 26/10/2026 : avec le seul jeton
d'une session existante (`X-Token`), la liste des messages

```
POST /v3/eleves/{id}/messages.awp?typeRecuperation=received&itemsPerPage=1&verbe=get
data={"anneeMessages":""}
```

répond 200 et porte `data.pagination.messagesRecusNotReadCount`, à côté de
`messagesRecusCount`, `messagesEnvoyesCount`, `messagesArchivesCount` et
`messagesDraftCount`. L'en-tête `x-token` renvoie **le même** jeton : pas de
rotation, et le jeton répond toujours 200 après coup. Lire la liste ne marque
rien comme lu.

Le compteur de la messagerie se rafraîchit donc sans login ni mot de passe,
toutes les 5 minutes (`features/badge-sources.js`).

Ces appels passent par `session.defaultSession.fetch`, comme ceux du site,
et donc aussi par `webRequest.onHeadersReceived`. Mesuré : les requêtes du
site portent le `webContentsId` de la fenêtre, les nôtres `undefined`. La
détection d'expiration ne regarde que les premières : un 520 sur notre
propre appel ne recharge pas la page. Les autres modules (notes, devoirs, vie scolaire) n'ont pas
d'équivalent identifié : leurs compteurs ne sont connus que par la réponse
de login.

### Ce qu'on ne peut pas faire : se greffer sur les réponses du site

`webRequest.onHeadersReceived` donne les en-têtes, jamais le corps. Le
compteur est dans le corps. Il n'y a donc pas moyen de récupérer le badge en
observant le trafic que le SPA génère déjà ; d'où la connexion dédiée, espacée
et bruitée (30 min ± 10), dans `features/badge.js`.

### L'ancienne lecture DOM, et pourquoi elle a été retirée

Le compteur était relevé par sélecteurs CSS, dont
`#menuId-5618 > li:nth-child(5) > …` — l'identifiant élève d'un seul
utilisateur, codé en dur. Aucun des quatre sélecteurs ne correspondait plus
au DOM du site : la lecture renvoyait `0` et **effaçait** le compteur juste
obtenu à la connexion, cinq secondes après l'avoir posé. Les journaux le
montraient noir sur blanc : `[BADGE] Overlay applique` puis
`[BADGE] Overlay supprime`, avec un message non lu bien réel.

La règle qui en découle, et qui vaut pour toute lecture de compteur : **un
échec de lecture vaut `null`, jamais `0`**, et `null` conserve la dernière
valeur connue.

---

## Packaging : `package.json` a la priorité sur `electron-builder.yml`

`app-builder-lib/out/util/config/load.js` :

```js
const data = packageMetadata[request.packageKey];      // package.json "build"
return data == null ? findAndReadConfig(request) : { result: data, configFile: null };
```

Le fichier de configuration n'est cherché **que si** le champ `build` est
absent de `package.json`. Quand les deux existent, le `.yml` n'est jamais lu.
Le build le confirme dans sa sortie :

```
• loaded configuration  file=package.json ("build" field)
```

Conséquence : toute modification de packaging doit se faire dans
`package.json`. La faire dans un `.yml` n'aurait aucun effet et ne se verrait
qu'à la release. `electron-builder.yml` a été supprimé pour cette raison.

## L'extension ne peut pas être chargée depuis l'asar

`session.loadExtension()` exige un vrai dossier sur disque. L'extension
patchée est donc copiée par `extraResources` et résolue au runtime via
`process.resourcesPath` en packagé, `app.getAppPath()` en développement.

## `app.getAppPath()` dépend du script lancé

Pour l'application (`electron .`) il vaut la racine du projet ; pour un script
lancé directement (`electron scripts/diag-auth.js`) il vaut le dossier du
script. Un utilitaire qui doit retrouver le profil de l'application ne peut
donc pas s'appuyer dessus, et doit en outre appeler `app.setName()`, faute de
quoi il retombe sur `AppData/Roaming/Electron`.

## Monter de version Electron casse `install-app-deps` tant que `node-abi` retarde

Le `postinstall` lance `electron-builder install-app-deps`, qui délègue à
`@electron/rebuild`, qui interroge `node-abi` pour connaître l'ABI de la
version d'Electron visée. La copie de `node-abi` embarquée par
`@electron/rebuild` est souvent en retard de quelques versions : au moment du
passage à Electron 44 elle était en 4.31.0, qui ne connaissait pas encore
l'ABI 149, et l'installation échouait avec un `getAbi` en erreur — pnpm
annulait alors la mise à jour de `package.json`.

Le correctif est une surcharge dans `pnpm-workspace.yaml` :

```yaml
overrides:
  node-abi: ^4.35.0
```

À relever pour chaque montée majeure d'Electron. Le projet n'a plus de
module natif depuis le retrait de `canvas` (les pastilles du badge sont des
PNG pré-rendus dans `assets/badges/`) : c'est uniquement l'interrogation de
`node-abi` qui échouait, il n'y a rien à recompiler.

## `ELECTRON_RUN_AS_NODE` traîne dans certains terminaux

VS Code exporte `ELECTRON_RUN_AS_NODE=1` dans l'environnement de ses
terminaux intégrés. Un `electron .` lancé depuis là démarre en Node pur :
`process.type` vaut `undefined` et `require("electron")` ne renvoie plus le
module intégré mais la chaîne exportée par le paquet npm, c'est-à-dire le
chemin du binaire. Le symptôme est un `Cannot read properties of undefined`
sur `app`, `BrowserWindow` ou n'importe quel export, souvent depuis un module
de `node_modules` — ce qui fait accuser à tort la dépendance ou la version
d'Electron.

Lancer avec `env -u ELECTRON_RUN_AS_NODE …` pour trancher.

## `globalShortcut` refuse F5, F12 et Ctrl+R sous Windows

`globalShortcut.register()` renvoie `false` — sans lever d'erreur — pour
`F5`, `F12` et `CommandOrControl+R`, alors qu'il accepte `Alt+Left` et
`Alt+Right`. D'où un jeu de raccourcis à moitié fonctionnel, sans rien dans
la console pour le signaler : `register()` ne rapporte son échec que par sa
valeur de retour, qu'on ne lit jamais.

Ce n'était de toute façon pas le bon outil. `globalShortcut` enregistre des
hotkeys au niveau du système : les accélérateurs restent confisqués aux
autres applications même quand la fenêtre n'a pas le focus. Pour des
raccourcis d'application, `webContents.on("before-input-event")` est la voie
correcte.

Un piège s'y ajoute : **les frappes faites dans une `<webview>` ne remontent
pas au `webContents` de la fenêtre.** Il faut attacher l'écouteur au guest,
récupéré par `did-attach-webview`, faute de quoi les raccourcis de la fenêtre
popup cessent de répondre dès qu'on clique dans la page.

## L'expiration de session est lisible dans l'en-tête `x-code`

L'API répond `HTTP 200` avec le code métier dans le corps, mais elle le pose
**aussi** dans un en-tête de réponse. Vérifié contre le service réel avec un
jeton bidon :

```
HTTP/1.1 200 OK
x-code: 520
{"code":520, "token":"", "message":"Token invalide !", "data":{…}}
```

C'est ce qui permet de détecter l'expiration depuis
`session.webRequest.onHeadersReceived`, sans injecter de code dans la page ni
dépendre du DOM du site. Les codes concernés sont **520** (« Token
invalide ») et **525**, que le SPA traite ensemble sous `AccessTokenInvalid`.

La table complète des en-têtes utilisés par le SPA :

```js
{ token: "X-Token", code: "X-Code", wopiToken: "WOPI-Token",
  streamToken: "STREAM-Token", twoFAToken: "2FA-Token",
  authUserInfos: "X-WithAuthUserInfos", cache: "X-WithCacheContext" }
```

## Le SPA tente son propre rafraîchissement avant d'afficher sa modale

Son intercepteur HTTP, sur `AccessTokenInvalid`, appelle d'abord
`authService.refreshToken({...credentialsStore.credentials, uuid})` —
une seule tentative, `RETRY_ATTEMPT = 1`. Le corps envoyé est celui que
décrit BlocksDirecte :

```js
{ identifiant, typeCompte, motdepasse: "???", accesstoken, isReLogin: true }
```

Cet objet n'est **pas** persisté : il vit dans un champ privé du
`CredentialsStore`, reconstruit à l'hydratation par
`authStore.setAuthStore()` → `credentialsStore.updateCredentials(currentUser)`
à partir de `accounts[].identifiant`, `accounts[].typeCompte` et
`accounts[].accessToken`. Ces trois champs viennent de la réponse de login,
que l'on recopie telle quelle : le rafraîchissement du site reste donc
possible après notre amorçage.

Ce n'est que si ce rafraîchissement échoue que le SPA émet
`user:access-token-invalid` et affiche « Votre session est invalide ou
expirée, identifiez-vous à nouveau ».

**Conséquence pour nous** : réagir au premier code d'expiration
rechargerait la page alors que le site allait se rattraper seul. D'où la
temporisation de `auth/expiry-watcher.js` — un code d'expiration arme, une
réponse saine désarme, un second déclenche tout de suite. Et d'où
l'exclusion de `login.awp` et `doubleauth` : c'est par là que passe le
rafraîchissement du site, et sa réponse d'échec ne doit surtout pas désarmer.

## Un journal bufferisé ne voit jamais la fin de l'application

`initLogger` dupliquait la console vers `app.log` avec un
`fs.createWriteStream`. Un flux Node est **bufferisé et asynchrone** : ce qui
est écrit juste avant la mort du processus part avec le buffer.

Conséquence directe : tout ce qui se journalise sur `will-quit` et `quit` —
donc l'installation de la mise à jour, qui se fait exactement là — n'atterrit
jamais dans le fichier. Le journal donnait l'illusion d'être complet, alors
qu'il s'arrêtait systématiquement avant l'évènement intéressant.

Les écritures sont désormais faites par `fs.appendFileSync`. Le coût est
négligeable au volume de l'application (environ 200 Ko par an) et c'est le
seul moyen d'avoir une trace de ce qui se passe pendant la fermeture.

## L'installation silencieuse de la mise à jour échouait sans un mot

Constaté le 03/09/2026, sur le passage de la 2.1.1 à la 2.2.0. Le journal
montre trois cycles identiques :

```
19:32:26  Mise à jour v2.2.0 téléchargée.
19:37:46  [redémarrage]           ← rien n'a été installé
19:37:52  Mise à jour v2.2.0 téléchargée.
19:40:20  [redémarrage]           ← toujours rien
19:40:25  Mise à jour v2.2.0 téléchargée.
```

L'installateur téléchargé était pourtant intègre (124 195 486 octets, la
taille exacte de l'asset GitHub), et il restait dans
`%LOCALAPPDATA%\ecole-directe-desktop-updater\pending\` — un dossier
qu'electron-updater nettoie après une pose réussie.

Le mécanisme en cause est `autoInstallOnAppQuit`. Dans `BaseUpdater`, il pose
un `app.once("quit")` qui appelle `install(true, false)`, c'est-à-dire
`doInstall({ isSilent: true })`, qui lance
`pending\…Setup-2.2.0.exe --updated /S`. Trois choses se conjuguent :

- l'installateur est **assisté** (`oneClick: false` avec
  `allowToChangeInstallationDirectory: true`), lancé en mode silencieux ;
- toute erreur passe par `dispatchError`, donc par l'évènement `error` ;
- le processus étant déjà en train de mourir, l'évènement n'a plus personne
  pour l'écouter et le journal est perdu avec son buffer.

L'échec était donc structurellement invisible, et l'application
re-téléchargeait la même version à chaque démarrage.

`autoInstallOnAppQuit` est désormais à `false`. La pose passe par une action
explicite de l'utilisateur, avec `quitAndInstall(false, true)` :
`isSilent = false` pour que l'installateur montre son interface — un échec
devient visible — et `isForceRunAfter = true` pour que l'application se
rouvre seule.

### Détecter un échec qu'on ne peut pas observer

On ne verra jamais l'installateur échouer : il tourne après la mort du
processus. Le seul signal exploitable est de **re-télécharger une version
déjà téléchargée**, ce qui prouve qu'on ne tourne toujours pas dessus. Le
compteur vit dans `update-attempts.json` et est effacé dès que
`app.getVersion()` rejoint la version attendue. À partir de deux tentatives,
la fenêtre propose d'ouvrir l'installateur à la main.

## Les bornes de fenêtre dérivent, et pas dans le sens qu'on croit

En réinjectant à chaque cycle la valeur lue au cycle précédent, sous
Windows 11 :

```
getNormalBounds     1111x777 -> 1113x779 -> 1114x780 -> stable
getContentBounds    1111x777 -> 1112x780 -> 1112x782 -> 1112x784…
```

`useContentSize` + `getContentBounds`, qui semble pourtant le couple
cohérent, **n'a pas de point fixe** : la fenêtre grandit de deux pixels à
chaque ouverture, indéfiniment. `getNormalBounds` se stabilise après un
ajustement unique de trois pixels. C'est donc lui que retient
`main-window.js`.

## Le zoom se résout sur `code`, pas sur `key`

Sur un clavier AZERTY les chiffres exigent Shift : `Ctrl+0` y produit
`input.key === "à"`. Un aiguillage sur `key` ne verrait donc jamais passer
la remise à zéro du zoom sur le clavier de l'utilisateur. `input.code` vaut
`"Digit0"` quelle que soit la disposition, et c'est lui qu'utilise
`resolveShortcut` pour les trois raccourcis de zoom.

## Un téléchargement laissait une fenêtre blanche derrière lui

Signalé le 12/09/2026. Ouvrir une pièce jointe téléchargeait bien le
fichier, mais laissait aussi une fenêtre entièrement blanche à l'écran.

L'enchaînement, reproduit sur un serveur local qui répond
`Content-Disposition: attachment` :

1. le lien de la pièce jointe porte `target="_blank"` ;
2. `setWindowOpenHandler` de la fenêtre principale n'y reconnaît ni
   `blob:`, ni `data:`, ni l'API — il ouvre donc un popup ;
3. la `<webview>` du popup tente la navigation ;
4. le serveur annonce une pièce jointe, Chromium convertit la navigation en
   téléchargement et l'abandonne ;
5. la webview reste sur `about:blank`, et le popup demeure affiché, vide.

Mesuré sous Electron 44 dans `will-download` : le `webContents`
initiateur est de type `"webview"`, son `getURL()` rend la chaîne vide, et
`BrowserWindow.fromWebContents()` sur ce guest renvoie **directement la
fenêtre popup** qui le contient — pas besoin de passer par
`hostWebContents`. C'est ce qui permet de refermer précisément la bonne
fenêtre. Une webview qui porte déjà une URL est laissée tranquille : c'est
une vraie session de navigation, où l'utilisateur télécharge peut-être
depuis une page qu'il consulte.

Effet de bord non corrigible : Electron journalise sur sa sortie d'erreur
un `Error occurred in handler for 'GUEST_VIEW_MANAGER_CALL': ERR_FAILED`
chaque fois qu'une navigation de `<webview>` devient un téléchargement.
Le message vient du code interne d'Electron, ne passe pas par `console.*`
— il n'atterrit donc pas dans `app.log` — et n'est pas visible pour
l'utilisateur.

## Un élément injecté dans la page ne peut porter aucun bouton

La première version du suivi de téléchargement posait un bandeau dans le
document du site via `executeJavaScript`. Ce code s'exécute dans le monde
principal de la page : il n'a ni `ipcRenderer`, ni accès au processus
principal. Le bandeau ne pouvait donc rien déclencher — d'où
l'impossibilité d'annuler un téléchargement en cours.

Le panneau est maintenant une fenêtre maison
(`src/main/windows/downloads-window.js`), ancrée en bas à droite de la
fenêtre principale et affichée par `showInactive()` pour ne jamais voler
le focus. Les avis purement informatifs, eux, continuent de passer par
`page-notice.js`.

## `fitWindowToContent` ne sait que faire GRANDIR une fenêtre

Il mesure le déficit du conteneur `.ed-body`, soit
`scrollHeight - clientHeight`. Deux conséquences :

- une page sans élément `.ed-body` mesure un déficit nul, et la fenêtre ne
  bouge pas — c'est ce qui laissait le panneau de téléchargement à sa
  hauteur initiale, avec une barre de défilement et la dernière ligne
  coupée ;
- un déficit ne peut pas être négatif, donc la fonction ne rétrécit
  jamais rien.

Le panneau de téléchargement passe d'une ligne à trois puis revient à une :
il a besoin des deux sens. Il fait donc sa propre mesure, en additionnant
la hauteur de son en-tête et le `scrollHeight` de sa liste, lequel donne la
hauteur réelle du contenu sans se laisser borner par la hauteur visible.

## Electron annonce 0 octet reçu pendant la première seconde

En sondant l'objet `DownloadItem` lui-même, indépendamment de toute
interface, sur un téléchargement de 8 Mio débité lentement :

```
t=400ms    recu=0
t=800ms    recu=0
t=1200ms   recu=2097152    (25 %)
t=2000ms   recu=2883584    (34 %)
```

Les deux premiers `updated` rapportent zéro. Un test d'avancement qui
échantillonne avant une seconde mesure donc le tampon de Chromium, pas
l'affichage — et échoue pour de mauvaises raisons.

## Un facteur de zoom capturé dans une fermeture est un piège

Chromium remet le zoom à 1 à chaque changement de document, et le SPA
navigue beaucoup : il faut donc le reposer sur `did-finish-load`. La
première version capturait la valeur enregistrée dans un `const` à la
création de la fenêtre. Le raccourci écrivait bien la nouvelle valeur sur
le disque, mais la fermeture gardait l'ancienne et la réappliquait à chaque
navigation : changer de page avec Ctrl+K annulait le zoom en cours pour
revenir à celui du démarrage.

La valeur courante doit être mutable et mise à jour par tous les chemins
qui la changent — les raccourcis, mais aussi `zoom-changed`, qu'émet
Chromium sur un Ctrl+molette.

## `setWindowOpenHandler` est attaché à un webContents, pas à l'application

C'est la cause des deux fenêtres parasites rapportées le 12/09/2026, et la
première tentative de correction avait visé à côté faute d'avoir vu ça.

La politique d'ouverture vivait en ligne dans `main-window.js`, donc posée
sur la seule fenêtre principale. Tout autre contexte retombait sur le
comportement par défaut d'Electron : une fenêtre nue.

Le cas le plus net est la `<webview>` du popup. Elle porte `allowpopups`
mais n'héritait d'aucune politique, si bien qu'un lien cliqué dedans
ouvrait une fenêtre sans barre d'adresse ni boutons Copier / Navigateur.
Vérifié en rejouant le cas :

```
avant   fenetre#2  boutons []                           → FENETRE NUE
après   fenetre#2  boutons ["Copier","Navigateur","×"]   → POPUP MAISON
```

La politique vit désormais dans `src/main/windows/window-policy.js` et est
appliquée à la fenêtre principale, aux invités `<webview>` des popups, et
aux fenêtres qu'Electron crée lui-même sur un verdict « allow » — sans quoi
un lien parti de l'une d'elles rouvrait une fenêtre nue.

`openPopup` lui est injecté : c'est `popup-window.js` qui sait fabriquer un
popup, et il applique lui-même la politique à ses invités. L'injecter évite
le cycle d'imports.

## Une fenêtre ouverte sur un `blob:` est toujours morte

Le mécanisme réel de téléchargement d'ÉcoleDirecte, relevé sur le site :

```
POST api.ecoledirecte.com/v3/telechargement.awp?verbe=get&fichierId=2149
GET  blob:https://www.ecoledirecte.com/954f4333-0461-4f8a-abf1-d50df255de48
GET  assets/locale/fr/viewer.ftl                          (PDF.js)
```

Dans un navigateur, le document s'affiche en ligne dans une iframe PDF.js —
aucune fenêtre ne s'ouvre. Dans Electron, l'URL `blob:` tombait sur
`action: "allow"`, et la fenêtre obtenue est **définitivement vide** :

```
titre ""   enfants du body []   texte ""   taille du HTML 159 octets
```

Electron n'y peint pas le PDF et ne le télécharge pas non plus. C'était la
fenêtre blanche.

`blob:` et `data:` sont donc refusés. On ne télécharge pas le blob à la
place, même si `contents.downloadURL(url)` en est capable — essayé, ça
fonctionne — car le fichier arrive déjà par le chemin `<a download>` de la
page avec son vrai nom (`_1518066406.pdf` dans les journaux), alors que
`downloadURL` sur un blob ne dispose que de son UUID et produirait un
doublon nommé `9ec8126c-04aa-43dd-99ac-b473c1c11a97.pdf`.

Refuser ne perd rien, et c'est l'argument décisif : cette fenêtre ne
rendait aucun fichier.

## Un blob n'est lisible que par le renderer qui l'a créé

Corollaire utile : on ne peut pas afficher un `blob:` d'une page dans la
`<webview>` d'un popup, ni le charger depuis une autre fenêtre. Seul le
renderer d'origine — ou une fenêtre qu'il ouvre dans le même processus — y
a accès. C'est pourquoi `contents.downloadURL` doit être appelé sur **ce**
webContents, et pas sur un autre.
