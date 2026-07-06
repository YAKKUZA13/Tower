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
import { Color3, Matrix, Mesh, MeshBuilder, StandardMaterial, VertexBuffer, type Scene } from 'babylonjs';
import { ACCENT, PALETTE, shade, type RGB } from './dark-palette';

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

// ── baked per-face directional tint (классический «воксельный» шейдинг) ──────────
// Запекаем top ярче / sides средне / bottom темнее по нормали грани → блоки читаются
// при любом освещении, а стык яркой верхней и тёмной боковой грани читается как тёмная
// линия (эффект «out line по граням вокселя»), что работает на thin instances.
const FACE_TINT_TOP = 1.0;
const FACE_TINT_SIDE = 0.6;
const FACE_TINT_BOTTOM = 0.38;

/** Emissive-подобные цвета (яркие + насыщенные) НЕ затемняем по граням — это
 *  «огонь / глаза / кристаллы / золото», они должны гореть равно на всех гранях. */
function isAccentColor([r, g, b]: RGB): boolean {
  const max = Math.max(r, g, b);
  const sat = max - Math.min(r, g, b);
  return max > 0.7 && sat > 0.25;
}

/**
 * Строит единый воксельный меш из списка вокселов. Меш отцентрирован в начале координат.
 * Вызывающий владеет результатом (должен dispose).
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

  const parts: Mesh[] = [];
  for (const [key, color] of cells) {
    const p = key.split(',');
    const x = +p[0]!, y = +p[1]!, z = +p[2]!;
    const m = MeshBuilder.CreateBox(`${options.name}-v`, { size: 1 }, scene);
    m.position.set(x, y, z);
    // вершинные цвета с baked per-face tint по нормали грани.
    const accent = isAccentColor(color);
    const normals = m.getVerticesData(VertexBuffer.NormalKind);
    const vc = new Float32Array(24 * 4);
    for (let k = 0; k < 24; k++) {
      const ny = normals ? normals[k * 3 + 1] : 0;
      let t = FACE_TINT_TOP;
      if (!accent) {
        if (ny > 0.5) t = FACE_TINT_TOP;
        else if (ny < -0.5) t = FACE_TINT_BOTTOM;
        else t = FACE_TINT_SIDE;
      }
      vc[k * 4] = color[0] * t;
      vc[k * 4 + 1] = color[1] * t;
      vc[k * 4 + 2] = color[2] * t;
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

// ── RTS: защитные юниты ────────────────────────────────────────────────────

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
  'unit:knight': knightUnit,
  'unit:archer': archerUnit,
  'unit:mage': mageUnit,
  'unit:commander': commanderUnit
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
    case 'relic:totem-fire': return ACCENT.fire;
    case 'relic:totem-arcane': return ACCENT.arcane;
    case 'relic:totem-gold': return ACCENT.gold;
    case 'relic:totem-ice': return ACCENT.ice;
    case 'relic:totem-blood': return ACCENT.blood;
    case 'building:sawmill': return ACCENT.fire;
    case 'building:mine': return ACCENT.gold;
    case 'building:smelter': return ACCENT.fireCore;
    case 'building:barracks': return ACCENT.blood;
    case 'unit:knight': return ACCENT.soul;
    case 'unit:archer': return ACCENT.gold;
    case 'unit:mage': return ACCENT.arcane;
    case 'unit:commander': return ACCENT.arcaneCore;
    default: return undefined;
  }
}
