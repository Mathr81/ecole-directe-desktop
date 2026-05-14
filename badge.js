const { app, nativeImage } = require("electron");

let badgeCheckInterval = null;
const DEBUG_BADGE = process.env.NODE_ENV === "development";
function badgeLog(...args) { if (DEBUG_BADGE) console.log("[BADGE]", ...args); }

const BADGE_SELECTORS = [
  "#menuId-5618 > li:nth-child(5) > ed-menu-block-item > div > a > span.badge.alert-danger.ed-menu-badge",
  "span.badge.alert-danger.ed-menu-badge",
  ".badge.alert-danger",
  ".ed-menu-badge",
];

async function updateBadge(page, mainWindow) {
  if (!page) { badgeLog("Page absente"); return; }
  if (mainWindow.isDestroyed()) { badgeLog("Fenetre detruite"); return; }
  try {
    badgeLog("Verification du badge...");
    const result = await page.evaluate((selectors) => {
      const debug = [];
      for (const selector of selectors) {
        try {
          const els = document.querySelectorAll(selector);
          debug.push({ selector, found: els.length, values: Array.from(els).map((el) => el.textContent.trim()) });
          if (els.length > 0) {
            let total = 0;
            els.forEach((el) => { const n = parseInt(el.textContent.trim(), 10); if (!isNaN(n)) total += n; });
            if (total > 0) return { count: total, matchedSelector: selector, debug };
          }
        } catch (e) { debug.push({ selector, error: String(e) }); }
      }
      return { count: 0, matchedSelector: null, debug };
    }, BADGE_SELECTORS);
    badgeLog("Resultat :", result);
    const count = result.count;
    if (process.platform === "darwin" || process.platform === "linux") {
      try { app.setBadgeCount(count); badgeLog("setBadgeCount(" + count + ")"); }
      catch (e) { badgeLog("setBadgeCount non supporte :", e.message); }
    }
    if (process.platform === "win32") {
      if (count > 0) { mainWindow.setOverlayIcon(createBadgeImage(count), count + " notification(s)"); badgeLog("Overlay applique"); }
      else { mainWindow.setOverlayIcon(null, ""); badgeLog("Overlay supprime"); }
    }
  } catch (err) { badgeLog("Erreur updateBadge :", err); }
}

function createBadgeImage(count) {
  badgeLog("Creation image badge :", count);
  const label = count > 99 ? "99+" : String(count);
  try {
    const { createCanvas } = require("canvas");
    const size = 32;
    const canvas = createCanvas(size, size);
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#e94560";
    ctx.beginPath(); ctx.arc(size/2, size/2, size/2, 0, Math.PI*2); ctx.fill();
    ctx.fillStyle = "white";
    ctx.font = "bold " + (label.length > 1 ? 14 : 18) + "px sans-serif";
    ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.fillText(label, size/2, size/2);
    const img = nativeImage.createFromBuffer(canvas.toBuffer("image/png"));
    badgeLog("Canvas OK :", img.isEmpty() ? "VIDE" : "OK");
    return img;
  } catch (e) { badgeLog("Canvas indisponible :", e.message); }
  badgeLog("Fallback bitmap");
  const size = 16;
  const buf = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const idx = (y*size+x)*4;
      const dx = x - size/2 + 0.5, dy = y - size/2 + 0.5;
      if (Math.sqrt(dx*dx+dy*dy) <= size/2) { buf[idx]=233; buf[idx+1]=69; buf[idx+2]=96; buf[idx+3]=255; }
    }
  }
  const img = nativeImage.createFromBitmap(buf, { width: size, height: size });
  badgeLog("Bitmap :", img.isEmpty() ? "VIDE" : "OK");
  return img;
}

function startBadgePolling(page, mainWindow) {
  badgeLog("Demarrage polling badge");
  badgeCheckInterval = setInterval(() => { badgeLog("Tick"); updateBadge(page, mainWindow); }, 2*60*1000);
  setTimeout(() => { badgeLog("Premier check"); updateBadge(page, mainWindow); }, 5000);
}

function stopBadgePolling() {
  if (badgeCheckInterval) { clearInterval(badgeCheckInterval); badgeCheckInterval = null; }
}

module.exports = { startBadgePolling, stopBadgePolling, updateBadge };