/**
 * M8-fix smoke — RTS continuous terrain + new RTS assets.
 *
 * Headless (NullEngine): без браузера проверяет, что:
 *  1. createRtsGround строит корректный chunk-root (vertex/index/normal/color) и
 *     ВЕРХ поверхности в клетке равен sampleHeight (центральный фикс парения).
 *  2. createRtsScene отдаёт name='ground' с pickable playable-чанками
 *     и НЕ создаёт «доску» (board-border / board-decorations).
 *  3. Новые voxel-билдеры (town-hall/l2, watch-tower, worker) возвращают
 *     непустые массивы вокселей (раньше их не было → fallback-бокс).
 *  4. workerRigged даёт валидный гуманоидный риг со всеми walk-нодами.
 *
 * Запуск: npx tsx scripts/smoke-rts-terrain.ts
 */
import { NullEngine } from '@babylonjs/core/Engines/nullEngine.js';
import { Scene } from '@babylonjs/core/scene.js';
import { VertexBuffer } from '@babylonjs/core/Buffers/buffer.js';
import { Mesh } from '@babylonjs/core/Meshes/mesh.js';
import { createRtsGround } from '../client/src/babylon/terrain/rts-terrain';
import { createRtsScene } from '../client/src/babylon/createScene';
import { VOXEL_BUILDERS, builderEmissive } from '../client/src/babylon/voxel/voxel-builder';
import { UNIT_RIGS } from '../client/src/babylon/voxel/importers/unit-rigs';
import { sampleHeight } from '../client/src/babylon/terrain/terrain-math';
import { RTS_MAPS, getRtsMap } from '../shared/src/maps/rts-maps';

let failures = 0;
function check(name: string, cond: boolean, details = ''): void {
  if (cond) console.log(`  \u2713 ${name}`);
  else { failures++; console.error(`  \u2713 FAIL: ${name} ${details}`); }
}

const WALK_NODES = ['spine', 'thighL', 'shinL', 'thighR', 'shinR', 'upperArmL', 'forearmL', 'upperArmR', 'forearmR'];

function listPartNames(def: { root: { name: string; children: unknown[] } }): Set<string> {
  const names = new Set<string>();
  const walk = (p: { name: string; children: unknown[] }): void => {
    names.add(p.name);
    for (const c of p.children) walk(c as { name: string; children: unknown[] });
  };
  walk(def.root);
  return names;
}

// ── 1. createRtsGround — структура и Y-корректность ──────────────────
console.log('1. RTS ground mesh structure + heightmap match:');
{
  const engine = new NullEngine({ renderWidth: 64, renderHeight: 64 } as never);
  const scene = new Scene(engine);
  const map = getRtsMap('rts-2p-crossroads')!;
  const grid = map.grid;
  const heightmap = map.heightmap!;

  const ground = createRtsGround(scene, grid, heightmap, map.tiles ?? null, { apronRings: 6 });

  const chunks = ground.getChildMeshes().filter((mesh) =>
    (mesh.metadata as { playableGround?: boolean } | null)?.playableGround === true
  );
  const firstChunk = chunks[0]!;
  const positions = firstChunk.getVerticesData(VertexBuffer.PositionKind)!;
  const colors = firstChunk.getVerticesData(VertexBuffer.ColorKind)!;
  const indices = firstChunk.getIndices()!;

  check('ground.name === "ground"', ground.name === 'ground');
  check('root is not pickable', ground.isPickable === false);
  check('terrain split into 8x8 chunks', chunks.length === 64, `(chunks=${chunks.length})`);
  check('playable chunks are pickable', chunks.every((mesh) => mesh.isPickable));
  check('receiveShadows=true (тени ложатся на террейн)', ground.receiveShadows === true);
  check('has positions', positions.length > 0, `(len=${positions.length})`);
  check('has colors (vertex-color из tiles)', colors.length > 0, `(len=${colors.length})`);
  check('has indices (>=2 triangles)', indices.length >= 6, `(len=${indices.length})`);
  check('normals computed (3 per vertex)', (firstChunk.getVerticesData(VertexBuffer.NormalKind)?.length ?? 0) === positions.length);

  // Главный фикс: каждая клетка имеет собственную плоскую top-face на высоте
  // heightmap[r][c], без интерполяции цвета/нормали через соседние материалы.
  let yMatchOk = true;
  let yMatchDetail = '';
  const halfW = (grid.cols * grid.cellSize) / 2;
  const halfH = (grid.rows * grid.cellSize) / 2;
  for (const [c, r] of [[5, 5], [32, 32], [50, 12], [12, 50]] as const) {
    const chunk = chunks.find((mesh) => {
      const meta = (mesh.metadata as { terrainChunk?: { col: number; row: number; size: number } } | null)?.terrainChunk;
      return !!meta && c >= meta.col && c < meta.col + meta.size && r >= meta.row && r < meta.row + meta.size;
    });
    const data = chunk?.getVerticesData(VertexBuffer.PositionKind) ?? [];
    const expectedX = c * grid.cellSize - halfW;
    const expectedZ = r * grid.cellSize - halfH;
    const expectedY = heightmap[r]![c]!;
    let found = false;
    for (let i = 0; i <= data.length - 12; i += 12) {
      if (Math.abs(data[i]! - expectedX) < 1e-3 && Math.abs(data[i + 1]! - expectedY) < 1e-3 && Math.abs(data[i + 2]! - expectedZ) < 1e-3) {
        found = true;
        break;
      }
    }
    if (!found) { yMatchOk = false; yMatchDetail = `cell(${c},${r}) top face not found`; break; }
  }
  check('each sampled cell owns a top face at Y=heightmap', yMatchOk, yMatchDetail);

  // Юнит стоит в центре клетки (col,row); его Y = sampleHeight(col,row,bilinear).
  // sampleHeight at integer cells remains the renderer/sim placement contract.
  const cc = 32, cr = 32;
  const unitY = sampleHeight(heightmap, grid, cc, cr, true);
  check('sampleHeight(int col,row) == heightmap cell plateau',
    Math.abs(unitY - heightmap[cr]![cc]!) < 1e-6, `(unit=${unitY})`);

  ground.dispose();
  engine.dispose();
}

// ── 2. createRtsScene — нет «доски», есть правильный ground ──────────
console.log('2. createRtsScene (no floating board):');
{
  const engine = new NullEngine({ renderWidth: 64, renderHeight: 64 } as never);
  const map = getRtsMap('rts-2p-crossroads')!;
  const { scene, camera, light, ground } = createRtsScene(engine, map.grid, map.heightmap, { tiles: map.tiles });

  check('returns scene/camera/light/ground', !!scene && !!camera && !!light && !!ground);
  check('scene has ground mesh named "ground"', scene.getMeshByName('ground') instanceof Mesh);
  check('NO board-border (крепостной бордюр убран)', !scene.getMeshByName('board-border'));
  check('NO board-decorations (подложка-бездна убрана)', !scene.getMeshByName('board-decorations'));
  check('NO ground-underlay', !scene.getMeshByName('ground-underlay'));
  check('ground.receiveShadows=true', (scene.getMeshByName('ground') as Mesh).receiveShadows === true);

  scene.dispose();
  engine.dispose();
}

// ── 3. Новые voxel-билдеры зданий (раньше их не было) ─────────────────
console.log('3. New RTS building voxel builders (non-empty):');
{
  const expected: Array<{ id: string; min: number }> = [
    { id: 'building:town-hall', min: 100 },
    { id: 'building:town-hall-l2', min: 100 },
    { id: 'building:watch-tower', min: 80 },
    { id: 'unit:worker', min: 20 }
  ];
  for (const { id, min } of expected) {
    const fn = VOXEL_BUILDERS[id];
    check(`builder registered: ${id}`, typeof fn === 'function');
    if (!fn) continue;
    const voxels = fn();
    check(`${id} returns ${min}+ voxels`, voxels.length >= min, `(got ${voxels.length})`);
    const emissive = builderEmissive(id);
    check(`${id} has emissive accent`, Array.isArray(emissive) && emissive.length === 3);
  }
}

// ── 4. workerRigged — валидный гуманоидный риг ────────────────────────
console.log('4. workerRigged (valid humanoid rig):');
{
  const fn = UNIT_RIGS['unit:worker'];
  check('UNIT_RIGS["unit:worker"] registered', typeof fn === 'function');
  if (fn) {
    const def = fn();
    const names = listPartNames(def);
    const missing = WALK_NODES.filter((n) => !names.has(n));
    check('all walk-cycle nodes present', missing.length === 0, `(missing: ${missing.join(',')})`);
    check('animKind="humanoid"', (def as { animKind?: string }).animKind === 'humanoid');
    // есть имя части 'forearmR' — там висит кирка (тест зачитываемости силуэта)
    check('has forearmR (worker holds pickaxe)', names.has('forearmR'));
  }
}

// ── 5. Все 3 RTS-карты строются через createRtsScene без ошибок ───────
console.log('5. All 3 RTS maps build RTS scene without errors:');
{
  for (const map of RTS_MAPS) {
    const engine = new NullEngine({ renderWidth: 32, renderHeight: 32 } as never);
    let ok = false;
    let err = '';
    try {
      const { scene, ground } = createRtsScene(engine, map.grid, map.heightmap, { tiles: map.tiles });
      ok = !!scene.getMeshByName('ground') && ground === scene.getMeshByName('ground');
      scene.dispose();
    } catch (e) {
      err = String(e);
    }
    check(`${map.metadata?.name}: createRtsScene OK + ground returned`, ok, err);
    engine.dispose();
  }
}

// ── итог ─────────────────────────────────────────────────────────────
console.log('===');
if (failures === 0) console.log('\u2705 ALL PASSED');
else { console.error(`\u274C ${failures} FAILED`); process.exit(1); }
