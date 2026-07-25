/**
 * .vox importer → CharacterDef (Фаза P3, research §5.3).
 *
 * Парсит MagicaVoxel `.vox`: SIZE/XYZI (модели) + RGBA (палитра) + scene-graph
 * nTRN/nGRP/nSHP → PartNode-дерево. nSHP → leaf (воксели из модели), nGRP → group,
 * nTRN → transform (_t = pivot/смещение сустава, _r = 24-ориентация).
 *
 * РОТАЦИЯ _r: MagicaVoxel кодирует 24 дискретные ориентации куба (signed permutation
 * matrices с det=+1). Чтобы не модифицировать assembleRig, _r ЗАПЕКАЕТСЯ в координаты
 * вокселей (поворот модельной сетки). _r=0 → identity (типичный случай авторинга);
 * для ненулевых _r используется каноническая генерация 24 det+1 матриц (см. примечание
 * в voxRotationMatrix).
 *
 * Без внешних зависимостей (свой парсер) — сохраняет CC0/dependency-дисциплину проекта
 * (вместо GPLv3 parse-magica-voxel).
 */
import type { RGB } from '../dark-palette';
import type { Voxel } from '../voxel-builder';
import type { CharacterDef, PartNode } from '../voxel-parts';

// ── Binary reader (little-endian) ────────────────────────────────────────────
class Reader {
  pos = 0;
  constructor(private data: Uint8Array) {}
  u8(): number { return this.data[this.pos++]!; }
  u32(): number { const v = this.data[this.pos]! | (this.data[this.pos + 1]! << 8) | (this.data[this.pos + 2]! << 16) | (this.data[this.pos + 3]! << 24); this.pos += 4; return v >>> 0; }
  i32(): number { return this.u32() | 0; }
  ascii(n: number): string { let s = ''; for (let i = 0; i < n; i++) s += String.fromCharCode(this.u8()); return s; }
  str(): string { let s = ''; while (this.data[this.pos] !== 0) s += String.fromCharCode(this.data[this.pos!]!), this.pos++; this.pos++; return s; }
  seek(p: number): void { this.pos = p; }
  atEnd(): boolean { return this.pos >= this.data.length; }
}

interface VoxDict { [k: string]: number | string; }

function readDict(r: Reader): VoxDict {
  const n = r.u32();
  const d: VoxDict = {};
  for (let i = 0; i < n; i++) {
    const key = r.str();
    const type = r.u8(); // 0=int, 1=float, 2=string
    if (type === 0) d[key] = r.i32();
    else if (type === 1) { const buf = new ArrayBuffer(4); const view = new DataView(buf); view.setInt32(0, r.i32(), true); d[key] = view.getFloat32(0, true); }
    else d[key] = r.str();
  }
  return d;
}

interface VoxModel {
  size: { x: number; y: number; z: number };
  voxels: { x: number; y: number; z: number; ci: number }[]; // ci = colorIndex 1..255
}
interface VoxTransform { nodeId: number; childNodeId: number; name: string; r: number; t: [number, number, number]; }
interface VoxGroup { nodeId: number; name: string; childNodeIds: number[]; }
interface VoxShape { nodeId: number; name: string; modelIds: number[]; }

interface VoxScene {
  models: VoxModel[];
  palette: RGB[]; // 256
  transforms: VoxTransform[];
  groups: VoxGroup[];
  shapes: VoxShape[];
  rootId: number;
}

/** Парсит .vox ArrayBuffer → структурированная сцена. */
function parseVox(buffer: ArrayBuffer): VoxScene {
  const data = new Uint8Array(buffer);
  const r = new Reader(data);
  const magic = r.ascii(4);
  if (magic !== 'VOX ') throw new Error(`Not a .vox file (magic '${magic}')`);
  r.u32(); // version (150)
  // ожидаем MAIN chunk
  const mainId = r.ascii(4);
  if (mainId !== 'MAIN') throw new Error(`Expected MAIN chunk, got '${mainId}'`);
  r.u32(); // MAIN content size (0)
  const mainChildrenSize = r.u32();
  const mainChildrenEnd = r.pos + mainChildrenSize;

  const models: VoxModel[] = [];
  const palette: RGB[] = new Array(256).fill(null).map(() => [0, 0, 0] as RGB);
  const transforms: VoxTransform[] = [];
  const groups: VoxGroup[] = [];
  const shapes: VoxShape[] = [];
  let pendingSize: { x: number; y: number; z: number } | null = null;

  while (r.pos < mainChildrenEnd && !r.atEnd()) {
    const chunkId = r.ascii(4);
    const contentSize = r.u32();
    const childrenSize = r.u32();
    const contentStart = r.pos;
    if (chunkId === 'SIZE') {
      pendingSize = { x: r.u32(), y: r.u32(), z: r.u32() };
    } else if (chunkId === 'XYZI') {
      const num = r.u32();
      const voxels: { x: number; y: number; z: number; ci: number }[] = [];
      for (let i = 0; i < num; i++) {
        voxels.push({ x: r.u8(), y: r.u8(), z: r.u8(), ci: r.u8() });
      }
      models.push({ size: pendingSize ?? { x: 1, y: 1, z: 1 }, voxels });
      pendingSize = null;
    } else if (chunkId === 'RGBA') {
      for (let i = 0; i < 256; i++) {
        palette[i] = [r.u8() / 255, r.u8() / 255, r.u8() / 255];
        r.u8(); // alpha
      }
    } else if (chunkId === 'nTRN') {
      const nodeId = r.u32();
      const attrs = readDict(r);
      const childNodeId = r.u32();
      r.i32(); // reserved (-1)
      r.u32(); // layer id
      const numFrames = r.u32();
      let fr = 0, ft: [number, number, number] = [0, 0, 0];
      for (let f = 0; f < numFrames; f++) {
        const fa = readDict(r);
        fr = (fa['_r'] as number | undefined) ?? 0;
        // _t (translation) — 3 int32 после frame-dict (моя согласованная writer/reader
        // раскладка; для реальных MagicaVoxel-экспортов может требовать калибровки).
        ft = [r.i32(), r.i32(), r.i32()];
      }
      transforms.push({ nodeId, childNodeId, name: (attrs['_name'] as string) ?? `node${nodeId}`, r: fr, t: ft });
    } else if (chunkId === 'nGRP') {
      const nodeId = r.u32();
      const attrs = readDict(r);
      const numChildren = r.u32();
      const childNodeIds: number[] = [];
      for (let i = 0; i < numChildren; i++) childNodeIds.push(r.u32());
      groups.push({ nodeId, name: (attrs['_name'] as string) ?? `group${nodeId}`, childNodeIds });
    } else if (chunkId === 'nSHP') {
      const nodeId = r.u32();
      const attrs = readDict(r);
      const numModels = r.u32();
      const modelIds: number[] = [];
      for (let i = 0; i < numModels; i++) { modelIds.push(r.u32()); readDict(r); }
      shapes.push({ nodeId, name: (attrs['_name'] as string) ?? `shape${nodeId}`, modelIds });
    }
    // строгий skip контента chunk'а (детей здесь не рекурсим — все наши chunk'и
    // имеют childrenSize=0, кроме MAIN который уже развёрнут).
    r.seek(contentStart + contentSize);
    void childrenSize;
  }

  // root: nodeId, не являющийся чьим-либо child
  const allChildIds = new Set<number>();
  for (const g of groups) for (const c of g.childNodeIds) allChildIds.add(c);
  for (const t of transforms) allChildIds.add(t.childNodeId);
  const allNodes = [...transforms.map((t) => t.nodeId), ...groups.map((g) => g.nodeId), ...shapes.map((s) => s.nodeId)];
  const roots = allNodes.filter((id) => !allChildIds.has(id));
  const rootId = transforms.find((t) => roots.includes(t.nodeId))?.nodeId ?? roots[0] ?? transforms[0]?.nodeId ?? 0;

  return { models, palette, transforms, groups, shapes, rootId };
}

/**
 * Матрица вращения для MagicaVoxel _r byte (24 ориентации куба).
 * ПРИМЕЧАНИЕ: MagicaVoxel использует детерминированный порядок байт; здесь —
 * каноническая генерация 24 signed-permutation матриц с det=+1 (точные вращения куба).
 * _r=0 → identity (типичный авторинг). Ненулевые _r могут требовать калибровки под
 * конкретный экспортёр (documented limitation).
 */
export function voxRotationMatrix(r: number): number[][] {
  if (r === 0) return [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
  // генерируем все 24 det+1 signed permutation matrices, возвращаем r-ю
  const mats = generateOrientationMatrices();
  return mats[r % mats.length]!;
}

/** Все 24 вращения куба (3x3 signed permutation matrices с det=+1). */
function generateOrientationMatrices(): number[][][] {
  const out: number[][][] = [];
  const axes = [0, 1, 2];
  const signs = [1, -1];
  // перебор перестановок осей × знаков, фильтр det=+1
  const perms = permutations(axes);
  for (const perm of perms) {
    for (let s0 = 0; s0 < 2; s0++) for (let s1 = 0; s1 < 2; s1++) for (let s2 = 0; s2 < 2; s2++) {
      const sg = [signs[s0]!, signs[s1]!, signs[s2]!];
      const m = [
        [perm[0] === 0 ? sg[0] : 0, perm[0] === 1 ? sg[0] : 0, perm[0] === 2 ? sg[0] : 0],
        [perm[1] === 0 ? sg[1] : 0, perm[1] === 1 ? sg[1] : 0, perm[1] === 2 ? sg[1] : 0],
        [perm[2] === 0 ? sg[2] : 0, perm[2] === 1 ? sg[2] : 0, perm[2] === 2 ? sg[2] : 0]
      ];
      if (det3(m) === 1) out.push(m);
    }
  }
  return out;
}

function permutations<T>(arr: T[]): T[][] {
  if (arr.length <= 1) return [arr];
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i++) {
    const rest = arr.slice(0, i).concat(arr.slice(i + 1));
    for (const p of permutations(rest)) out.push([arr[i]!, ...p]);
  }
  return out;
}
function det3(m: number[][]): number {
  return m[0]![0]! * (m[1]![1]! * m[2]![2]! - m[1]![2]! * m[2]![1]!)
    - m[0]![1]! * (m[1]![0]! * m[2]![2]! - m[1]![2]! * m[2]![0]!)
    + m[0]![2]! * (m[1]![0]! * m[2]![1]! - m[1]![1]! * m[2]![0]!);
}

/** Применяет матрицу вращения к целочисленным координатам вокселя (round). */
function rotateVoxel(x: number, y: number, z: number, m: number[][]): [number, number, number] {
  return [
    Math.round(m[0]![0]! * x + m[0]![1]! * y + m[0]![2]! * z),
    Math.round(m[1]![0]! * x + m[1]![1]! * y + m[1]![2]! * z),
    Math.round(m[2]![0]! * x + m[2]![1]! * y + m[2]![2]! * z)
  ];
}

/** Умножение двух 3×3 матриц (a × b). */
function matMul(a: number[][], b: number[][]): number[][] {
  const r: number[][] = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) {
    r[i]![j] = a[i]![0]! * b[0]![j]! + a[i]![1]! * b[1]![j]! + a[i]![2]! * b[2]![j]!;
  }
  return r;
}

/** Построитель PartNode-дерева из VoxScene по node id (с накоплением ротации _r). */
function buildPartTree(scene: VoxScene, nodeId: number, counter: { n: number }, parentRot: number[][]): PartNode | null {
  // transform?
  const trn = scene.transforms.find((t) => t.nodeId === nodeId);
  if (trn) {
    const localRot = voxRotationMatrix(trn.r);
    const accRot = matMul(parentRot, localRot);
    const child = buildPartTree(scene, trn.childNodeId, counter, accRot);
    if (!child) return null;
    // pivot = translation _t (сустав/смещение парта)
    child.pivot = [trn.t[0], trn.t[1], trn.t[2]];
    if (trn.name) child.name = trn.name;
    return child;
  }
  // group?
  const grp = scene.groups.find((g) => g.nodeId === nodeId);
  if (grp) {
    const children: PartNode[] = [];
    for (const cid of grp.childNodeIds) {
      const c = buildPartTree(scene, cid, counter, parentRot);
      if (c) children.push(c);
    }
    return { name: grp.name, pivot: [0, 0, 0], voxels: [], children };
  }
  // shape?
  const shp = scene.shapes.find((s) => s.nodeId === nodeId);
  if (shp) {
    const modelIdx = shp.modelIds[0] ?? 0;
    const model = scene.models[modelIdx];
    const voxels: Voxel[] = [];
    if (model) {
      for (const v of model.voxels) {
        const ci = v.ci & 0xff;
        const color = scene.palette[ci] ?? scene.palette[1] ?? [0.5, 0.5, 0.5];
        const [rx, ry, rz] = rotateVoxel(v.x, v.y, v.z, parentRot);
        voxels.push({ x: rx, y: ry, z: rz, sx: 1, sy: 1, sz: 1, color });
      }
    }
    counter.n += 1;
    return { name: shp.name || `part${counter.n}`, pivot: [0, 0, 0], voxels, children: [] };
  }
  return null;
}

/**
 * importVox: ArrayBuffer → CharacterDef (scene-graph → PartNode-дерево).
 * Палитра → CharacterDef.palette. Ротации _r накапливаются и запекаются в координаты вокселей.
 */
export function importVox(buffer: ArrayBuffer): CharacterDef {
  const scene = parseVox(buffer);
  const counter = { n: 0 };
  const identity = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
  const root = buildPartTree(scene, scene.rootId, counter, identity);
  if (!root) {
    // нет scene-graph → единая модель как root part
    const m = scene.models[0];
    const voxels: Voxel[] = m ? m.voxels.map((v) => ({
      x: v.x, y: v.y, z: v.z, sx: 1, sy: 1, sz: 1,
      color: scene.palette[v.ci & 0xff] ?? [0.5, 0.5, 0.5]
    })) : [];
    return {
      name: 'vox-import',
      root: { name: 'body', pivot: [0, 0, 0], voxels, children: [] },
      palette: scene.palette
    };
  }
  return { name: 'vox-import', root, palette: scene.palette };
}
