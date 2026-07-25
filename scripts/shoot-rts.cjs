// Drive system Chrome via puppeteer-core: guest login → RTS solo → screenshot + diagnostics.
// ASCII-only selectors / text matching (Cyrillic via .includes on page-side text).
const puppeteer = require('puppeteer-core');
const path = require('path');

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const URL = 'http://127.0.0.1:5173/';
const OUT = 'D:\\projeckt\\Tower\\.playwright-mcp';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: 'new',
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--use-gl=angle', '--enable-webgl', '--ignore-gpu-blocklist', '--window-size=1600,900']
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1600, height: 900, deviceScaleFactor: 1 });
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push('PAGEERROR: ' + e.message));
  page.on('requestfailed', (r) => errors.push('REQFAIL: ' + r.url() + ' (' + (r.failure()?.errorText || '') + ')'));

  const log = (...a) => console.log('#', ...a);
  log('goto', URL);
  await page.goto(URL, { waitUntil: 'networkidle2', timeout: 30000 });
  await sleep(800);

  // 1) guest login
  const guest = await page.$('.auth-btn.guest');
  log('guest button present:', !!guest);
  if (guest) { await guest.click(); await sleep(1000); }
  await page.screenshot({ path: path.join(OUT, 'shot-1-after-guest.png') });

  // 2) click "RTS" nav (3rd nav-button / match ASCII 'RTS')
  const navClicked = await page.evaluate(() => {
    const btns = Array.from(document.querySelectorAll('.nav-button'));
    const b = btns.find((x) => /RTS/.test(x.textContent || ''));
    if (b) { b.click(); return true; }
    return false;
  });
  log('RTS nav clicked:', navClicked);
  await sleep(1200);
  await page.screenshot({ path: path.join(OUT, 'shot-2-rts-lobby.png') });

  // 3) start default map (rts-2p-crossroads) via lobby-foot primary button
  const startBtn = await page.$('.lobby-foot .btn.primary') || await page.$('.btn.primary.big');
  log('start button present:', !!startBtn);
  if (startBtn) { await startBtn.click(); }
  // wait for canvas + scene init (catalog async load + babylon)
  await sleep(7000);
  await page.screenshot({ path: path.join(OUT, 'shot-3-rts-game.png') });
  log('shot-3 saved (initial)');
  await sleep(3000);
  await page.screenshot({ path: path.join(OUT, 'shot-4-rts-game-warm.png') });
  log('shot-4 saved (warm)');

  // 4) deep diagnostics
  const diag = await page.evaluate(() => {
    const canvas = document.querySelector('canvas.rts-canvas') || document.querySelector('canvas');
    let pxVar = -1, pxSample = null, w = 0, h = 0;
    let gl = null, glVendor = null, glRenderer = null;
    if (canvas) {
      w = canvas.width; h = canvas.height;
      try {
        // read pixels straight from the webgl canvas (preserveDrawingBuffer may block; try)
        gl = canvas.getContext('webgl2') || canvas.getContext('webgl');
        if (gl) {
          const dbg = gl.getExtension('WEBGL_debug_renderer_info');
          glVendor = dbg ? gl.getParameter(dbg.UNMASKED_VENDOR_WEBGL) : gl.getParameter(gl.VENDOR);
          glRenderer = dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : null;
        }
        // pixel variance via 2D copy
        const tmp = document.createElement('canvas');
        tmp.width = Math.min(160, w); tmp.height = Math.min(90, h);
        const ctx = tmp.getContext('2d');
        ctx.drawImage(canvas, 0, 0, tmp.width, tmp.height);
        const data = ctx.getImageData(0, 0, tmp.width, tmp.height).data;
        let sum = 0, sum2 = 0, n = 0;
        const cols = new Set();
        for (let i = 0; i < data.length; i += 4) {
          const lum = (data[i] + data[i + 1] + data[i + 2]) / 3;
          sum += lum; sum2 += lum * lum; n++;
          cols.add((data[i] >> 4) + ',' + (data[i + 1] >> 4) + ',' + (data[i + 2] >> 4));
        }
        const mean = sum / n;
        pxVar = sum2 / n - mean * mean;
        pxSample = { uniqueColors: cols.size, mean: Math.round(mean), w: tmp.width, h: tmp.height };
      } catch (e) { pxSample = { err: String(e) }; }
    }
    return {
      hasCanvas: !!canvas,
      canvasSize: canvas ? { w, h } : null,
      canvasClientRect: canvas ? { w: Math.round(canvas.getBoundingClientRect().width), h: Math.round(canvas.getBoundingClientRect().height) } : null,
      webgl: gl ? { vendor: glVendor, renderer: glRenderer } : null,
      pixelVariance: pxVar,
      pixelSample: pxSample,
      title: document.title,
      hudText: (document.querySelector('.hud-corner')?.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 300),
      alertText: (document.querySelector('.game-alert')?.textContent || '').trim(),
      modalText: (document.querySelector('.modal-card')?.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 200),
      selSummary: (document.querySelector('.selection-summary')?.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 120),
      economyText: (document.querySelector('.economy-bar, #economy-bar, .eco')?.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 200),
      bodyClasses: document.body.className,
      rootChildCount: document.querySelector('#app')?.childElementCount ?? -1
    };
  });
  log('DIAG', JSON.stringify(diag, null, 2));

  log('errors (' + errors.length + '):');
  for (const e of errors.slice(0, 40)) log('  ERR:', e.slice(0, 400));

  await browser.close();
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
