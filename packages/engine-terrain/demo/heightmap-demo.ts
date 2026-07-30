/**
 * Demo: engine-terrain — grid math + simple value-noise heightmap
 *
 * Run: npx tsx packages/engine-terrain/demo/heightmap-demo.ts
 */
import {
  gridToWorldData,
  worldToGridData,
  sampleHeight,
  computeHeightRange
} from '../src/index.js';

// ── Simple 2D value noise (inline — full terrain pipeline = Phase S3) ──
function valueNoise2D(seed: number): (x: number, z: number, scale: number) => number {
  const rng = mulberry32(seed);
  const perm: number[] = [];
  for (let i = 0; i < 256; i++) perm.push(i);
  for (let i = 255; i > 0; i--) {
    const j = (rng() * (i + 1)) | 0;
    [perm[i], perm[j]] = [perm[j]!, perm[i]!];
  }
  function hash(x: number, z: number): number {
    return perm[(perm[(x & 255)!]! + (z & 255)) & 255]! / 256;
  }

  return (x: number, z: number, scale: number) => {
    const sx = x / scale, sz = z / scale;
    const ix = Math.floor(sx), iz = Math.floor(sz);
    const fx = sx - ix, fz = sz - iz;
    const sx2 = fx * fx * (3 - 2 * fx); // smoothstep
    const sz2 = fz * fz * (3 - 2 * fz);
    const n00 = hash(ix, iz);
    const n10 = hash(ix + 1, iz);
    const n01 = hash(ix, iz + 1);
    const n11 = hash(ix + 1, iz + 1);
    const nx0 = n00 + (n10 - n00) * sx2;
    const nx1 = n01 + (n11 - n01) * sx2;
    return (nx0 + (nx1 - nx0) * sz2) * 20; // height 0..20
  };
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ── Demo ──────────────────────────────────────────────────────────────
console.log('═══════════════════════════════════════');
console.log('  Engine Terrain — Grid Math Demo');
console.log('═══════════════════════════════════════\n');

const grid = { cols: 40, rows: 30, cellSize: 1.0 };
const noise = valueNoise2D(42);

// генерируем heightmap
console.log(`Grid: ${grid.cols}×${grid.rows}, cellSize=${grid.cellSize}`);
console.log(`Seed: 42\n`);

const heightmap: number[][] = [];
for (let r = 0; r < grid.rows; r++) {
  const row: number[] = [];
  for (let c = 0; c < grid.cols; c++) {
    let h = noise(c, r, 8);           // base terrain (hills)
    h += noise(c + 100, r + 100, 16) * 0.5;  // detail
    h += noise(c + 200, r + 200, 4) * 0.3;   // large forms
    row.push(Math.round(h * 10) / 10);
  }
  heightmap.push(row);
}

const { minH, maxH } = computeHeightRange(heightmap);
console.log(`Height range: ${minH.toFixed(1)} .. ${maxH.toFixed(1)}`);

// ASCII heatmap
console.log('\n── ASCII heightmap (20×15 crop, ░=low █=high) ──');
const ramp = ' ░▒▓█';
const scale = (maxH - minH) || 1;
for (let r = 0; r < Math.min(15, grid.rows); r++) {
  let line = '';
  for (let c = 0; c < Math.min(20, grid.cols); c++) {
    const h = heightmap[r]![c]!;
    const t = Math.min(ramp.length - 1, Math.floor(((h - minH) / scale) * ramp.length));
    line += ramp[t]!;
  }
  console.log(`  ${line}`);
}

// grid math checks
console.log('\n── Grid math checks ──');
const center = gridToWorldData(grid, grid.cols / 2, grid.rows / 2);
console.log(`  gridToWorld(center): (${center.x.toFixed(2)}, ${center.y.toFixed(2)}, ${center.z.toFixed(2)})`);

const back = worldToGridData(grid, center);
console.log(`  worldToGrid(center): col=${back.col.toFixed(2)} row=${back.row.toFixed(2)}`);

const hCenter = sampleHeight(heightmap, grid, grid.cols / 2, grid.rows / 2, true);
console.log(`  sampleHeight(center, bilinear): ${hCenter.toFixed(2)}`);

const hCorner = sampleHeight(heightmap, grid, 0, 0);
console.log(`  sampleHeight(0,0): ${hCorner.toFixed(2)}`);

// bilinear vs nearest
const hNear = sampleHeight(heightmap, grid, 5.3, 5.7, false);
const hBili = sampleHeight(heightmap, grid, 5.3, 5.7, true);
console.log(`  sampleHeight(5.3,5.7) nearest=${hNear.toFixed(2)} bilinear=${hBili.toFixed(2)}`);

console.log('\n═══════════════════════════════════════');
console.log('  OK');
