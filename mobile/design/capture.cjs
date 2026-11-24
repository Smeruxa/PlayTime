const { app, BrowserWindow } = require('electron');
const path = require('node:path');
const fs = require('node:fs/promises');

app.whenReady().then(async () => {
    const window = new BrowserWindow({ width: 1680, height: 1400, show: false, webPreferences: { offscreen: true } });
    await window.loadFile(path.join(__dirname, 'index.html'));
    const height = await window.webContents.executeJavaScript('document.documentElement.scrollHeight');
    window.setContentSize(1680, height);
    await new Promise((resolve) => setTimeout(resolve, 400));
    const capture = await window.webContents.capturePage();
    await fs.writeFile(path.join(__dirname, 'design-board.png'), capture.toPNG());
    app.quit();
});
