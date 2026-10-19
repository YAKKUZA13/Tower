const { spawn } = require('node:child_process');
const { join } = require('node:path');

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function isReachable(target) {
  try {
    const response = await fetch(target, { signal: AbortSignal.timeout(750) });
    return response.ok;
  } catch {
    return false;
  }
}

async function stopProcess(child) {
  if (!child?.pid || child.exitCode !== null || child.killed) return;
  const exited = new Promise((resolve) => child.once('exit', resolve));
  child.kill();
  await Promise.race([exited, delay(2_000)]);
}

/**
 * Reuses an existing local server or owns a temporary Vite process. Keeping
 * this lifecycle in one place prevents browser tooling from leaving port 5173
 * occupied after a failed screenshot or interaction smoke.
 */
async function ensureLocalRtsServer(url, repoRoot, timeoutMs = 20_000) {
  if (await isReachable(url)) {
    return { owned: false, stop: async () => {} };
  }

  const target = new URL(url);
  if (!['127.0.0.1', 'localhost'].includes(target.hostname)) {
    throw new Error(`RTS URL is unreachable and cannot be started locally: ${url}`);
  }

  const logs = [];
  const viteBin = join(repoRoot, 'node_modules', 'vite', 'bin', 'vite.js');
  const listenPort = Number(target.port || 5173);
  const child = spawn(process.execPath, [viteBin, '--host', target.hostname, '--port', String(listenPort), '--strictPort'], {
    cwd: join(repoRoot, 'client'),
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true
  });
  const record = (chunk) => {
    logs.push(String(chunk));
    if (logs.length > 40) logs.shift();
  };
  child.stdout.on('data', record);
  child.stderr.on('data', record);
  let launchError = null;
  child.once('error', (error) => { launchError = error; });

  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (launchError) throw new Error(`Unable to launch Vite: ${launchError.message}`);
    if (child.exitCode !== null) {
      throw new Error(`Vite exited with ${child.exitCode}: ${logs.join('').trim()}`);
    }
    if (await isReachable(url)) {
      return { owned: true, stop: () => stopProcess(child) };
    }
    await delay(100);
  }

  await stopProcess(child);
  throw new Error(`Timed out starting ${url}: ${logs.join('').trim()}`);
}

module.exports = { ensureLocalRtsServer };
