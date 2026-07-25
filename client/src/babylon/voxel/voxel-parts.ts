/**
 * Part-graph риг поверх воксельной сетки (Фаза P0, research §5).
 *
 * Модель = иерархия PartNode («stiff limb» rigid-part animation, research §5.1/§5.4):
 * каждый парт (head/torso/upperArm/forearm/thigh/shin/...) = набор вокселей Voxel[] +
 * pivot (центр сустава в модельных unit-вокселях). assembleRig строит иерархию
 * TransformNode (Babylon «B-model» паттерн §5.4): нода = сустав, меш парта смещён
 * так, что pivot сидит в origin ноды → rotation ноды = вращение вокруг сустава.
 *
 * Walk-cycle и любая анимация — рендер-only (инвариант §2.1: сим НЕ знает о риге).
 *
 * Контракт normalizeMesh (§2.4): собранный риг масштабируется к height=1.0, base@-0.5,
 * XZ по центру — через transform корневой ноды (НЕ запекается в вершины, чтобы
 * сохранить joint-local геометрию для анимации).
 */
import {
  Color3,
  Mesh,
  StandardMaterial,
  TransformNode,
  VertexData,
  type Scene
} from 'babylonjs';
import {
  computeGreedyGeometry,
  type Voxel,
  type VoxelMeshOptions
} from './voxel-builder';
import type { RGB } from './dark-palette';

/** Ключевой кадр rigid-анимации (research §5.3 — зеркало .vox nTRN per-frame _r/_t). */
export interface Keyframe {
  /** Время кадра (нормализованное 0..1 внутри клипа или секунды). */
  t: number;
  /** Euler rotation (рад) относительно rest-pose. */
  rot: [number, number, number];
  /** Опц. смещение позиции относительно rest-pose. */
  pos?: [number, number, number];
}

/** Узел part-graph: один rigid парт тела (research §5.5). */
export interface PartNode {
  /** Имя-сустав: 'hips' | 'spine' | 'head' | 'upperArmL' | 'forearmL' | 'thighL' | ... */
  name: string;
  /** Центр сустава в модельных unit-вокселях (абсолютные координаты модели). */
  pivot: [number, number, number];
  /** Воксели парта (в тех же модельных координатах, что pivot). */
  voxels: Voxel[];
  /** Опц. варианты для shape-swap (оружие / разрушенное состояние, research §5.3 nSHP). */
  swapVariants?: PartNode[];
  /** Опц. rigid keyframe-анимация (клип); рендер интерполирует/проигрывает. */
  frames?: Keyframe[];
  /** Дочерние парты (родительская связь = сустав-сустав). */
  children: PartNode[];
}

/**
 * Тип анимационного драйвера для рига (M1). Рендерер выбирает процедурную
 * анимацию по этому полю: walk-cycle (гуманоид), взмах крыльев (летучая мышь),
 * перебирание 8 ног (паук), парение (призрак), сжатие/растяжение (слизень).
 * Если не задан — рендерер определяет по наличию walk-нод (spine/thighL/...),
 * иначе риг статичен (idle отсутствует).
 */
export type AnimKind = 'humanoid' | 'bat' | 'spider' | 'ghost' | 'slime' | 'static';

/** Полное определение персонажа: корень part-graph + опц. индекс-палитра (P1). */
export interface CharacterDef {
  name: string;
  root: PartNode;
  /** Опц. индекс-палитра (≤255, P1) — для palette-snap/дебриса. */
  palette?: RGB[];
  /** Тип процедурной анимации (M1). */
  animKind?: AnimKind;
}

export interface AssembleRigOptions {
  /** Стратегия мешинга партов (по умолчанию 'greedy' — меньше tri). */
  meshing?: 'naive' | 'greedy';
  /** Emissive-акцент материала (всё тело слегка светится). */
  emissive?: RGB;
  emissiveStrength?: number;
  alpha?: number;
  matte?: boolean;
}

/** Метаданные, хранящиеся на корневой ноде рига (для cloneRig/disposeRig). */
const RIG_META = '__characterRig';

interface RigMeta {
  def: CharacterDef;
  scene: Scene;
  options: AssembleRigOptions;
  /** Единый материал всех партов (vertex colors несут tint+AO). */
  material: StandardMaterial;
}

/**
 * Собирает CharacterDef → иерархия TransformNode (rig). Каждый PartNode → TransformNode
 * (сустав) + дочерний меш парта. mesh.position = -pivot (pivot в origin ноды);
 * node.position = pivot - parentPivot (relative). При вращении ноды парт вращается
 * вокруг сустава. Корневая нода масштабируется к normalizeMesh-конвенции.
 *
 * @returns корневая TransformNode (владение — у вызывающего, dispose через disposeRig).
 */
export function assembleRig(
  scene: Scene,
  def: CharacterDef,
  options: AssembleRigOptions = {}
): TransformNode {
  const meshing = options.meshing ?? 'greedy';
  // Единый материал рига (vertex colors несут baked tint+AO — как в buildVoxelMesh).
  const mat = new StandardMaterial(`${def.name}-rig-mat`, scene);
  mat.diffuseColor = new Color3(0.82, 0.82, 0.82);
  if (options.matte !== false) mat.specularColor = new Color3(0.04, 0.04, 0.04);
  const em = options.emissive;
  const es = options.emissiveStrength ?? 0.18;
  if (em && es > 0) mat.emissiveColor = new Color3(em[0] * es, em[1] * es, em[2] * es);
  if (options.alpha !== undefined && options.alpha < 1) mat.alpha = options.alpha;

  const rigRoot = new TransformNode(`${def.name}-rig`, scene);
  // Нормализацию (scale 1/height + recenter XZ + base@-0.5) кладём на ДОЧЕРНИЙ
  // узел `norm`, а НЕ на сам rigRoot. Тогда rigRoot остаётся с identity-трансформом
  // и рендерер свободно ставит его position/scaling для world-размещения юнита
  // (cellSize-масштаб + world-позиция), не затирая нормализацию. Раньше нормализация
  // была на rigRoot и рендереры делали root.scaling.set(cellSize) → перетирали её →
  // юниты получались в ~modelHeight× больше (воркер 25 единиц вместо 1.5).
  const normNode = new TransformNode(`${def.name}-norm`, scene);
  normNode.parent = rigRoot;
  // рекурсивно строим узлы; parentPivot root'а = (0,0,0) → root node at root.pivot.
  buildPartNode(scene, def.root, normNode, [0, 0, 0], meshing, mat);

  // normalizeMesh-конвенция (§2.4): объединённые bounds всех вокселей → scale/translate
  // norm-узла (НЕ запекаем в вершины — сохраняем joint-local геометрию для анимации).
  const bounds = computeDefBounds(def);
  const height = Math.max(1, bounds.maxY - bounds.minY);
  const s = 1 / height;
  normNode.scaling.set(s, s, s);
  normNode.position.set(
    -((bounds.minX + bounds.maxX) * 0.5) * s,
    -0.5 - bounds.minY * s,
    -((bounds.minZ + bounds.maxZ) * 0.5) * s
  );
  // rigRoot остаётся identity — рендерер задаёт тут world-позицию/масштаб/поворот.

  (rigRoot as TransformNode & { metadata: unknown }).metadata = {
    [RIG_META]: { def, scene, options, material: mat } satisfies RigMeta
  };
  return rigRoot;
}

/** Рекурсивно строит TransformNode + меш парта + дочерние узлы. */
function buildPartNode(
  scene: Scene,
  part: PartNode,
  parent: TransformNode,
  parentPivot: [number, number, number],
  meshing: 'naive' | 'greedy',
  material: StandardMaterial
): TransformNode {
  const node = new TransformNode(part.name, scene);
  node.parent = parent;
  // relative offset: pivot этого парта минус pivot родителя (rest-pose).
  node.position.set(
    part.pivot[0] - parentPivot[0],
    part.pivot[1] - parentPivot[1],
    part.pivot[2] - parentPivot[2]
  );

  if (part.voxels.length > 0) {
    const mesh = buildPartMesh(scene, part.voxels, part.name, meshing);
    mesh.parent = node;
    // pivot в origin ноды: вершина-сустав (pivot) → node origin → вращается вокруг него.
    mesh.position.set(-part.pivot[0], -part.pivot[1], -part.pivot[2]);
    mesh.material = material;
    mesh.isPickable = false;
    mesh.doNotSyncBoundingInfo = true;
  }

  for (const child of part.children) {
    buildPartNode(scene, child, node, part.pivot, meshing, material);
  }
  return node;
}

/** Строит меш парта БЕЗ normalizeMesh (geometрия остаётся в модельных воксель-координатах). */
function buildPartMesh(
  scene: Scene,
  voxels: Voxel[],
  name: string,
  meshing: 'naive' | 'greedy'
): Mesh {
  if (meshing === 'greedy') {
    const geo = computeGreedyGeometry(voxels, false);
    const mesh = new Mesh(`${name}-part`, scene);
    if (geo.positions.length > 0) {
      const vd = new VertexData();
      vd.positions = geo.positions;
      vd.indices = geo.indices;
      vd.colors = geo.colors;
      vd.normals = geo.normals;
      vd.applyToMesh(mesh, false);
    }
    return mesh;
  }
  // 'naive' fallback для партов: используем greedy-геометрию тоже (наивные per-cube
  // боксы + merge здесь избыточны; greedy корректен и для маленьких партов).
  return buildPartMesh(scene, voxels, name, 'greedy');
}

/**
 * Bounding box объединения всех вокселей CharacterDef (модельные координаты).
 * Воксель — единичный куб [v, v+1) по каждой оси (как его строит greedy-мешер):
 * поэтому max-грань = maxVoxelCoord + 1, иначе нормализация (1/height) давала
 * высоту рига ~1.05 вместо 1.0 (юниты на ~5% больше и основание тонуло в землю).
 */
function computeDefBounds(def: CharacterDef): { minX: number; minY: number; minZ: number; maxX: number; maxY: number; maxZ: number } {
  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  const walk = (p: PartNode): void => {
    for (const v of p.voxels) {
      if (v.x < minX) minX = v.x; if (v.x + 1 > maxX) maxX = v.x + 1;
      if (v.y < minY) minY = v.y; if (v.y + 1 > maxY) maxY = v.y + 1;
      if (v.z < minZ) minZ = v.z; if (v.z + 1 > maxZ) maxZ = v.z + 1;
    }
    for (const c of p.children) walk(c);
  };
  walk(def.root);
  return { minX, minY, minZ, maxX, maxY, maxZ };
}

/**
 * Deep-clone рига для per-enemy инстансов (research §5.5 шаг 6 — clone() иерархии).
 *
 * Реализация: re-assemble из сохранённого CharacterDef (метаданные корня). Это
 * надёжнее Babylon native TransformNode.clone (который не гарантирует сохранение
 * имён нод и корректный deep-clone мешей-детей). Геометрия партов строится через
 * greedy — дёшево для ~11 партов × десятки вокселей. Возвращает независимую
 * иерархию с теми же именами суставов.
 */
export function cloneRig(root: TransformNode): TransformNode {
  const meta = (root as TransformNode & { metadata?: Record<string, unknown> }).metadata;
  const rigMeta = meta?.[RIG_META] as RigMeta | undefined;
  if (!rigMeta) {
    // нет метаданных (внешний риг) — fallback на Babylon native clone
    return root.clone(`${root.name}-c`, null) as TransformNode;
  }
  return assembleRig(rigMeta.scene, rigMeta.def, rigMeta.options);
}

/** Освобождает все меши и ноды рига (рекурсивно). Безопасен для клонов. */
export function disposeRig(root: TransformNode): void {
  // dispose материала только если это «мастер» (у клона тот же материал — Babylon
  // отследит; повторный dispose материала безопасен через try/catch).
  const meta = (root as TransformNode & { metadata?: Record<string, unknown> }).metadata;
  const rigMeta = meta?.[RIG_META] as RigMeta | undefined;
  // рекурсивно dispose дочерних мешей/нод
  const stack: TransformNode[] = [root];
  while (stack.length) {
    const n = stack.pop()!;
    for (const child of n.getChildren()) {
      stack.push(child as TransformNode);
    }
    if (n instanceof Mesh) n.dispose(false, true);
    else n.dispose();
  }
  void rigMeta;
}

/** Находит дочерние TransformNode по именам (для walk-cycle: thighL, shinL, ...). */
export function findNodesByName(root: TransformNode, names: readonly string[]): Map<string, TransformNode> {
  const want = new Set(names);
  const out = new Map<string, TransformNode>();
  const stack: TransformNode[] = [root];
  while (stack.length) {
    const n = stack.pop()!;
    if (want.has(n.name)) out.set(n.name, n);
    for (const child of n.getChildren()) stack.push(child as TransformNode);
  }
  return out;
}

/** Собирает все меши рига (для регистрации теней — как getShadowCasterMeshes). */
export function collectRigMeshes(root: TransformNode): Mesh[] {
  const out: Mesh[] = [];
  const stack: TransformNode[] = [root];
  while (stack.length) {
    const n = stack.pop()!;
    if (n instanceof Mesh) out.push(n);
    for (const child of n.getChildren()) stack.push(child as TransformNode);
  }
  return out;
}

/** Возвращает воксели парта по имени (для дебриса при смерти — Фаза P1). */
export function getPartVoxels(def: CharacterDef, partName: string): Voxel[] {
  const stack: PartNode[] = [def.root];
  while (stack.length) {
    const p = stack.pop()!;
    if (p.name === partName) return p.voxels;
    for (const c of p.children) stack.push(c);
  }
  return [];
}

/** Список имён всех партов CharacterDef (для отладки/тестов). */
export function listPartNames(def: CharacterDef): string[] {
  const out: string[] = [];
  const walk = (p: PartNode): void => {
    out.push(p.name);
    for (const c of p.children) walk(c);
  };
  walk(def.root);
  return out;
}

// re-export опций материала для удобства импортёров
export type { VoxelMeshOptions };
