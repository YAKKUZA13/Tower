const { spawnSync } = require('node:child_process');
const { resolve } = require('node:path');
const root = resolve(__dirname, '..');
for (const name of ['rts', 'rts-camera', 'rts-gameplay', 'rts-workers', 'rts-rendering', 'rts-terrain', 'rts-solo', 'rts-m8', 'unit-orders']) {
  console.log(`RUN smoke-${name}`);
  const result = spawnSync(process.execPath, ['--import', 'tsx', `scripts/smoke-${name}.ts`], {cwd: root, stdio: 'inherit', windowsHide: true});
  if (result.status !== 0) { console.error(result.error ?? `smoke-${name} exited ${result.status}`); process.exit(1); }
}
console.log('PASS all nine RTS regression scripts');
