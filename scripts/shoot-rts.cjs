// Capture the local, serverless RTS showcase route with system Chrome.
// Usage: node scripts/shoot-rts.cjs [url] [output]
const { existsSync, mkdirSync, mkdtempSync, renameSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { dirname, join, resolve } = require('node:path');
const { spawn } = require('node:child_process');
const { ensureLocalRtsServer } = require('./lib/local-rts-server.cjs');

const chrome = process.env.TOWER_CHROME || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const url = process.argv[2] || 'http://127.0.0.1:5173/?demo=rts&map=rts-2p-crossroads';
const output = resolve(process.argv[3] || join('docs', 'media', 'rts-crossroads.png'));
const repoRoot = resolve(__dirname, '..');
const profile = mkdtempSync(join(tmpdir(), 'tower-rts-shot-'));
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function waitForExit(child) {
  return new Promise((resolveExit, reject) => {
    child.once('error', reject);
    child.once('exit', (code, signal) => resolveExit({ code, signal }));
  });
}

async function waitForScreenshot(child, capturePath, timeoutMs = 35_000) {
  const exit = waitForExit(child);
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (existsSync(capturePath)) return;
    const result = await Promise.race([exit, delay(200).then(() => null)]);
    if (result && !existsSync(capturePath)) {
      throw new Error(`Chrome exited before writing the screenshot (code=${result.code}, signal=${result.signal})`);
    }
  }
  throw new Error(`Timed out waiting for screenshot: ${output}`);
}

async function main() {
  let localServer = null;
  let chromeChild = null;
  let captureDirectory = null;
  try {
    mkdirSync(dirname(output), { recursive: true });
    // Keep the previous README image intact when startup or capture fails.
    captureDirectory = mkdtempSync(join(dirname(output), '.rts-capture-'));
    const capturePath = join(captureDirectory, 'capture.png');
    localServer = await ensureLocalRtsServer(url, repoRoot);

    chromeChild = spawn(chrome, [
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
      `--screenshot=${capturePath}`,
      url
    ], { stdio: 'inherit', windowsHide: true });

    await waitForScreenshot(chromeChild, capturePath);
    renameSync(capturePath, output);
    console.log(`RTS screenshot saved: ${output}`);
  } finally {
    if (chromeChild && chromeChild.exitCode === null && !chromeChild.killed) chromeChild.kill();
    await localServer?.stop();
    await delay(250);
    try { rmSync(profile, { recursive: true, force: true, maxRetries: 4, retryDelay: 200 }); } catch { /* Chrome can briefly retain the profile lock. */ }
    if (captureDirectory) rmSync(captureDirectory, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(`RTS screenshot failed: ${error.message}`);
  process.exitCode = 1;
});
