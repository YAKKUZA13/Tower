/**
 * M8-fix — RTS continuous terrain (replaces the floating «voxel board»).
 *
 * Проблема: createScene для TD делает «доску в космосе» — плоская плита +
 * тёмная бездна под ней + крепостной бордюр (зубцы/руны/черепа). Для RTS это
 * неправильно: в StarCraft/AoE карта — это сплошной террейн, уходящий в туман.
 *
 * Доп. баг: createScene ИГНОРИРОВАЛ heightmap (_heightmap), рисуя плоский пол
 * на y=0, тогда как все рендереры ставят объекты на `groundY = sampleHeight(...)`
 * (1.0..2.0 на RTS-картах с rolling-heightmap). Из-за этого юниты/здания/ресурсы
 * «парили» на 1–2 единицы над видимой плитой. На минимапе они были (минимап читает
 * col/row из сима, а не world-Y), а на сцене — нет.
 *
 * Решение: один Mesh-«ground» с (cols+1)×(rows+1) вершин, смещённых по heightmap,
 * так что ВЕРХ поверхности в клетке (c,r) в точности равен sampleHeight(c,r).
 * Вершины стоят на углах клеток → билинейная интерполяция поверхности в центре
 * клетки = среднее 4 углов = ровно sampleHeight(bilinear=true, центр). Юниты/здания
 * ставятся через `sampleHeight + offset` → основание ровно на террейне.
 *
 * Цвета: per-quad vertex-colors по tiles-матрице (grass/dirt/water/rock/sand),
 * с детерминированным per-cell jitter (hand-painted feel). Один материал, 1 draw call.
 *
 * Apron: вокс-периметр расширен на `apronRings` колец за пределы карты. Высота и
 * цвет плавно сходятся к fog-цвету → нет резкого края «доски», террейн уходит в
 * туман как в каноничных RTS.
 *
 * Контракт для пикеров и рендереров сохранён: name='ground', isPickable=true,
 * receiveShadows=true, top-surface y = sampleHeight value.
 */
import {
  Color3,
  Mesh,
  StandardMaterial,
  VertexData,
  type Scene
} from 'babylonjs';
import type { GridData, TileType } from '@tower/shared';
import { fieldMaterialColor, tileToFieldMaterial } from '../voxel/voxel-field';
import { shade } from '../voxel/dark-palette';
import type { RGB } from '../voxel/dark-palette';

/** Колец «апрона» вокруг карты (каждое кольцо = 1 клетка толщиной). */
const DEFAULT_APRON_RINGS = 18;
/**
 * Во что растворяется апрон. Раньше = fog-цвет (тёмно-навигационный) → низ кадра у
 * ребра карты читался как «чёрная бездна/void». Теперь = нейтральный тёмный ЗЕМЛЯНОЙ
 * тон: апрон выглядит как «дальний террейн», а не как дыра (как в StarCraft/AoE —
 * карта без void, террейн уходит за горизонт тёмной полосой, а не провалом).
 */
const APRON_FADE_COLOR: RGB = [0.12, 0.11, 0.09];
/** Амплитуда per-cell цветового jitter (±). */
const CELL_JITTER = 0.06;

export interface RtsGroundOptions {
  /** Колец апрона за периметром карты. 0 = без апрона. */
  apronRings?: number;
}

/**
 * Создаёт сплошной RTS-террейн, следующий heightmap, с tile-цветами и apron-фадом.
 * Возвращает Mesh с name='ground' (isPickable=true, receiveShadows=true).
 */
export function createRtsGround(
  scene: Scene,
  grid: GridData,
  heightmap: number[][] | null | undefined,
  tiles: TileType[][] | null | undefined,
  options: RtsGroundOptions = {}
): Mesh {
  const cs = grid.cellSize;
  const cols = grid.cols;
  const rows = grid.rows;
  const apronRings = Math.max(0, options.apronRings ?? DEFAULT_APRON_RINGS);

  const halfW = (cols * cs) / 2;
  const halfH = (rows * cs) / 2;

  // Безопасный доступ к heightmap (вне диапазона / null → 0).
  const hAt = (c: number, r: number): number => {
    if (!heightmap) return 0;
    const rr = Math.max(0, Math.min(rows - 1, r));
    const cc = Math.max(0, Math.min(cols - 1, c));
    const v = heightmap[rr]?.[cc];
    return typeof v === 'number' && Number.isFinite(v) ? v : 0;
  };

  // Логическая сетка вершин: col `C` ∈ [-apronRings .. cols+apronRings].
  // Это даёт (cols + 2*apronRings + 1) вершин по X (и аналогично по Z).
  const vCols = cols + 2 * apronRings + 1;
  const vRows = rows + 2 * apronRings + 1;
  const vertexCount = vCols * vRows;

  const positions = new Float32Array(vertexCount * 3);
  const colors = new Float32Array(vertexCount * 4);

  // 1) Вершины.
  let p = 0; // индекс в positions/colors (step = 3 / 4)
  for (let iz = 0; iz < vRows; iz++) {
    const logicalR = iz - apronRings; // ряд вершины: 0..rows внутри карты
    // +cs*0.5: вершина «логической (c,r)» стоит в ЦЕНТРЕ клетки (c,r), а не в углу.
    // Тогда terrain Y в клетке = heightmap[r][c] = sampleHeight(col,row) точно (без
    // half-cell offset) → юниты/здания/ресурсы стоят ровно на поверхности.
    const worldZ = (logicalR + 0.5) * cs - halfH;
    for (let ix = 0; ix < vCols; ix++) {
      const logicalC = ix - apronRings; // колонка вершины: 0..cols внутри карты
      const worldX = (logicalC + 0.5) * cs - halfW;

      // расстояние за пределами карты (в клетках), приведённое к [0..1] по apronRings.
      const outsideC = Math.max(0, -logicalC, logicalC - cols);
      const outsideR = Math.max(0, -logicalR, logicalR - rows);
      const outside = Math.max(outsideC, outsideR);
      // fadeFactor: 1.0 на границе карты (outside=0) → 0.0 на внешнем кольце (outside=apronRings).
      const fadeFactor = apronRings > 0 ? Math.max(0, 1 - outside / apronRings) : 1;

      // Высота: внутри карты — heightmap; снаружи — плавный сход к 0.
      const hInside = hAt(logicalC, logicalR);
      const y = hInside * fadeFactor;

      // Цвет: внутри — tile-цвет с jitter; снаружи — lerp к fog.
      const cellCol = Math.max(0, Math.min(cols - 1, logicalC));
      const cellRow = Math.max(0, Math.min(rows - 1, logicalR));
      const tile: TileType = tiles?.[cellRow]?.[cellCol] ?? 'grass';
      const baseRGB = fieldMaterialColor(tileToFieldMaterial(tile));
      // jitter детерминированный (без rng): sin-hash по клетке.
      const j = (hash01(cellCol, cellRow) - 0.5) * 2 * CELL_JITTER;
      const tinted: RGB = [
        clamp01(baseRGB[0] + j),
        clamp01(baseRGB[1] + j),
        clamp01(baseRGB[2] + j * 0.5)
      ];
      // water — чуть затемнённая (читается как «глубина»), rock — высветлена для объёма.
      let surface: RGB = tinted;
      if (tile === 'water') surface = shade(tinted, 0.82);
      else if (tile === 'rock') surface = shade(tinted, 1.12);
      // lerp к земляному апрону по fadeFactor (на границе карты — дальний террейн,
      // не «бездна»). Чуть высветляем APRON_FADE_COLOR когда рядом с картой, чтобы
      // переход был плавным, а не ступенькой.
      const fr = APRON_FADE_COLOR[0] + (surface[0] - APRON_FADE_COLOR[0]) * fadeFactor;
      const fg = APRON_FADE_COLOR[1] + (surface[1] - APRON_FADE_COLOR[1]) * fadeFactor;
      const fb = APRON_FADE_COLOR[2] + (surface[2] - APRON_FADE_COLOR[2]) * fadeFactor;

      positions[p * 3] = worldX;
      positions[p * 3 + 1] = y;
      positions[p * 3 + 2] = worldZ;
      colors[p * 4] = fr;
      colors[p * 4 + 1] = fg;
      colors[p * 4 + 2] = fb;
      colors[p * 4 + 3] = 1;
      p++;
    }
  }

  // 2) Индексы: каждый квад (logical cell) = 2 треугольника.
  //    Полное число квадратов = (vCols-1)*(vRows-1).
  const quadCount = (vCols - 1) * (vRows - 1);
  const indices = new Uint32Array(quadCount * 6);
  let ii = 0;
  for (let iz = 0; iz < vRows - 1; iz++) {
    for (let ix = 0; ix < vCols - 1; ix++) {
      const v0 = iz * vCols + ix;
      const v1 = v0 + 1;
      const v2 = v0 + vCols + 1;
      const v3 = v0 + vCols;
      // CCW с верхней точки зрения: v0, v1, v2, v0, v2, v3
      indices[ii++] = v0;
      indices[ii++] = v1;
      indices[ii++] = v2;
      indices[ii++] = v0;
      indices[ii++] = v2;
      indices[ii++] = v3;
    }
  }

  // 3) Normals — пусть Babylon посчитает по позициям + индексам.
  const vd = new VertexData();
  vd.positions = positions;
  vd.indices = indices;
  vd.colors = colors;
  vd.normals = new Float32Array(vertexCount * 3); // заполнит computeNormals
  VertexData.ComputeNormals(positions, indices, vd.normals);

  const mesh = new Mesh('ground', scene);
  vd.applyToMesh(mesh, false);

  // Материал: vertex-colors как diffuse, минимальный specular (mate, читает тени/тун-шейдинг).
  const mat = new StandardMaterial('rts-ground-mat', scene);
  mat.diffuseColor = new Color3(1, 1, 1); // → видны vertex colors
  mat.specularColor = new Color3(0.02, 0.02, 0.02);
  mat.roughness = 0.95;
  mat.backFaceCulling = true;
  mesh.material = mat;

  mesh.receiveShadows = true;
  mesh.isPickable = true;
  mesh.isVisible = true;
  mesh.metadata = { playableGround: true };

  return mesh;
}

// ──────────────────────────────────────────────────────────────────────
// helpers
// ──────────────────────────────────────────────────────────────────────

function clamp01(x: number): number {
  return x < 0 ? 0 : x > 1 ? 1 : x;
}

/** Детерминированный pseudo-random [0,1) из int-ключа (per-cell jitter). */
function hash01(c: number, r: number): number {
  const h = Math.sin((c + 1) * 12.9898 + (r + 1) * 78.233) * 43758.5453;
  return h - Math.floor(h);
}
