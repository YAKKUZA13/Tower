// Capture the local, serverless RTS showcase route with system Chrome.
// Usage: node scripts/shoot-rts.cjs [url] [output]
const { existsSync, mkdirSync, mkdtempSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { dirname, join, resolve } = require('node:path');
const { spawn } = require('node:child_process');

const chrome = process.env.TOWER_CHROME || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const url = process.argv[2] || 'http://127.0.0.1:5173/?demo=rts&map=rts-2p-crossroads';
const output = resolve(process.argv[3] || join('docs', 'media', 'rts-crossroads.png'));
const profile = mkdtempSync(join(tmpdir(), 'tower-rts-shot-'));

mkdirSync(dirname(output), { recursive: true });
rmSync(output, { force: true });

const args = [
  '--headless=new',
  '--no-first-run',
  '--no-default-browser-check',
  `--user-data-dir=${profile}`,
  '--use-angle=swiftshader',
  '--enable-webgl',
  '--ignore-gpu-blocklist',
  '--hide-scrollbars',
  '--window-size=1600,900',
  '--virtual-time-budget=15000',
  `--screenshot=${output}`,
  url
];

const child = spawn(chrome, args, { stdio: 'inherit', windowsHide: true });
child.once('error', (error) => {
  console.error(`Unable to launch Chrome at ${chrome}:`, error.message);
  process.exitCode = 1;
});

const startedAt = Date.now();
const poll = setInterval(() => {
  if (existsSync(output)) {
    clearInterval(poll);
    console.log(`RTS screenshot saved: ${output}`);
    setTimeout(() => {
      try { rmSync(profile, { recursive: true, force: true, maxRetries: 4, retryDelay: 200 }); } catch { /* Chrome may still own the temp profile. */ }
    }, 750).unref();
    return;
  }
  if (Date.now() - startedAt > 30_000) {
    clearInterval(poll);
    console.error(`Timed out waiting for screenshot: ${output}`);
    process.exitCode = 1;
  }
}, 250);
