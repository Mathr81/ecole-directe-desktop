const fs = require("fs");
const path = require("path");

// Au-dela de cette taille le journal est archive en .1 et reparti a zero.
// Sans cela le fichier grossit indefiniment : il depassait 200 Ko apres un an.
const MAX_BYTES = 1024 * 1024;

/**
 * Rend un argument de console lisible dans le fichier.
 *
 * `args.join(" ")` ecrasait les objets en "[object Object]" et perdait la
 * pile des erreurs, ce qui rendait les journaux d'echec inexploitables.
 */
function stringify(value) {
  if (value instanceof Error) return value.stack || `${value.name}: ${value.message}`;
  if (typeof value === "string") return value;
  if (value === null) return "null";
  if (value === undefined) return "undefined";
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function formatLine(level, args, now = new Date()) {
  return `[${level}] ${now.toISOString()} ${args.map(stringify).join(" ")}\n`;
}

function shouldRotate(currentSize, incomingLength, maxBytes = MAX_BYTES) {
  return currentSize > 0 && currentSize + incomingLength > maxBytes;
}

function rotate(file) {
  try {
    fs.renameSync(file, `${file}.1`);
  } catch {
    // Archive impossible (fichier verrouille) : on tronque plutot que
    // de laisser grossir sans fin.
    try { fs.truncateSync(file, 0); } catch { /* tant pis */ }
  }
}

/**
 * Duplique la console vers app.log. A appeler une seule fois, au demarrage.
 *
 * Les ecritures sont SYNCHRONES et c'est deliberе : la version precedente
 * utilisait un createWriteStream bufferise, et tout ce qui etait journalise
 * pendant la fermeture de l'application etait perdu avec le buffer. C'est
 * precisement ce qui a rendu invisible l'echec d'installation de la mise a
 * jour, qui se produit sur l'evenement `quit`. Le volume est faible : un
 * appendFileSync par ligne est un cout negligeable ici.
 */
function initLogger(userDataPath) {
  const file = path.join(userDataPath, "app.log");

  const original = { log: console.log, warn: console.warn, error: console.error };

  const write = (level, args) => {
    const line = formatLine(level, args);
    try {
      let size = 0;
      try { size = fs.statSync(file).size; } catch { /* pas encore de fichier */ }
      if (shouldRotate(size, line.length)) rotate(file);
      fs.appendFileSync(file, line);
    } catch {
      // Journaliser ne doit jamais faire tomber l'application.
    }
  };

  const tee = (level, fn) => (...args) => {
    fn(...args);
    write(level, args);
  };

  console.log = tee("LOG", original.log);
  console.warn = tee("WARN", original.warn);
  console.error = tee("ERROR", original.error);

  return { file, write };
}

module.exports = { initLogger, formatLine, stringify, shouldRotate, MAX_BYTES };
