// Politique d'ouverture de fenetre, sur les trois chemins qui comptent.
//
//   env -u ELECTRON_RUN_AS_NODE ./node_modules/.bin/electron scripts/diag-window-policy.js
//
// Couvre les deux fenetres parasites rapportees le 12/09/2026 :
//
//   - le lien externe clique DANS la <webview> d'un popup, qui ouvrait une
//     fenetre Electron nue, sans les boutons Copier / Navigateur ;
//   - la piece jointe en blob:, qui ouvrait une fenetre definitivement
//     blanche — mesure a l'appui, le document n'y fait que 159 octets vides.
//
// Et verifie qu'on n'a rien casse au passage : le chemin <a download>, par
// lequel EcoleDirecte livre reellement ses fichiers avec leur vrai nom,
// doit continuer de fonctionner.
const { app, BrowserWindow, session } = require("electron");
const http = require("http");
const path = require("path");
const fs = require("fs");
const os = require("os");

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const check = (name, ok, detail = "") => {
  results.push(ok);
  console.log(`${ok ? "OK  " : "ECHEC"} ${name}${detail ? " — " + detail : ""}`);
};

// PDF minimal mais valide, pour qu'Electron le traite comme un PDF.
const PDF = Buffer.from(
  "%PDF-1.1\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n" +
  "2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n" +
  "3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 99 99]>>endobj\n" +
  "trailer<</Root 1 0 R>>\n%%EOF\n", "latin1");

const server = http.createServer((req, res) => {
  if (req.url === "/telechargement.awp") {
    res.writeHead(200, { "Content-Type": "application/pdf", "Content-Length": String(PDF.length) });
    res.end(PDF);
    return;
  }
  if (req.url === "/externe") {
    res.writeHead(200, { "Content-Type": "text/html" });
    res.end("<body>page externe</body>");
    return;
  }
  res.writeHead(200, { "Content-Type": "text/html" });
  res.end(`<body style="font:15px sans-serif;padding:24px">
    <a id="ext" href="/externe" target="_blank">lien externe</a>
    <button id="fenetre">blob en nouvelle fenetre</button>
    <button id="download">blob avec attribut download</button>
    <script>
      async function blobUrl() {
        const r = await fetch("/telechargement.awp", { method: "POST" });
        return URL.createObjectURL(new Blob([await r.blob()], { type: "application/pdf" }));
      }
      // Chemin qui ouvrait la fenetre blanche.
      document.getElementById("fenetre").addEventListener("click", async () => {
        const a = document.createElement("a");
        a.href = await blobUrl(); a.target = "_blank"; a.rel = "noopener";
        document.body.appendChild(a); a.click();
      });
      // Chemin par lequel EcoleDirecte livre ses fichiers nommes.
      document.getElementById("download").addEventListener("click", async () => {
        const a = document.createElement("a");
        a.href = await blobUrl(); a.download = "Bulletin du 2e trimestre.pdf";
        document.body.appendChild(a); a.click();
      });
    </script>
  </body>`);
});

app.whenReady().then(async () => {
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const port = server.address().port;

  const { createPopupWindow } = require("../src/main/windows/popup-window");
  const { applyWindowPolicy } = require("../src/main/windows/window-policy");
  const { setupDownloads } = require("../src/main/features/downloads");
  const { getDownloadsWindow } = require("../src/main/windows/downloads-window");

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ed-policy-"));
  const main = new BrowserWindow({ width: 1000, height: 680, x: 80, y: 80 });
  applyWindowPolicy(main.webContents, { openPopup: createPopupWindow });
  setupDownloads(session.defaultSession, main, {
    downloadsDir: dir, reveal: () => {}, openFile: () => {},
  });

  const etrangeres = () => BrowserWindow.getAllWindows().filter(
    (w) => w !== main && w !== getDownloadsWindow() && !w.isDestroyed()
  );
  const estHabille = async (w) => w.webContents
    .executeJavaScript(`Boolean(document.getElementById("wv"))`, true)
    .catch(() => false);

  await main.loadURL(`http://127.0.0.1:${port}/`);

  // ---- 1. Lien externe depuis la fenetre principale -------------------
  await main.webContents.executeJavaScript(`document.getElementById("ext").click()`, true);
  await wait(2000);
  let ouvertes = etrangeres();
  check("un lien externe ouvre une fenetre, et une seule", ouvertes.length === 1,
    `${ouvertes.length}`);
  check("cette fenetre porte notre habillage",
    ouvertes.length === 1 && (await estHabille(ouvertes[0])));

  // ---- 2. Lien externe depuis la <webview> DU popup -------------------
  //
  // C'est le cas qui produisait une fenetre nue : la webview porte
  // allowpopups, mais n'heritait d'aucune politique.
  if (ouvertes.length === 1) {
    await ouvertes[0].webContents.executeJavaScript(`
      document.getElementById("wv").executeJavaScript('document.getElementsByTagName("a")[0] && 1')
    `, true).catch(() => null);
    await ouvertes[0].webContents.executeJavaScript(`
      document.getElementById("wv").loadURL("http://127.0.0.1:${port}/")
    `, true).catch(() => null);
    await wait(1800);
    await ouvertes[0].webContents.executeJavaScript(`
      document.getElementById("wv").executeJavaScript('document.getElementById("ext").click()')
    `, true).catch(() => null);
    await wait(2000);

    const depuisWebview = etrangeres().filter((w) => w !== ouvertes[0]);
    check("un lien dans la webview d'un popup ouvre un popup habille",
      depuisWebview.length === 1 && (await estHabille(depuisWebview[0])),
      `${depuisWebview.length} fenetre(s)`);
    for (const w of etrangeres()) w.destroy();
  }

  // ---- 3. Piece jointe blob: ------------------------------------------
  await wait(300);
  await main.webContents.executeJavaScript(`document.getElementById("fenetre").click()`, true);
  await wait(2000);
  check("un blob: n'ouvre plus de fenetre blanche", etrangeres().length === 0,
    `${etrangeres().length} fenetre(s)`);

  // ---- 4. Le chemin qui livre vraiment les fichiers -------------------
  await main.webContents.executeJavaScript(`document.getElementById("download").click()`, true);
  await wait(2000);
  const fichiers = fs.readdirSync(dir);
  check("le chemin <a download> livre toujours le fichier, avec son nom",
    fichiers.includes("Bulletin du 2e trimestre.pdf"), fichiers.join(", ") || "(aucun)");
  check("et sans laisser de fenetre derriere lui", etrangeres().length === 0,
    `${etrangeres().length} fenetre(s)`);

  server.close();
  fs.rmSync(dir, { recursive: true, force: true });
  const passed = results.filter(Boolean).length;
  console.log(`\n${passed}/${results.length} verifications passees.`);
  app.exit(passed === results.length ? 0 : 1);
}).catch((err) => {
  console.error("Diagnostic interrompu :", err && err.message);
  app.exit(1);
});
