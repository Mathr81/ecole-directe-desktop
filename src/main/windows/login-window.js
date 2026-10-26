const { BrowserWindow } = require("electron");
const path = require("path");
const { fitWindowToContent } = require("./fit-to-content");

// Largeur fixe : un formulaire de deux champs ne gagne rien a s'elargir.
// La hauteur, elle, est calculee sur le contenu reel.
const WIDTH = 420;
const MIN_HEIGHT = 260;
const MAX_HEIGHT = 420;

async function createLoginWindow(parent) {
  const loginWindow = new BrowserWindow({
    width: WIDTH,
    height: MIN_HEIGHT,
    minWidth: WIDTH,
    minHeight: MIN_HEIGHT,
    // Les dimensions decrivent la zone utile, pas le cadre : sans cela la
    // bordure et la barre de titre rognent le contenu.
    useContentSize: true,
    resizable: false,
    // Une fenetre modale sans parent est invalide : on ne rend modal que
    // s'il y a effectivement un parent.
    modal: Boolean(parent),
    parent: parent || undefined,
    title: "Connexion",
    webPreferences: { sandbox: true, contextIsolation: true, preload: path.join(__dirname, "..", "..", "preload", "ui.js") },
  });

  await loginWindow.loadFile(
    path.join(__dirname, "..", "..", "renderer", "login", "login.html")
  );
  await fitWindowToContent(loginWindow, {
    width: WIDTH,
    minHeight: MIN_HEIGHT,
    maxHeight: MAX_HEIGHT,
  });

  return loginWindow;
}

module.exports = { createLoginWindow };
