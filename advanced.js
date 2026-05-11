const { app, BrowserWindow, Menu, ipcMain, safeStorage, session } = require("electron");
const { ElectronChromeExtensions } = require("electron-chrome-extensions");
const pie = require("puppeteer-in-electron");
const puppeteer = require("puppeteer-core");
const fs = require('fs');
const path = require('path');

// --- Logging Setup ---
const logFilePath = path.join(app.getPath('userData'), 'app.log');
const logStream = fs.createWriteStream(logFilePath, { flags: 'a' });

const originalConsoleLog = console.log;
const originalConsoleWarn = console.warn;
const originalConsoleError = console.error;

console.log = (...args) => {
  originalConsoleLog(...args);
  logStream.write(`[LOG] ${new Date().toISOString()} ${args.join(' ')}\n`);
};

console.warn = (...args) => {
  originalConsoleWarn(...args);
  logStream.write(`[WARN] ${new Date().toISOString()} ${args.join(' ')}\n`);
};

console.error = (...args) => {
  originalConsoleError(...args);
  logStream.write(`[ERROR] ${new Date().toISOString()} ${args.join(' ')}\n`);
};
// --- End Logging Setup ---

let userDataPath;

if (process.env.NODE_ENV === "development") {
  userDataPath = path.join(__dirname, "userData");
  if (!fs.existsSync(userDataPath)) fs.mkdirSync(userDataPath, { recursive: true });
  app.setPath("userData", userDataPath);
} else {
  userDataPath = app.getPath("userData");
}

const getCustomExtensionPath = () => {
  if (process.env.NODE_ENV === "development") {
    return path.join(__dirname, "CustomDirecte"); // dev
  } else {
    const appPath = app.getAppPath();
    console.log("app.getAppPath():", appPath);

    // Basé sur l'entrée de l'utilisateur, CustomDirecte est à la racine de l'installation de l'application.
    // app.getAppPath() renvoie le chemin vers app.asar (par exemple, .../resources/app.asar)
    // Nous devons remonter de deux niveaux pour atteindre la racine de l'installation de l'application.
    const appInstallationRoot = path.dirname(path.dirname(appPath));
    let correctExtensionPath = path.join(appInstallationRoot, "CustomDirecte");

    console.log("Racine d'installation de l'application calculée :", appInstallationRoot);
    console.log("Chemin d'extension correct calculé :", correctExtensionPath);

    if (fs.existsSync(correctExtensionPath)) {
      return correctExtensionPath;
    } else {
      console.error("Chemin d'extension correct non trouvé :", correctExtensionPath);
      // Fallback vers la logique précédente si pour une raison quelconque ce qui précède est incorrect
      // Cela ne devrait idéalement pas être atteint si le chemin de l'utilisateur est précis.
      const dirnameAppPath = path.dirname(appPath);
      let unpackedExtensionPath = path.join(dirnameAppPath, "CustomDirecte");
      console.warn("Tentative de chemin décompressé (dans resources, probablement non trouvé) :", unpackedExtensionPath);
      if (fs.existsSync(unpackedExtensionPath)) {
        return unpackedExtensionPath;
      } else {
        let fallbackInsideAsar = path.join(appPath, "CustomDirecte");
        console.warn("Tentative de chemin de secours (dans app.asar, susceptible d'échouer) :", fallbackInsideAsar);
        if (fs.existsSync(fallbackInsideAsar)) {
          return fallbackInsideAsar;
        } else {
          console.error("Tous les chemins d'extension potentiels ont échoué.");
          return "";
        }
      }
    }
  }
};

pie.initialize(app);

const credentialsPath = path.join(app.getPath('userData'), 'credentials.json');

function getStoredCredentials() {
  if (fs.existsSync(credentialsPath)) {
    const data = JSON.parse(fs.readFileSync(credentialsPath));
    if (data.username && data.password) {
      const username = safeStorage.isEncryptionAvailable() ? safeStorage.decryptString(Buffer.from(data.username, 'base64')) : null;
      const password = safeStorage.isEncryptionAvailable() ? safeStorage.decryptString(Buffer.from(data.password, 'base64')) : null;
      return { username, password };
    }
  }
  return { username: null, password: null };
}

function storeCredentials(username, password) {
  if (safeStorage.isEncryptionAvailable()) {
    const encryptedUsername = safeStorage.encryptString(username).toString('base64');
    const encryptedPassword = safeStorage.encryptString(password).toString('base64');
    fs.writeFileSync(credentialsPath, JSON.stringify({ username: encryptedUsername, password: encryptedPassword }));
  } else {
    console.error("Le chiffrement n'est pas disponible sur ce système.");
  }
}

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

  loginWindow.loadFile('login.html');
  return loginWindow;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const main = async () => {
  const browser = await pie.connect(app, puppeteer);

  // --- INITIALISATION EXTENSIONS ---
  const extensions = new ElectronChromeExtensions({ session: session.defaultSession, license: 'GPL-3.0' });

  // --- CHARGEMENT DE L’EXTENSION CUSTOMDIRECTE ---
  const extensionPath = getCustomExtensionPath();
  if (fs.existsSync(extensionPath)) {
    try {
      const ext = BrowserWindow.addExtension
        ? BrowserWindow.addExtension(extensionPath)  // Electron < v35
        : session.defaultSession.loadExtension(extensionPath); // Electron >= v35
      console.log("Extension chargée :", extensionPath);
    } catch (err) {
      console.error("Erreur lors du chargement de l'extension :", err);
    }
  } else {
    console.warn("Dossier d'extension introuvable :", extensionPath);
  }

  // --- CREATION FENÊTRE PRINCIPALE ---
  const mainWindow = new BrowserWindow({
    webPreferences: {
      session: session.defaultSession,
      sandbox: true,
      contextIsolation: true,
      devTools: true
    },
  });

  extensions.addTab(mainWindow.webContents, mainWindow);

  Menu.setApplicationMenu(null);
  const url = "https://www.ecoledirecte.com/login?cameFrom=%2FAccueil";
  await mainWindow.loadURL(url);

  let { username, password } = getStoredCredentials();

  if (!username || !password) {
    const loginWindow = await createLoginWindow();

    ipcMain.once('submit-credentials', (event, credentials) => {
      username = credentials.username;
      password = credentials.password;
      storeCredentials(username, password);
      loginWindow.close();
    });

    await new Promise((resolve) => {
      loginWindow.on('closed', resolve);
    });
  } else {
    console.log("Identifiants déjà enregistrés !");
  }

  const page = await pie.getPage(browser, mainWindow);

  const currentUsername = await page.$eval("#username", el => el.value);
  const currentPassword = await page.$eval("#password", el => el.value);

  if (!currentUsername.trim()) {
	await page.type("#username", username);
  } else {
	console.log("Nom d'utilisateur déjà rempli");
  }

  if (!currentPassword.trim()) {
	await page.type("#password", password);
  } else {
	console.log("Mot de passe déjà rempli");
  }
  
  await page.click("#seSouvenirDeMoi");
  await page.click("#connexion");
  await page.waitForNavigation();

  console.log("Connexion réussie");
  await sleep(500);
};

app.whenReady().then(() => {
  main().catch((err) => console.error("Erreur lors de la connexion :", err));
});
