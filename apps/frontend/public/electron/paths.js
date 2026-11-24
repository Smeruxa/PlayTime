const path = require("path");
const { app } = require("electron");

function publicRoot() {
    return path.join(__dirname, "..");
}

function mainPreloadPath() {
    return path.join(publicRoot(), "preload.js");
}

function faviconPath() {
    if (app.isPackaged) {
        return path.join(app.getAppPath(), "build", "assets", "favicon.ico");
    }
    return path.join(publicRoot(), "assets", "favicon.ico");
}

function notifyHtmlPath() {
    return path.join(publicRoot(), "notify.html");
}

function notifyPreloadPath() {
    return path.join(publicRoot(), "notify-preload.js");
}

function productionIndexHtml() {
    return path.join(app.getAppPath(), "build", "index.html");
}

function recorderWorkletJs() {
    return path.join(app.getAppPath(), "build", "recorder-worklet.js");
}

module.exports = {
    publicRoot,
    mainPreloadPath,
    faviconPath,
    notifyHtmlPath,
    notifyPreloadPath,
    productionIndexHtml,
    recorderWorkletJs
};
