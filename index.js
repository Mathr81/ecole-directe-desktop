const { app, BrowserWindow, Menu, ipcMain, safeStorage, session } = require("electron");
const { ElectronChromeExtensions } = require("electron-chrome-extensions");
const pie = require("puppeteer-in-electron");
const puppeteer = require("puppeteer-core");
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

  const appPath = app.getAppPath();

  console.log("app.getAppPath():", appPath);

  const appInstallationRoot = path.dirname(path.dirname(appPath));

  const extensionPath = path.join(appInstallationRoot, "CustomDirecte");

  console.log("Extension path:", extensionPath);

  return extensionPath;
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
// UTILS
// =========================

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
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
    webPreferences: {
      session: session.defaultSession,
      sandbox: true,
      contextIsolation: true,
      devTools: true,
    },
  });

  extensions.addTab(mainWindow.webContents, mainWindow);

  Menu.setApplicationMenu(null);

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

  const currentUsername = await page.$eval(
    "#username",
    (el) => el.value
  );

  const currentPassword = await page.$eval(
    "#password",
    (el) => el.value
  );

  console.log("Username field =", currentUsername);
  console.log(
    "Password field =",
    currentPassword ? "[REMPLI]" : "[VIDE]"
  );

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
  if (process.platform !== "darwin") {
    app.quit();
  }
});