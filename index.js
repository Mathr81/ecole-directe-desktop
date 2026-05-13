const {
  app,
  BrowserWindow,
  Menu,
  ipcMain,
  safeStorage,
  session,
  globalShortcut,
  shell,
  clipboard,
} = require("electron");
const { ElectronChromeExtensions } = require("electron-chrome-extensions");
const pie = require("puppeteer-in-electron");
const puppeteer = require("puppeteer-core");
const { autoUpdater } = require("electron-updater");
const fs = require("fs");
const path = require("path");

// =========================
// MODE DEV
// =========================

console.log("NODE_ENV =", process.env.NODE_ENV);

let userDataPath;

if (process.env.NODE_ENV === "development") {
  userDataPath = path.join(__dirname, "userData");

  if (!fs.existsSync(userDataPath)) {
    fs.mkdirSync(userDataPath, { recursive: true });
  }

  app.setPath("userData", userDataPath);
} else {
  userDataPath = app.getPath("userData");
}

console.log("userData =", userDataPath);

// =========================
// LOGGING
// =========================

const logFilePath = path.join(app.getPath("userData"), "app.log");
const logStream = fs.createWriteStream(logFilePath, { flags: "a" });

const originalConsoleLog = console.log;
const originalConsoleWarn = console.warn;
const originalConsoleError = console.error;

console.log = (...args) => {
  originalConsoleLog(...args);
  logStream.write(`[LOG] ${new Date().toISOString()} ${args.join(" ")}\n`);
};

console.warn = (...args) => {
  originalConsoleWarn(...args);
  logStream.write(`[WARN] ${new Date().toISOString()} ${args.join(" ")}\n`);
};

console.error = (...args) => {
  originalConsoleError(...args);
  logStream.write(`[ERROR] ${new Date().toISOString()} ${args.join(" ")}\n`);
};

// =========================
// EXTENSION PATH
// =========================

function getCustomExtensionPath() {
  if (process.env.NODE_ENV === "development") {
    return path.join(__dirname, "CustomDirecte");
  }

  // Remonter depuis app.asar jusqu'à trouver CustomDirecte
  let dir = path.dirname(app.getAppPath()); // resources/
  for (let i = 0; i < 4; i++) {
    dir = path.dirname(dir);
    const candidate = path.join(dir, "CustomDirecte");
    if (fs.existsSync(candidate)) {
      console.log("Extension trouvée :", candidate);
      return candidate;
    }
  }

  console.error("CustomDirecte introuvable depuis", app.getAppPath());
  return path.join(path.dirname(path.dirname(app.getAppPath())), "CustomDirecte");
}

// =========================
// PUPPETEER INIT
// =========================

pie.initialize(app);

// =========================
// CREDENTIALS
// =========================

const credentialsPath = path.join(app.getPath("userData"), "credentials.json");

function getStoredCredentials() {
  try {
    if (fs.existsSync(credentialsPath)) {
      const data = JSON.parse(fs.readFileSync(credentialsPath));

      if (data.username && data.password) {
        const username = safeStorage.isEncryptionAvailable()
          ? safeStorage.decryptString(Buffer.from(data.username, "base64"))
          : null;

        const password = safeStorage.isEncryptionAvailable()
          ? safeStorage.decryptString(Buffer.from(data.password, "base64"))
          : null;

        return { username, password };
      }
    }
  } catch (err) {
    console.error("Erreur lecture credentials :", err);
  }

  return { username: null, password: null };
}

function storeCredentials(username, password) {
  try {
    if (!safeStorage.isEncryptionAvailable()) {
      console.error("Le chiffrement n'est pas disponible.");
      return;
    }

    const encryptedUsername = safeStorage
      .encryptString(username)
      .toString("base64");

    const encryptedPassword = safeStorage
      .encryptString(password)
      .toString("base64");

    fs.writeFileSync(
      credentialsPath,
      JSON.stringify({
        username: encryptedUsername,
        password: encryptedPassword,
      })
    );

    console.log("Identifiants enregistrés.");
  } catch (err) {
    console.error("Erreur sauvegarde credentials :", err);
  }
}

// =========================
// LOGIN WINDOW
// =========================

async function createLoginWindow() {
  const loginWindow = new BrowserWindow({
    width: 400,
    height: 300,
    modal: true,
    parent: BrowserWindow.getFocusedWindow(),
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
    },
  });

  await loginWindow.loadFile("login.html");

  return loginWindow;
}

// =========================
// POPUP WINDOW (liens externes)
// =========================

function createPopupWindow(url) {
  const popup = new BrowserWindow({
    width: 1000,
    height: 700,
    minWidth: 500,
    minHeight: 300,
    title: "Lien externe",
    icon: path.join(__dirname, "assets/icons/icon.ico"),
    frame: false,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
      webviewTag: true,
    },
  });

  popup.loadFile("popup.html");

  popup.webContents.once("did-finish-load", () => {
    popup.webContents.send("load-url", url);
  });

  // DevTools depuis la popup
  ipcMain.on("popup-devtools", () => {
    if (!popup.isDestroyed()) {
      popup.webContents.openDevTools({ mode: "detach" });
    }
  });

  // Raccourcis dans la popup via globalShortcut (quand focused)
  popup.on("focus", () => {
    globalShortcut.register("Alt+Left", () => {
      if (!popup.isDestroyed()) {
        popup.webContents.goBack();
      }
    });
    globalShortcut.register("Alt+Right", () => {
      if (!popup.isDestroyed()) {
        popup.webContents.goForward();
      }
    });
  });

  popup.on("blur", () => {
    globalShortcut.unregister("Alt+Left");
    globalShortcut.unregister("Alt+Right");
  });

  popup.on("closed", () => {
    globalShortcut.unregister("Alt+Left");
    globalShortcut.unregister("Alt+Right");
  });

  return popup;
}

// =========================
// UTILS
// =========================

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// =========================
// AUTO-UPDATER
// =========================

function setupAutoUpdater(mainWindow) {
  if (process.env.NODE_ENV === "development") {
    console.log("Auto-updater désactivé en mode développement.");
    return;
  }

  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on("checking-for-update", () => {
    console.log("Vérification des mises à jour…");
  });

  autoUpdater.on("update-available", (info) => {
    console.log(`Mise à jour disponible : v${info.version}`);
    // Notification discrète dans la fenêtre
    if (!mainWindow.isDestroyed()) {
      mainWindow.webContents.executeJavaScript(`
        if (!document.getElementById('ed-update-banner')) {
          const banner = document.createElement('div');
          banner.id = 'ed-update-banner';
          banner.style.cssText = 'position:fixed;bottom:16px;right:16px;background:#1a6640;color:#7df5b0;padding:8px 16px;border-radius:8px;font-size:13px;z-index:99999;font-family:Segoe UI,sans-serif;box-shadow:0 4px 12px rgba(0,0,0,0.3);';
          banner.textContent = '⬇ Mise à jour en cours de téléchargement…';
          document.body.appendChild(banner);
        }
      `).catch(() => {});
    }
  });

  autoUpdater.on("update-not-available", () => {
    console.log("Application à jour.");
  });

  autoUpdater.on("update-downloaded", (info) => {
    console.log(`Mise à jour v${info.version} téléchargée.`);
    if (!mainWindow.isDestroyed()) {
      mainWindow.webContents.executeJavaScript(`
        const banner = document.getElementById('ed-update-banner');
        if (banner) {
          banner.textContent = '✓ Mise à jour prête — sera installée à la fermeture';
        }
      `).catch(() => {});
    }
  });

  autoUpdater.on("error", (err) => {
    console.error("Erreur auto-updater :", err.message);
  });

  // Vérifier au démarrage puis toutes les heures
  autoUpdater.checkForUpdates().catch((err) => {
    console.error("Impossible de vérifier les mises à jour :", err.message);
  });

  setInterval(() => {
    autoUpdater.checkForUpdates().catch((err) => {
      console.error("Erreur vérification périodique :", err.message);
    });
  }, 60 * 60 * 1000);
}

// =========================
// BADGE TASKBAR (notifications)
// =========================

let badgeCheckInterval = null;

// Sélecteurs à essayer dans l'ordre (fallback progressif)
const BADGE_SELECTORS = [
  "#menuId-5618 > li:nth-child(5) > ed-menu-block-item > div > a > span.badge.alert-danger.ed-menu-badge",
  "span.badge.alert-danger.ed-menu-badge",
  ".badge.alert-danger",
  ".ed-menu-badge",
];

async function updateBadge(page, mainWindow) {
  if (!page || mainWindow.isDestroyed()) return;

  try {
    const count = await page.evaluate((selectors) => {
      for (const selector of selectors) {
        try {
          const els = document.querySelectorAll(selector);
          if (els.length > 0) {
            let total = 0;
            els.forEach((el) => {
              const n = parseInt(el.textContent.trim(), 10);
              if (!isNaN(n)) total += n;
            });
            if (total > 0) return total;
          }
        } catch {
          // Sélecteur invalide, on passe au suivant
        }
      }
      return 0;
    }, BADGE_SELECTORS);

    if (process.platform === "win32") {
      if (count > 0) {
        // Overlay icon Windows (petit badge rouge)
        mainWindow.setOverlayIcon(
          createBadgeImage(count),
          `${count} notification(s)`
        );
      } else {
        mainWindow.setOverlayIcon(null, "");
      }
    }
  } catch (err) {
    // Silencieux — la page peut être en navigation
  }
}

/**
 * Crée une image NativeImage avec le nombre de notifications
 * Format : cercle rouge avec chiffre blanc, 20x20px
 */
function createBadgeImage(count) {
  const { nativeImage } = require("electron");
  const { createCanvas } = (() => {
    try {
      return require("canvas");
    } catch {
      return null;
    }
  })() || {};

  // Fallback si canvas n'est pas disponible : image SVG encodée
  if (!createCanvas) {
    const label = count > 99 ? "99+" : String(count);
    const svg = `
      <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20">
        <circle cx="10" cy="10" r="10" fill="#e94560"/>
        <text x="10" y="14" text-anchor="middle" font-family="Segoe UI,Arial" font-size="${label.length > 1 ? 8 : 11}" font-weight="bold" fill="white">${label}</text>
      </svg>
    `;
    return nativeImage.createFromDataURL(
      `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`
    );
  }

  // Avec canvas (optionnel, meilleur rendu)
  const canvas = createCanvas(20, 20);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#e94560";
  ctx.beginPath();
  ctx.arc(10, 10, 10, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "white";
  ctx.font = `bold ${count > 9 ? 8 : 11}px "Segoe UI"`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(count > 99 ? "99+" : String(count), 10, 10);

  return nativeImage.createFromDataURL(canvas.toDataURL());
}

function startBadgePolling(page, mainWindow) {
  // Vérifier toutes les 2 minutes
  badgeCheckInterval = setInterval(() => {
    updateBadge(page, mainWindow);
  }, 2 * 60 * 1000);

  // Premier check après 5 secondes (laisse le temps à la page de charger)
  setTimeout(() => updateBadge(page, mainWindow), 5000);
}

function stopBadgePolling() {
  if (badgeCheckInterval) {
    clearInterval(badgeCheckInterval);
    badgeCheckInterval = null;
  }
}

// =========================
// MAIN
// =========================

async function main() {
  const browser = await pie.connect(app, puppeteer);

  // =========================
  // EXTENSIONS
  // =========================

  const extensions = new ElectronChromeExtensions({
    session: session.defaultSession,
    license: "GPL-3.0",
  });

  const extensionPath = getCustomExtensionPath();
  console.log("Chargement extension :", extensionPath);

  if (fs.existsSync(extensionPath)) {
    const manifestPath = path.join(extensionPath, "manifest.json");

    if (fs.existsSync(manifestPath)) {
      try {
        if (BrowserWindow.addExtension) {
          BrowserWindow.addExtension(extensionPath);
        } else {
          await session.defaultSession.loadExtension(extensionPath);
        }
        console.log("Extension chargée !");
      } catch (err) {
        console.error("Erreur chargement extension :", err);
      }
    } else {
      console.error("manifest.json introuvable :", manifestPath);
    }
  } else {
    console.error("Dossier extension introuvable :", extensionPath);
  }

  // =========================
  // MAIN WINDOW
  // =========================

  const mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    icon: path.join(__dirname, "assets/icons/icon.ico"),
    webPreferences: {
      session: session.defaultSession,
      sandbox: true,
      contextIsolation: true,
      devTools: true,
    },
  });

  extensions.addTab(mainWindow.webContents, mainWindow);

  Menu.setApplicationMenu(null);

  // =========================
  // LIENS EXTERNES → POPUP
  // =========================

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    // URLs de téléchargement direct (API EcoleDirecte ou autres fichiers)
    const isDownload = 
      url.includes('api.ecoledirecte.com') ||
      /\.(pdf|docx?|xlsx?|pptx?|zip|rar|png|jpg|jpeg|gif)(\?|$)/i.test(url);
  
    if (isDownload) {
      // Déclencher le téléchargement natif Electron
      mainWindow.webContents.downloadURL(url);
      return { action: 'deny' };
    }
  
    if (url.startsWith('about:') || url.startsWith('devtools:')) {
      return { action: 'allow' };
    }
  
    createPopupWindow(url);
    return { action: 'deny' };
  });

  // =========================
  // RACCOURCIS CLAVIER
  // =========================

  mainWindow.on("focus", () => {
    // Navigation historique (uniquement quand la fenêtre principale a le focus)
    globalShortcut.register("Alt+Left", () => {
      if (!mainWindow.isDestroyed()) {
        mainWindow.webContents.goBack();
      }
    });

    globalShortcut.register("Alt+Right", () => {
      if (!mainWindow.isDestroyed()) {
        mainWindow.webContents.goForward();
      }
    });
  });

  mainWindow.on("blur", () => {
    globalShortcut.unregister("Alt+Left");
    globalShortcut.unregister("Alt+Right");
  });

  // Raccourcis permanents (toute l'app)
  app.on("browser-window-focus", (event, win) => {
    globalShortcut.register("F5", () => {
      const focused = BrowserWindow.getFocusedWindow();
      if (focused) focused.webContents.reload();
    });

    globalShortcut.register("F12", () => {
      const focused = BrowserWindow.getFocusedWindow();
      if (focused) focused.webContents.openDevTools({ mode: "detach" });
    });

    globalShortcut.register("CommandOrControl+R", () => {
      const focused = BrowserWindow.getFocusedWindow();
      if (focused) focused.webContents.reload();
    });
  });

  // =========================
  // LOAD URL
  // =========================

  const url = "https://www.ecoledirecte.com/login?cameFrom=%2FAccueil";
  await mainWindow.loadURL(url);

  // =========================
  // GET CREDS
  // =========================

  let { username, password } = getStoredCredentials();

  if (!username || !password) {
    const loginWindow = await createLoginWindow();

    ipcMain.once("submit-credentials", (event, credentials) => {
      username = credentials.username;
      password = credentials.password;
      storeCredentials(username, password);
      loginWindow.close();
    });

    await new Promise((resolve) => {
      loginWindow.on("closed", resolve);
    });
  } else {
    console.log("Identifiants déjà enregistrés !");
  }

  // =========================
  // PUPPETEER
  // =========================

  const page = await pie.getPage(browser, mainWindow);

  await page.waitForSelector("#username");
  await page.waitForSelector("#password");

  // =========================
  // CHECK AUTO-FILL
  // =========================

  const currentUsername = await page.$eval("#username", (el) => el.value);
  const currentPassword = await page.$eval("#password", (el) => el.value);

  console.log("Username field =", currentUsername);
  console.log("Password field =", currentPassword ? "[REMPLI]" : "[VIDE]");

  if (!currentUsername.trim()) {
    await page.type("#username", username);
  } else {
    console.log("Nom d'utilisateur déjà rempli.");
  }

  if (!currentPassword.trim()) {
    await page.type("#password", password);
  } else {
    console.log("Mot de passe déjà rempli.");
  }

  // =========================
  // REMEMBER ME
  // =========================

  try {
    const rememberMeChecked = await page.$eval(
      "#seSouvenirDeMoi",
      (el) => el.checked
    );

    if (!rememberMeChecked) {
      await page.click("#seSouvenirDeMoi");
    }
  } catch {
    console.warn("Checkbox souvenir introuvable.");
  }

  // =========================
  // LOGIN
  // =========================

  await page.click("#connexion");

  await page.waitForNavigation({
    waitUntil: "networkidle2",
  });

  console.log("Connexion réussie");

  await sleep(500);

  // =========================
  // RE-LOGIN AUTOMATIQUE
  // =========================

  await setupReloginWatcher(page, mainWindow, password);

  // =========================
  // BADGE TASKBAR
  // =========================

  startBadgePolling(page, mainWindow);

  // =========================
  // AUTO-UPDATER
  // =========================

  setupAutoUpdater(mainWindow);
}

// =========================
// RE-LOGIN WATCHER
// =========================

/**
 * Injecte un MutationObserver dans la page qui surveille l'apparition
 * du champ mot de passe (popup de session expirée).
 * Quand détecté, envoie un signal IPC pour remplir le password automatiquement.
 */
async function setupReloginWatcher(page, mainWindow, password) {
  // Injection du watcher dans la page courante et toutes les futures navigations
  await page.evaluateOnNewDocument(() => {
    let watcherActive = false;

    function startWatcher() {
      if (watcherActive) return;
      watcherActive = true;

      const observer = new MutationObserver(() => {
        // Cherche un champ password visible qui n'est PAS la page de login initiale
        const passwordFields = document.querySelectorAll(
          'input[type="password"]'
        );

        passwordFields.forEach((field) => {
          // Le champ doit être visible (offsetParent !== null)
          if (field.offsetParent !== null) {
            // Vérifier que ce n'est pas la page de login normale
            const isLoginPage = window.location.pathname.includes("/login");

            if (!isLoginPage) {
              // C'est la popup de re-connexion
              if (!field.dataset.edWatcherFired) {
                field.dataset.edWatcherFired = "1";
                window.dispatchEvent(
                  new CustomEvent("ed-relogin-needed", { detail: field.id })
                );
              }
            }
          }
        });
      });

      observer.observe(document.body, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ["style", "class"],
      });
    }

    // Démarrer quand la page est prête
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", startWatcher);
    } else {
      startWatcher();
    }
  });

  // Écouter l'événement depuis la page via exposeFunction
  await page.exposeFunction("__edTriggerRelogin", async () => {
    console.log("Re-login nécessaire détecté !");
    await performRelogin(page, password);
  });

  // Pont entre l'événement DOM et la fonction exposée
  await page.evaluate(() => {
    window.addEventListener("ed-relogin-needed", () => {
      if (typeof window.__edTriggerRelogin === "function") {
        window.__edTriggerRelogin();
      }
    });
  });

  // Fallback : surveiller aussi les navigations vers /login
  mainWindow.webContents.on("did-navigate", async (event, url) => {
    if (url.includes("/login")) {
      console.log("Redirection login détectée, re-login en cours…");
      await sleep(800);
      await performRelogin(page, password, true);
    }
  });
}

/**
 * Effectue le re-login :
 * - isFullLogin = true → remplit aussi le username (page de login complète)
 * - isFullLogin = false → remplit seulement le password (popup)
 */
async function performRelogin(page, password, isFullLogin = false) {
  try {
    // Attendre que le champ password soit disponible
    await page.waitForSelector('input[type="password"]', { timeout: 5000 });

    if (isFullLogin) {
      // Page de login complète : remplir username aussi
      const usernameField = await page.$("#username");
      if (usernameField) {
        const val = await page.$eval("#username", (el) => el.value);
        if (!val.trim()) {
          const { username } = getStoredCredentials();
          if (username) await page.type("#username", username);
        }
      }
    }

    // Remplir le password
    const passwordFields = await page.$$('input[type="password"]');
    for (const field of passwordFields) {
      const isVisible = await field.evaluate(
        (el) => el.offsetParent !== null
      );
      if (isVisible) {
        await field.click({ clickCount: 3 }); // Sélectionner tout
        await field.type(password);
        break;
      }
    }

    // Chercher le bouton de connexion
    const connectBtn =
      (await page.$("#connexion")) ||
      (await page.$('button[type="submit"]')) ||
      (await page.$(".btn-connexion"));

    if (connectBtn) {
      await connectBtn.click();
      console.log("Re-login effectué avec succès.");
    } else {
      console.warn("Bouton de connexion introuvable pour le re-login.");
    }
  } catch (err) {
    console.error("Erreur lors du re-login :", err.message);
  }
}

// =========================
// APP READY
// =========================

app.whenReady().then(() => {
  main().catch((err) => {
    console.error("Erreur lors du lancement :", err);
  });
});

// =========================
// WINDOWS
// =========================

app.on("window-all-closed", () => {
  stopBadgePolling();
  globalShortcut.unregisterAll();
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("will-quit", () => {
  stopBadgePolling();
  globalShortcut.unregisterAll();
});