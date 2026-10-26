// Recherche de la palette de navigation (Ctrl+K).
//
// Les destinations ne sont pas ecrites en dur : elles sont relevees sur les
// liens de la page elle-meme. Un menu qui change cote EcoleDirecte fait
// donc varier la palette sans qu'on ait a la maintenir — et surtout, on ne
// propose jamais une route qui n'existe plus. Le projet a deja paye le prix
// des selecteurs DOM figes avec l'ancienne lecture du badge : ici on ne
// depend d'aucune classe, seulement de <a href>.

const MAX_LABEL = 60;
const DEFAULT_LIMIT = 12;

/** Minuscule sans accents : « Vie scolaire » doit repondre a « vie sco ». */
function fold(text) {
  return String(text || "")
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .trim();
}

/**
 * Nettoie ce que la page a rendu.
 *
 * Les menus contiennent des ancres, des liens javascript: et des doublons
 * (icone + libelle pointant au meme endroit). On garde la premiere
 * occurrence de chaque destination, celle dont le libelle est le plus
 * souvent le bon.
 */
function normalizeLinks(rawLinks, origin = "https://www.ecoledirecte.com") {
  const seen = new Set();
  const out = [];

  for (const link of Array.isArray(rawLinks) ? rawLinks : []) {
    if (!link || typeof link.href !== "string") continue;

    const href = link.href.trim();
    if (!href || href.startsWith("javascript:") || href.startsWith("#")) continue;
    if (!href.startsWith(origin)) continue;
    // Une ancre pure renvoie sur la page courante : rien a proposer.
    if (href.replace(origin, "").startsWith("#")) continue;

    const label = String(link.text || "").replace(/\s+/g, " ").trim().slice(0, MAX_LABEL);
    if (!label) continue;

    if (seen.has(href)) continue;
    seen.add(href);
    out.push({ href, label });
  }

  return out;
}

/**
 * Score d'une entree pour une requete, ou -1 si elle ne correspond pas.
 *
 * Trois qualites de correspondance, de la meilleure a la moins bonne :
 * le libelle commence par la requete, il la contient, ou ses lettres
 * apparaissent dans l'ordre (« cdt » trouve « Cahier De Texte »).
 */
function scoreEntry(entry, query) {
  const q = fold(query);
  if (!q) return 0;

  const label = fold(entry.label);
  if (label.startsWith(q)) return 1000 - label.length;
  if (label.includes(q)) return 500 - label.length;

  let i = 0;
  for (const char of label) {
    if (char === q[i]) i += 1;
    if (i === q.length) return 100 - label.length;
  }
  return -1;
}

/**
 * Entrees correspondantes, les meilleures d'abord. A requete vide, on rend
 * la liste dans l'ordre de la page : c'est l'ordre du menu, deja pense.
 */
function filterEntries(entries, query, limit = DEFAULT_LIMIT) {
  const list = Array.isArray(entries) ? entries : [];
  if (!fold(query)) return list.slice(0, limit);

  return list
    .map((entry, index) => ({ entry, index, score: scoreEntry(entry, query) }))
    .filter((row) => row.score >= 0)
    // A score egal, l'ordre de la page tranche : un tri stable garde le
    // menu dans son ordre naturel.
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .slice(0, limit)
    .map((row) => row.entry);
}

// Aussi charge tel quel dans la fenetre palette, ou `module` n'existe pas.
if (typeof module !== "undefined") module.exports = { normalizeLinks, filterEntries, scoreEntry, fold, MAX_LABEL, DEFAULT_LIMIT };
