// scripts/patch-extension.js
//
// Copie CustomDirecte/src vers .cache/extension/ puis patche la copie.
// Le submodule n'est jamais ecrit : il reste read-only.
//
// Idempotent par construction : on supprime, on recopie, on patche du neuf.
const fs = require("fs");
const path = require("path");

const SRC = path.join(__dirname, "..", "CustomDirecte", "src");
const DEST = path.join(__dirname, "..", ".cache", "extension");

// storage.sync n'existe pas sous Electron : on le remplace partout, ou que
// l'extension le range (la V3 l'a deplace dans browser.js, popupManager.js...).
const PATCHES = [["storage.sync", "storage.local"]];

if (!fs.existsSync(SRC)) {
  console.error(`[patch] Submodule absent : ${SRC}`);
  console.error("[patch] Lancez : git submodule update --init --recursive");
  process.exit(1);
}

fs.rmSync(DEST, { recursive: true, force: true });
fs.mkdirSync(DEST, { recursive: true });
fs.cpSync(SRC, DEST, { recursive: true });
console.log(`[patch] Copie ${SRC} -> ${DEST}`);

const jsFiles = fs
  .readdirSync(DEST, { recursive: true })
  .filter((f) => f.endsWith(".js"));

for (const relPath of jsFiles) {
  const file = path.join(DEST, relPath);
  let content = fs.readFileSync(file, "utf8");
  let total = 0;

  for (const [from, to] of PATCHES) {
    const count = content.split(from).length - 1;
    if (count > 0) {
      content = content.replaceAll(from, to);
      total += count;
    }
  }

  if (total > 0) {
    fs.writeFileSync(file, content, "utf8");
    console.log(`[patch] ${relPath} : ${total} remplacement(s)`);
  }
}

if (!fs.existsSync(path.join(DEST, "manifest.json"))) {
  console.error("[patch] manifest.json absent de la sortie !");
  process.exit(1);
}

console.log("[patch] Termine");
