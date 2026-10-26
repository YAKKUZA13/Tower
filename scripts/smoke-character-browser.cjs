const assert = require('node:assert/strict');
const fs = require('node:fs');
const { tmpdir } = require('node:os');
const { join, resolve, sep } = require('node:path');
const { spawn } = require('node:child_process');
const { visualGate } = require('./png-visual-gate.cjs');

const repo = resolve(__dirname, '..');
const backend = process.argv[2] === 'webgpu' ? 'webgpu' : 'webgl';
const chromePath = process.env.TOWER_CHROME || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const pause = ms => new Promise(done => setTimeout(done, ms));
async function retry(action, timeout = 30_000) {
  const until = Date.now() + timeout;
  let error;
  while (Date.now() < until) {
    try { return await action(); } catch (failure) { error = failure; await pause(100); }
  }
  throw error || new Error('Browser check timed out');
}
async function stop(child) {
  if (!child || child.exitCode !== null) return;
  const exited = new Promise(done => child.once('exit', done)); child.kill();
  await Promise.race([exited, pause(2000)]);
}

async function main() {
  assert.ok(fs.existsSync(chromePath), 'Chromium executable is missing');
  const profile = fs.mkdtempSync(join(tmpdir(), 'tower-character-browser-'));
  const output = join(repo, 'artifacts', 'character-assets');
  fs.mkdirSync(output, { recursive: true });
  let vite, browser, socket;
  try {
    // Always own a fresh server. Reusing port 5184 can accidentally validate Tower
    // while this script is running inside an extracted candidate checkout.
    const program = `import {createServer} from 'vite'; const server = await createServer({root:${JSON.stringify(join(repo, 'packages', 'voxel-lab'))},logLevel:'silent',server:{host:'127.0.0.1',port:0,strictPort:true,open:false}}); await server.listen(); process.stdout.write(JSON.stringify({port:server.httpServer.address().port})+'\\n');`;
    vite = spawn(process.execPath, ['--input-type=module', '-e', program], { cwd: repo, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    let serverOutput = '', serverError = '';
    vite.stdout.on('data', chunk => { serverOutput = (serverOutput + chunk).slice(-8192); });
    vite.stderr.on('data', chunk => { serverError = (serverError + chunk).slice(-8192); });
    vite.on('error', error => { serverError = String(error); });
    const labPort = await retry(async () => {
      assert.equal(vite.exitCode, null, `Lab server failed: ${serverError}`);
      const line = serverOutput.split(/\r?\n/).find(line => line.startsWith('{"port":'));
      assert.ok(line, `Waiting for lab server: ${serverError}`); return JSON.parse(line).port;
    });
    const base = `http://127.0.0.1:${labPort}/`;
    browser = spawn(chromePath, [
      '--headless=new', '--no-first-run', '--no-default-browser-check',
      `--user-data-dir=${profile}`, '--remote-debugging-port=0',
      ...(backend === 'webgl' && !process.argv.includes('--native') ? ['--use-angle=swiftshader', '--enable-webgl'] : []),
      '--hide-scrollbars', '--window-size=1600,900', 'about:blank',
    ], { stdio: 'ignore', windowsHide: true });
    browser.on('error', () => {});
    const port = await retry(async () => Number(fs.readFileSync(join(profile, 'DevToolsActivePort'), 'utf8').split(/\r?\n/)[0]));
    const target = await fetch(`http://127.0.0.1:${port}/json/list`).then(response => response.json()).then(list => list.find(page => page.type === 'page'));
    socket = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise((done, fail) => { socket.addEventListener('open', done, { once: true }); socket.addEventListener('error', fail, { once: true }); });
    let next = 0;
    const pending = new Map(), errors = [];
    socket.addEventListener('message', event => {
      const message = JSON.parse(String(event.data));
      if (message.method === 'Runtime.consoleAPICalled' && message.params.type === 'warning') {
        const warning = message.params.args.map(arg => arg.value || arg.description).join(' ');
        if (/GPUValidationError|uncaptured error|Invalid ShaderModule|Invalid RenderPipeline/i.test(warning)) errors.push(warning);
      }
      if (message.method === 'Runtime.exceptionThrown') errors.push(message.params.exceptionDetails.exception?.description || message.params.exceptionDetails.text);
      if (message.method === 'Runtime.consoleAPICalled' && message.params.type === 'error') errors.push(message.params.args.map(arg => arg.value || arg.description).join(' '));
      if (message.method === 'Network.loadingFailed') errors.push(message.params.errorText);
      const request = pending.get(message.id);
      if (request) {
        pending.delete(message.id); clearTimeout(request.timer);
        if (message.error) request.fail(new Error(message.error.message)); else request.done(message.result);
      }
    });
    socket.addEventListener('close', () => {
      for (const request of pending.values()) { clearTimeout(request.timer); request.fail(new Error('CDP closed')); }
      pending.clear();
    });
    const send = (method, params = {}, timeoutMs = 20_000) => new Promise((done, fail) => {
      const id = ++next;
      const timer = setTimeout(() => { pending.delete(id); fail(new Error(`CDP timeout: ${method}`)); }, timeoutMs);
      pending.set(id, { done, fail, timer }); socket.send(JSON.stringify({ id, method, params }));
    });
    const evaluate = async expression => {
      const response = await send('Runtime.evaluate', { expression, returnByValue: true });
      if (response.exceptionDetails) throw new Error(response.exceptionDetails.exception?.description || response.exceptionDetails.text);
      return response.result.value;
    };
    const visualChecks = {};
    const capture = async name => {
      const probe = await evaluate('window.__labDiagnostics()');
      const png = Buffer.from((await send('Page.captureScreenshot', { format: 'png' })).data, 'base64');
      fs.writeFileSync(join(output, `${backend}-${name}.png`), png);
      visualChecks[name] = visualGate(png, probe.canvasRect);
    };
    await send('Runtime.enable'); await send('Page.enable'); await send('Network.enable');
    await send('Emulation.setDeviceMetricsOverride', { width: 1600, height: 900, deviceScaleFactor: 1, mobile: false });
    await send('Page.navigate', { url: `${base}?backend=${backend}#character` });
    await retry(async () => assert.ok(await evaluate(`document.body.dataset.characterReady === 'warden' && window.__labDiagnostics?.().frames > 10 && window.__labDiagnostics?.().ready`), 'Character did not render'), 60_000)
      .catch(async error => { throw new Error(`${error}\n${JSON.stringify({ errors, status: await evaluate('document.body.innerText') })}`); });
    const report = await evaluate('window.__labBackend');
    assert.equal(report.requested, backend);
    if (backend === 'webgl') assert.equal(report.selected, 'webgl');
    else assert.ok(report.selected === 'webgpu' || report.fallbackReason);
    const fixture = fs.readFileSync(join(repo, 'packages/voxel-lab/public/characters/warden.json'), 'utf8');
    await evaluate(`document.querySelector('#character-play').checked = false`);
    const counts = await evaluate('window.__labDiagnostics()');
    await capture('initial');
    assert.equal(counts.isWebGPU, report.selected === 'webgpu');
    const invalid = JSON.parse(fixture); invalid.parts[0].shapes[0].kind = 'unknown';
    await evaluate(`document.querySelector('#character-json').value = ${JSON.stringify(JSON.stringify(invalid))}; document.querySelector('#character-build').click()`);
    assert.ok(await evaluate(`document.querySelector('#character-errors').textContent.length > 0`));
    assert.equal((await evaluate('window.__labDiagnostics()')).meshes, counts.meshes, 'Bad JSON must preserve good preview');
    for (let index = 0; index < 3; index++) {
      await evaluate(`document.querySelector('#character-json').value = ${JSON.stringify(fixture)}; document.querySelector('#character-build').click()`);
      const after = await evaluate('window.__labDiagnostics()');
      for (const key of ['meshes', 'nodes', 'materials']) assert.equal(after[key], counts[key], `${key} leaks after rebuild`);
    }
    await evaluate(`document.querySelector('#character-clip').value = ''; document.querySelector('#character-clip').dispatchEvent(new Event('change'))`);
    for (const view of ['front', 'side', 'back', 'three-quarter']) {
      await evaluate(`document.querySelector('#character-view').value = '${view}'; document.querySelector('#character-view').dispatchEvent(new Event('change'))`);
      const frame = (await evaluate('window.__labDiagnostics()')).frames;
      await retry(async () => assert.ok((await evaluate('window.__labDiagnostics()')).frames > frame + 2));
      await capture(view);
    }
    // Controlled desktop submission/RAF measurements; never label these mobile results.
    // The page allows 60 seconds for 60 warmup + 180 measured frames. CDP must
    // not cancel the same measurement earlier on software-rendered CI runners.
    console.log('Measuring 60 warmup + 180 frames (page deadline 60s)');
    const timed = await send('Runtime.evaluate', { expression: 'window.__labBenchmark(60, 180)', awaitPromise: true, returnByValue: true }, 65_000);
    if (timed.exceptionDetails) throw new Error(timed.exceptionDetails.exception?.description || 'Benchmark failed');
    const benchmark = timed.result.value;
    assert.equal(benchmark.samples, 180);
    await evaluate(`document.querySelector('#character-part').value=''`);
    await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: counts.canvasRect.width / 2, y: counts.canvasRect.height / 2 });
    await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: counts.canvasRect.width / 2, y: counts.canvasRect.height / 2, button: 'left', clickCount: 1 });
    await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: counts.canvasRect.width / 2, y: counts.canvasRect.height / 2, button: 'left', clickCount: 1 });
    await retry(async () => assert.ok(await evaluate(`document.querySelector('#character-part').value.length > 0`), 'Part picking failed'), 2000);
    for (let index = 0; index < 3; index++) {
      await evaluate(`document.querySelector('#tab-greedy').click()`);
      await retry(async () => assert.equal(await evaluate('document.body.dataset.characterReady'), undefined));
      await evaluate(`document.querySelector('#tab-character').click()`);
      await retry(async () => assert.equal(await evaluate('document.body.dataset.characterReady'), 'warden'));
      const after = await evaluate('window.__labDiagnostics()');
      for (const key of ['meshes', 'nodes', 'materials']) assert.equal(after[key], counts[key], `${key} leaks after tab switch`);
    }
    await evaluate(`document.querySelector('#character-socket').value='weapon'; document.querySelector('#character-equip').click()`);
    await retry(async () => assert.equal(await evaluate('document.body.dataset.equipmentReady'), 'rune-sword'));
    await evaluate(`document.querySelector('#character-play').checked=false; document.querySelector('#character-clip').value='salute'; document.querySelector('#character-time').value='0.5'; document.querySelector('#character-time').dispatchEvent(new Event('input'))`);
    const attachmentFrame = (await evaluate('window.__labDiagnostics()')).frames;
    await retry(async () => assert.ok((await evaluate('window.__labDiagnostics()')).frames > attachmentFrame + 5));
    await capture('animated-attachment');
    await evaluate(`document.querySelector('#character-explode').value='0.5'; document.querySelector('#character-explode').dispatchEvent(new Event('input'))`);
    assert.ok(await evaluate(`document.querySelector('#character-inspect').textContent.includes('pivot')`));
    for (const id of ['lantern-beetle', 'rune-sword']) {
      await evaluate(`document.querySelector('#character-fixture').value='${id}'; document.querySelector('#character-fixture').dispatchEvent(new Event('change'))`);
      await retry(async () => assert.equal(await evaluate('document.body.dataset.characterReady'), id));
      assert.equal(await evaluate(`document.querySelectorAll('#character-part option').length`), id === 'rune-sword' ? 1 : 7);
      const frame = (await evaluate('window.__labDiagnostics()')).frames;
      await retry(async () => {
        const probe = await evaluate('window.__labDiagnostics()');
        assert.ok(probe.frames > frame + 3 && probe.ready && probe.activeMeshes > 1, `Fixture not visually ready: ${JSON.stringify(probe)}`);
      });
      await capture(id);
      console.log(JSON.stringify({ fixture: id, diagnostics: await evaluate('window.__labDiagnostics()') }));
    }
    // The same renderer must handle PBR bump noise, emitters and lighting too.
    await evaluate(`document.querySelector('#tab-ritual').click()`);
    await retry(async () => assert.equal(await evaluate('document.body.dataset.sceneReady'), 'ritual'));
    const ritualFrame = (await evaluate('window.__labDiagnostics()')).frames;
    await retry(async () => assert.ok((await evaluate('window.__labDiagnostics()')).frames > ritualFrame + 3));
    await capture('ritual');
    await send('Emulation.setDeviceMetricsOverride', { width: 900, height: 600, deviceScaleFactor: 1, mobile: false });
    await evaluate(`window.dispatchEvent(new Event('resize'))`);
    await evaluate(`document.querySelector('#tab-character').click()`);
    await retry(async () => assert.equal(await evaluate('document.body.dataset.characterReady'), 'warden'));
    const resizeFrame = (await evaluate('window.__labDiagnostics()')).frames;
    await retry(async () => assert.ok((await evaluate('window.__labDiagnostics()')).frames > resizeFrame + 10));
    await capture('resized');
    await evaluate(`document.querySelector('#character-resolution').value='0'; document.querySelector('#character-resolution').dispatchEvent(new Event('change'))`);
    const nativeFrame = (await evaluate('window.__labDiagnostics()')).frames;
    await retry(async () => assert.ok((await evaluate('window.__labDiagnostics()')).frames > nativeFrame + 3));
    await capture('native-resolution');
    assert.deepEqual(errors, [], 'Browser console/network/runtime errors');
    const result = { ok: true, backend: report, profile: process.argv.includes('--native') ? 'native-requested' : backend === 'webgl' ? 'swiftshader' : 'default-adapter', counts, afterResize: await evaluate('window.__labDiagnostics()'), screenshots: output };
    result.visualChecks = visualChecks; result.benchmark = benchmark; result.testedWorkspace = repo;
    fs.writeFileSync(join(output, `${backend}-report.json`), JSON.stringify(result, null, 2));
    console.log(JSON.stringify(result, null, 2));
  } finally {
    socket?.close(); await stop(browser); await stop(vite);
    const actual = fs.realpathSync(profile), temp = fs.realpathSync(tmpdir());
    assert.ok(actual.startsWith(temp + sep), 'Temporary profile escaped temp root');
    fs.rmSync(actual, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
