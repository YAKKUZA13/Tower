/**
 * CLI: image(s) → Voxel[] via visual hull (Фаза P2, research §4.4).
 *
 * Использование:
 *   npx tsx scripts/voxelize.ts <front.png> <side.png> [back.png] [top.png] \
 *       -o output.vox|json --grid 32 [--threshold 128] [--bg r,g,b]
 *
 * Назначение осей: front→z, side→x, back→z(sign+1), top→y. Front-PNG — источник цвета.
 * Силуэт: по alpha-threshold (если есть прозрачность) ИЛИ chroma-key по --bg.
 * Сохраняет: .vox (MagicaVoxel, через vox-writer) или .json (Voxel[]).
 *
 * Источник PNG-декодера: pngjs (уже в node_modules, транзитивная зависимость).
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { PNG } from 'pngjs';
import {
  visualHull,
  silhouetteFromAlpha,
  silhouetteFromBackground,
  occupancyBounds,
  type CameraView
} from '../client/src/babylon/voxel/voxel-visualhull';
import { writeVox, voxelsToVoxFormat } from '../client/src/babylon/voxel/importers/vox-writer';
import { INDEXED_PALETTE, snapToPalette } from '../client/src/babylon/voxel/voxel-palette';
import type { Voxel } from '../client/src/babylon/voxel/voxel-builder';

interface Args {
  inputs: string[];
  output: string;
  grid: number;
  threshold: number;
  bg: [number, number, number] | null;
}

function parseArgs(argv: string[]): Args {
  const inputs: string[] = [];
  let output = 'output.vox';
  let grid = 32;
  let threshold = 128;
  let bg: [number, number, number] | null = null;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === '-o' || a === '--output') output = argv[++i] ?? output;
    else if (a === '--grid') grid = parseInt(argv[++i] ?? '32', 10);
    else if (a === '--threshold') threshold = parseInt(argv[++i] ?? '128', 10);
    else if (a === '--bg') {
      const parts = (argv[++i] ?? '').split(',').map((s) => parseInt(s, 10));
      if (parts.length === 3) bg = parts as [number, number, number];
    } else if (!a.startsWith('-')) inputs.push(a);
  }
  return { inputs, output, grid, threshold, bg };
}

function loadPngRgba(path: string): { width: number; height: number; data: Uint8Array } {
  const buf = readFileSync(path);
  const png = PNG.sync.read(buf);
  return { width: png.width, height: png.height, data: png.data as unknown as Uint8Array };
}

const AXIS_MAP: ('z' | 'x' | 'y')[] = ['z', 'x', 'z', 'y'];
const SIGN_MAP: (1 | -1)[] = [-1, -1, 1, -1];

function main(): void {
  const args = parseArgs(process.argv.slice(2));
  if (args.inputs.length < 2) {
    console.error('Usage: voxelize.ts <front.png> <side.png> [back.png] [top.png] -o out.vox|json --grid N');
    process.exit(1);
  }
  const views: CameraView[] = [];
  for (let i = 0; i < args.inputs.length; i++) {
    const path = args.inputs[i]!;
    if (!existsSync(path)) { console.error(`Input not found: ${path}`); process.exit(1); }
    const { width, height, data } = loadPngRgba(path);
    const silhouette = args.bg
      ? silhouetteFromBackground(data, width, height, args.bg)
      : silhouetteFromAlpha(data, width, height, args.threshold);
    views.push({
      axis: AXIS_MAP[i] ?? 'z',
      sign: SIGN_MAP[i] ?? -1,
      silhouette,
      width,
      height,
      color: data // front (i=0) — первый с color → источник цвета в visualHull
    });
  }

  console.log(`Voxelizing ${args.inputs.length} view(s) at grid ${args.grid}³...`);
  const t0 = Date.now();
  const voxels = visualHull(views, args.grid);
  console.log(`  visualHull: ${voxels.length} voxels in ${Date.now() - t0}ms`);

  // palette-snap
  for (const v of voxels) {
    v.color = INDEXED_PALETTE[snapToPalette(v.color)]!;
  }

  if (voxels.length === 0) {
    console.error('No voxels produced (silhouettes do not intersect?).');
    process.exit(1);
  }

  const isJson = args.output.endsWith('.json');
  if (isJson) {
    const json: Voxel[] = voxels;
    writeFileSync(args.output, JSON.stringify(json, null, 2));
    console.log(`  wrote ${args.output} (${voxels.length} voxels JSON)`);
  } else {
    const { size, voxels: voxVoxels } = voxelsToVoxFormat(
      voxels.map((v) => ({ x: v.x, y: v.y, z: v.z, color: v.color as unknown as number[] })),
      INDEXED_PALETTE
    );
    const bytes = writeVox(size, voxVoxels, INDEXED_PALETTE);
    writeFileSync(args.output, Buffer.from(bytes));
    const b = occupancyBounds(voxels);
    console.log(`  wrote ${args.output} (${voxels.length} voxels .vox, size ${b.x}×${b.y}×${b.z})`);
  }
}

main();
