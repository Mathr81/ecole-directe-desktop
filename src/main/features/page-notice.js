// Bandeau discret pose dans la page du site.
//
// L'application n'a pas de barre d'etat a elle : le site occupe toute la
// fenetre. Pour dire quelque chose sans ouvrir une fenetre — reconnexion en
// cours, telechargement en cours — on pose un bandeau dans le document.
//
// Les valeurs reprennent les jetons de src/renderer/shared/tokens.css.
// Elles sont dupliquees ici parce que la page appartient a EcoleDirecte :
// on ne peut pas y injecter notre feuille de style sans risquer de
// perturber la sienne.
const TONES = {
  info: { color: "#ffffff", background: "#0f8fd1" },   // --ed-accent
  done: { color: "#ffffff", background: "#1a6640" },   // vert de confirmation
  error: { color: "#ffffff", background: "#b02a37" },  // --ed-danger
};

// Trois emplacements, choisis pour que deux avis simultanes ne se
// recouvrent jamais : le bandeau pleine largeur en haut reste reserve aux
// interruptions (reconnexion), les pastilles du bas portent l'information
// d'appoint, chacune dans son coin.
const PLACEMENTS = {
  top: ["top:0", "left:0", "right:0", "padding:8px 12px", "text-align:center"],
  "bottom-left": ["bottom:12px", "left:12px", "padding:6px 12px", "border-radius:12px"],
  "bottom-right": ["bottom:12px", "right:12px", "padding:6px 12px", "border-radius:12px"],
};

function styleFor(tone, placement = "top") {
  const palette = TONES[tone] || TONES.info;
  return [
    "position:fixed",
    ...(PLACEMENTS[placement] || PLACEMENTS.top),
    "z-index:99999",
    `color:${palette.color}`,
    `background:${palette.background}`,
    "font-family:Tahoma,Helvetica,Arial,sans-serif",
    "font-size:12px",
    // Une pastille ne doit pas intercepter les clics destines au site.
    "pointer-events:none",
  ].join(";");
}

function showNotice(win, id, message, { tone = "info", placement = "top" } = {}) {
  if (!win || win.isDestroyed()) return;
  win.webContents.executeJavaScript(`
    (() => {
      let notice = document.getElementById(${JSON.stringify(id)});
      if (!notice) {
        notice = document.createElement('div');
        notice.id = ${JSON.stringify(id)};
        document.body.appendChild(notice);
      }
      notice.style.cssText = ${JSON.stringify(styleFor(tone, placement))};
      notice.textContent = ${JSON.stringify(String(message))};
    })()
  `).catch(() => {});
}

function clearNotice(win, id) {
  if (!win || win.isDestroyed()) return;
  win.webContents.executeJavaScript(`
    (() => {
      const notice = document.getElementById(${JSON.stringify(id)});
      if (notice) notice.remove();
    })()
  `).catch(() => {});
}

module.exports = { showNotice, clearNotice, styleFor, TONES, PLACEMENTS };
