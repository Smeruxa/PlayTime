const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs/promises');
const { pathToFileURL } = require('node:url');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
(async () => {
    const output = process.env.VIEWER_SCREENSHOT_DIR || path.resolve('dist/improvement-run/viewer-ui');
    await fs.mkdir(output, { recursive: true });
    const browser = await chromium.launch({ headless: true, ...(process.env.VIEWER_BROWSER_PATH ? { executablePath: process.env.VIEWER_BROWSER_PATH } : {}) });
    try {
        const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' });
        const errors = [];
        page.on('pageerror', error => errors.push(error.message));
        await page.addInitScript(() => {
            window.changes = []; window.viewerClosedCount = 0;
            window.mixerState = { master: 85, screen: 60, screenMuted: false, screenAvailable: true, screenLabel: 'Демонстрация · teammate', participants: [{ username: 'teammate', volume: 75 }, { username: 'second_player', volume: 100 }] };
            window.screenShareViewer = {
                onFrame: callback => { window.frameCallback=callback },
                onMixer: callback => { window.mixerCallback=callback },
                requestMixer: () => { window.mixerCallback(window.mixerState) },
                changeMixer: change => {
                    window.changes.push(change);
                    if (change.kind === 'master') window.mixerState.master=change.value;
                    if (change.kind === 'screen') { window.mixerState.screen=change.value; window.mixerState.screenMuted=change.value===0; }
                    if (change.kind === 'participant') window.mixerState.participants.find(p=>p.username===change.username).volume=change.value;
                    window.mixerCallback(window.mixerState);
                },
                close: () => { window.viewerClosedCount++ }
            };
        });
        await page.goto(pathToFileURL(path.resolve('apps/frontend/public/screen-share-viewer.html')).href);
        await page.evaluate(() => {
            const canvas=document.createElement('canvas');canvas.width=1440;canvas.height=900;const context=canvas.getContext('2d');
            context.fillStyle='#10161f';context.fillRect(0,0,1440,900);context.fillStyle='#192434';context.fillRect(80,60,1000,680);context.fillStyle='#24384d';context.fillRect(100,80,960,35);
            context.fillStyle='#566c83';context.font='18px system-ui';context.fillText('PlayTime · Preview',120,105);context.fillStyle='#1f3041';for(let i=0;i<5;i++)context.fillRect(110,150+i*104,940,80);
            window.frameCallback(canvas.toDataURL('image/jpeg'));
        });
        await page.getByRole('button',{name:'Громкость демонстрации',exact:true}).click();
        await page.getByRole('dialog',{name:'Звук демонстрации'}).waitFor();
        assert.equal(await page.getByRole('slider').count(),1);
        const screen=page.getByRole('slider',{name:'Демонстрация · teammate',exact:true});
        await screen.fill('42'); await screen.press('ArrowLeft');
        assert.equal((await page.evaluate(()=>window.changes)).at(-1).value,41);
        assert.equal(await page.evaluate(()=>window.mixerState.master),85);
        assert.equal(await page.evaluate(()=>window.mixerState.participants[0].volume),75);
        await page.getByRole('button',{name:'Выключить: Демонстрация · teammate',exact:true}).click();
        assert.equal(await page.getByRole('slider',{name:'Демонстрация · teammate',exact:true}).inputValue(),'0');
        await page.getByRole('button',{name:'Включить: Демонстрация · teammate',exact:true}).click();
        assert.equal(await page.getByRole('slider',{name:'Демонстрация · teammate',exact:true}).inputValue(),'41');
        await page.screenshot({path:path.join(output,'fullscreen-mixer.png')});
        await page.waitForTimeout(2400);
        assert(await page.locator('#overlay').evaluate(element=>element.classList.contains('visible')));
        await page.keyboard.press('Escape');assert(await page.locator('#mixer').isHidden());
        assert.equal(await page.evaluate(()=>window.viewerClosedCount),0);await page.keyboard.press('Escape');assert.equal(await page.evaluate(()=>window.viewerClosedCount),1);
        await page.evaluate(()=>{window.mixerState.participants=[];window.mixerState.screenAvailable=false;window.mixerCallback(window.mixerState)});
        await page.getByRole('button',{name:'Громкость демонстрации',exact:true}).click();
        assert(await page.getByRole('slider',{name:'Демонстрация · teammate',exact:true}).isDisabled());
        assert.equal(await page.getByRole('slider').count(),1);
        assert((await page.evaluate(()=>window.changes)).every(change=>change.kind==='screen'));
        assert.equal(await page.locator('.toolbar button').evaluateAll(buttons=>buttons.every(button=>button.textContent.trim()==='')),true);
        await page.setViewportSize({width:960,height:600});await page.screenshot({path:path.join(output,'fullscreen-mixer-compact.png')});
        assert.deepEqual(errors,[]);
        console.log(JSON.stringify({ok:true,checks:['only local screen gain changes','icon-only toolbar','keyboard adjustment','screen mute and restore','overlay stays while mixer is open','Escape closes mixer before fullscreen','disabled local/silent screen channel','1440x900 and 960x600 screenshots'],output},null,2));
    } finally { await browser.close() }
})().catch(error=>{console.error(error);process.exit(1)});
