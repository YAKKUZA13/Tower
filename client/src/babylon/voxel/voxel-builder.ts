/**
 * Процедурный билдер воксельных мешей.
 *
 * Воксель = один unit-куб в целочисленной сетке (центр в (x,y,z)∈ℤ, размер 1).
 * Модель = набор таких кубов, каждый со своим цветом. Билдер строит по боксу на
 * воксел, красит вершинные цвета (с baked per-face tint), сливает (MergeMeshes)
 * в ОДИН меш → 1 draw call, совместимо с thin instances и InstancedMesh (ADR-4).
 *
 * Авторская модель пишется в «грубых» целочисленных координатах (Y вверх, стопы у
 * y=0; X — ширина; Z — глубина, лицо в +Z). normalizeMesh центрирует и масштабирует
 * к height=1.0 → рендерер ставит master на cellSize. Перекрытия разрешены: dedup
 * по клетке (last-wins) убирает z-fighting; акценты добавляются последними.
 */
import { Color3, Matrix, Mesh, MeshBuilder, StandardMaterial, VertexBuffer, VertexData, type Scene } from 'babylonjs';
import { ACCENT, PALETTE, desaturate, shade, type RGB } from './dark-palette';

export interface Voxel {
  x: number; y: number; z: number;     // центр воксела (целое)
  sx: number; sy: number; sz: number;  // полные размеры (1 для unit-куба)
  color: RGB;
}

export interface VoxelMeshOptions {
  /** Имя меша. */
  name: string;
  /** Emissive-акцент материала (глаза/огонь/магия) — лёгкое общее свечение модели. */
  emissive?: RGB;
  /** Множитель emissive (0 = нет свечения, 0.25 = заметное). */
  emissiveStrength?: number;
  /** Альфа материала. */
  alpha?: number;
  /** Подавить specular (матовый камень/кость). */
  matte?: boolean;
  /** «Плоский» режим: БЕЗ baked AO и БЕЗ jitter — только 3-tier face tint как в
   *  baseline. Для тайлов пола и подобных поверхностей, где AO-затемнение краёв
   *  нежелательно (пол должен оставаться ровно-ярким). По умолчанию false. */
  flat?: boolean;
  /** Стратегия мешинга. 'naive' = CreateBox на воксел + MergeMeshes (baseline,
   *  точный per-cube AO/jitter). 'greedy' = multi-attribute greedy meshing
   *  (research §12.2): мерж coplanar same-color граней в прямоугольники → резко
   *  меньше треугольников; per-vertex AO по углам quad'ов. По умолчанию 'naive'
   *  (обратная совместимость); asset-catalog авто-выбирает greedy для крупных
   *  моделей (> GREEDY_VOXEL_THRESHOLD вокселей). */
  meshing?: 'naive' | 'greedy';
}

// ── Авторские хелперы (unit-grid) ─────────────────────────────────────────────

/** Один unit-воксель в клетке (x,y,z). */
export function cube(list: Voxel[], x: number, y: number, z: number, color: RGB): void {
  list.push({ x, y, z, sx: 1, sy: 1, sz: 1, color });
}

/** Заполнить целочисленный параллелепипед [x0..x1]×[y0..y1]×[z0..z1] unit-вокселями. */
export function box3(
  list: Voxel[],
  x0: number, x1: number,
  y0: number, y1: number,
  z0: number, z1: number,
  color: RGB
): void {
  for (let x = x0; x <= x1; x++) {
    for (let y = y0; y <= y1; y++) {
      for (let z = z0; z <= z1; z++) {
        list.push({ x, y, z, sx: 1, sy: 1, sz: 1, color });
      }
    }
  }
}

/**
 * Нормализует меш к каноническому виду для единообразного размещения рендерерами:
 *  - основание (min.y) → y = -0.5;
 *  - верх (max.y)      → y = +0.5 (равномерный масштаб по высоте = 1.0);
 *  - центр по X/Z      → (0, 0).
 * Применяется и к процедурным воксель-моделям, и к GLB-шаблонам.
 * Трансформация запекается в вершины (mesh-transform остаётся identity).
 */
export function normalizeMesh(mesh: Mesh): void {
  mesh.refreshBoundingInfo();
  const bb = mesh.getBoundingInfo().boundingBox;
  const min = bb.minimumWorld;
  const max = bb.maximumWorld;
  const height = Math.max(1e-4, max.y - min.y);
  const s = 1 / height;
  const cx = (min.x + max.x) * 0.5 * s;
  const cz = (min.z + max.z) * 0.5 * s;
  const dy = -0.5 - min.y * s;
  // M = Translation(-cx, dy, -cz) ∘ Scale(s) — запекаем в вершины.
  const final = Matrix.Translation(-cx, dy, -cz).multiply(Matrix.Scaling(s, s, s));
  mesh.bakeTransformIntoVertices(final);
  mesh.refreshBoundingInfo();
}

// ── baked per-face directional tint + per-vertex AO (классический воксель-шейдинг) ──
// Конструкция меша: CreateBox на воксел + MergeMeshes (как baseline → идентичный
// vertex-layout, UV, normals → гарантированно работает со всеми рендерерами).
// Поверх baseline-tint добавляем per-vertex AO (алгоритм 0FPS): для каждой вершины
// бокса сэмплируем 3 соседа в плоскости грани → ao level 0..3 → brightness factor.
// AO работает только на персонажах/башнях/врагах/стенах; для тайлов пола (flat:true)
// AO отключён — пол остаётся ровно-ярким как baseline.
// Directional-шейдинг даёт свет сцены (DirectionalLight из atmosphere.ts) поверх —
// НЕ запекаем Lambert в vertex colors (двойной Lambert пересвечивает грани в темноту).
const FACE_TINT_TOP = 1.0;
const FACE_TINT_SIDE = 0.6;
const FACE_TINT_BOTTOM = 0.38;

/** ao level (0=полностью окклюдирован .. 3=открыт) → brightness factor. */
const AO_FACTORS = [0.55, 0.72, 0.88, 1.0];
/** Амплитуда per-cell jitter (±JITTER/2) для не-акцентных цветов — hand-painted feel. */
const COLOR_JITTER = 0.10;

/** Детерминированный pseudo-random [0,1) из int-ключа (для per-cell jitter). */
function hash01(x: number, y: number, z: number): number {
  const h = Math.sin(x * 12.9898 + y * 78.233 + z * 37.719) * 43758.5453;
  return h - Math.floor(h);
}

/** Emissive-подобные цвета (яркие + насыщенные) НЕ затемняем по граням — это
 *  «огонь / глаза / кристаллы / золото», они должны гореть равно на всех гранях. */
function isAccentColor([r, g, b]: RGB): boolean {
  const max = Math.max(r, g, b);
  const sat = max - Math.min(r, g, b);
  return max > 0.7 && sat > 0.25;
}

/**
 * Per-vertex AO (0FPS algorithm) для вершины бокса. По позиции вершины и нормали
 * грани определяем corner в tangent-плоскости и сэмплируем 3 соседних вокселя.
 * Возвращает ao level 0..3 (0 = полностью окклюдирован, 3 = открыт).
 */
function vertexAO(
  cells: Map<string, RGB>,
  cx: number, cy: number, cz: number,     // центр клетки бокса
  nx: number, ny: number, nz: number,     // нормаль грани (±1 на одной оси)
  px: number, py: number, pz: number      // позиция вершины (абсолютная)
): number {
  // neighbour cell в направлении нормали
  const mx = cx + nx, my = cy + ny, mz = cz + nz;
  // corner offsets в tangent-плоскости (sign отклонения вершины от центра клетки)
  const has = (x: number, y: number, z: number): boolean => cells.has(`${x},${y},${z}`);
  let s1: boolean, s2: boolean, cor: boolean;
  if (nx !== 0) {
    // ±X face: tangent = Y,Z
    const dy = py > cy ? 1 : -1, dz = pz > cz ? 1 : -1;
    s1 = has(mx, my + dy, mz);
    s2 = has(mx, my, mz + dz);
    cor = has(mx, my + dy, mz + dz);
  } else if (ny !== 0) {
    // ±Y face: tangent = X,Z
    const dx = px > cx ? 1 : -1, dz = pz > cz ? 1 : -1;
    s1 = has(mx + dx, my, mz);
    s2 = has(mx, my, mz + dz);
    cor = has(mx + dx, my, mz + dz);
  } else {
    // ±Z face: tangent = X,Y
    const dx = px > cx ? 1 : -1, dy = py > cy ? 1 : -1;
    s1 = has(mx + dx, my, mz);
    s2 = has(mx, my + dy, mz);
    cor = has(mx + dx, my + dy, mz);
  }
  if (s1 && s2) return 0;
  return 3 - ((s1 ? 1 : 0) + (s2 ? 1 : 0) + (cor ? 1 : 0));
}

/**
 * Строит единый воксельный меш из списка вокселов. Конструкция идентична baseline
 * (CreateBox на воксел + MergeMeshes) → тот же vertex-layout/UV/normals. Поверх
 * baseline per-face tint добавлен baked per-vertex AO (для не-flat моделей) и
 * лёгкий per-cell jitter. Вызывающий владеет результатом (должен dispose).
 */
export function buildVoxelMesh(scene: Scene, voxels: Voxel[], options: VoxelMeshOptions): Mesh {
  // dedup по клетке целочисленной сетки (last-wins): убирает перекрытия/z-fighting;
  // детали-акценты (глаза/огонь/руны), добавляемые последними, перебивают корпус.
  const cells = new Map<string, RGB>();
  for (const v of voxels) {
    cells.set(`${Math.round(v.x)},${Math.round(v.y)},${Math.round(v.z)}`, v.color);
  }
  if (cells.size === 0) {
    return MeshBuilder.CreateBox(options.name, { size: 0.05 }, scene);
  }

  const flat = Boolean(options.flat);

  const parts: Mesh[] = [];
  for (const [key, color] of cells) {
    const p = key.split(',');
    const x = +p[0]!, y = +p[1]!, z = +p[2]!;
    const m = MeshBuilder.CreateBox(`${options.name}-v`, { size: 1 }, scene);
    m.position.set(x, y, z);
    const accent = isAccentColor(color);
    // per-cell jitter (детерминированный) для не-акцентных цветов — hand-painted feel.
    // flat-режим: jitter отключён.
    const jitter = (accent || flat) ? 1 : 1 - COLOR_JITTER * 0.5 + hash01(x, y, z) * COLOR_JITTER;
    // вершинные цвета с baked per-face tint по нормали грани + per-vertex AO.
    const normals = m.getVerticesData(VertexBuffer.NormalKind);
    const positions = m.getVerticesData(VertexBuffer.PositionKind);
    const vc = new Float32Array(24 * 4);
    for (let k = 0; k < 24; k++) {
      const ny = normals ? normals[k * 3 + 1] : 0;
      const nx = normals ? normals[k * 3] : 0;
      const nz = normals ? normals[k * 3 + 2] : 0;
      const px = positions ? positions[k * 3] + x : x;
      const py = positions ? positions[k * 3 + 1] + y : y;
      const pz = positions ? positions[k * 3 + 2] + z : z;
      // face tint (baseline 3-tier)
      let t = FACE_TINT_TOP;
      if (!accent) {
        if (ny > 0.5) t = FACE_TINT_TOP;
        else if (ny < -0.5) t = FACE_TINT_BOTTOM;
        else t = FACE_TINT_SIDE;
      }
      // per-vertex AO (0..3 → factor) — только для не-accent, не-flat моделей
      let ao = 1.0;
      if (!accent && !flat) {
        const level = vertexAO(cells, x, y, z, nx, ny, nz, px, py, pz);
        ao = AO_FACTORS[level]!;
      }
      const b = t * ao * jitter;
      vc[k * 4] = color[0] * b;
      vc[k * 4 + 1] = color[1] * b;
      vc[k * 4 + 2] = color[2] * b;
      vc[k * 4 + 3] = 1;
    }
    m.setVerticesData(VertexBuffer.ColorKind, vc, false);
    m.isPickable = false;
    parts.push(m);
  }

  const merged = Mesh.MergeMeshes(parts, true, false) ?? parts[0];
  merged.name = options.name;
  merged.id = options.name;
  normalizeMesh(merged);

  const mat = new StandardMaterial(`${options.name}-mat`, scene);
  mat.diffuseColor = new Color3(0.82, 0.82, 0.82); // белый базис → видны vertex colors
  if (options.matte !== false) {
    mat.specularColor = new Color3(0.04, 0.04, 0.04);
  }
  const em = options.emissive;
  const es = options.emissiveStrength ?? 0;
  if (em && es > 0) {
    mat.emissiveColor = new Color3(em[0] * es, em[1] * es, em[2] * es);
  }
  if (options.alpha !== undefined && options.alpha < 1) {
    mat.alpha = options.alpha;
  }
  merged.material = mat;
  merged.isPickable = false;
  merged.doNotSyncBoundingInfo = true;
  return merged;
}

// ── Greedy meshing (research §12.2 — Lysenko 0fps) ───────────────────────────
// Multi-attribute greedy meshing: sweep по 3 осям; для каждой пары соседних слоёв
// строим 2D mask[u×v] ключей граней (ключ = упакованный (colorQuant | normalSign));
// greedy-merge маски в наибольшие axis-aligned прямоугольники; эммит quad'ов
// (2 треугольника) с vertex colors (baked per-face tint + per-vertex AO — те же
// константы/хелперы, что в naive). Greedy НЕ применяет jitter (он мержит ячейки).
// AO считается per-vertex по соседям в исходной grid (через общий vertexAO()).
//
// Гарантия аппроксимации (теорема Lysenko): Greedy ≤ 8·Optimal. На сплошном 8³
// кубе: naive=3072 quads → greedy=6 (доказуемо оптимально).

/**
 * Порог количества вокселей для авто-выбора greedy в asset-catalog (>$threshold).
 * M0: снижен с 200 → 80 — greedy mesher верифицирован (tri-reduction/AABB/NaN smoke),
 * даёт радикально меньше треугольников уже на medium-моделях (skeleton/zombie/units),
 * визуально идентичен naive (тот же baked tint+AO, просто merged-quad'ы).
 * Tiny-модели (projectile:bolt) остаются naive — overhead greedy для <80 вокселей
 * не окупается, а box-аппроксимация достаточно дёшева.
 */
export const GREEDY_VOXEL_THRESHOLD = 80;

export interface GreedyGeometry {
  positions: number[];
  indices: number[];
  colors: number[];   // RGBA per vertex (baked tint*ao)
  normals: number[];  // face normal per vertex
}

/** Квантование RGB → 24-бит ключ для multi-attribute сравнения цветов при мерже. */
function colorKeyOf(rgb: RGB): number {
  const r = Math.max(0, Math.min(255, Math.round(rgb[0] * 255)));
  const g = Math.max(0, Math.min(255, Math.round(rgb[1] * 255)));
  const b = Math.max(0, Math.min(255, Math.round(rgb[2] * 255)));
  return (r << 16) | (g << 8) | b;
}

/**
 * Pure (no-Scene) greedy geometry: Voxel[] → {positions, indices, colors, normals}.
 * Используется и buildVoxelMeshGreedy, и headless-тестами (smoke-voxel-mesh).
 *
 * Алгоритм (research §12.2): sweep axis∈{x,y,z}; для каждой границы d между слоем
 * d-1 и d строим mask[iu,iv] — ключ грани (colorQuant·2 + sign, 0=нет грани).
 * Greedy-merge ячеек с идентичным ключом в прямоугольники w×h → один quad.
 * Циклический порядок (axis,u,v) сохраняет handedness → CCW-вершины дают +axis
 * normal; для -face обращаем winding. AO per-vertex через общий vertexAO() с
 * owning-вокселем (угол quad'а) — те же соседи, что в naive.
 */
export function computeGreedyGeometry(voxels: Voxel[], flat: boolean): GreedyGeometry {
  const positions: number[] = [];
  const indices: number[] = [];
  const colors: number[] = [];
  const normals: number[] = [];

  // dedup по клетке (last-wins) — идентично buildVoxelMesh.
  const cells = new Map<string, RGB>();
  for (const v of voxels) {
    cells.set(`${Math.round(v.x)},${Math.round(v.y)},${Math.round(v.z)}`, v.color);
  }
  if (cells.size === 0) return { positions, indices, colors, normals };

  const colAt = (x: number, y: number, z: number): RGB | undefined => cells.get(`${x},${y},${z}`);

  // bounds
  let bmin0 = Infinity, bmin1 = Infinity, bmin2 = Infinity;
  let bmax0 = -Infinity, bmax1 = -Infinity, bmax2 = -Infinity;
  for (const k of cells.keys()) {
    const p = k.split(',');
    const x = +p[0]!, y = +p[1]!, z = +p[2]!;
    if (x < bmin0) bmin0 = x; if (x > bmax0) bmax0 = x;
    if (y < bmin1) bmin1 = y; if (y > bmax1) bmax1 = y;
    if (z < bmin2) bmin2 = z; if (z > bmax2) bmax2 = z;
  }
  const boundsMin = [bmin0, bmin1, bmin2];
  const boundsMax = [bmax0, bmax1, bmax2];

  for (let axis = 0; axis < 3; axis++) {
    const u = (axis + 1) % 3;
    const v = (axis + 2) % 3;
    const minU = boundsMin[u]!, maxU = boundsMax[u]!;
    const minV = boundsMin[v]!, maxV = boundsMax[v]!;
    const uLen = maxU - minU + 1;
    const vLen = maxV - minV + 1;
    const mask = new Int32Array(uLen * vLen); // 0 = нет грани; иначе colorKey·2 + signBit

    // sweep по всем границам d ∈ [minAxis .. maxAxis+1] (включая past-end).
    for (let d = boundsMin[axis]!; d <= boundsMax[axis]! + 1; d++) {
      // собрать маску для границы d: грань между слоем d-1 (lo) и d (hi).
      // (axis,u,v) — полная перестановка (0,1,2): coord[axis]=d±0, coord[u]=cu, coord[v]=cv.
      for (let iu = 0; iu < uLen; iu++) {
        for (let iv = 0; iv < vLen; iv++) {
          const cu = minU + iu;
          const cv = minV + iv;
          const lo: [number, number, number] = [0, 0, 0];
          lo[axis] = d - 1; lo[u] = cu; lo[v] = cv;
          const hi: [number, number, number] = [0, 0, 0];
          hi[axis] = d; hi[u] = cu; hi[v] = cv;
          const loC = colAt(lo[0], lo[1], lo[2]);
          const hiC = colAt(hi[0], hi[1], hi[2]);
          let key = 0;
          if (loC && !hiC) key = colorKeyOf(loC) * 2 + 1;       // +face (normal +axis)
          else if (!loC && hiC) key = colorKeyOf(hiC) * 2 + 2;  // -face (normal -axis)
          mask[iu * vLen + iv] = key;
        }
      }
      // greedy merge маски в прямоугольники
      for (let n = 0; n < mask.length; n++) {
        const key = mask[n]!;
        if (key === 0) continue;
        const sign = (key & 1) === 1 ? 1 : -1;
        const iu0 = Math.floor(n / vLen);
        const iv0 = n % vLen;
        // ширина по iv (внутри строки)
        let w = 1;
        while (iv0 + w < vLen && mask[iu0 * vLen + iv0 + w] === key) w++;
        // высота по iu (целые строки одинаковой ширины)
        let h = 1;
        let canGrow = true;
        while (iu0 + h < uLen && canGrow) {
          for (let k = 0; k < w; k++) {
            if (mask[(iu0 + h) * vLen + iv0 + k] !== key) { canGrow = false; break; }
          }
          if (canGrow) h++;
        }
        emitGreedyQuad(
          axis, u, v, d, minU, minV, iu0, iv0, w, h, sign,
          colAt, cells, flat, positions, indices, colors, normals
        );
        // обнулить w×h ячеек маски
        for (let a = 0; a < h; a++) {
          for (let b = 0; b < w; b++) mask[(iu0 + a) * vLen + iv0 + b] = 0;
        }
      }
    }
  }
  return { positions, indices, colors, normals };
}

/** Эммит одного quad'а (4 вершины + 2 треугольника) с baked tint+AO. */
function emitGreedyQuad(
  axis: number, u: number, v: number, d: number,
  minU: number, minV: number, iu0: number, iv0: number, w: number, h: number,
  sign: number,
  colAt: (x: number, y: number, z: number) => RGB | undefined,
  cells: Map<string, RGB>,
  flat: boolean,
  positions: number[], indices: number[], colors: number[], normals: number[]
): void {
  // tangent continuous coords (воксель k центрирован в k → [k-0.5, k+0.5]).
  const umin = minU + iu0 - 0.5;
  const umax = minU + iu0 + h - 0.5;     // правый край: последний воксель iu0+h-1 +0.5
  const vmin = minV + iv0 - 0.5;
  const vmax = minV + iv0 + w - 0.5;
  const dAxis = d - 0.5;                  // плоскость границы
  // CCW в (u,v): C0=(umin,vmin) C1=(umax,vmin) C2=(umax,vmax) C3=(umin,vmax)
  const cu = [umin, umax, umax, umin];
  const cv = [vmin, vmin, vmax, vmax];
  // owning-воксель (угол quad'а) для AO: слой axis = sign>0 ? d-1 : d
  const ownAxis = sign > 0 ? d - 1 : d;
  const ownIU = [iu0, iu0 + h - 1, iu0 + h - 1, iu0];
  const ownIV = [iv0, iv0, iv0 + w - 1, iv0 + w - 1];
  // цвет quad'а = цвет owning-вокселя (точно из cells, без квантования)
  const ownPos: [number, number, number] = [0, 0, 0];
  ownPos[axis] = ownAxis; ownPos[u] = minU + ownIU[0]!; ownPos[v] = minV + ownIV[0]!;
  const color = colAt(ownPos[0], ownPos[1], ownPos[2])!;
  const accent = isAccentColor(color);

  const baseIdx = positions.length / 3;
  for (let c = 0; c < 4; c++) {
    const pu = cu[c]!;
    const pv = cv[c]!;
    const p: [number, number, number] = [0, 0, 0];
    p[axis] = dAxis; p[u] = pu; p[v] = pv;
    positions.push(p[0], p[1], p[2]);
    // normal = sign × +axis
    const nrm: [number, number, number] = [0, 0, 0];
    nrm[axis] = sign;
    normals.push(nrm[0], nrm[1], nrm[2]);
    // baked per-face tint (3-tier) — акценты без tint
    let t = FACE_TINT_TOP;
    if (!accent) {
      if (axis === 1 && sign > 0) t = FACE_TINT_TOP;        // +Y
      else if (axis === 1 && sign < 0) t = FACE_TINT_BOTTOM; // -Y
      else t = FACE_TINT_SIDE;
    }
    // per-vertex AO (0..3) через общий vertexAO() — те же соседи, что в naive.
    let ao = 1.0;
    if (!accent && !flat) {
      const own: [number, number, number] = [0, 0, 0];
      own[axis] = ownAxis; own[u] = minU + ownIU[c]!; own[v] = minV + ownIV[c]!;
      const level = vertexAO(cells, own[0], own[1], own[2], nrm[0], nrm[1], nrm[2], p[0], p[1], p[2]);
      ao = AO_FACTORS[level]!;
    }
    const b = t * ao; // jitter отключён для greedy (мерж ячеек)
    colors.push(color[0] * b, color[1] * b, color[2] * b, 1);
  }
  // triangles: +axis → (0,1,2)(0,2,3); -axis → reversed для корректного normal/winding
  if (sign > 0) {
    indices.push(baseIdx, baseIdx + 1, baseIdx + 2, baseIdx, baseIdx + 2, baseIdx + 3);
  } else {
    indices.push(baseIdx, baseIdx + 3, baseIdx + 2, baseIdx, baseIdx + 2, baseIdx + 1);
  }
}

/**
 * Строит единый воксельный меш через greedy meshing (research §12.2).
 * Контракт идентичен buildVoxelMesh (normalizeMesh + StandardMaterial + freeze-ready),
 * но triangle count резко ниже для моделей с большими плоскими поверхностями.
 * Вызывающий владеет результатом (должен dispose).
 */
export function buildVoxelMeshGreedy(scene: Scene, voxels: Voxel[], options: VoxelMeshOptions): Mesh {
  const geo = computeGreedyGeometry(voxels, Boolean(options.flat));
  const mesh = new Mesh(options.name, scene);
  if (geo.positions.length === 0) {
    // пустая модель — крошечный бокс (как в naive)
    const tiny = MeshBuilder.CreateBox(options.name, { size: 0.05 }, scene);
    return tiny;
  }
  const vd = new VertexData();
  vd.positions = geo.positions;
  vd.indices = geo.indices;
  vd.colors = geo.colors;
  vd.normals = geo.normals;
  vd.applyToMesh(mesh, false);
  normalizeMesh(mesh);

  const mat = new StandardMaterial(`${options.name}-mat`, scene);
  mat.diffuseColor = new Color3(0.82, 0.82, 0.82);
  if (options.matte !== false) {
    mat.specularColor = new Color3(0.04, 0.04, 0.04);
  }
  const em = options.emissive;
  const es = options.emissiveStrength ?? 0;
  if (em && es > 0) {
    mat.emissiveColor = new Color3(em[0] * es, em[1] * es, em[2] * es);
  }
  if (options.alpha !== undefined && options.alpha < 1) {
    mat.alpha = options.alpha;
  }
  mesh.material = mat;
  mesh.isPickable = false;
  mesh.doNotSyncBoundingInfo = true;
  return mesh;
}

// ──────────────────────────────────────────────────────────────────────
//  Определения моделей. Координаты — целочисленная сетка (unit-кубы).
//  Гуманоиды: ширина X (− лево, + право), лицо в +Z, стопы y=0, высота ~16–20.
// ──────────────────────────────────────────────────────────────────────

/** Скелет — костяной гуманоид с ребрами, черепом и ржавым мечом. */
export function skeletonEnemy(): Voxel[] {
  const v: Voxel[] = [];
  const bo = PALETTE.bone, bod = PALETTE.boneDark;
  const e = ACCENT.eyeRed, sw = PALETTE.metalLight, wd = PALETTE.woodDark;
  // ноги
  box3(v, -2, -1, 0, 1, 0, 1, bod);   box3(v, 1, 2, 0, 1, 0, 1, bod);   // ступни
  box3(v, -1, -1, 2, 5, 0, 0, bod);   box3(v, 1, 1, 2, 5, 0, 0, bod);   // голени
  cube(v, -1, 6, 0, bo);              cube(v, 1, 6, 0, bo);             // колени
  box3(v, -1, -1, 7, 8, 0, 0, bod);   box3(v, 1, 1, 7, 8, 0, 0, bod);   // бёдра
  // таз
  box3(v, -2, 2, 9, 10, 0, 1, bod);
  // позвоночник + ребра
  box3(v, -1, 0, 11, 14, 0, 0, bo);
  box3(v, -2, -1, 12, 12, 0, 0, bo);  box3(v, 1, 2, 12, 12, 0, 0, bo);
  box3(v, -2, -1, 13, 13, 0, 0, bo);  box3(v, 1, 2, 13, 13, 0, 0, bo);
  box3(v, -2, -2, 11, 11, 0, 0, bo);  box3(v, 2, 3, 11, 11, 0, 0, bo);  // нижние ребра
  // плечи + руки
  box3(v, -2, 2, 14, 14, 0, 1, bo);                                     // ключицы
  box3(v, -3, -2, 10, 13, 0, 0, bod); box3(v, 2, 3, 10, 13, 0, 0, bod); // плечи
  box3(v, -3, -2, 7, 9, 0, 0, bod);  box3(v, 2, 3, 7, 9, 0, 0, bod);    // предплечья
  cube(v, -3, 6, 0, bo);             cube(v, 3, 6, 0, bo);              // кисти
  // череп
  box3(v, -2, 2, 15, 18, -1, 1, bo);
  box3(v, -1, 1, 19, 19, 0, 0, bo);                                     // макушка
  cube(v, -1, 17, 1, e);             cube(v, 1, 17, 1, e);              // глазницы
  cube(v, 0, 16, 1, bod);                                               // нос-дырка
  box3(v, -1, 1, 14, 14, 0, 1, bod);                                    // зубы (тёмная полоса)
  // ржавый меч в правой кисти
  cube(v, 3, 6, 1, wd);
  box3(v, 3, 3, 7, 12, 1, 1, sw);
  cube(v, 3, 13, 1, ACCENT.gold);
  return v;
}

/** Гоблин — сгорбленный, зелёный, длинные руки, большие уши, дубина. */
export function goblinEnemy(): Voxel[] {
  const v: Voxel[] = [];
  const f = PALETTE.flesh, fd = PALETTE.fleshDark, mo = PALETTE.moss;
  const e = ACCENT.eyeDemon, wd = PALETTE.woodDark;
  // короткие кривые ноги
  box3(v, -2, -1, 0, 1, 0, 1, fd);  box3(v, 1, 2, 0, 1, 0, 1, fd);
  box3(v, -1, -1, 2, 4, 0, 0, fd);  box3(v, 1, 1, 2, 4, 0, 0, fd);
  // таз + сгорбленный торс (верхние слои сдвинуты вперёд по +Z — сутулость)
  box3(v, -2, 2, 5, 6, 0, 1, mo);
  box3(v, -2, 2, 7, 9, 0, 1, f);
  box3(v, -1, 2, 10, 12, 1, 2, f);
  // длинные руки до земли
  box3(v, -3, -3, 6, 11, 0, 0, fd); box3(v, 2, 3, 6, 11, 0, 0, fd);
  cube(v, -3, 5, 0, fd);            cube(v, 3, 5, 0, fd);
  // голова (большая, вперёд)
  box3(v, -2, 2, 11, 14, 1, 2, f);
  // большие уши
  box3(v, -3, -3, 12, 13, 1, 1, fd); box3(v, 2, 3, 12, 13, 1, 1, fd);
  cube(v, 0, 12, 3, fd);                                               // нос-клюв
  cube(v, -1, 13, 2, e);            cube(v, 1, 13, 2, e);              // глаза
  // дубина в правой руке
  cube(v, 3, 5, 1, wd);
  box3(v, 3, 3, 6, 9, 1, 1, wd);
  cube(v, 3, 10, 1, wd);
  return v;
}

/** Зомби — гнилое туловище, одна рука длиннее, рваная плоть. */
export function zombieEnemy(): Voxel[] {
  const v: Voxel[] = [];
  const f = PALETTE.fleshDark, fd = shade(PALETTE.fleshDark, 0.7), fl = shade(PALETTE.fleshDark, 1.15);
  const e = ACCENT.eyeRed;
  // ноги (одна короче — хромота)
  box3(v, -2, -1, 0, 1, 0, 1, fd);  box3(v, 1, 2, 0, 1, 0, 1, fd);
  box3(v, -1, -1, 2, 6, 0, 0, fd);  box3(v, 1, 1, 2, 5, 0, 0, fd);
  // таз + раздутый живот
  box3(v, -2, 2, 7, 8, 0, 1, fd);
  box3(v, -2, 2, 9, 13, 0, 1, f);
  cube(v, 0, 11, 1, fd);                                               // провал живота
  // левая рука (обычная), правая (длиннее, тянется вперёд)
  box3(v, -3, -3, 9, 13, 0, 0, fd);
  box3(v, 2, 3, 9, 14, 1, 1, fd);                                      // вытянутая рука
  box3(v, 2, 3, 15, 16, 1, 1, fl);                                     // кисть (светлее)
  cube(v, -3, 8, 0, fd);
  // голова (скособочена)
  box3(v, -1, 3, 14, 17, 0, 1, fl);
  cube(v, -2, 15, 1, f);            cube(v, 2, 15, 1, f);              // глаза (тусклые)
  cube(v, -2, 15, 1, e);            cube(v, 2, 15, 1, e);
  box3(v, -1, 2, 17, 17, 0, 1, fd);                                    // волосы/гниль
  cube(v, 1, 16, 1, fd);                                               // открытый рот
  return v;
}

/** Демон — крупный, рогатый, тёмно-багровый, когти. */
export function demonEnemy(): Voxel[] {
  const v: Voxel[] = [];
  const sk = PALETTE.metalDark, bl = ACCENT.blood, bls = shade(ACCENT.blood, 0.55);
  const e = ACCENT.eyeDemon;
  // массивные ноги (задние, согнутые)
  box3(v, -3, -1, 0, 1, 0, 2, sk);  box3(v, 1, 3, 0, 1, 0, 2, sk);
  box3(v, -3, -2, 2, 6, 0, 1, sk);  box3(v, 2, 3, 2, 6, 0, 1, sk);
  box3(v, -3, -1, 7, 8, 0, 0, sk);  box3(v, 1, 2, 7, 8, 0, 0, sk);     // стопы-когти вперёд
  // бочкообразный торс
  box3(v, -3, 3, 9, 14, 0, 1, bls);
  box3(v, -2, 2, 9, 14, 2, 2, sk);
  cube(v, 0, 12, 1, bl);            cube(v, 0, 13, 1, bl);             // рубцы на груди
  // массивные плечи + руки (длинные, с когтями)
  box3(v, -4, -3, 11, 13, 0, 1, sk); box3(v, 2, 4, 11, 13, 0, 1, sk);
  box3(v, -4, -3, 8, 10, 0, 0, sk); box3(v, 3, 4, 8, 10, 0, 0, sk);
  cube(v, -4, 7, 0, e);             cube(v, 4, 7, 0, e);               // когти-свет
  // голова
  box3(v, -2, 2, 15, 18, 0, 1, bls);
  box3(v, -1, 2, 19, 19, 0, 1, bls);                                   // лоб/нос
  cube(v, -1, 17, 1, e);            cube(v, 1, 17, 1, e);              // глаза
  box3(v, -1, 1, 15, 15, 1, 1, bl);                                    // пасть/клыки
  // рога
  box3(v, -3, -2, 18, 20, 0, 0, PALETTE.boneDark); box3(v, 2, 3, 18, 20, 0, 0, PALETTE.boneDark);
  cube(v, -3, 21, 0, PALETTE.bone); cube(v, 3, 21, 0, PALETTE.bone);    // кончики рогов
  return v;
}

/** Владыка (босс) — огромный тёмный лорд с большими рогами и магией. */
export function bossEnemy(): Voxel[] {
  const v: Voxel[] = [];
  const sd = PALETTE.stoneDark, bl = ACCENT.blood, bls = shade(ACCENT.blood, 0.4);
  const ar = ACCENT.arcane, e = ACCENT.eyeDemon;
  // огромные ноги
  box3(v, -4, -2, 0, 1, 0, 2, sd);  box3(v, 2, 4, 0, 1, 0, 2, sd);
  box3(v, -4, -2, 2, 8, 0, 1, sd);  box3(v, 2, 4, 2, 8, 0, 1, sd);
  // массивный торс (плащ-накидка расширяется вниз)
  box3(v, -4, 4, 9, 16, -1, 2, bls);
  box3(v, -3, 3, 9, 16, 2, 3, sd);
  box3(v, -5, 5, 9, 12, -1, 2, shade(sd, 0.8));                        // плечи-наплечники
  box3(v, -5, 5, 13, 16, 0, 1, sd);                                    // рукава плаща
  // руки
  box3(v, -6, -5, 11, 16, 0, 1, shade(sd, 0.8)); box3(v, 4, 6, 11, 16, 0, 1, shade(sd, 0.8));
  cube(v, -6, 10, 0, bl);           cube(v, 6, 10, 0, bl);             // когти
  // голова
  box3(v, -3, 3, 17, 21, 0, 1, bls);
  box3(v, -2, 2, 22, 22, 0, 1, bls);
  cube(v, -2, 19, 1, e);            cube(v, 2, 19, 1, e);              // горящие глаза
  box3(v, -1, 2, 17, 17, 1, 1, ar);                                    // светящаяся пасть
  cube(v, 0, 20, 1, ar);                                               // руна на лбу
  // большие рога (изогнутые)
  box3(v, -4, -3, 19, 23, 0, 0, PALETTE.boneDark); box3(v, 3, 4, 19, 23, 0, 0, PALETTE.boneDark);
  box3(v, -5, -4, 23, 25, 0, 0, PALETTE.boneDark); box3(v, 4, 5, 23, 25, 0, 0, PALETTE.boneDark);
  cube(v, -5, 26, 0, PALETTE.bone); cube(v, 5, 26, 0, PALETTE.bone);
  return v;
}

// ── Post-MVP: разнообразные силуэты врагов (расширение каталога) ────────────
// Цель: уйти от «все враги — гуманоиды»; разные пропорции, palette swap, летающие.

/** Слизень — низкий, широкий, дрожащий; кислотно-зелёный с фиолетовыми вкраплениями. */
export function slimeEnemy(): Voxel[] {
  const v: Voxel[] = [];
  const base = shade(PALETTE.moss, 0.85);
  const dark = shade(base, 0.6);
  const light = shade(base, 1.3);
  const ar = ACCENT.arcane;
  // широкое полусферическое тело (3 слоя по Y, расширяется к середине)
  box3(v, -3, 3, 0, 0, -2, 2, dark);                  // нижний слой (узкий)
  box3(v, -4, 4, 1, 1, -3, 3, base);                  // средний слой (широкий)
  box3(v, -3, 3, 2, 2, -2, 2, light);                 // верхний слой (меньше)
  // купол (округлая верхушка)
  box3(v, -2, 2, 3, 3, -1, 1, light);
  cube(v, 0, 4, 0, light);
  cube(v, -1, 4, 1, light); cube(v, 1, 4, 1, light);
  // глаза на поверхности (два фиолетовых)
  cube(v, -2, 2, 3, ar); cube(v, 2, 2, 3, ar);
  // капли слизи внизу
  cube(v, -4, 0, 2, dark); cube(v, 4, 0, -2, dark);
  cube(v, 0, 0, 3, dark); cube(v, 0, 0, -3, dark);
  return v;
}

/** Летучая мышь — маленькая, крылатая; летает (flies=true в каталоге). */
export function batEnemy(): Voxel[] {
  const v: Voxel[] = [];
  const sk = PALETTE.metalDark, skd = shade(PALETTE.metalDark, 0.6);
  const e = ACCENT.eyeRed, fl = shade(PALETTE.metalDark, 1.4);
  // тело (компактный «шарик»)
  box3(v, -1, 1, 2, 4, -1, 1, sk);
  cube(v, 0, 5, 0, sk);                                // голова
  cube(v, 0, 6, 0, skd);                               // уши
  cube(v, -1, 6, 0, skd); cube(v, 1, 6, 0, skd);
  cube(v, -1, 5, 1, e); cube(v, 1, 5, 1, e);           // горящие глаза
  // крылья — растопыренные (3 сегмента с каждой стороны)
  box3(v, -2, -3, 1, 2, 0, 1, fl);                     // левое крыло, внутреннее
  box3(v, -5, -4, 1, 1, 1, 1, fl);                     // левое крыло, среднее (тонкое)
  cube(v, -6, 1, 1, fl); cube(v, -7, 1, 1, fl);        // левое крыло, кончик
  box3(v, 2, 3, 1, 2, 0, 1, fl);                       // правое крыло
  box3(v, 4, 5, 1, 1, 1, 1, fl);
  cube(v, 6, 1, 1, fl); cube(v, 7, 1, 1, fl);
  // хвост/задние лапки
  cube(v, 0, 1, -1, skd); cube(v, -1, 0, -1, skd); cube(v, 1, 0, -1, skd);
  return v;
}

/** Паук — компактное тело + 8 ног; тёмный, с красными глазами. */
export function spiderEnemy(): Voxel[] {
  const v: Voxel[] = [];
  const sk = PALETTE.metalDark, skd = shade(PALETTE.metalDark, 0.65);
  const e = ACCENT.eyeRed;
  // брюшко (большое, круглое, немного вытянутое по Z)
  box3(v, -2, 2, 1, 4, -2, 2, sk);
  box3(v, -2, 2, 5, 6, -2, 2, skd);
  cube(v, 0, 7, 0, skd);
  // головогрудь (перед брюшком, меньше)
  box3(v, -1, 1, -1, 1, -1, 1, sk);
  // глаза (6 — по 3 с каждой стороны, как у настоящего паука)
  cube(v, -1, 0, 0, e); cube(v, 1, 0, 0, e);
  cube(v, -2, 0, 0, e); cube(v, 2, 0, 0, e);
  cube(v, -1, 1, 0, e); cube(v, 1, 1, 0, e);
  // 8 ног (по 4 с каждой стороны; 2 сустава)
  // левые ноги (4)
  box3(v, -3, -2, 1, 1, 0, 0, skd); box3(v, -5, -4, 1, 1, 0, 0, skd);
  box3(v, -3, -2, 3, 3, 0, 0, skd); box3(v, -5, -4, 3, 3, 0, 0, skd);
  box3(v, -3, -2, 5, 5, 0, 0, skd); box3(v, -5, -4, 5, 5, 0, 0, skd);
  box3(v, -3, -2, 7, 7, 0, 0, skd); box3(v, -5, -4, 7, 7, 0, 0, skd);
  // правые ноги (4)
  box3(v, 2, 3, 1, 1, 0, 0, skd); box3(v, 4, 5, 1, 1, 0, 0, skd);
  box3(v, 2, 3, 3, 3, 0, 0, skd); box3(v, 4, 5, 3, 3, 0, 0, skd);
  box3(v, 2, 3, 5, 5, 0, 0, skd); box3(v, 4, 5, 5, 5, 0, 0, skd);
  box3(v, 2, 3, 7, 7, 0, 0, skd); box3(v, 4, 5, 7, 7, 0, 0, skd);
  return v;
}

/** Призрак — парящий, без ног, полупрозрачный; бледно-голубой с тёмными глазами. */
export function ghostEnemy(): Voxel[] {
  const v: Voxel[] = [];
  const body = desaturate([0.55, 0.62, 0.72], 0.18);
  const dark = shade(body, 0.55);
  const light = shade(body, 1.25);
  const e = ACCENT.soul;
  // верх-капюшон (округлая верхушка)
  box3(v, -2, 2, 6, 8, -1, 1, light);
  box3(v, -3, 3, 4, 5, -1, 1, body);
  cube(v, 0, 8, 0, light); cube(v, -1, 8, 0, light); cube(v, 1, 8, 0, light);
  // лицо — тень под капюшоном
  box3(v, -1, 1, 4, 5, 0, 1, PALETTE.metalDark);
  cube(v, -1, 5, 2, e); cube(v, 1, 5, 2, e);          // светящиеся глаза
  cube(v, 0, 4, 2, dark);                              // рот-провал
  // струящееся «тело» — сужается книзу, рваный низ
  box3(v, -3, 3, 1, 3, -1, 1, body);
  box3(v, -2, 2, 0, 0, -1, 1, dark);
  // рваный подол (тёмные полосы)
  cube(v, -2, 0, 0, dark); cube(v, 0, 0, 0, dark); cube(v, 2, 0, 0, dark);
  cube(v, -3, 0, 1, dark); cube(v, 3, 0, 1, dark);
  // призрачные «руки» (полупрозрачные — визуально через alpha в catalog)
  box3(v, -4, -4, 2, 4, 0, 0, light);
  box3(v, 3, 4, 2, 4, 0, 0, light);
  return v;
}

/** Лучник — деревянная сторожевая башня: 4 угловых столба, платформа, перила, острая крыша, факел. */
export function arrowTower(): Voxel[] {
  const v: Voxel[] = [];
  const w = PALETTE.wood, wd = PALETTE.woodDark, wl = PALETTE.woodLight;
  // 4 угловых столба
  box3(v, -4, -3, 0, 14, -3, -3, wd); box3(v, 3, 4, 0, 14, -3, -3, wd);
  box3(v, -4, -3, 0, 14, 3, 3, wd);  box3(v, 3, 4, 0, 14, 3, 3, wd);
  // перекладины (арочной структуры)
  box3(v, -4, 4, 5, 5, -3, 3, w);    box3(v, -4, 4, 10, 10, -3, 3, w);
  // платформа лучников
  box3(v, -4, 4, 14, 15, -3, 3, wl);
  // перила (с бойницами — с зазорами)
  box3(v, -4, -4, 16, 18, -3, -3, w); box3(v, 3, 4, 16, 18, -3, -3, w);
  box3(v, -4, -4, 16, 18, 3, 3, w);   box3(v, 3, 4, 16, 18, 3, 3, w);
  cube(v, -2, 17, -3, w); cube(v, 0, 17, -3, w); cube(v, 2, 17, -3, w); // фронт-перила
  // острая крыша (ступенчатая)
  box3(v, -4, 4, 19, 19, -3, 3, shade(wd, 0.85));
  box3(v, -3, 3, 20, 20, -3, 3, shade(wd, 0.85));
  box3(v, -2, 2, 21, 21, -2, 2, shade(wd, 0.85));
  box3(v, -1, 1, 22, 22, -1, 1, shade(wd, 0.8));
  cube(v, 0, 23, 0, ACCENT.gold);                                      // шпиль
  // факел на углу
  cube(v, 4, 12, -3, wd);
  cube(v, 4, 14, -3, ACCENT.fireCore);
  cube(v, 4, 15, -3, ACCENT.fire);
  return v;
}

/** Осада — каменная крепость с чёрной пушкой. */
export function cannonTower(): Voxel[] {
  const v: Voxel[] = [];
  const s = PALETTE.stone, sd = PALETTE.stoneDark, sl = PALETTE.stoneLight;
  const md = PALETTE.metalDark, m = PALETTE.metal;
  // основание-бастион
  box3(v, -5, 5, 0, 4, -4, 4, sd);
  box3(v, -4, 4, 4, 8, -4, 4, s);
  // кладка (горизонтальные швы — тёмные полосы)
  box3(v, -4, 4, 5, 5, -4, 4, shade(s, 0.9));
  box3(v, -4, 4, 7, 7, -4, 4, shade(s, 0.9));
  // зубцы (merlons) с бойницами
  box3(v, -5, -4, 9, 11, -4, -4, sl); box3(v, -1, 0, 9, 11, -4, -4, sl); box3(v, 3, 5, 9, 11, -4, -4, sl);
  box3(v, -5, -4, 9, 11, 4, 4, sl);   box3(v, -1, 0, 9, 11, 4, 4, sl);   box3(v, 3, 5, 9, 11, 4, 4, sl);
  box3(v, -5, -5, 9, 11, -1, -1, sl); box3(v, 3, 5, 9, 11, -1, -1, sl);  // боковые зубцы
  box3(v, -5, -5, 9, 11, 1, 1, sl);   box3(v, 3, 5, 9, 11, 1, 1, sl);
  // пушка-ствол (чёрный, горизонтально вдоль +Z, выглядывает из бойницы +Z)
  box3(v, -1, 1, 6, 11, 3, 4, md);
  box3(v, -2, 2, 4, 6, 2, 5, m);                                        // казённик
  cube(v, 0, 8, 4, ACCENT.fireCore); cube(v, 0, 9, 4, ACCENT.fireCore);  // жерло
  // колёса
  cube(v, -2, 5, 4, sd); cube(v, 2, 5, 4, sd); cube(v, -2, 5, -4, sd); cube(v, 2, 5, -4, sd);
  return v;
}

/** Аркан — тёмный обелиск со светящимся кристаллом и рунами. */
export function arcaneTower(): Voxel[] {
  const v: Voxel[] = [];
  const sd = PALETTE.stoneDark, sl = PALETTE.stoneLight;
  const ar = ACCENT.arcane, arc = ACCENT.arcaneCore;
  // основание
  box3(v, -4, 4, 0, 3, -4, 4, sd);
  box3(v, -3, 3, 3, 5, -3, 3, sl);
  // обелиск (сужается вверх ступенями)
  box3(v, -3, 3, 6, 10, -3, 3, sd);
  box3(v, -3, 3, 6, 10, -3, 3, sl);   // (перекрытие → нижний слой sd ниже)
  box3(v, -2, 2, 6, 9, -2, 2, sd);
  box3(v, -2, 2, 11, 14, -2, 2, sl);
  box3(v, -1, 1, 11, 13, -1, 1, sd);
  box3(v, -1, 1, 15, 17, -1, 1, sl);
  // светящиеся руны по граням (после корпуса → перекрывают)
  cube(v, 0, 8, 3, ar); cube(v, 0, 11, 3, ar); cube(v, 0, 14, 3, ar);
  cube(v, -3, 8, 0, ar); cube(v, 3, 11, 0, ar);
  // кристалл на вершине (ромб из кубов)
  box3(v, -1, 1, 18, 18, -1, 1, ar);
  cube(v, 0, 19, 0, ar); cube(v, 0, 17, 0, ar);
  cube(v, -1, 18, 0, ar); cube(v, 1, 18, 0, ar); cube(v, 0, 18, -1, ar); cube(v, 0, 18, 1, ar);
  cube(v, 0, 20, 0, arc); cube(v, 0, 16, 0, arc);
  return v;
}

/** Лёд — обледенелый шпиль с кристаллом льда и сосульками. */
export function iceTower(): Voxel[] {
  const v: Voxel[] = [];
  const s = PALETTE.stoneLight, sd = PALETTE.stoneDark;
  const ic = ACCENT.ice, icc = ACCENT.iceCore;
  // основание
  box3(v, -4, 4, 0, 3, -4, 4, sd);
  box3(v, -3, 3, 3, 5, -3, 3, s);
  // шпиль (сужается)
  box3(v, -3, 3, 6, 9, -3, 3, s);
  box3(v, -2, 2, 10, 13, -2, 2, shade(s, 0.92));
  box3(v, -1, 1, 14, 16, -1, 1, shade(s, 0.85));
  // сосульки по краям
  box3(v, -4, -4, 6, 7, 0, 0, ic); box3(v, 3, 4, 6, 8, 0, 0, ic);
  box3(v, 0, 0, 6, 7, -4, -4, ic); box3(v, 0, 0, 6, 8, 3, 4, ic);
  // кристалл льда (ромб)
  box3(v, -1, 1, 17, 17, -1, 1, ic);
  cube(v, 0, 18, 0, ic);
  cube(v, -1, 17, 0, ic); cube(v, 1, 17, 0, ic); cube(v, 0, 17, -1, ic); cube(v, 0, 17, 1, ic);
  cube(v, 0, 19, 0, icc); cube(v, 0, 16, 0, icc);
  return v;
}

/** База — алтарь с кристаллом-душой. */
export function baseAltar(): Voxel[] {
  const v: Voxel[] = [];
  const sd = PALETTE.stoneDark, s = PALETTE.stone;
  const so = ACCENT.soul, icc = ACCENT.iceCore, g = ACCENT.gold;
  // кольцо-основание (квадратный подиум со ступенями)
  box3(v, -5, 5, 0, 2, -5, 5, sd);
  box3(v, -4, 4, 2, 3, -4, 4, s);
  box3(v, -3, 3, 3, 4, -3, 3, shade(s, 0.92));
  // руны золотом по углам подиума
  cube(v, -4, 1, -4, g); cube(v, 4, 1, -4, g); cube(v, -4, 1, 4, g); cube(v, 4, 1, 4, g);
  cube(v, -4, 2, -4, g); cube(v, 4, 2, -4, g); cube(v, -4, 2, 4, g); cube(v, 4, 2, 4, g);
  // обелиски-поддержка по углам
  box3(v, -3, -3, 4, 9, -3, -3, sd); box3(v, 3, 3, 4, 9, -3, -3, sd);
  box3(v, -3, -3, 4, 9, 3, 3, sd);   box3(v, 3, 3, 4, 9, 3, 3, sd);
  // кристалл-ядро (большой ромб)
  box3(v, -2, 2, 5, 10, -2, 2, so);
  cube(v, 0, 11, 0, so); cube(v, 0, 4, 0, so);
  cube(v, -3, 7, 0, so); cube(v, 3, 7, 0, so); cube(v, 0, 7, -3, so); cube(v, 0, 7, 3, so);
  cube(v, 0, 8, 0, icc); cube(v, 0, 6, 0, icc);
  return v;
}

/** Спавн — тёмный портал с огненным ядром. */
export function spawnPortal(): Voxel[] {
  const v: Voxel[] = [];
  const sd = PALETTE.stoneDark, s = PALETTE.stone;
  const fi = ACCENT.fire, fic = ACCENT.fireCore, bl = ACCENT.blood;
  // основание-площадка
  box3(v, -5, 5, 0, 2, -3, 3, sd);
  box3(v, -4, 4, 2, 3, -3, 3, s);
  // боковые столбы арки
  box3(v, -4, -3, 3, 12, -2, -2, shade(sd, 0.8)); box3(v, 3, 4, 3, 12, -2, -2, shade(sd, 0.8));
  box3(v, -4, -3, 3, 12, 2, 2, shade(sd, 0.8));   box3(v, 3, 4, 3, 12, 2, 2, shade(sd, 0.8));
  // замковый камень арки сверху
  box3(v, -3, 3, 13, 14, -2, 2, shade(sd, 0.7));
  box3(v, -2, 2, 15, 15, -1, 1, shade(sd, 0.7));
  // огненное ядро портала (заполняет проём арки)
  box3(v, -2, 2, 5, 12, -1, 1, fi);
  box3(v, -1, 1, 6, 11, 0, 0, fic);
  // кровавые руны у основания
  cube(v, -2, 1, 3, bl); cube(v, 0, 1, 3, bl); cube(v, 2, 1, 3, bl);
  return v;
}

/** Снаряд — короткий болт. */
export function projectileBolt(): Voxel[] {
  const v: Voxel[] = [];
  box3(v, -1, 1, 0, 0, 0, 0, PALETTE.metalLight);
  cube(v, 2, 0, 0, ACCENT.fireCore);
  cube(v, -2, 0, 0, PALETTE.metalDark);
  return v;
}

// ── Стены лабиринта ────────────────────────────────────────────────────────

/** Деревянная стена — частокол из брёвен с перекладиной. */
export function woodWall(): Voxel[] {
  const v: Voxel[] = [];
  const w = PALETTE.wood, wd = PALETTE.woodDark;
  // 3 бревна
  box3(v, -3, -1, 0, 8, -2, 2, wd); box3(v, -1, 1, 0, 8, -2, 2, wd); box3(v, 1, 3, 0, 8, -2, 2, wd);
  // заострённые верхушки
  cube(v, -2, 9, 0, shade(wd, 0.8)); cube(v, 0, 9, 0, shade(wd, 0.8)); cube(v, 2, 9, 0, shade(wd, 0.8));
  // перекладины
  box3(v, -3, 3, 2, 3, -2, 2, w); box3(v, -3, 3, 6, 6, -2, 2, w);
  return v;
}

/** Каменная стена — грубая кладка из валунов. */
export function stoneWall(): Voxel[] {
  const v: Voxel[] = [];
  const s = PALETTE.stone, sd = PALETTE.stoneDark, sl = PALETTE.stoneLight;
  box3(v, -3, 3, 0, 2, -2, 2, sd);
  box3(v, -3, 3, 3, 5, -2, 2, s);
  box3(v, -3, 3, 6, 7, -2, 2, shade(s, 0.92));
  // верхние валуны (неровный гребень)
  box3(v, -2, 0, 8, 9, -2, 2, sl);
  box3(v, 1, 3, 8, 9, -1, 1, shade(sl, 0.9));
  cube(v, -3, 8, 0, sd); cube(v, 3, 8, 0, sd);
  return v;
}

/** Костяная стена — баррикада из костей и черепов. */
export function boneWall(): Voxel[] {
  const v: Voxel[] = [];
  const bo = PALETTE.bone, bod = PALETTE.boneDark, e = ACCENT.eyeRed;
  // основание
  box3(v, -3, 3, 0, 2, -2, 2, bod);
  // берцовые кости (вертикальные)
  box3(v, -3, -2, 3, 8, -1, -1, bo); box3(v, 0, 1, 3, 8, -1, -1, bo); box3(v, 2, 3, 3, 8, 1, 1, bo);
  cube(v, -3, 2, 0, bod); cube(v, 0, 2, 0, bod); cube(v, 2, 2, 0, bod);     // суставы
  // черепа на гребне
  box3(v, -2, -1, 9, 10, -1, 1, bo);
  cube(v, -1, 9, 1, e); cube(v, 1, 9, 1, e);
  box3(v, 1, 2, 9, 10, -1, 1, shade(bo, 0.95));
  cube(v, 1, 9, 1, e); cube(v, 2, 9, 1, e);
  return v;
}

// ── Реликвии-тотемы ────────────────────────────────────────────────────────

/** Огненный тотем — чёрный обелиск с пламенем. */
export function relicFireTotem(): Voxel[] {
  const v: Voxel[] = [];
  const sd = PALETTE.stoneDark, s = PALETTE.stone;
  const fi = ACCENT.fire, fic = ACCENT.fireCore;
  box3(v, -3, 3, 0, 2, -3, 3, sd);
  box3(v, -2, 2, 3, 4, -2, 2, s);
  box3(v, -2, 2, 5, 8, -2, 2, sd);
  box3(v, -1, 1, 9, 11, -1, 1, s);
  // пламя
  box3(v, -1, 1, 12, 14, -1, 1, fi);
  cube(v, 0, 15, 0, fic); cube(v, 0, 16, 0, fic);
  cube(v, 0, 3, 2, fi);                                       // руна у основания
  return v;
}

/** Магический тотем — осколки обелиска с фиолетовым кристаллом. */
export function relicArcaneTotem(): Voxel[] {
  const v: Voxel[] = [];
  const sd = PALETTE.stoneDark, sl = PALETTE.stoneLight;
  const ar = ACCENT.arcane, arc = ACCENT.arcaneCore;
  box3(v, -3, 3, 0, 2, -3, 3, sd);
  // наклонные осколки
  box3(v, -2, -1, 3, 10, -1, -1, sl);
  box3(v, 0, 2, 3, 9, 1, 1, sd);
  cube(v, 1, 11, 0, sl);
  // парящий кристалл (ромб)
  box3(v, -1, 1, 12, 13, -1, 1, ar);
  cube(v, 0, 14, 0, arc); cube(v, 0, 11, 0, arc);
  return v;
}

/** Золотой тотем — колонна с рунным кольцом и золотым шаром. */
export function relicGoldTotem(): Voxel[] {
  const v: Voxel[] = [];
  const sd = PALETTE.stoneDark, s = PALETTE.stone, g = ACCENT.gold;
  box3(v, -3, 3, 0, 2, -3, 3, sd);
  box3(v, -1, 1, 3, 10, -1, 1, s);
  // рунное кольцо (золото)
  box3(v, -2, 2, 4, 5, -2, 2, g);
  box3(v, -2, 2, 8, 9, -2, 2, g);
  // золотой шар
  box3(v, -1, 1, 11, 13, -1, 1, g);
  cube(v, 0, 14, 0, ACCENT.fireCore);
  return v;
}

/** Ледяной тотем — обледенелый шпиль с кристаллом. */
export function relicIceTotem(): Voxel[] {
  const v: Voxel[] = [];
  const sd = PALETTE.stoneDark, sl = PALETTE.stoneLight;
  const ic = ACCENT.ice, icc = ACCENT.iceCore;
  box3(v, -3, 3, 0, 2, -3, 3, sd);
  box3(v, -2, 2, 3, 6, -2, 2, shade(sl, 0.92));
  box3(v, -1, 1, 7, 10, -1, 1, shade(sl, 0.85));
  // сосульки
  box3(v, -3, -3, 4, 6, 0, 0, ic); box3(v, 3, 3, 4, 6, 0, 0, ic);
  // кристалл
  box3(v, -1, 1, 11, 13, -1, 1, ic);
  cube(v, 0, 14, 0, icc);
  return v;
}

/** Кровавый тотем — черепа на столбе с кровавым камнем. */
export function relicBloodTotem(): Voxel[] {
  const v: Voxel[] = [];
  const bo = PALETTE.bone, bod = PALETTE.boneDark, sd = PALETTE.stoneDark;
  const bl = ACCENT.blood, e = ACCENT.eyeRed;
  box3(v, -3, 3, 0, 2, -3, 3, sd);
  box3(v, -1, 1, 3, 9, -1, 1, bod);
  box3(v, -1, 1, 9, 10, -1, 1, bo);
  // кровавый камень
  box3(v, -1, 1, 11, 13, -1, 1, bl);
  cube(v, 0, 11, 1, e); cube(v, 0, 12, 1, e);
  // черепа у основания
  cube(v, -3, 1, 2, bo); cube(v, 3, 1, 2, bo);
  cube(v, -3, 1, 3, e); cube(v, 3, 1, 3, e);
  return v;
}

// ── RTS: производственные здания ───────────────────────────────────────────

/** Лесопилка — деревянный навес с бревном и пилой. */
export function sawmillBuilding(): Voxel[] {
  const v: Voxel[] = [];
  const w = PALETTE.wood, wd = PALETTE.woodDark, wl = PALETTE.woodLight;
  box3(v, -5, 5, 0, 2, -4, 4, PALETTE.earth);                          // фундамент
  // угловые столбы
  box3(v, -5, -4, 3, 10, -4, -4, wd); box3(v, 4, 5, 3, 10, -4, -4, wd);
  box3(v, -5, -4, 3, 10, 4, 4, wd);   box3(v, 4, 5, 3, 10, 4, 4, wd);
  // крыша-навес (ступенчатая)
  box3(v, -5, 5, 11, 12, -4, 4, shade(wd, 0.85));
  box3(v, -4, 4, 13, 14, -4, 4, shade(wd, 0.8));
  box3(v, -2, 2, 15, 15, -3, 3, shade(wd, 0.75));
  // бревно-заготовка
  box3(v, -2, 2, 3, 5, -2, 2, w);
  // пила
  box3(v, -1, 1, 6, 7, 3, 3, PALETTE.metalLight);
  cube(v, 0, 6, 3, ACCENT.gold);
  // костёр у входа
  cube(v, -3, 2, 3, ACCENT.fire); cube(v, -4, 2, 3, ACCENT.fire);
  return v;
}

/** Шахта — ствол в горе с деревянной крепью. */
export function mineBuilding(): Voxel[] {
  const v: Voxel[] = [];
  const s = PALETTE.stone, sd = PALETTE.stoneDark, wd = PALETTE.woodDark;
  box3(v, -5, 5, 0, 3, -4, 4, sd);                                     // скалистое основание
  box3(v, -4, 4, 3, 6, -4, 4, s);
  box3(v, -3, 3, 6, 8, -3, 3, shade(s, 0.92));
  // чёрный провал шахты
  box3(v, -2, 2, 4, 8, -2, 2, PALETTE.metalDark);
  // деревянная крепь (рама)
  box3(v, -3, -3, 3, 10, -3, -3, wd); box3(v, 3, 3, 3, 10, -3, -3, wd);
  box3(v, -3, 3, 11, 11, -3, 3, wd);
  // руда (золотые крупицы)
  cube(v, -3, 3, 3, ACCENT.gold); cube(v, 3, 4, 3, ACCENT.gold); cube(v, 0, 5, 3, ACCENT.gold);
  // фонарь
  cube(v, 0, 9, 3, ACCENT.fireCore);
  return v;
}

/** Плавильня — каменная печь с огненным жерлом. */
export function smelterBuilding(): Voxel[] {
  const v: Voxel[] = [];
  const s = PALETTE.stone, sd = PALETTE.stoneDark, md = PALETTE.metalDark;
  const fi = ACCENT.fire, fic = ACCENT.fireCore;
  box3(v, -5, 5, 0, 2, -4, 4, sd);
  box3(v, -4, 4, 3, 5, -4, 4, s);                                      // основание печи
  box3(v, -3, 3, 6, 9, -3, 3, shade(s, 0.88));                          // корпус
  box3(v, -1, 1, 10, 13, -1, 1, md);                                   // труба
  // жерло
  box3(v, -2, 2, 5, 7, -2, 2, PALETTE.metalDark);
  box3(v, -1, 1, 6, 7, 0, 0, fi);
  cube(v, 0, 7, 0, fic);
  // наковальня
  box3(v, 4, 4, 3, 4, 3, 3, md); box3(v, 3, 5, 4, 5, 3, 3, PALETTE.metal);
  cube(v, 2, 7, 3, fic);                                               // искра
  return v;
}

/** Казармы — приземистый бункер с оружием у входа. */
export function barracksBuilding(): Voxel[] {
  const v: Voxel[] = [];
  const s = PALETTE.stone, sd = PALETTE.stoneDark, wd = PALETTE.woodDark, m = PALETTE.metal;
  box3(v, -5, 5, 0, 2, -4, 4, sd);
  box3(v, -4, 4, 3, 7, -4, 4, s);                                      // стены бункера
  // бойницы (тёмные щели)
  box3(v, -4, 4, 4, 4, -2, -2, PALETTE.metalDark); box3(v, -4, 4, 4, 4, 2, 2, PALETTE.metalDark);
  box3(v, -4, 4, 6, 6, -2, -2, PALETTE.metalDark); box3(v, -4, 4, 6, 6, 2, 2, PALETTE.metalDark);
  // крыша-зубцы
  cube(v, -4, 8, -4, shade(sd, 0.9)); cube(v, -1, 8, -4, shade(sd, 0.9)); cube(v, 2, 8, -4, shade(sd, 0.9));
  cube(v, -4, 8, 4, shade(sd, 0.9)); cube(v, -1, 8, 4, shade(sd, 0.9)); cube(v, 2, 8, 4, shade(sd, 0.9));
  // дверь-проём
  box3(v, -1, 1, 3, 5, 0, 0, PALETTE.metalDark);
  // стойка с оружием
  cube(v, 3, 3, 3, wd); box3(v, 3, 3, 4, 7, 3, 3, m);                  // древко + наконечник
  // факел
  cube(v, -4, 6, 3, wd); cube(v, -4, 7, 3, ACCENT.fire);
  return v;
}

// ── RTS: ключевые здания (Town Hall / Watch Tower) ──────────────────────────
// (M8-fix: ранее у 'building:town-hall' / 'town-hall-l2' / 'watch-tower' НЕ было
//  билдеров → AssetCatalog падал в fallback-бокс 0.4 → игрок видел крошечный
//  кубик вместо базы. Здесь — полноценные воксель-модели в стиле остального RTС-арта.)

/** Town Hall L1 — центральное здание базы: каменный зал с двускатной крышей и флагом. */
export function townHallBuilding(): Voxel[] {
  const v: Voxel[] = [];
  const s = PALETTE.stone, sd = PALETTE.stoneDark, sl = PALETTE.stoneLight;
  const wd = PALETTE.woodDark, w = PALETTE.wood, wl = PALETTE.woodLight;
  const g = ACCENT.gold, fire = ACCENT.fire;
  // каменный фундамент-ступени
  box3(v, -6, 6, 0, 1, -5, 5, sd);
  box3(v, -5, 5, 1, 2, -4, 4, s);
  // основной объём зала (2 этажа)
  box3(v, -5, 5, 2, 8, -4, 4, s);
  // угловые контрфорсы
  box3(v, -6, -5, 2, 9, -5, -5, shade(sd, 0.92)); box3(v, 5, 6, 2, 9, -5, -5, shade(sd, 0.92));
  box3(v, -6, -5, 2, 9, 5, 5, shade(sd, 0.92));   box3(v, 5, 6, 2, 9, 5, 5, shade(sd, 0.92));
  // оконные бойницы (тёмные щели по бокам)
  box3(v, -5, 5, 4, 4, -3, -3, PALETTE.metalDark); box3(v, -5, 5, 4, 4, 3, 3, PALETTE.metalDark);
  box3(v, -5, 5, 6, 6, -3, -3, PALETTE.metalDark); box3(v, -5, 5, 6, 6, 3, 3, PALETTE.metalDark);
  box3(v, -3, -3, 5, 6, -4, -4, PALETTE.metalDark); box3(v, 3, 4, 5, 6, -4, -4, PALETTE.metalDark);
  box3(v, -3, -3, 5, 6, 4, 4, PALETTE.metalDark);   box3(v, 3, 4, 5, 6, 4, 4, PALETTE.metalDark);
  // дверь-арка (тёмный проём)
  box3(v, -2, 2, 2, 5, 0, 0, PALETTE.metalDark);
  cube(v, -2, 4, 1, wd); cube(v, 2, 4, 1, wd);       // дверные косяки
  // двускатная крыша (дерево) — ступенчатый фронтон
  box3(v, -6, 6, 9, 10, -5, 5, shade(wd, 0.85));
  box3(v, -5, 5, 11, 12, -4, 4, shade(wd, 0.8));
  box3(v, -4, 4, 13, 13, -3, 3, shade(wd, 0.75));
  box3(v, -2, 2, 14, 14, -2, 2, shade(wd, 0.7));
  cube(v, 0, 15, 0, g);                              // флюгер-шар
  // флагшток + стяг (золотое полотно)
  cube(v, 0, 13, 5, wd); cube(v, 0, 14, 5, wd); cube(v, 0, 15, 5, wd);
  cube(v, 1, 15, 5, g); cube(v, 2, 15, 5, g);
  cube(v, 1, 14, 5, shade(g, 0.85));
  // факела у входа
  cube(v, -3, 5, 1, wd); cube(v, -3, 6, 1, fire);
  cube(v, 3, 5, 1, wd); cube(v, 3, 6, 1, fire);
  void sl; void w; void wl;
  return v;
}

/** Town Hall L2 — укреплённая версия: выше, с угловыми башенками и зубчатым венцом. */
export function townHallL2Building(): Voxel[] {
  const v: Voxel[] = [];
  const s = PALETTE.stone, sd = PALETTE.stoneDark, sl = PALETTE.stoneLight;
  const wd = PALETTE.woodDark, g = ACCENT.gold, fire = ACCENT.fire;
  // расширенный фундамент
  box3(v, -7, 7, 0, 1, -6, 6, sd);
  box3(v, -6, 6, 1, 2, -5, 5, s);
  // основной объём (3 этажа)
  box3(v, -6, 6, 2, 10, -5, 5, s);
  // 4 угловые башенки (выше основного объёма)
  box3(v, -7, -6, 2, 13, -6, -6, shade(sd, 0.9)); box3(v, 6, 7, 2, 13, -6, -6, shade(sd, 0.9));
  box3(v, -7, -6, 2, 13, 6, 6, shade(sd, 0.9));   box3(v, 6, 7, 2, 13, 6, 6, shade(sd, 0.9));
  // зубцы на угловых башенках
  for (const [bx, bz] of [[-6, -6], [6, -6], [-6, 6], [6, 6]] as const) {
    cube(v, bx, 14, bz, shade(sd, 0.85));
    cube(v, bx + (bx < 0 ? 1 : -1), 14, bz, shade(sd, 0.85));
    cube(v, bx, 14, bz + (bz < 0 ? 1 : -1), shade(sd, 0.85));
  }
  // окна
  box3(v, -6, 6, 5, 5, -3, -3, PALETTE.metalDark); box3(v, -6, 6, 5, 5, 3, 3, PALETTE.metalDark);
  box3(v, -6, 6, 7, 7, -3, -3, PALETTE.metalDark); box3(v, -6, 6, 7, 7, 3, 3, PALETTE.metalDark);
  box3(v, -4, -4, 5, 7, -6, -6, PALETTE.metalDark); box3(v, 4, 5, 5, 7, -6, -6, PALETTE.metalDark);
  box3(v, -4, -4, 5, 7, 6, 6, PALETTE.metalDark);   box3(v, 4, 5, 5, 7, 6, 6, PALETTE.metalDark);
  // дверь
  box3(v, -2, 2, 2, 6, 0, 0, PALETTE.metalDark);
  cube(v, -3, 5, 1, wd); cube(v, 3, 5, 1, wd);
  // двускатная крыша (выше, чем у L1)
  box3(v, -6, 6, 11, 12, -5, 5, shade(wd, 0.85));
  box3(v, -5, 5, 13, 14, -4, 4, shade(wd, 0.8));
  box3(v, -3, 3, 15, 15, -3, 3, shade(wd, 0.75));
  cube(v, 0, 16, 0, g);
  // флагшток + большое полотно (золотой стяг)
  cube(v, 0, 14, 6, wd); cube(v, 0, 15, 6, wd); cube(v, 0, 16, 6, wd); cube(v, 0, 17, 6, wd);
  box3(v, 1, 3, 16, 17, 6, 6, g);
  // факела
  cube(v, -3, 5, 1, wd); cube(v, -3, 6, 1, fire);
  cube(v, 3, 5, 1, wd); cube(v, 3, 6, 1, fire);
  void sl;
  return v;
}

/** Watch Tower — узкая дозорная башня: высокое основание + верхняя площадка с зубцами. */
export function watchTowerBuilding(): Voxel[] {
  const v: Voxel[] = [];
  const s = PALETTE.stone, sd = PALETTE.stoneDark, wd = PALETTE.woodDark;
  const fire = ACCENT.fire, g = ACCENT.gold, e = ACCENT.soul;
  // каменное основание (квадратное, узкое)
  box3(v, -3, 3, 0, 2, -3, 3, sd);
  // основной столп (4 этажа)
  box3(v, -3, 3, 3, 10, -3, 3, s);
  // бойницы-окна по сторонам
  box3(v, -3, 3, 5, 5, -2, -2, PALETTE.metalDark); box3(v, -3, 3, 5, 5, 2, 2, PALETTE.metalDark);
  box3(v, -3, 3, 8, 8, -2, -2, PALETTE.metalDark); box3(v, -3, 3, 8, 8, 2, 2, PALETTE.metalDark);
  box3(v, -2, 2, 5, 5, -3, -3, PALETTE.metalDark); box3(v, 2, 3, 5, 5, -3, -3, PALETTE.metalDark);
  box3(v, -2, 2, 5, 5, 3, 3, PALETTE.metalDark);   box3(v, 2, 3, 5, 5, 3, 3, PALETTE.metalDark);
  // верхняя площадка (чуть шире столпа)
  box3(v, -4, 4, 11, 12, -4, 4, shade(sd, 0.95));
  // зубцы по периметру площадки
  cube(v, -4, 13, -4, shade(sd, 0.85)); cube(v, -1, 13, -4, shade(sd, 0.85)); cube(v, 2, 13, -4, shade(sd, 0.85));
  cube(v, -4, 13, 4, shade(sd, 0.85));  cube(v, -1, 13, 4, shade(sd, 0.85));  cube(v, 2, 13, 4, shade(sd, 0.85));
  cube(v, -4, 13, -1, shade(sd, 0.85)); cube(v, -4, 13, 2, shade(sd, 0.85));
  cube(v, 4, 13, -1, shade(sd, 0.85));  cube(v, 4, 13, 2, shade(sd, 0.85));
  // коническая крыша
  box3(v, -3, 3, 14, 15, -3, 3, shade(wd, 0.8));
  box3(v, -2, 2, 16, 16, -2, 2, shade(wd, 0.75));
  cube(v, 0, 17, 0, g);
  // сигнальный костёр на площадке
  cube(v, 0, 13, 0, fire); cube(v, 1, 13, 0, fire); cube(v, 0, 14, 0, ACCENT.fireCore);
  // дверной проём
  box3(v, -1, 1, 3, 5, 0, 0, PALETTE.metalDark);
  // факела у входа
  cube(v, -2, 5, 1, wd); cube(v, -2, 6, 1, fire);
  cube(v, 2, 5, 1, wd); cube(v, 2, 6, 1, fire);
  void e;
  return v;
}

// ── RTS: защитные юниты ────────────────────────────────────────────────────

/** Worker (static fallback) — крестьянин с киркой (для non-rigged пути / smoke-тестов). */
export function workerUnit(): Voxel[] {
  const v: Voxel[] = [];
  const f = PALETTE.flesh, fd = PALETTE.fleshDark;
  const w = PALETTE.wood, wd = PALETTE.woodDark, wl = PALETTE.woodLight;
  const md = PALETTE.metalDark, m = PALETTE.metal;
  const e = ACCENT.soul;
  // ноги (поножи)
  box3(v, -2, -1, 0, 1, 0, 1, fd); box3(v, 1, 2, 0, 1, 0, 1, fd);
  box3(v, -2, -1, 2, 6, 0, 0, fd); box3(v, 1, 2, 2, 6, 0, 0, fd);
  // туника
  box3(v, -2, 2, 7, 13, 0, 1, shade(w, 0.85));
  // ремень
  box3(v, -2, 2, 8, 9, 0, 1, shade(wd, 0.9));
  // капюшон + голова
  box3(v, -2, 2, 14, 15, -1, 1, wd); box3(v, -2, 2, 14, 15, 1, 2, wd);
  box3(v, -1, 1, 14, 15, 0, 1, f);
  cube(v, -1, 14, 1, e); cube(v, 1, 14, 1, e);
  // руки
  box3(v, -3, -2, 12, 14, 0, 0, fd); box3(v, 2, 3, 12, 14, 0, 0, fd);
  // кирка в правой руке
  box3(v, 3, 3, 8, 15, 1, 1, wl);
  box3(v, 2, 4, 8, 9, 0, 2, md);
  cube(v, 1, 8, 1, m); cube(v, 5, 8, 1, m);
  return v;
}

/** Рыцарь — латник со щитом и мечом. */
export function knightUnit(): Voxel[] {
  const v: Voxel[] = [];
  const m = PALETTE.metal, md = PALETTE.metalDark, ml = PALETTE.metalLight, wd = PALETTE.woodDark;
  const e = ACCENT.soul, g = ACCENT.gold;
  // ноги в доспехе
  box3(v, -2, -1, 0, 1, 0, 1, md); box3(v, 1, 2, 0, 1, 0, 1, md);
  box3(v, -2, -1, 2, 6, 0, 0, md); box3(v, 1, 2, 2, 6, 0, 0, md);
  // набедренник
  box3(v, -2, 2, 7, 9, 0, 1, m);
  // нагрудник
  box3(v, -2, 2, 10, 13, 0, 1, m);
  box3(v, -1, 1, 12, 13, 1, 1, ml);                                    // грудь-блик
  cube(v, 0, 11, 1, g);                                                // эмблема
  // наплечники
  box3(v, -3, -2, 10, 11, 0, 1, md); box3(v, 2, 3, 10, 11, 0, 1, md);
  // руки
  box3(v, -3, -2, 12, 14, 0, 0, md); box3(v, 2, 3, 12, 14, 0, 0, md);
  // голова в шлеме
  box3(v, -2, 2, 14, 17, 0, 1, md);
  cube(v, 0, 18, 0, g);                                                // гребень
  cube(v, -1, 16, 1, e); cube(v, 1, 16, 1, e);                         // глазница щели
  // щит (левая рука)
  box3(v, -4, -3, 10, 14, 1, 2, shade(m, 0.9));
  cube(v, -4, 12, 2, g);
  // меч в правой
  cube(v, 3, 9, 1, wd);                                                // рукоять
  box3(v, 3, 3, 10, 15, 1, 1, ml);                                     // клинок
  cube(v, 3, 16, 1, g);                                                // набалдашник
  return v;
}

/** Лучник — лёгкий боец с луком и колчаном. */
export function archerUnit(): Voxel[] {
  const v: Voxel[] = [];
  const f = PALETTE.flesh, fd = PALETTE.fleshDark, w = PALETTE.wood, wl = PALETTE.woodLight;
  const e = ACCENT.soul, g = ACCENT.gold;
  // ноги (поножи)
  box3(v, -2, -1, 0, 1, 0, 1, fd); box3(v, 1, 2, 0, 1, 0, 1, fd);
  box3(v, -2, -1, 2, 6, 0, 0, fd); box3(v, 1, 2, 2, 6, 0, 0, fd);
  // туника
  box3(v, -2, 2, 7, 13, 0, 1, shade(f, 0.85));
  // капюшон
  box3(v, -2, 2, 14, 15, -1, 1, fd);
  box3(v, -2, 2, 13, 14, 1, 2, fd);
  // голова
  box3(v, -1, 1, 14, 16, 0, 1, f);
  cube(v, -1, 15, 1, e); cube(v, 1, 15, 1, e);
  // колчан за спиной
  box3(v, -1, 1, 9, 13, -2, -2, w);
  cube(v, 0, 14, -2, wl); cube(v, -1, 14, -2, wl);
  // лук (дугой в левой руке)
  box3(v, -3, -3, 11, 15, 1, 1, w);
  cube(v, -3, 10, 1, w); cube(v, -3, 16, 1, w);
  cube(v, -3, 13, 2, wl);                                              // стрела на тетиве
  cube(v, 2, 13, 1, g);                                                // пояс-пряжка
  return v;
}

/** Маг — в мантии с посохом и капюшоном. */
export function mageUnit(): Voxel[] {
  const v: Voxel[] = [];
  const sd = PALETTE.stoneDark, sl = PALETTE.stoneLight;
  const ar = ACCENT.arcane, arc = ACCENT.arcaneCore;
  // подол мантии (расширяется вниз)
  box3(v, -2, 2, 0, 6, 0, 1, shade(sd, 0.7));
  box3(v, -1, 1, 3, 4, 0, 1, sl);                                      // подкладка
  // лиф мантии
  box3(v, -2, 2, 7, 12, 0, 1, sl);
  box3(v, -2, 2, 11, 13, 0, 1, shade(sd, 0.8));
  // рукава
  box3(v, -3, -2, 8, 12, 0, 0, shade(sd, 0.7)); box3(v, 2, 3, 8, 12, 0, 0, shade(sd, 0.7));
  // капюшон + лицо (тень)
  box3(v, -2, 2, 13, 16, 0, 1, sd);
  box3(v, -1, 1, 14, 15, 1, 1, PALETTE.metalDark);                     // тень-лицо
  cube(v, -1, 15, 1, arc); cube(v, 1, 15, 1, arc);                     // глаза-магия
  // посох с кристаллом
  box3(v, 3, 3, 6, 14, 1, 1, PALETTE.woodDark);
  box3(v, 2, 4, 15, 17, 0, 2, ar);                                     // кристалл-ромб
  cube(v, 3, 16, 1, arc);
  cube(v, 0, 10, 1, ar);                                               // руна на мантии
  return v;
}

/** Командир-некромант — увеличенный маг с короной и двойным посохом. */
export function commanderUnit(): Voxel[] {
  const v: Voxel[] = [];
  const sd = PALETTE.stoneDark, sl = PALETTE.stoneLight, bo = PALETTE.bone;
  const ar = ACCENT.arcane, arc = ACCENT.arcaneCore, bl = ACCENT.blood, g = ACCENT.gold;
  // широкий подол плаща
  box3(v, -3, 3, 0, 6, 0, 1, shade(sd, 0.6));
  box3(v, -2, 2, 3, 4, 0, 1, sl);
  box3(v, -3, 3, 7, 13, 0, 1, sl);
  box3(v, -3, 3, 12, 14, 0, 1, shade(sd, 0.75));
  // рукава-рога
  box3(v, -4, -3, 8, 13, 0, 0, shade(sd, 0.7)); box3(v, 3, 4, 8, 13, 0, 0, shade(sd, 0.7));
  // крупный капюшон
  box3(v, -2, 2, 14, 18, 0, 1, sd);
  box3(v, -1, 1, 15, 16, 1, 1, PALETTE.metalDark);
  // корона из кости
  box3(v, -2, 2, 19, 19, 0, 0, bo); box3(v, -1, 1, 19, 19, 0, 0, bo); box3(v, 1, 2, 19, 19, 0, 0, bo);
  cube(v, -1, 20, 0, g); cube(v, 1, 20, 0, g);
  cube(v, -1, 16, 1, arc); cube(v, 1, 16, 1, arc);                     // горящие глаза
  // посох-жезл с двумя кристаллами
  box3(v, 4, 4, 5, 16, 1, 1, PALETTE.boneDark);
  box3(v, 3, 5, 17, 19, 0, 2, ar);
  cube(v, 4, 18, 1, arc);
  cube(v, 4, 10, 1, bl);                                               // второй (кровавый) кристалл
  // рунный пояс
  cube(v, -2, 10, 1, ar); cube(v, 0, 10, 1, ar); cube(v, 2, 10, 1, ar);
  return v;
}

// ── Phase T: тайлы террейна (референс 'Isometric Fantasy Tiles') ───────────
// Каждый тайл = плоская воксель-плита 6×6 (XZ) × 1 (Y), все воксели в y=0.
// normalizeMesh даёт XZ-size=6, Y-size=1 → рендерер делает плоский тайл
// cellSize × cellSize/6 × cellSize (тоньше поля, читается как плитка).
// Различие типов — за счёт разных цветов вокселей в одном слое (пятна/швы).

/** Grass-тайл: мшистая зелёно-коричневая плита с тёмными пятнами мха. */
export function tileGrass(): Voxel[] {
  const v: Voxel[] = [];
  const g = PALETTE.moss;
  const dark = shade(g, 0.65);
  const light = shade(g, 1.25);
  box3(v, 0, 5, 0, 0, 0, 5, g);
  // тёмные пятна мха
  cube(v, 1, 0, 1, dark);
  cube(v, 4, 0, 3, dark);
  cube(v, 2, 0, 4, dark);
  cube(v, 5, 0, 0, dark);
  // светлые травинки
  cube(v, 3, 0, 0, light);
  cube(v, 0, 0, 2, light);
  cube(v, 5, 0, 5, light);
  return v;
}

/** Dirt-тайл: землисто-коричневая плита с тёмными трещинами. */
export function tileDirt(): Voxel[] {
  const v: Voxel[] = [];
  const d = PALETTE.earth;
  const dark = shade(d, 0.6);
  const light = shade(d, 1.2);
  box3(v, 0, 5, 0, 0, 0, 5, d);
  // трещины (цепочки тёмных вокселей)
  cube(v, 1, 0, 1, dark); cube(v, 2, 0, 1, dark);
  cube(v, 4, 0, 3, dark); cube(v, 3, 0, 4, dark);
  cube(v, 5, 0, 5, dark);
  // камешки (светлее)
  cube(v, 0, 0, 5, light);
  cube(v, 5, 0, 0, light);
  cube(v, 2, 0, 3, light);
  return v;
}

/** Road-тайл: мощёная каменная плита (для пути врагов). */
export function tileRoad(): Voxel[] {
  const v: Voxel[] = [];
  const s = PALETTE.stone;
  const dark = PALETTE.stoneDark;
  const light = PALETTE.stoneLight;
  box3(v, 0, 5, 0, 0, 0, 5, s);
  // тёмные швы (крест-накрест + рамка)
  cube(v, 2, 0, 0, dark); cube(v, 2, 0, 1, dark); cube(v, 2, 0, 2, dark);
  cube(v, 2, 0, 3, dark); cube(v, 2, 0, 4, dark); cube(v, 2, 0, 5, dark);
  cube(v, 0, 0, 4, dark); cube(v, 1, 0, 4, dark); cube(v, 3, 0, 4, dark);
  cube(v, 4, 0, 4, dark); cube(v, 5, 0, 4, dark);
  // светлые камни-блики
  cube(v, 0, 0, 0, light);
  cube(v, 4, 0, 1, light);
  cube(v, 1, 0, 3, light);
  cube(v, 5, 0, 5, light);
  return v;
}

/** Water-тайл: тёмная водная гладь с бирюзовым emissive-свечением «мёртвой воды». */
export function tileWater(): Voxel[] {
  const v: Voxel[] = [];
  const w = desaturate([0.05, 0.10, 0.18], 0.18);
  const dark = shade(w, 0.55);
  const glow = ACCENT.soul; // бирюзовый акцент
  box3(v, 0, 5, 0, 0, 0, 5, w);
  // тёмные глубины
  cube(v, 0, 0, 0, dark); cube(v, 5, 0, 0, dark);
  cube(v, 0, 0, 5, dark); cube(v, 5, 0, 5, dark);
  cube(v, 2, 0, 2, dark);
  // эмиссивные блики (бирюза — болотная мерцань)
  cube(v, 1, 0, 1, glow);
  cube(v, 4, 0, 2, glow);
  cube(v, 2, 0, 4, glow);
  return v;
}

/** Rock-тайл: серая каменная плита с тёмными вкраплениями и светлыми прожилками. */
export function tileRock(): Voxel[] {
  const v: Voxel[] = [];
  const r = PALETTE.stone;
  const dark = PALETTE.stoneDark;
  const light = PALETTE.stoneLight;
  box3(v, 0, 5, 0, 0, 0, 5, r);
  // тёмные вкрапления
  cube(v, 0, 0, 0, dark); cube(v, 3, 0, 1, dark);
  cube(v, 5, 0, 3, dark); cube(v, 2, 0, 5, dark);
  cube(v, 4, 0, 5, dark);
  // светлые прожилки
  cube(v, 4, 0, 0, light); cube(v, 1, 0, 2, light);
  cube(v, 5, 0, 5, light); cube(v, 0, 0, 4, light);
  return v;
}

/** Sand-тайл: песочно-бежевая плита с редкими крупицами. */
export function tileSand(): Voxel[] {
  const v: Voxel[] = [];
  const base = desaturate([0.50, 0.42, 0.28], 0.28);
  const dark = shade(base, 0.7);
  const light = shade(base, 1.25);
  box3(v, 0, 5, 0, 0, 0, 5, base);
  // редкие тёмные крупицы
  cube(v, 1, 0, 2, dark);
  cube(v, 4, 0, 4, dark);
  cube(v, 5, 0, 1, dark);
  // светлые песчинки
  cube(v, 3, 0, 0, light);
  cube(v, 0, 0, 5, light);
  cube(v, 2, 0, 3, light);
  return v;
}

/** Реестр процедурных билдеров по имени (используется asset-catalog). */
export const VOXEL_BUILDERS: Record<string, () => Voxel[]> = {
  'tower:arrow': arrowTower,
  'tower:cannon': cannonTower,
  'tower:arcane': arcaneTower,
  'tower:ice': iceTower,
  'enemy:skeleton': skeletonEnemy,
  'enemy:goblin': goblinEnemy,
  'enemy:zombie': zombieEnemy,
  'enemy:demon': demonEnemy,
  'enemy:boss': bossEnemy,
  // Post-MVP: разнообразные силуэты для variety
  'enemy:slime': slimeEnemy,
  'enemy:bat': batEnemy,
  'enemy:spider': spiderEnemy,
  'enemy:ghost': ghostEnemy,
  'base:altar': baseAltar,
  'spawn:portal': spawnPortal,
  'projectile:bolt': projectileBolt,
  'wall:wood': woodWall,
  'wall:stone': stoneWall,
  'wall:bone': boneWall,
  'relic:totem-fire': relicFireTotem,
  'relic:totem-arcane': relicArcaneTotem,
  'relic:totem-gold': relicGoldTotem,
  'relic:totem-ice': relicIceTotem,
  'relic:totem-blood': relicBloodTotem,
  'building:sawmill': sawmillBuilding,
  'building:mine': mineBuilding,
  'building:smelter': smelterBuilding,
  'building:barracks': barracksBuilding,
  // M8-fix: ключевые RTS-здания (ранее отсутствовали → fallback-бокс вместо базы).
  'building:town-hall': townHallBuilding,
  'building:town-hall-l2': townHallL2Building,
  'building:watch-tower': watchTowerBuilding,
  'unit:knight': knightUnit,
  'unit:archer': archerUnit,
  'unit:mage': mageUnit,
  'unit:commander': commanderUnit,
  // M8-fix: статичный fallback для worker (rigged-деф приоритетнее — см. UNIT_RIGS).
  'unit:worker': workerUnit,
  // Phase T: тайлы террейна
  'tile:grass': tileGrass,
  'tile:dirt': tileDirt,
  'tile:road': tileRoad,
  'tile:water': tileWater,
  'tile:rock': tileRock,
  'tile:sand': tileSand
};

/** Emissive-акцент модели по имени билдера (для материала). */
export function builderEmissive(builderName: string): RGB | undefined {
  switch (builderName) {
    case 'tower:arrow': return ACCENT.fire;
    case 'tower:cannon': return ACCENT.fireCore;
    case 'tower:arcane': return ACCENT.arcane;
    case 'tower:ice': return ACCENT.ice;
    case 'enemy:boss': return ACCENT.arcane;
    case 'enemy:demon': return ACCENT.eyeDemon;
    case 'enemy:slime': return ACCENT.arcane;
    case 'enemy:bat': return ACCENT.eyeRed;
    case 'enemy:spider': return ACCENT.eyeRed;
    case 'enemy:ghost': return ACCENT.soul;
    case 'base:altar': return ACCENT.soul;
    case 'spawn:portal': return ACCENT.fire;
    case 'projectile:bolt': return ACCENT.fireCore;
    case 'wall:bone': return ACCENT.eyeRed;
    case 'relic:totem-fire': return ACCENT.fire;
    case 'relic:totem-arcane': return ACCENT.arcane;
    case 'relic:totem-gold': return ACCENT.gold;
    case 'relic:totem-ice': return ACCENT.ice;
    case 'relic:totem-blood': return ACCENT.blood;
    case 'building:sawmill': return ACCENT.fire;
    case 'building:mine': return ACCENT.gold;
    case 'building:smelter': return ACCENT.fireCore;
    case 'building:barracks': return ACCENT.blood;
    case 'building:town-hall': return ACCENT.gold;
    case 'building:town-hall-l2': return ACCENT.gold;
    case 'building:watch-tower': return ACCENT.fire;
    case 'unit:knight': return ACCENT.soul;
    case 'unit:archer': return ACCENT.gold;
    case 'unit:mage': return ACCENT.arcane;
    case 'unit:commander': return ACCENT.arcaneCore;
    case 'unit:worker': return ACCENT.soul;
    case 'tile:water': return ACCENT.soul;       // бирюзовая мерцающая вода
    default: return undefined;
  }
}
