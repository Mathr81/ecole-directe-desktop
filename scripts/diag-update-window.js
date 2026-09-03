// Verifie que les deux nouveaux renderers peignent reellement quelque chose.
//
//   env -u ELECTRON_RUN_AS_NODE ./node_modules/.bin/electron scripts/diag-update-window.js
//
// Un renderer qui leve (require introuvable, typiquement) affiche une page
// blanche sans erreur visible cote processus principal : c'est exactement le
// genre de panne qu'un test unitaire ne voit pas.
const { app, BrowserWindow, ipcMain } = require("electron");
const path = require("path");

// Electron avertit en developpement que la page n'a pas de CSP. Toutes les
// fenetres maison du projet sont dans ce cas (script inline), et le message
// precise lui-meme qu'il disparait une fois l'application empaquetee.
const isDevOnlyWarning = (message) => /Electron Security Warning/.test(message);

const results = [];
const check = (name, ok, detail = "") => {
  results.push(ok);
  console.log(`${ok ? "OK  " : "ECHEC"} ${name}${detail ? " — " + detail : ""}`);
};

app.whenReady().then(async () => {
  const { describe, createUpdateState } = require("../src/main/features/update-state");

  // ---- Fenetre de mise a jour ----------------------------------------
  const errors = [];
  const win = new BrowserWindow({
    width: 420, height: 260, show: false,
    webPreferences: { nodeIntegration: true, contextIsolation: false },
  });
  win.webContents.on("console-message", (event) => {
    if (event.level === "error" && !isDevOnlyWarning(event.message)) errors.push(event.message);
  });

  await win.loadFile(path.join(__dirname, "..", "src", "renderer", "update", "update.html"));

  const state = createUpdateState();
  state.downloaded("2.3.0", 3);
  win.webContents.send("update:view", describe(state.value), 100);
  await new Promise((r) => setTimeout(r, 200));

  const painted = await win.webContents.executeJavaScript(`({
    title: document.getElementById("title").textContent,
    detail: document.getElementById("detail").textContent,
    installVisible: !document.getElementById("install").hidden,
    manualVisible: !document.getElementById("manual").hidden,
  })`, true);

  check("le titre porte la version", /2\.3\.0/.test(painted.title), painted.title);
  check("le bouton d'installation est propose", painted.installVisible === true);
  check("apres echecs repetes, l'installateur manuel apparait", painted.manualVisible === true);
  check("le detail explique la situation", /échoué 2 fois/.test(painted.detail), painted.detail);
  check("aucune erreur console dans le renderer", errors.length === 0, errors.join(" | "));

  // ---- Palette : le require du module partage passe-t-il ? ------------
  const perrors = [];
  const pal = new BrowserWindow({
    width: 520, height: 380, show: false,
    webPreferences: { nodeIntegration: true, contextIsolation: false },
  });
  pal.webContents.on("console-message", (event) => {
    if (event.level === "error" && !isDevOnlyWarning(event.message)) perrors.push(event.message);
  });
  await pal.loadFile(path.join(__dirname, "..", "src", "renderer", "palette", "palette.html"));

  pal.webContents.send("palette:entries", [
    { href: "https://www.ecoledirecte.com/Eleves/1/Notes", label: "Notes" },
    { href: "https://www.ecoledirecte.com/Eleves/1/Messagerie", label: "Messagerie" },
    { href: "https://www.ecoledirecte.com/Eleves/1/CahierDeTexte", label: "Cahier de texte" },
  ]);
  await new Promise((r) => setTimeout(r, 200));

  const listed = await pal.webContents.executeJavaScript(
    `document.getElementById("list").children.length`, true);
  check("la palette peint ses entrees (donc son require a abouti)", listed === 3, `${listed} entrées`);

  // Filtrage par initiales, via la MEME fonction que le processus principal.
  await pal.webContents.executeJavaScript(`(() => {
    const i = document.getElementById("query");
    i.value = "cdt";
    i.dispatchEvent(new Event("input"));
  })()`, true);
  await new Promise((r) => setTimeout(r, 100));

  const filtered = await pal.webContents.executeJavaScript(
    `[...document.getElementById("list").children].map(li => li.textContent)`, true);
  check("le filtrage par initiales fonctionne dans la fenetre", 
    filtered.length === 1 && filtered[0] === "Cahier de texte", filtered.join(", "));
  check("aucune erreur console dans la palette", perrors.length === 0, perrors.join(" | "));

  win.destroy();
  pal.destroy();

  const passed = results.filter(Boolean).length;
  console.log(`\n${passed}/${results.length} verifications passees.`);
  app.exit(passed === results.length ? 0 : 1);
}).catch((err) => {
  console.error("Diagnostic interrompu :", err);
  app.exit(1);
});
