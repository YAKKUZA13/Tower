// Spatial histogram of the RTS canvas: where is bright content on screen?
const puppeteer = require('puppeteer-core');
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox','--use-gl=angle','--enable-webgl','--ignore-gpu-blocklist','--window-size=1600,900'] });
  const page = await browser.newPage();
  await page.setViewport({ width: 1600, height: 900 });
  await page.goto('http://127.0.0.1:5173/', { waitUntil: 'networkidle2' });
  await sleep(600);
  if (await page.$('.auth-btn.guest')) { await (await page.$('.auth-btn.guest')).click(); await sleep(800); }
  await page.evaluate(() => { const b = Array.from(document.querySelectorAll('.nav-button')).find(x=>/RTS/.test(x.textContent||'')); if(b)b.click(); });
  await sleep(900);
  const start = await page.$('.lobby-foot .btn.primary') || await page.$('.btn.primary.big');
  if (start) await start.click();
  await sleep(8000);

  // multiple-frame best sample, split into 4x4 grid, report mean lum per cell + content ratio.
  const grid = await page.evaluate(() => new Promise((resolve) => {
    const canvas = document.querySelector('canvas');
    const GW = 8, GH = 5;
    let best = null;
    let n = 0;
    const tick = () => {
      try {
        const w = 160, h = Math.round(160 * (canvas.height / canvas.width));
        const tmp = document.createElement('canvas'); tmp.width = w; tmp.height = h;
        const ctx = tmp.getContext('2d'); ctx.drawImage(canvas, 0, 0, w, h);
        const d = ctx.getImageData(0, 0, w, h).data;
        // clearColor target ~ (13,15,23) → lum 15-18
        const cells = [];
        let nonBg = 0, total = 0, globalSum = 0;
        const cellW = w / GW, cellH = h / GH;
        for (let gy = 0; gy < GH; gy++) {
          for (let gx = 0; gx < GW; gx++) {
            let s = 0, c = 0, bg = 0;
            const x0 = Math.floor(gx*cellW), x1 = Math.floor((gx+1)*cellW);
            const y0 = Math.floor(gy*cellH), y1 = Math.floor((gy+1)*cellH);
            for (let y=y0;y<y1;y++) for (let x=x0;x<x1;x++) {
              const i = (y*w+x)*4;
              const lum = (d[i]+d[i+1]+d[i+2])/3;
              s += lum; c++; globalSum += lum; total++;
              if (lum > 32) bg++;  // brighter than background → content
            }
            cells.push({ gx, gy, mean: Math.round(s/c), content: Math.round(bg/c*100) });
            nonBg += bg;
          }
        }
        const sample = { globalMean: Math.round(globalSum/total), contentPct: Math.round(nonBg/total*100), cells };
        if (!best || sample.contentPct > best.contentPct) best = sample;
      } catch(e){}
      n++;
      if (n < 15) requestAnimationFrame(tick); else resolve(best);
    };
    requestAnimationFrame(tick);
  }));

  if (grid) {
    console.log('# global mean lum:', grid.globalMean, '| content(>32):', grid.contentPct + '%');
    console.log('# grid (gx 0..7 L→R, gy 0..4 T→B): mean-lum / content%');
    for (let gy = 0; gy < 5; gy++) {
      const row = grid.cells.filter(c => c.gy === gy).sort((a,b)=>a.gx-b.gx)
        .map(c => `${String(c.mean).padStart(3)}/${String(c.content).padStart(2)}%`);
      console.log('  y'+gy+':', row.join('  '));
    }
  } else console.log('# no sample');

  // also test: does the camera move / scene change over time? sample now vs +3s
  const snap = () => page.evaluate(() => new Promise((res) => requestAnimationFrame(() => {
    const c = document.querySelector('canvas'); const t = document.createElement('canvas');
    t.width=120; t.height=Math.round(120*c.height/c.width); const x=t.getContext('2d');
    x.drawImage(c,0,0,t.width,t.height); const d=x.getImageData(0,0,t.width,t.height).data;
    let s=0; for(let i=0;i<d.length;i+=4) s+=(d[i]+d[i+1]+d[i+2])/3; res(Math.round(s/(d.length/4)));
  })));
  const m1 = await snap(); await sleep(3000); const m2 = await snap();
  console.log('# lum now:', m1, '| lum +3s:', m2, '(scene changing?)');

  await browser.close();
})().catch(e => { console.error('FATAL', e); process.exit(1); });
