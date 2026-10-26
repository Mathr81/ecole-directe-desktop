const { BrowserWindow } = require("electron");
const path = require("path");
const { fitWindowToContent } = require("./fit-to-content");

// La question et les propositions viennent de l'API : leur longueur varie
// fortement. La hauteur s'adapte au contenu jusqu'a un maximum, au-dela
// duquel .ed-body defile. Les actions, hors de ce conteneur, restent
// toujours visibles.
const WIDTH = 480;
const MIN_HEIGHT = 320;
const MAX_HEIGHT = 620;

async function createTwoFaWindow(parent, { question, propositions }) {
  const twoFaWindow = new BrowserWindow({
    width: WIDTH,
    height: MIN_HEIGHT,
    minWidth: WIDTH,
    minHeight: MIN_HEIGHT,
    useContentSize: true,
    modal: Boolean(parent),
    parent: parent || undefined,
    title: "Double authentification",
    webPreferences: { sandbox: true, contextIsolation: true, preload: path.join(__dirname, "..", "..", "preload", "ui.js") },
  });

  await twoFaWindow.loadFile(
    path.join(__dirname, "..", "..", "renderer", "twofa", "twofa.html")
  );

  twoFaWindow.webContents.send("twofa-question", { question, propositions });

  // Le dimensionnement doit avoir lieu APRES le rendu des propositions,
  // sinon on mesure une fenetre vide.
  await new Promise((resolve) => setTimeout(resolve, 60));
  await fitWindowToContent(twoFaWindow, {
    width: WIDTH,
    minHeight: MIN_HEIGHT,
    maxHeight: MAX_HEIGHT,
  });

  return twoFaWindow;
}

module.exports = { createTwoFaWindow };
