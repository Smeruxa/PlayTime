const { app, BrowserWindow } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const output = path.resolve(process.argv[2]);
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');
app.whenReady()
    .then(async () => {
        const input = JSON.parse(fs.readFileSync(path.join(output, 'consumer-input.json'), 'utf8'));
        const window = new BrowserWindow({
            width: 1100,
            height: 1200,
            show: false,
            webPreferences: { webSecurity: false, backgroundThrottling: false },
        });
        window.webContents.on('console-message', (_event, _level, message) => console.log(message));
        const html = `<!doctype html><meta charset="utf-8"><link rel="stylesheet" href="consumer.css"><style>body{margin:30px;background:#161616;color:white;font-family:Arial}section{padding:20px;border:1px solid #555;margin:12px;border-radius:14px}h1{font-size:25px}h2{font-size:16px}img{max-width:380px}a{color:#3aa8ff}</style><div id="root"></div><script>window.nativeMediaInput=${JSON.stringify(
            input,
        ).replaceAll('<', '\\u003c')}</script><script src="consumer.js"></script>`;
        fs.writeFileSync(path.join(output, 'consumer.html'), html);
        await window.loadFile(path.join(output, 'consumer.html'));
        let result;
        for (let index = 0; index < 250; index++) {
            result = await window.webContents.executeJavaScript('window.mediaInteropResult');
            if (result) break;
            await new Promise((resolve) => setTimeout(resolve, 100));
        }
        const screenshot = await window.webContents.capturePage();
        fs.writeFileSync(path.join(output, 'desktop-consumers.png'), screenshot.toPNG());
        result ??= { status: 'failed', error: 'Desktop consumer timed out' };
        const report = {
            ...result,
            consumers: [
                'apps/frontend/src/features/chat/components/VoiceMessagePlayer.tsx',
                'apps/frontend/src/features/chat/components/ChatAttachmentBubble.tsx',
            ],
            electronVersion: process.versions.electron,
            chromiumVersion: process.versions.chrome,
            scope: 'Unchanged desktop decryptors and media consumer components mounted in an isolated Electron harness; not the full desktop application UI.',
            items: input.items.map(({ descriptor, ...item }) => ({
                ...item,
                kind: descriptor.kind,
                mime: descriptor.mime,
                filename: descriptor.filename,
                declaredDuration: descriptor.durationSec,
            })),
        };
        fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify(report, null, 4));
        console.log(JSON.stringify(report));
        app.exit(result.status === 'passed' ? 0 : 1);
    })
    .catch((error) => {
        console.error(error);
        app.exit(1);
    });
