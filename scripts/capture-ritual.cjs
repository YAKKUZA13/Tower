/** Deterministic no-dependency Chromium capture for the voxel-lab ritual fixture. */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');

const url = process.argv[2] || 'http://127.0.0.1:5184/#ritual';
const output = path.resolve(process.argv[3] || 'artifacts/img2threejs/datk-ritual/render-reference.png');
const view = process.argv[4] || 'reference';
const candidates = [
  process.env.CHROME_PATH,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
].filter(Boolean);
const executable = candidates.find((candidate) => fs.existsSync(candidate));
if (!executable) throw new Error('No existing Chromium executable found');

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'tower-ritual-capture-'));
const browser = spawn(executable, [
  '--headless=new', '--no-sandbox', '--disable-gpu-sandbox', '--use-angle=swiftshader',
  '--enable-webgl', '--ignore-gpu-blocklist', '--hide-scrollbars', '--window-size=1600,900',
  '--force-device-scale-factor=1', '--remote-debugging-port=0', `--user-data-dir=${profile}`, 'about:blank'
], { stdio: ['ignore', 'ignore', 'pipe'], windowsHide: true });

async function readDevToolsPort() {
  const portFile = path.join(profile, 'DevToolsActivePort');
  for (let attempt = 0; attempt < 100; attempt++) {
    if (fs.existsSync(portFile)) return Number(fs.readFileSync(portFile, 'utf8').split(/\r?\n/, 1)[0]);
    await delay(50);
  }
  throw new Error('Chromium did not expose a DevTools port');
}

async function connect(wsUrl) {
  const socket = new WebSocket(wsUrl);
  await new Promise((resolve, reject) => {
    socket.addEventListener('open', resolve, { once: true });
    socket.addEventListener('error', reject, { once: true });
  });
  let id = 0;
  const pending = new Map();
  const events = [];
  socket.addEventListener('message', (event) => {
    const message = JSON.parse(String(event.data));
    if (message.id && pending.has(message.id)) {
      const { resolve, reject } = pending.get(message.id);
      pending.delete(message.id);
      if (message.error) reject(new Error(`${message.error.code}: ${message.error.message}`));
      else resolve(message.result || {});
      return;
    }
    if (message.method === 'Runtime.exceptionThrown') events.push(`PAGEERROR ${message.params.exceptionDetails.text}`);
    if (message.method === 'Runtime.consoleAPICalled' && message.params.type === 'error') {
      events.push(`CONSOLE ${message.params.args.map((item) => item.value || item.description || '').join(' ')}`);
    }
    if (message.method === 'Network.loadingFailed') events.push(`REQFAIL ${message.params.errorText} ${message.params.type}`);
  });
  return {
    events,
    send(method, params = {}) {
      const messageId = ++id;
      socket.send(JSON.stringify({ id: messageId, method, params }));
      return new Promise((resolve, reject) => pending.set(messageId, { resolve, reject }));
    },
    close() { socket.close(); }
  };
}

(async () => {
  let cdp;
  try {
    const port = await readDevToolsPort();
    const targets = await fetch(`http://127.0.0.1:${port}/json/list`).then((response) => response.json());
    const page = targets.find((target) => target.type === 'page');
    if (!page) throw new Error('No Chromium page target');
    cdp = await connect(page.webSocketDebuggerUrl);
    await Promise.all([cdp.send('Page.enable'), cdp.send('Runtime.enable'), cdp.send('Network.enable')]);
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1600, height: 900, deviceScaleFactor: 1, mobile: false });
    await cdp.send('Page.navigate', { url });
    let ready = false;
    for (let attempt = 0; attempt < 160; attempt++) {
      await delay(50);
      const result = await cdp.send('Runtime.evaluate', {
        expression: "document.readyState === 'complete' && window.__ritualReady === true",
        returnByValue: true
      });
      if (result.result?.value === true) { ready = true; break; }
    }
    if (!ready) throw new Error('Ritual scene did not become ready');
    if (view !== 'reference') {
      await cdp.send('Runtime.evaluate', { expression: `window.__setRitualView?.(${JSON.stringify(view)})` });
    }
    await cdp.send('Runtime.evaluate', {
      expression: `(() => {
        const panel = document.querySelector('#panel');
        const canvas = document.querySelector('canvas');
        if (panel) panel.style.display = 'none';
        if (canvas) canvas.style.width = '100vw';
        window.dispatchEvent(new Event('resize'));
      })()`
    });
    await cdp.send('Runtime.evaluate', {
      expression: 'new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))',
      awaitPromise: true
    });
    const diagnostics = await cdp.send('Runtime.evaluate', {
      expression: `JSON.stringify({
        ready: window.__ritualReady,
        scene: document.body.dataset.sceneReady,
        triangles: document.querySelector('#stat-tri')?.textContent,
        nodes: document.querySelector('#stat-vox')?.textContent,
        canvas: { width: document.querySelector('canvas')?.width, height: document.querySelector('canvas')?.height }
      })`,
      returnByValue: true
    });
    const shot = await cdp.send('Page.captureScreenshot', { format: 'png', fromSurface: true, captureBeyondViewport: false });
    fs.mkdirSync(path.dirname(output), { recursive: true });
    fs.writeFileSync(output, Buffer.from(shot.data, 'base64'));
    console.log(JSON.stringify({ output, view, diagnostics: JSON.parse(diagnostics.result.value), errors: cdp.events }, null, 2));
    process.exitCode = cdp.events.length ? 2 : 0;
  } finally {
    try { await cdp?.send('Browser.close'); } catch {}
    cdp?.close();
    browser.kill();
    await delay(250);
    try { fs.rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); } catch {}
  }
})().catch((error) => {
  console.error(error.stack || error);
  process.exitCode = 1;
});
