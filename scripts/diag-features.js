// Verifie sous Electron ce que les tests unitaires ne peuvent pas voir :
// que les API reellement appelees existent et se comportent comme prevu.
//
//   env -u ELECTRON_RUN_AS_NODE ./node_modules/.bin/electron scripts/diag-features.js
//
// Ne journalise aucun secret : uniquement des dimensions et des comptes.
const { app, BrowserWindow, screen, session } = require("electron");
const path = require("path");
const fs = require("fs");
const os = require("os");

const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok, detail });
  console.log(`${ok ? "OK  " : "ECHEC"} ${name}${detail ? " — " + detail : ""}`);
};

app.whenReady().then(async () => {
  const { saveWindowState, loadWindowState } = require("../src/main/lib/window-state");
  const { setupDownloads } = require("../src/main/features/downloads");
  const { showPalette } = require("../src/main/windows/palette-window");
  const { normalizeLinks } = require("../src/main/features/palette");
  const { nextZoom } = require("../src/main/features/shortcuts");

  const displays = screen.getAllDisplays();
  check("screen.getAllDisplays fournit un workArea", Boolean(displays[0] && displays[0].workArea),
    `${displays.length} écran(s)`);

  // ---- Geometrie : aller-retour complet sur le disque ----------------
  saveWindowState("diag", { width: 1234, height: 567, x: 42, y: 24, maximized: false, zoom: 1.25 });
  const reloaded = loadWindowState("diag", displays);
  check("l'etat de fenetre fait l'aller-retour",
    reloaded && reloaded.width === 1234 && reloaded.x === 42 && reloaded.zoom === 1.25,
    JSON.stringify(reloaded));

  // Une position sur un ecran absent doit etre abandonnee, pas restauree.
  saveWindowState("diag2", { width: 800, height: 600, x: 99999, y: 99999 });
  const offscreen = loadWindowState("diag2", displays);
  check("une position hors ecran est abandonnee", offscreen && offscreen.hasPosition === false);

  // ---- Fenetre reelle : les API de bornes existent-elles ? -----------
  const win = new BrowserWindow({ width: 900, height: 700, show: false, webPreferences: { sandbox: true } });
  await win.loadURL("data:text/html,<a href='https://www.ecoledirecte.com/Eleves/1/Notes'>Notes</a><a href='https://www.ecoledirecte.com/Eleves/1/Messagerie'>Messagerie</a>");

  const bounds = win.getNormalBounds();
  check("getNormalBounds renvoie des bornes", Number.isFinite(bounds.width) && bounds.width > 0,
    `${bounds.width}x${bounds.height}`);

  win.webContents.setZoomFactor(nextZoom(1, 1));
  check("setZoomFactor / getZoomFactor s'accordent",
    Math.abs(win.webContents.getZoomFactor() - 1.1) < 0.001,
    String(win.webContents.getZoomFactor().toFixed(3)));

  // ---- Releve des liens de la palette --------------------------------
  const raw = await win.webContents.executeJavaScript(
    `Array.from(document.querySelectorAll("a[href]")).map(a => ({ href: a.href, text: a.textContent }))`, true);
  const entries = normalizeLinks(raw);
  check("la palette releve les liens de la page", entries.length === 2,
    entries.map((e) => e.label).join(", "));

  const palette = await showPalette(win);
  check("la fenetre de palette s'ouvre", Boolean(palette) && !palette.isDestroyed());
  if (palette) palette.destroy();

  // ---- La vraie fenetre principale, avec sa geometrie restauree -------
  //
  // C'est le chemin de code que l'application emprunte au demarrage : s'il
  // leve, l'application ne s'ouvre pas du tout.
  const { createMainWindow } = require("../src/main/windows/main-window");
  saveWindowState("main", { width: 1111, height: 777, maximized: false, zoom: 1 });
  let mainWin = null;
  try {
    mainWin = createMainWindow();
    const b = mainWin.getBounds();
    check("createMainWindow restaure la taille enregistree",
      Math.abs(b.width - 1111) <= 2 && Math.abs(b.height - 777) <= 2, `${b.width}x${b.height}`);
  } catch (err) {
    check("createMainWindow restaure la taille enregistree", false, err.message);
  }
  if (mainWin && !mainWin.isDestroyed()) mainWin.destroy();

  // ---- Telechargements ------------------------------------------------
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ed-dl-"));
  let handlerInstalled = false;
  const testSession = session.fromPartition("persist:diag-features");
  testSession.on("will-download", () => { handlerInstalled = true; });
  setupDownloads(testSession, win, { downloadsDir: dir, reveal: () => {} });
  check("le gestionnaire de telechargement s'installe sans erreur", true, dir);
  fs.rmSync(dir, { recursive: true, force: true });

  win.destroy();

  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} verifications passees.`);
  app.exit(failed.length === 0 ? 0 : 1);
}).catch((err) => {
  console.error("Diagnostic interrompu :", err);
  app.exit(1);
});
