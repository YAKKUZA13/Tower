// Diagnose: count WebGL draw calls over ~1.6s + capture all failed request URLs.
const puppeteer = require('puppeteer-core');
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const URL = 'http://127.0.0.1:5173/';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const browser = await puppeteer.launch({
    executablePath: CHROME, headless: 'new',
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--use-gl=angle', '--enable-webgl', '--ignore-gpu-blocklist', '--window-size=1600,900']
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1600, height: 900 });

  const failed = [];
  page.on('requestfailed', (r) => failed.push({ url: r.url(), err: r.failure()?.errorText }));
  page.on('response', (r) => { if (r.status() >= 400) failed.push({ url: r.url(), status: r.status() }); });

  await page.goto(URL, { waitUntil: 'networkidle2', timeout: 30000 });
  await sleep(600);
  if (await page.$('.auth-btn.guest')) { await (await page.$('.auth-btn.guest')).click(); await sleep(900); }
  if (await page.evaluate(() => { const b = Array.from(document.querySelectorAll('.nav-button')).find(x => /RTS/.test(x.textContent||'')); if(b){b.click();return true;} return false; })) { await sleep(1000); }
  const start = await page.$('.lobby-foot .btn.primary') || await page.$('.btn.primary.big');
  if (start) await start.click();
  await sleep(7000);

  // Inject draw-call counter into the WebGL context of the RTS canvas.
  const counts = await page.evaluate(async () => {
    const canvas = document.querySelector('canvas.rts-canvas') || document.querySelector('canvas');
    if (!canvas) return { err: 'no canvas' };
    const gl = canvas.getContext('webgl2') || canvas.getContext('webgl');
    if (!gl) return { err: 'no webgl ctx (already taken by babylon — expected)' };
    // babylon already grabbed the context, so this returns null. We need a different hook.
    return { err: 'ctx-already-acquired' };
  });
  console.log('# direct-ctx:', JSON.stringify(counts));

  // babylon owns the context. Instead, monkeypatch the WebGL prototype BEFORE we can —
  // but we're too late. Alternative: use SPECTRE / chrome devtools. Simpler: read
  // canvas pixels AFTER a forced compose by using page.screenshot (composited) and
  // ALSO test preserveDrawingBuffer by re-reading inside one rAF right after a draw.
  // We'll sample the composited screenshot via a hidden img copy through CDP.

  // Approach: use page.evaluate to add a rAF that snapshots the canvas via
  // createImageBitmap / drawImage IMMEDIATELY after requestAnimationFrame (closest
  // to the draw). Do it several times and keep the max unique-color count.
  const best = await page.evaluate(() => new Promise((resolve) => {
    const canvas = document.querySelector('canvas.rts-canvas') || document.querySelector('canvas');
    if (!canvas) return resolve({ err: 'no canvas' });
    let best = { unique: -1, mean: -1 };
    let samples = 0;
    const finish = () => resolve({ samples, best, w: canvas.width, h: canvas.height });
    const tick = () => {
      // sample inside the same frame as render (babylon runRenderLoop uses rAF too;
      // we request a frame right after)
      try {
        const tmp = document.createElement('canvas');
        tmp.width = 80; tmp.height = 45;
        const ctx = tmp.getContext('2d');
        ctx.drawImage(canvas, 0, 0, 80, 45);
        const d = ctx.getImageData(0, 0, 80, 45).data;
        const cols = new Set(); let sum = 0;
        for (let i = 0; i < d.length; i += 4) {
          cols.add((d[i] >> 4) + ',' + (d[i+1] >> 4) + ',' + (d[i+2] >> 4));
          sum += (d[i] + d[i+1] + d[i+2]) / 3;
        }
        const mean = sum / (d.length / 4);
        if (cols.size > best.unique) best = { unique: cols.size, mean: Math.round(mean) };
      } catch (e) { best = { unique: -2, err: String(e) }; }
      samples++;
      if (samples < 12) requestAnimationFrame(tick); else finish();
    };
    requestAnimationFrame(tick);
  }));
  console.log('# canvas sampling (12 rAF ticks, keep best):', JSON.stringify(best));

  // Also: expose babylon scene via Vue component instance is hard. Instead, find
  // meshes by scanning gl — not possible post-hoc. Report what we have.
  console.log('# failed/4xx requests (' + failed.length + '):');
  for (const f of failed) console.log('   ', f.status || f.err, f.url);

  await browser.close();
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
