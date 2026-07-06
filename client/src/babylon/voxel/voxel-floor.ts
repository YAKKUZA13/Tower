/**
 * Воксельная плита поля боя + тематический бордюр (Phase D новой концепции).
 *
 * Заменяет гладкий heightmap-террейн на однородный воксельный пол в стиле
 * остального арта (башни/враги/стены). Пол:
 *   - занимает всю канвас-область поля (cols×rows клеток);
 *   - не «висит в воздухе»: под плитой тёмная подложка, по периметру —
 *     каменный бордюр крепости (зубцы + редкие черепа/руны);
 *   - плоский (sampleHeight = 0) — математика сима/рендера та же, что и раньше;
 *   - принимает тени (receiveShadows=true) — акторы больше не «парят».
 */

import { Color3, Mesh, MeshBuilder, StandardMaterial, VertexBuffer, type Scene } from 'babylonjs';
import { PALETTE, ACCENT, desaturate, shade, type RGB } from './dark-palette';

export interface VoxelBoardOptions {
  /** Подсветка края «кровавыми» рунами (опц.). Дефолт = true. */
  runeAccent?: boolean;
}

/**
 * Создаёт воксельную плиту поля боя. Возвращает ground-меш (имя 'ground' —
 * важно для pickWorld) и отдельный decoration-меш (бордюр + подложка).
 */
export function createVoxelBoard(
  scene: Scene,
  grid: { cols: number; rows: number; cellSize: number },
  _options: VoxelBoardOptions = {}
): { ground: Mesh; decorations: Mesh } {
  const cs = grid.cellSize;
  const boardW = grid.cols * cs;
  const boardD = grid.rows * cs;

  // Единый материал для всей подложки+бордюра: vertex colors задают цвет
  // каждой детали (тёмный камень для плиты, кость/золото для акцентов).
  const boardMat = new StandardMaterial('voxel-board-mat', scene);
  boardMat.diffuseColor = new Color3(0.95, 0.95, 0.95); // базис → видны vertex colors
  boardMat.specularColor = new Color3(0.03, 0.03, 0.03);
  boardMat.roughness = 0.95;

  // ── Плита поля (верх на y=0, низ на y=-0.5; объекты ставятся на y=0) ──
  // Тёмная каменная плитка с лёгкой per-cell вариацией — через vertex colors.
  const ground = MeshBuilder.CreateGround(
    'ground',
    { width: boardW, height: boardD, subdivisionsX: grid.cols, subdivisionsY: grid.rows },
    scene
  );
  //Vertex colors: per-cell вариация между earth/stoneDark/moss для «пятнистого» вида.
  paintStoneTileVariation(ground, grid);

  const groundMat = new StandardMaterial('voxel-ground-mat', scene);
  groundMat.diffuseColor = new Color3(0.95, 0.95, 0.95); // базис → видны vertex colors
  groundMat.specularColor = new Color3(0.03, 0.03, 0.03);
  groundMat.roughness = 0.95;
  ground.material = groundMat;
  ground.receiveShadows = true; // тени от акторов ложатся на пол (§D)
  ground.isPickable = true;
  // верхняя грань на y=0: CreateGround уже плоский на y=0 → ничего двигать не нужно.
  ground.metadata = { playableGround: true };

  // ── Подложка под плитой — тёмная «бездна», чтобы край не висел в воздухе ──
  const underlay = MeshBuilder.CreateBox(
    'ground-underlay',
    { width: boardW + cs * 0.4, depth: boardD + cs * 0.4, height: 2.5 },
    scene
  );
  underlay.position.set(0, -1.75, 0); // верх подложки на y=-0.5 (стык в уровень низа плиты)
  underlay.material = boardMat;
  paintSolidBox(underlay, PALETTE.stoneDark);
  underlay.receiveShadows = false;
  underlay.isPickable = false;
  underlay.doNotSyncBoundingInfo = true;

  // ── Бордюр по периметру: каменная стена крепости с зубцами ──
  const border = buildBorder(scene, grid, boardMat);

  // Объединяем подложку + бордюр в один decoration-меш (1 draw call).
  const merged = Mesh.MergeMeshes([underlay, border], true, false) ?? underlay;
  merged.name = 'board-decorations';
  merged.id = 'board-decorations';
  merged.isPickable = false;
  merged.doNotSyncBoundingInfo = true;
  merged.freezeWorldMatrix();

  return { ground, decorations: merged };
}

// ──────────────────────────────────────────────────────────────────────
// Хелперы
// ──────────────────────────────────────────────────────────────────────

/** Красит vertex colors плиты в тёмные землистые тона с лёгкой пятнистостью. */
function paintStoneTileVariation(
  ground: Mesh,
  grid: { cols: number; rows: number; cellSize: number }
): void {
  const positions = ground.getVerticesData(VertexBuffer.PositionKind);
  if (!positions) return;
  const subdivisionsX = grid.cols;
  const subdivisionsY = grid.rows;
  const stride = subdivisionsX + 1;
  const colors = new Float32Array(stride * (subdivisionsY + 1) * 4);

  // базовые тона «тёмного камня»: 3 варианта для вариативности без «милоты»
  const variants: RGB[] = [
    desaturate([0.16, 0.16, 0.18], 0.20),
    desaturate([0.20, 0.18, 0.15], 0.25),
    desaturate([0.14, 0.15, 0.13], 0.18)
  ];

  // псевдо-случайное распределение по сетке (детерминированное, без rng)
  for (let r = 0; r <= subdivisionsY; r++) {
    for (let c = 0; c <= subdivisionsX; c++) {
      const h = Math.sin((c + 1) * 12.9898 + (r + 1) * 78.233) * 43758.5453;
      const t = h - Math.floor(h);
      const v = variants[Math.floor(t * variants.length)] ?? variants[0]!;
      const ci = (r * stride + c) * 4;
      colors[ci] = v[0];
      colors[ci + 1] = v[1];
      colors[ci + 2] = v[2];
      colors[ci + 3] = 1;
    }
  }
  ground.setVerticesData(VertexBuffer.ColorKind, colors, false);
}

/**
 * Каменный бордюр-стена по периметру поля с зубцами и редкими рунами/черепами.
 * Тематически читается как «край карты крепости», отделяет игровое поле от
 * тёмной подложки/тумана.
 */
function buildBorder(
  scene: Scene,
  grid: { cols: number; rows: number; cellSize: number },
  material: StandardMaterial
): Mesh {
  const cs = grid.cellSize;
  const boardW = grid.cols * cs;
  const boardD = grid.rows * cs;
  const thickness = Math.max(0.4, cs * 0.35);
  const height = Math.max(0.55, cs * 0.55);
  // бордюр стоит вплотную к краю плиты (снаружи)
  const outerW = boardW + thickness;
  const outerD = boardD + thickness;

  const parts: Mesh[] = [];

  // 4 стороны бордюра (4 узких бокса)
  const sides: Array<{ w: number; d: number; x: number; z: number }> = [
    { w: outerW + thickness, d: thickness, x: 0, z: -outerD / 2 - thickness / 2 }, // near
    { w: outerW + thickness, d: thickness, x: 0, z: outerD / 2 + thickness / 2 },  // far
    { w: thickness, d: outerD, x: -outerW / 2 - thickness / 2, z: 0 },             // left
    { w: thickness, d: outerD, x: outerW / 2 + thickness / 2, z: 0 }               // right
  ];
  for (let i = 0; i < sides.length; i++) {
    const s = sides[i]!;
    const m = MeshBuilder.CreateBox(`border-side-${i}`, { width: s.w, height, depth: s.d }, scene);
    m.position.set(s.x, height / 2 - 0.25, s.z);
    paintSolidBox(m, mixColor(PALETTE.stoneDark, PALETTE.stone, 0.4));
    parts.push(m);
  }

  // Зубцы (crenellations) — короткие блоки поверх каждой стороны с зазором.
  const merlonW = Math.max(0.3, cs * 0.35);
  const merlonGap = merlonW * 0.9;
  const merlonH = height * 0.45;
  const merlonY = height + merlonH / 2 - 0.25;

  // вдоль длинных сторон (X axis): шагаем по boardW
  const countX = Math.max(2, Math.floor((outerW + merlonGap) / (merlonW + merlonGap)));
  const stepX = (outerW + thickness * 2) / countX;
  for (let i = 0; i < countX; i++) {
    const x = -outerW / 2 - thickness / 2 + stepX * (i + 0.5);
    for (const z of [-outerD / 2 - thickness / 2, outerD / 2 + thickness / 2]) {
      const m = MeshBuilder.CreateBox(`merlon-x-${i}-${z}`, { width: merlonW, height: merlonH, depth: thickness * 0.9 }, scene);
      m.position.set(x, merlonY, z);
      paintSolidBox(m, shade(mixColor(PALETTE.stoneDark, PALETTE.stone, 0.55), 0.92));
      parts.push(m);
    }
  }
  // вдоль коротких сторон (Z axis)
  const countZ = Math.max(2, Math.floor((outerD + merlonGap) / (merlonW + merlonGap)));
  const stepZ = (outerD) / countZ;
  for (let i = 0; i < countZ; i++) {
    const z = -outerD / 2 + stepZ * (i + 0.5);
    for (const x of [-outerW / 2 - thickness / 2, outerW / 2 + thickness / 2]) {
      const m = MeshBuilder.CreateBox(`merlon-z-${i}-${x}`, { width: thickness * 0.9, height: merlonH, depth: merlonW }, scene);
      m.position.set(x, merlonY, z);
      paintSolidBox(m, shade(mixColor(PALETTE.stoneDark, PALETTE.stone, 0.55), 0.92));
      parts.push(m);
    }
  }

  // Редкие акценты: «руны» (золотые крупицы) и черепа на углах
  const corners: Array<[number, number]> = [
    [-outerW / 2 - thickness / 2, -outerD / 2 - thickness / 2],
    [outerW / 2 + thickness / 2, -outerD / 2 - thickness / 2],
    [-outerW / 2 - thickness / 2, outerD / 2 + thickness / 2],
    [outerW / 2 + thickness / 2, outerD / 2 + thickness / 2]
  ];
  for (let i = 0; i < corners.length; i++) {
    const [cx, cz] = corners[i]!;
    // угловой столб-башенка (крупнее зубцов)
    const tower = MeshBuilder.CreateBox(`corner-tower-${i}`, {
      width: thickness * 1.4,
      height: height * 1.4,
      depth: thickness * 1.4
    }, scene);
    tower.position.set(cx, height * 0.7 - 0.25, cz);
    paintSolidBox(tower, mixColor(PALETTE.stoneDark, PALETTE.boneDark, 0.25));
    parts.push(tower);

    // золотая руна на вершине угловой башенки
    const rune = MeshBuilder.CreateBox(`corner-rune-${i}`, {
      width: thickness * 0.45,
      height: thickness * 0.18,
      depth: thickness * 0.18
    }, scene);
    rune.position.set(cx, height * 1.4 - 0.18, cz);
    paintSolidBox(rune, ACCENT.gold);
    parts.push(rune);

    // череп у основания (каждый второй угол)
    if (i % 2 === 0) {
      const skull = MeshBuilder.CreateBox(`corner-skull-${i}`, {
        width: cs * 0.28,
        height: cs * 0.22,
        depth: cs * 0.28
      }, scene);
      // череп чуть внутри поля, на плите
      const dx = cx > 0 ? -thickness * 0.9 : thickness * 0.9;
      const dz = cz > 0 ? -thickness * 0.9 : thickness * 0.9;
      skull.position.set(cx + dx, 0.0 + cs * 0.11, cz + dz);
      paintSolidBox(skull, mixColor(PALETTE.bone, PALETTE.boneDark, 0.4));
      parts.push(skull);
      // глазницы
      const eyes = MeshBuilder.CreateBox(`corner-skull-eyes-${i}`, {
        width: cs * 0.16,
        height: cs * 0.04,
        depth: cs * 0.02
      }, scene);
      eyes.position.set(skull.position.x, skull.position.y + cs * 0.02, skull.position.z + cs * 0.14);
      paintSolidBox(eyes, ACCENT.eyeRed);
      parts.push(eyes);
    }
  }

  const merged = Mesh.MergeMeshes(parts, true, false) ?? parts[0]!;
  merged.name = 'board-border';
  merged.id = 'board-border';
  merged.material = material;
  merged.isPickable = false;
  // Бордюр должен отбрасывать/принимать тени для «посадки» в сцену.
  merged.receiveShadows = true;
  merged.doNotSyncBoundingInfo = true;
  return merged;
}

// ── Цветовые утилиты ───────────────────────────────────────────────────

/** Линейная интерполяция двух RGB. */
function mixColor(a: RGB, b: RGB, t: number): RGB {
  return [
    a[0] + (b[0] - a[0]) * t,
    a[1] + (b[1] - a[1]) * t,
    a[2] + (b[2] - a[2]) * t
  ];
}

/** Заполняет vertex colors бокса одним цветом (для тематических акцентов). */
function paintSolidBox(mesh: Mesh, color: RGB): void {
  const vc = new Float32Array(24 * 4);
  for (let k = 0; k < 24; k++) {
    vc[k * 4] = color[0];
    vc[k * 4 + 1] = color[1];
    vc[k * 4 + 2] = color[2];
    vc[k * 4 + 3] = 1;
  }
  mesh.setVerticesData(VertexBuffer.ColorKind, vc, false);
}
