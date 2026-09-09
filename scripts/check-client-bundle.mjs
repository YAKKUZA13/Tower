import fs from 'node:fs';
import path from 'node:path';

const assetsDirectory = path.resolve('client/dist/assets');
const maximumBabylonBytes = 3_000_000;
if (!fs.existsSync(assetsDirectory)) throw new Error('client/dist/assets is missing; build the client first');

const babylonChunks = fs.readdirSync(assetsDirectory)
  .filter((name) => name.startsWith('babylon-core-') && name.endsWith('.js'))
  .map((name) => ({ name, bytes: fs.statSync(path.join(assetsDirectory, name)).size }));

if (babylonChunks.length !== 1) {
  throw new Error(`Expected exactly one babylon-core chunk, found ${babylonChunks.length}`);
}

const chunk = babylonChunks[0];
if (chunk.bytes > maximumBabylonBytes) {
  throw new Error(`${chunk.name} is ${chunk.bytes} bytes; budget is ${maximumBabylonBytes}. Check for root @babylonjs/core imports.`);
}

console.log(`Bundle budget passed: ${chunk.name} ${(chunk.bytes / 1_000_000).toFixed(2)} MB <= 3.00 MB.`);
