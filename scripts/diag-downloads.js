// Telechargement reel de bout en bout, sur un serveur local.
//
//   env -u ELECTRON_RUN_AS_NODE ./node_modules/.bin/electron scripts/diag-downloads.js [dossier-de-sortie]
//
// Couvre les trois defauts rapportes le 12/09/2026 : le popup laisse blanc
// derriere un telechargement, l'impossibilite d'annuler, et l'aspect du
// panneau (deux captures sont ecrites dans le dossier de sortie).
//
// Le serveur local debite volontairement 8 Mio lentement : sans cela le
// telechargement se termine avant qu'on ait pu observer l'avancement ni
// cliquer sur Annuler.
const { app, BrowserWindow, session } = require("electron");
const http = require("http");
const path = require("path");
const fs = require("fs");
const os = require("os");

const ROOT = path.join(__dirname, "..");
const OUT = process.argv[2] || require("os").tmpdir();

const results = [];
const check = (name, ok, detail = "") => {
  results.push(ok);
  console.log(`${ok ? "OK  " : "ECHEC"} ${name}${detail ? " — " + detail : ""}`);
};
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// /slow : 8 Mio debites lentement, pour avoir le temps d'annuler.
// /fast : petit fichier, pour observer l'etat termine.
const server = http.createServer(async (req, res) => {
  if (req.url === "/slow") {
    const total = 8 * 1024 * 1024;
    res.writeHead(200, {
      "Content-Type": "application/octet-stream",
      "Content-Disposition": 'attachment; filename="gros-bulletin.pdf"',
      "Content-Length": String(total),
    });
    const chunk = Buffer.alloc(256 * 1024, 7);
    for (let sent = 0; sent < total; sent += chunk.length) {
      if (res.writableEnded) return;
      res.write(chunk);
      await wait(160);
    }
    res.end();
    return;
  }
  if (req.url === "/fast") {
    const body = Buffer.alloc(700 * 1024, 3);
    res.writeHead(200, {
      "Content-Type": "application/pdf",
      "Content-Disposition": 'attachment; filename="Bulletin du 2e trimestre.pdf"',
      "Content-Length": String(body.length),
    });
    res.end(body);
    return;
  }
  res.writeHead(200, { "Content-Type": "text/html" });
  res.end(`<body style="font:14px sans-serif;padding:20px">
    <a id="slow" href="/slow" target="_blank">lent</a>
    <a id="fast" href="/fast" target="_blank">rapide</a>
  </body>`);
});

app.whenReady().then(async () => {
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const port = server.address().port;

  const { createPopupWindow } = require(path.join(ROOT, "src/main/windows/popup-window.js"));
  const { setupDownloads } = require(path.join(ROOT, "src/main/features/downloads.js"));
  const { getDownloadsWindow } = require(path.join(ROOT, "src/main/windows/downloads-window.js"));

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ed-dl-"));
  let revealed = null;

  const main = new BrowserWindow({ width: 1100, height: 720, x: 60, y: 60 });
  main.webContents.setWindowOpenHandler(({ url }) => {
    createPopupWindow(url);
    return { action: "deny" };
  });

  setupDownloads(session.defaultSession, main, {
    downloadsDir: dir,
    reveal: (p) => { revealed = p; },
    openFile: () => {},
  });

  await main.loadURL(`http://127.0.0.1:${port}/`);

  // ---- Telechargement lent : popup blanc, panneau, annulation ---------
  await main.webContents.executeJavaScript(`document.getElementById("slow").click()`, true);
  // Electron rapporte 0 octet recu pendant la premiere seconde (verifie par
  // une sonde independante sur l item lui-meme) : echantillonner avant, c est
  // mesurer le tampon de Chromium, pas notre affichage.
  await wait(2000);

  const popupsLeft = BrowserWindow.getAllWindows().filter(
    (w) => w !== main && w !== getDownloadsWindow() && !w.isDestroyed()
  );
  check("le popup reste blanc est referme", popupsLeft.length === 0,
    `${popupsLeft.length} fenetre(s) parasite(s)`);

  const panel = getDownloadsWindow();
  check("le panneau de telechargement est ouvert", Boolean(panel) && panel.isVisible());
  check("le panneau ne vole pas le focus", Boolean(panel) && !panel.isFocused());

  const anchored = panel && (() => {
    const p = main.getBounds(), d = panel.getBounds();
    return Math.abs((p.x + p.width) - (d.x + d.width) - 16) <= 2
      && Math.abs((p.y + p.height) - (d.y + d.height) - 16) <= 2;
  })();
  check("le panneau est ancre en bas a droite de la fenetre", Boolean(anchored),
    panel ? `panneau ${JSON.stringify(panel.getBounds())}` : "-");

  const during = await panel.webContents.executeJavaScript(`({
    nom: document.querySelector(".dl__name")?.textContent,
    detail: document.querySelector(".dl__detail")?.textContent,
    largeur: document.querySelector(".dl__fill")?.style.width,
    actions: [...document.querySelectorAll(".dl__act")].map(b => b.textContent),
  })`, true);
  check("l'avancement est affiche", /%/.test(during.detail || ""), during.detail);
  check("la barre progresse", (during.largeur || "") !== "" && during.largeur !== "0%", during.largeur);
  check("seul « Annuler » est propose pendant le telechargement",
    JSON.stringify(during.actions) === '["Annuler"]', JSON.stringify(during.actions));

  fs.writeFileSync(path.join(OUT, "panneau-en-cours.png"),
    (await panel.webContents.capturePage()).toPNG());

  // Clic REEL sur Annuler, depuis le panneau.
  await panel.webContents.executeJavaScript(
    `[...document.querySelectorAll(".dl__act")].find(b => b.textContent === "Annuler").click()`, true);
  await wait(700);

  const after = await panel.webContents.executeJavaScript(`({
    detail: document.querySelector(".dl__detail")?.textContent,
    actions: [...document.querySelectorAll(".dl__act")].map(b => b.textContent),
  })`, true);
  check("l'annulation aboutit vraiment", /Annulé/.test(after.detail || ""), after.detail);
  check("plus aucune action apres annulation",
    JSON.stringify(after.actions) === "[]", JSON.stringify(after.actions));

  // ---- Telechargement rapide : etat termine --------------------------
  await main.webContents.executeJavaScript(`document.getElementById("fast").click()`, true);
  await wait(1500);

  const done = await panel.webContents.executeJavaScript(`({
    lignes: document.querySelectorAll(".dl__item").length,
    actions: [...document.querySelectorAll(".dl__item:last-child .dl__act")].map(b => b.textContent),
    detail: document.querySelector(".dl__item:last-child .dl__detail")?.textContent,
  })`, true);
  check("les deux telechargements sont listes", done.lignes === 2, `${done.lignes} ligne(s)`);
  check("un fichier pose propose Ouvrir et Dossier",
    JSON.stringify(done.actions) === '["Ouvrir","Dossier"]', JSON.stringify(done.actions));
  check("le fichier est bien sur le disque",
    fs.existsSync(path.join(dir, "Bulletin du 2e trimestre.pdf")), fs.readdirSync(dir).join(", "));
  check("l'explorateur n'est plus ouvert d'office", revealed === null,
    revealed === null ? "aucun reveal automatique" : String(revealed));

  fs.writeFileSync(path.join(OUT, "panneau-termine.png"),
    (await panel.webContents.capturePage()).toPNG());
  fs.writeFileSync(path.join(OUT, "fenetre-entiere.png"),
    (await main.capturePage()).toPNG());

  server.close();
  fs.rmSync(dir, { recursive: true, force: true });
  const passed = results.filter(Boolean).length;
  console.log(`\n${passed}/${results.length} verifications passees.`);
  app.exit(passed === results.length ? 0 : 1);
}).catch((err) => {
  console.error("Diagnostic interrompu :", err);
  app.exit(1);
});
