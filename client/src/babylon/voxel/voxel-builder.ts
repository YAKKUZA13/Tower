/**
 * Процедурный билдер воксельных мешей (Phase 2 задача 2.2/2.3).
 *
 * Воксель = прямоугольный параллелепипед (box). Модель = набор вокселов, каждый
 * со своим цветом. Билдер создаёт по боксу на воксел, красит вершинные цвета и
 * сливает (Mesh.MergeMeshes) в ОДИН меш → 1 draw call, совместимо с thin instances
 * и InstancedMesh (ADR-4). Это и есть «воксель-модель» в духе CC0-паков Quaternius/KayKit.
 *
 * Координаты — в «клеточно-нормализованном» пространстве: модель отцентрирована в начале
 * координат, высота ≈ 1.0 (y ∈ [-0.5, 0.5]). Рендерер масштабирует master на cellSize.
 */
import { Color3, Matrix, Mesh, MeshBuilder, StandardMaterial, VertexBuffer, type Scene } from 'babylonjs';
import { ACCENT, PALETTE, shade, type RGB } from './dark-palette';

export interface Voxel {
  x: number; y: number; z: number;     // центр воксела
  sx: number; sy: number; sz: number;  // полные размеры
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
}

/** Быстро добавить бокс-воксель в список. */
export function box(
  list: Voxel[],
  x: number, y: number, z: number,
  sx: number, sy: number, sz: number,
  color: RGB
): void {
  list.push({ x, y, z, sx, sy, sz, color });
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

/** Заполнить «столбец»/«плашку» вокселов (для толстых деталей). */
export function fill(
  list: Voxel[],
  x0: number, x1: number,
  y0: number, y1: number,
  z0: number, z1: number,
  step: number,
  color: RGB
): void {
  for (let x = x0; x <= x1 + 1e-6; x += step) {
    for (let y = y0; y <= y1 + 1e-6; y += step) {
      for (let z = z0; z <= z1 + 1e-6; z += step) {
        list.push({ x, y, z, sx: step, sy: step, sz: step, color });
      }
    }
  }
}

/**
 * Строит единый воксельный меш из списка вокселов. Меш отцентрирован в начале координат.
 * Вызывающий владеет результатом (должен dispose).
 */
export function buildVoxelMesh(scene: Scene, voxels: Voxel[], options: VoxelMeshOptions): Mesh {
  if (voxels.length === 0) {
    // страховочный пустой меш
    return MeshBuilder.CreateBox(options.name, { size: 0.05 }, scene);
  }

  const parts: Mesh[] = [];
  for (let i = 0; i < voxels.length; i++) {
    const v = voxels[i];
    const m = MeshBuilder.CreateBox(`${options.name}-v${i}`, {
      width: Math.max(0.001, v.sx),
      height: Math.max(0.001, v.sy),
      depth: Math.max(0.001, v.sz)
    }, scene);
    m.position.set(v.x, v.y, v.z);
    // вершинные цвета: бокс имеет 24 вершины, красим все в цвет воксела
    const c = v.color;
    const vc = new Float32Array(24 * 4);
    for (let k = 0; k < 24; k++) {
      vc[k * 4] = c[0];
      vc[k * 4 + 1] = c[1];
      vc[k * 4 + 2] = c[2];
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
  // StandardMaterial использует vertex colors автоматически, если меш имеет ColorKind.
  merged.material = mat;
  merged.isPickable = false;
  merged.doNotSyncBoundingInfo = true;
  // Внимание: НЕ freezeWorldMatrix здесь — рендереры задают master.scaling (cellSize)
  // после buildMaster; заморозка «проглотила» бы это масштабирование.
  return merged;
}

// ──────────────────────────────────────────────────────────────────────
//  Определения моделей. Каждая функция возвращает Voxel[].
//  Высота моделей ≈ 1.0 (y ∈ [-0.5, 0.5]), отцентрировано в (0,0,0).
// ──────────────────────────────────────────────────────────────────────

/** Лучник — деревянная сторожевая башня с peaked-крышей и факелом. */
export function arrowTower(): Voxel[] {
  const v: Voxel[] = [];
  const w = PALETTE.wood, wd = PALETTE.woodDark, wl = PALETTE.woodLight;
  // 4 угловых столба
  for (const sx of [-0.22, 0.22]) for (const sz of [-0.22, 0.22]) {
    box(v, sx, -0.35, sz, 0.10, 0.70, 0.10, wd);
  }
  // платформа
  fill(v, -0.28, 0.28, 0.05, 0.05, -0.28, 0.28, 0.14, w);
  // стенки воротилца
  fill(v, -0.28, 0.28, 0.19, 0.27, -0.28, 0.28, 0.56, wl);
  // дверной проём (вырез): просто не ставим центральные — оставим стенки тонкими
  // peaked крыша (две наклонные плоскости ≈ ступеньки)
  for (let i = 0; i < 4; i++) {
    const t = i / 3;
    const half = 0.30 - i * 0.07;
    fill(v, -half, half, 0.30 + i * 0.07, 0.30 + i * 0.07, -half, half, 0.14, shade(wd, 0.85));
    void t;
  }
  // факел (огонь)
  box(v, 0.30, 0.20, 0.30, 0.05, 0.18, 0.05, PALETTE.woodDark);
  box(v, 0.30, 0.34, 0.30, 0.08, 0.08, 0.08, ACCENT.fireCore);
  box(v, 0.30, 0.40, 0.30, 0.05, 0.06, 0.05, ACCENT.fire);
  return v;
}

/** Осада — каменная крепость с чёрной пушкой. */
export function cannonTower(): Voxel[] {
  const v: Voxel[] = [];
  const s = PALETTE.stone, sd = PALETTE.stoneDark, md = PALETTE.metalDark;
  // основание-бастион
  fill(v, -0.32, 0.32, -0.50, -0.30, -0.32, 0.32, 0.16, sd);
  fill(v, -0.30, 0.30, -0.30, 0.05, -0.30, 0.30, 0.15, s);
  // зубцы баттlements
  for (const sx of [-0.30, -0.10, 0.10, 0.30]) for (const sz of [-0.30, 0.30]) {
    box(v, sx, 0.16, sz, 0.12, 0.12, 0.12, shade(s, 0.9));
  }
  // пушка-ствол (чёрный, горизонтально вдоль +X)
  fill(v, 0.0, 0.42, -0.05, 0.05, -0.08, 0.08, 0.10, md);
  box(v, 0.44, 0.0, 0.0, 0.12, 0.16, 0.16, PALETTE.metal); // казённик
  // жерло
  box(v, 0.40, 0.0, 0.0, 0.06, 0.10, 0.10, ACCENT.fireCore);
  return v;
}

/** Аркан — тёмный обелиск со светящимся кристаллом на вершине. */
export function arcaneTower(): Voxel[] {
  const v: Voxel[] = [];
  const sd = PALETTE.stoneDark, sl = PALETTE.stoneLight;
  // основание
  fill(v, -0.30, 0.30, -0.50, -0.36, -0.30, 0.30, 0.15, sd);
  // обелиск (сужается вверх)
  for (let i = 0; i < 4; i++) {
    const half = 0.22 - i * 0.035;
    const y = -0.30 + i * 0.20;
    fill(v, -half, half, y, y + 0.16, -half, half, 0.14, i % 2 ? sl : sd);
  }
  // руны (золото)
  box(v, 0, -0.10, 0.24, 0.04, 0.16, 0.02, ACCENT.gold);
  // кристалл на вершине (фиолет)
  box(v, 0, 0.18, 0, 0.16, 0.24, 0.16, ACCENT.arcane);
  box(v, 0, 0.34, 0, 0.08, 0.10, 0.08, ACCENT.arcaneCore);
  return v;
}

/** Лёд — обледенелый шпиль с кристаллом льда. */
export function iceTower(): Voxel[] {
  const v: Voxel[] = [];
  const s = PALETTE.stoneLight, sd = PALETTE.stoneDark;
  fill(v, -0.28, 0.28, -0.50, -0.34, -0.28, 0.28, 0.14, sd);
  // шпиль
  for (let i = 0; i < 4; i++) {
    const half = 0.20 - i * 0.03;
    const y = -0.34 + i * 0.18;
    fill(v, -half, half, y, y + 0.15, -half, half, 0.14, shade(s, 0.95 - i * 0.05));
  }
  // сосульки
  box(v, -0.22, 0.0, 0.22, 0.06, 0.14, 0.06, ACCENT.ice);
  box(v, 0.22, 0.0, -0.22, 0.06, 0.14, 0.06, ACCENT.ice);
  // кристалл льда
  box(v, 0, 0.20, 0, 0.14, 0.22, 0.14, ACCENT.ice);
  box(v, 0, 0.34, 0, 0.07, 0.08, 0.07, ACCENT.iceCore);
  return v;
}

/** Скелет — костяной гуманоид. */
export function skeletonEnemy(): Voxel[] {
  const v: Voxel[] = [];
  const bo = PALETTE.bone, bod = PALETTE.boneDark;
  // ноги
  box(v, -0.10, -0.40, 0, 0.07, 0.30, 0.10, bod);
  box(v, 0.10, -0.40, 0, 0.07, 0.30, 0.10, bod);
  // таз/торс
  box(v, 0, -0.22, 0, 0.20, 0.10, 0.12, bo);
  // рёбра/грудь
  fill(v, -0.12, 0.12, -0.10, 0.06, -0.08, 0.08, 0.06, bo);
  box(v, 0, 0.00, 0, 0.10, 0.10, 0.08, bod);
  // руки
  box(v, -0.18, -0.10, 0, 0.06, 0.30, 0.06, bo);
  box(v, 0.18, -0.10, 0, 0.06, 0.30, 0.06, bo);
  // череп
  box(v, 0, 0.22, 0, 0.18, 0.18, 0.16, bo);
  // глазницы
  box(v, -0.05, 0.24, 0.08, 0.04, 0.04, 0.02, ACCENT.eyeRed);
  box(v, 0.05, 0.24, 0.08, 0.04, 0.04, 0.02, ACCENT.eyeRed);
  return v;
}

/** Гоблин — мелкий сгорбленный, глаза-угольки. */
export function goblinEnemy(): Voxel[] {
  const v: Voxel[] = [];
  const f = PALETTE.flesh, fd = PALETTE.fleshDark, mo = PALETTE.moss;
  // коренастые ноги
  box(v, -0.08, -0.42, 0, 0.10, 0.16, 0.12, fd);
  box(v, 0.08, -0.42, 0, 0.10, 0.16, 0.12, fd);
  // сгорбленное туловище
  fill(v, -0.16, 0.16, -0.26, 0.04, -0.12, 0.12, 0.12, mo);
  box(v, 0, 0.06, -0.02, 0.22, 0.16, 0.16, f);
  // длинные руки до земли
  box(v, -0.22, -0.18, 0, 0.06, 0.30, 0.06, fd);
  box(v, 0.22, -0.18, 0, 0.06, 0.30, 0.06, fd);
  // голова
  box(v, 0, 0.20, 0.02, 0.16, 0.14, 0.14, f);
  // уши
  box(v, -0.14, 0.20, 0.02, 0.04, 0.10, 0.04, fd);
  box(v, 0.14, 0.20, 0.02, 0.04, 0.10, 0.04, fd);
  // глаза
  box(v, -0.04, 0.22, 0.09, 0.04, 0.04, 0.02, ACCENT.eyeDemon);
  box(v, 0.04, 0.22, 0.09, 0.04, 0.04, 0.02, ACCENT.eyeDemon);
  return v;
}

/** Зомби — гнилое туловище, тёмная плоть. */
export function zombieEnemy(): Voxel[] {
  const v: Voxel[] = [];
  const f = PALETTE.fleshDark, fd = shade(PALETTE.fleshDark, 0.7);
  box(v, -0.10, -0.42, 0, 0.10, 0.26, 0.12, fd);
  box(v, 0.10, -0.42, 0, 0.10, 0.26, 0.12, fd);
  box(v, 0, -0.20, 0, 0.26, 0.30, 0.16, f);
  // рваная рука
  box(v, -0.22, -0.16, 0.04, 0.07, 0.30, 0.07, fd);
  box(v, 0.22, -0.10, -0.04, 0.07, 0.22, 0.07, fd);
  // голова (скособочена)
  box(v, 0.04, 0.20, 0.0, 0.18, 0.18, 0.16, shade(f, 1.1));
  // глаза (тусклые)
  box(v, -0.02, 0.22, 0.08, 0.04, 0.04, 0.02, ACCENT.eyeRed);
  box(v, 0.12, 0.22, 0.08, 0.04, 0.04, 0.02, ACCENT.eyeRed);
  return v;
}

/** Демон — крупный, рогатый, тёмно-багровый. */
export function demonEnemy(): Voxel[] {
  const v: Voxel[] = [];
  const m = PALETTE.metalDark, bl = ACCENT.blood;
  // массивные ноги
  box(v, -0.12, -0.42, 0, 0.14, 0.26, 0.16, m);
  box(v, 0.12, -0.42, 0, 0.14, 0.26, 0.16, m);
  // торс
  fill(v, -0.22, 0.22, -0.16, 0.12, -0.18, 0.18, 0.14, shade(bl, 0.6));
  box(v, 0, 0.10, 0, 0.28, 0.22, 0.22, m);
  // плечи/руки
  box(v, -0.28, -0.06, 0, 0.10, 0.34, 0.12, shade(m, 0.8));
  box(v, 0.28, -0.06, 0, 0.10, 0.34, 0.12, shade(m, 0.8));
  // голова
  box(v, 0, 0.28, 0, 0.22, 0.20, 0.20, shade(bl, 0.5));
  // рога
  box(v, -0.12, 0.42, 0, 0.05, 0.12, 0.05, PALETTE.boneDark);
  box(v, 0.12, 0.42, 0, 0.05, 0.12, 0.05, PALETTE.boneDark);
  // глаза
  box(v, -0.06, 0.30, 0.10, 0.05, 0.05, 0.02, ACCENT.eyeDemon);
  box(v, 0.06, 0.30, 0.10, 0.05, 0.05, 0.02, ACCENT.eyeDemon);
  return v;
}

/** Владыка (босс) — огромный тёмный лорд с большими рогами. */
export function bossEnemy(): Voxel[] {
  const v: Voxel[] = [];
  const sd = PALETTE.stoneDark, bl = ACCENT.blood, ar = ACCENT.arcane;
  box(v, -0.16, -0.44, 0, 0.18, 0.30, 0.20, sd);
  box(v, 0.16, -0.44, 0, 0.18, 0.30, 0.20, sd);
  fill(v, -0.30, 0.30, -0.14, 0.20, -0.24, 0.24, 0.16, shade(bl, 0.45));
  box(v, 0, 0.22, 0, 0.40, 0.34, 0.30, sd);
  box(v, -0.36, 0.04, 0, 0.12, 0.42, 0.14, shade(sd, 1.15));
  box(v, 0.36, 0.04, 0, 0.12, 0.42, 0.14, shade(sd, 1.15));
  // голова
  box(v, 0, 0.44, 0, 0.28, 0.24, 0.26, shade(bl, 0.4));
  // большие рога
  box(v, -0.16, 0.62, -0.04, 0.06, 0.20, 0.06, PALETTE.boneDark);
  box(v, 0.16, 0.62, -0.04, 0.06, 0.20, 0.06, PALETTE.boneDark);
  box(v, -0.20, 0.74, -0.04, 0.04, 0.10, 0.04, PALETTE.bone);
  box(v, 0.20, 0.74, -0.04, 0.04, 0.10, 0.04, PALETTE.bone);
  // глаза + магическое свечение
  box(v, -0.07, 0.46, 0.12, 0.06, 0.06, 0.02, ACCENT.eyeDemon);
  box(v, 0.07, 0.46, 0.12, 0.06, 0.06, 0.02, ACCENT.eyeDemon);
  box(v, 0, 0.34, 0.14, 0.08, 0.04, 0.02, ar);
  return v;
}

/** База — алтарь с кристаллом (голубая душа). */
export function baseAltar(): Voxel[] {
  const v: Voxel[] = [];
  const sd = PALETTE.stoneDark, s = PALETTE.stone;
  // кольцо-основание из камня
  fill(v, -0.42, 0.42, -0.50, -0.42, -0.42, 0.42, 0.14, sd);
  fill(v, -0.42, 0.42, -0.30, -0.20, -0.42, 0.42, 0.14, s);
  // руны золотом по углам
  for (const sx of [-0.36, 0.36]) for (const sz of [-0.36, 0.36]) {
    box(v, sx, -0.34, sz, 0.08, 0.10, 0.08, ACCENT.gold);
  }
  // кристалл-ядро
  box(v, 0, -0.10, 0, 0.22, 0.30, 0.22, ACCENT.soul);
  box(v, 0, 0.12, 0, 0.14, 0.22, 0.14, ACCENT.iceCore);
  box(v, 0, 0.28, 0, 0.07, 0.10, 0.07, ACCENT.soul);
  return v;
}

/** Спавн — тёмный портал с огненными рунами. */
export function spawnPortal(): Voxel[] {
  const v: Voxel[] = [];
  const sd = PALETTE.stoneDark, bl = ACCENT.blood;
  fill(v, -0.36, 0.36, -0.50, -0.42, -0.36, 0.36, 0.12, sd);
  // кольцо-арка (упрощённо: угловые столбы)
  box(v, -0.30, -0.20, 0, 0.12, 0.50, 0.12, shade(sd, 0.8));
  box(v, 0.30, -0.20, 0, 0.12, 0.50, 0.12, shade(sd, 0.8));
  box(v, 0, 0.10, 0, 0.66, 0.12, 0.12, shade(sd, 0.7));
  // огненное ядро портала
  box(v, 0, -0.18, 0, 0.30, 0.40, 0.06, ACCENT.fire);
  box(v, 0, -0.18, 0.02, 0.18, 0.26, 0.04, ACCENT.fireCore);
  // кровь-руны
  box(v, 0, -0.40, 0.08, 0.22, 0.04, 0.02, bl);
  return v;
}

/** Снаряд — короткий болт (универсальный). */
export function projectileBolt(): Voxel[] {
  const v: Voxel[] = [];
  box(v, 0, 0, 0, 0.06, 0.06, 0.06, PALETTE.metalLight);
  box(v, 0.05, 0, 0, 0.08, 0.04, 0.04, ACCENT.fireCore);
  box(v, -0.05, 0, 0, 0.04, 0.08, 0.08, shade(PALETTE.metalDark, 0.9));
  return v;
}

// ── Стены лабиринта (Фаза 4) ────────────────────────────────────────────

/** Деревянная стена — частокол из тёмных брёвен с перекладиной. */
export function woodWall(): Voxel[] {
  const v: Voxel[] = [];
  const w = PALETTE.wood, wd = PALETTE.woodDark;
  // 3 вертикальных бревна
  for (const sx of [-0.22, 0, 0.22]) {
    fill(v, sx - 0.09, sx + 0.09, -0.42, 0.42, -0.12, 0.12, 0.10, wd);
  }
  // перекладины (скрепляют частокол)
  fill(v, -0.34, 0.34, -0.26, -0.20, -0.14, 0.14, 0.10, w);
  fill(v, -0.34, 0.34, 0.20, 0.34, -0.14, 0.14, 0.10, w);
  // заострённый верх (уголки)
  for (const sx of [-0.22, 0, 0.22]) {
    box(v, sx, 0.46, 0, 0.10, 0.10, 0.10, shade(wd, 0.8));
  }
  return v;
}

/** Каменная стена — грубая кладка из тёмных валунов. */
export function stoneWall(): Voxel[] {
  const v: Voxel[] = [];
  const s = PALETTE.stone, sd = PALETTE.stoneDark, sl = PALETTE.stoneLight;
  // основание-куча
  fill(v, -0.36, 0.36, -0.50, -0.34, -0.34, 0.34, 0.14, sd);
  // ряды кладки (со смещением)
  fill(v, -0.34, 0.34, -0.34, -0.16, -0.30, 0.30, 0.14, s);
  fill(v, -0.34, 0.34, -0.16, 0.02, -0.30, 0.30, 0.14, shade(s, 0.92));
  fill(v, -0.34, 0.34, 0.02, 0.20, -0.30, 0.30, 0.14, s);
  // верхние валуны (неровный гребень)
  box(v, -0.14, 0.34, 0.0, 0.30, 0.20, 0.30, sl);
  box(v, 0.18, 0.32, 0.08, 0.22, 0.18, 0.22, shade(sl, 0.9));
  box(v, -0.10, 0.34, -0.14, 0.26, 0.18, 0.20, shade(sl, 0.95));
  return v;
}

/** Костяная стена — баррикада из черепов и берцовых костей. */
export function boneWall(): Voxel[] {
  const v: Voxel[] = [];
  const bo = PALETTE.bone, bod = PALETTE.boneDark;
  // основание из крупных костей (бёдра)
  fill(v, -0.34, 0.34, -0.50, -0.38, -0.30, 0.30, 0.12, bod);
  // вертикальные берцовые кости
  for (const sx of [-0.22, 0.04, 0.26]) {
    fill(v, sx - 0.07, sx + 0.07, -0.34, 0.24, -0.09, 0.09, 0.08, bo);
    // суставы
    box(v, sx, -0.34, 0, 0.12, 0.08, 0.12, bod);
    box(v, sx, 0.26, 0, 0.10, 0.07, 0.10, bod);
  }
  // черепа на гребне
  box(v, -0.10, 0.36, 0, 0.16, 0.14, 0.16, bo);
  box(v, -0.06, 0.40, 0.08, 0.03, 0.03, 0.02, ACCENT.eyeRed);
  box(v, 0.02, 0.40, 0.08, 0.03, 0.03, 0.02, ACCENT.eyeRed);
  box(v, 0.22, 0.32, 0, 0.14, 0.12, 0.14, shade(bo, 0.95));
  box(v, 0.22, 0.36, 0.08, 0.03, 0.03, 0.02, ACCENT.eyeRed);
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
  'base:altar': baseAltar,
  'spawn:portal': spawnPortal,
  'projectile:bolt': projectileBolt,
  'wall:wood': woodWall,
  'wall:stone': stoneWall,
  'wall:bone': boneWall
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
    case 'base:altar': return ACCENT.soul;
    case 'spawn:portal': return ACCENT.fire;
    case 'projectile:bolt': return ACCENT.fireCore;
    case 'wall:bone': return ACCENT.eyeRed;
    default: return undefined;
  }
}
