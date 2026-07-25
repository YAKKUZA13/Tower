/**
 * M8-fix smoke — RTS continuous terrain + new RTS assets.
 *
 * Headless (NullEngine): без браузера проверяет, что:
 *  1. createRtsGround строит корректный меш (vertex/index/normal/color) и
 *     ВЕРХ поверхности в клетке равен sampleHeight (центральный фикс парения).
 *  2. createRtsScene отдаёт name='ground', isPickable=true, receiveShadows=true
 *     и НЕ создаёт «доску» (board-border / board-decorations).
 *  3. Новые voxel-билдеры (town-hall/l2, watch-tower, worker) возвращают
 *     непустые массивы вокселей (раньше их не было → fallback-бокс).
 *  4. workerRigged даёт валидный гуманоидный риг со всеми walk-нодами.
 *
 * Запуск: npx tsx scripts/smoke-rts-terrain.ts
 */
import { NullEngine, Scene, VertexBuffer, Mesh } from 'babylonjs';
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

  const positions = ground.getVerticesData(VertexBuffer.PositionKind)!;
  const colors = ground.getVerticesData(VertexBuffer.ColorKind)!;
  const indices = ground.getIndices()!;

  check('ground.name === "ground"', ground.name === 'ground');
  check('isPickable=true (контракт pickGrid)', ground.isPickable === true);
  check('receiveShadows=true (тени ложатся на террейн)', ground.receiveShadows === true);
  check('has positions', positions.length > 0, `(len=${positions.length})`);
  check('has colors (vertex-color из tiles)', colors.length > 0, `(len=${colors.length})`);
  check('has indices (>=2 triangles)', indices.length >= 6, `(len=${indices.length})`);
  check('normals computed (3 per vertex)', (ground.getVerticesData(VertexBuffer.NormalKind)?.length ?? 0) === positions.length);

  // Главный фикс: вершина клетки (c,r) внутри карты стоит в ЦЕНТРЕ клетки и
  // имеет Y = heightmap[r][c] = sampleHeight(c,r). Проверяем несколько клеток.
  let yMatchOk = true;
  let yMatchDetail = '';
  const halfW = (grid.cols * grid.cellSize) / 2;
  const halfH = (grid.rows * grid.cellSize) / 2;
  const apronRings = 6;
  const vCols = grid.cols + 2 * apronRings + 1;
  for (const [c, r] of [[5, 5], [32, 32], [50, 12], [12, 50]] as const) {
    // вершина в центре клетки (c, r):
    const ix = c + apronRings;
    const iz = r + apronRings;
    const idx = iz * vCols + ix;
    const vx = positions[idx * 3];
    const vy = positions[idx * 3 + 1];
    const vz = positions[idx * 3 + 2];
    const expectedX = (c + 0.5) * grid.cellSize - halfW;
    const expectedZ = (r + 0.5) * grid.cellSize - halfH;
    const expectedY = heightmap[r]![c]!;
    if (Math.abs(vx - expectedX) > 1e-3 || Math.abs(vz - expectedZ) > 1e-3) {
      yMatchOk = false; yMatchDetail = `cell(${c},${r}) XZ mismatch`; break;
    }
    if (Math.abs(vy - expectedY) > 1e-3) {
      yMatchOk = false; yMatchDetail = `cell(${c},${r}) Y=${vy} expected=${expectedY}`; break;
    }
  }
  check('vertex at cell-center with Y=heightmap (объекты больше не парят)', yMatchOk, yMatchDetail);

  // Юнит стоит в центре клетки (col,row); его Y = sampleHeight(col,row,bilinear).
  // sampleHeight(целые col,row) = heightmap[row][col] = Y вершины центра клетки →
  // точное совпадение surface==object-Y.
  const cc = 32, cr = 32;
  const unitY = sampleHeight(heightmap, grid, cc, cr, true);
  const vertexIdx = (cr + apronRings) * vCols + (cc + apronRings);
  const surfaceY = positions[vertexIdx * 3 + 1];
  check('sampleHeight(int col,row) == terrain surface Y at cell center (точное совпадение)',
    Math.abs(unitY - surfaceY) < 1e-6, `(unit=${unitY}, surface=${surfaceY})`);

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
