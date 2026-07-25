/**
 * Voxel-stamp primitives (Фаза P-MO, research §15.3).
 *
 * ПЕРЕПИСАНЫ как voxel-stamps (НЕ triangle meshes, как в forge): box → filled cuboid
 * вокселей; cylinder → Bresenham-circle per layer; hip_roof → stepped pyramid.
 * Каждый stamp возвращает Voxel[] в локальных координатах (центр XZ, base y=0).
 *
 * VoxelStampRegistry реализует shared PrimitiveRegistry (bbox для compile) И даёт
 * stamp(params) для assembleRecipe (IR → Voxel[]). Placement = union voxel stamps.
 */
import { box3, cube, type Voxel } from '../voxel-builder';
import { PALETTE, shade, type RGB } from '../dark-palette';
import type { AssetDef, BBox, ParamDef, ParamMap, ParamValue } from '@tower/shared';
import { sdfToVoxels, sdRoundCone, sdSphere, unionSdf, type SDF } from '../voxel-sdf';

export interface StampResult {
  voxels: Voxel[];
  bbox: BBox;
}

/** Запись примитива в реестре: id → { bbox(params), stamp(params), defaultParams() }. */
export interface StampEntry {
  bbox(params: ParamMap): BBox;
  stamp(params: ParamMap): Voxel[];
  defaultParams(): ParamMap;
  /** Дефолтный материал (label → palette mapping). */
  defaultMaterial: RGB;
}

const f = (p: ParamMap, k: string, def: number): number => {
  const v = p[k];
  return v && 'Float' in v ? v.Float : def;
};
const u = (p: ParamMap, k: string, def: number): number => {
  const v = p[k];
  return v && 'Uint' in v ? v.Uint : def;
};

// ── stamp helpers (локальные координаты: центр XZ, base y=0) ─────────────────

/** Кубоид w×h×d, заполненный вокселями (w,h,d в «грубых» единицах, округляется). */
function boxStamp(w: number, h: number, d: number, color: RGB): Voxel[] {
  const v: Voxel[] = [];
  const iw = Math.max(1, Math.round(w));
  const ih = Math.max(1, Math.round(h));
  const id = Math.max(1, Math.round(d));
  const x0 = -Math.floor(iw / 2);
  const z0 = -Math.floor(id / 2);
  box3(v, x0, x0 + iw - 1, 0, ih - 1, z0, z0 + id - 1, color);
  return v;
}

/** Цилиндр радиуса r, высоты h: Bresenham-circle per layer (research §15.3). */
function cylinderStamp(r: number, h: number, segments: number, color: RGB): Voxel[] {
  const v: Voxel[] = [];
  const ir = Math.max(1, Math.round(r));
  const ih = Math.max(1, Math.round(h));
  void segments; // Bresenham не зависит от segments (точный круг)
  for (let y = 0; y < ih; y++) {
    for (let x = -ir; x <= ir; x++) {
      for (let z = -ir; z <= ir; z++) {
        if (x * x + z * z <= ir * ir) cube(v, x, y, z, color);
      }
    }
  }
  return v;
}

/** Hip roof: ступенчатая пирамида w×d, сужается вверх на h слоёв. */
function hipRoofStamp(w: number, h: number, d: number, color: RGB): Voxel[] {
  const v: Voxel[] = [];
  const iw = Math.max(1, Math.round(w));
  const ih = Math.max(1, Math.round(h));
  const id = Math.max(1, Math.round(d));
  for (let y = 0; y < ih; y++) {
    const inset = Math.floor((y / Math.max(1, ih - 1)) * Math.min(iw, id) * 0.5);
    const cw = iw - inset * 2;
    const cd = id - inset * 2;
    if (cw <= 0 || cd <= 0) break;
    const x0 = -Math.floor(cw / 2);
    const z0 = -Math.floor(cd / 2);
    // только периметр (полый roof) на верхних слоях, сплошной внизу
    for (let x = x0; x <= x0 + cw - 1; x++) {
      for (let z = z0; z <= z0 + cd - 1; z++) {
        const edge = x === x0 || x === x0 + cw - 1 || z === z0 || z === z0 + cd - 1;
        if (y === 0 || edge || y === ih - 1) cube(v, x, y, z, color);
      }
    }
  }
  return v;
}

/** Wedge roof: односкатная (наклонная) — упрощённо как скошенный box. */
function wedgeRoofStamp(w: number, h: number, d: number, color: RGB): Voxel[] {
  const v: Voxel[] = [];
  const iw = Math.max(1, Math.round(w));
  const ih = Math.max(1, Math.round(h));
  const id = Math.max(1, Math.round(d));
  for (let y = 0; y < ih; y++) {
    const trim = Math.floor((y / Math.max(1, ih)) * (id / 2));
    const cd = id - trim;
    const z0 = -Math.floor(cd / 2);
    for (let x = -Math.floor(iw / 2); x <= Math.floor((iw - 1) / 2); x++) {
      for (let z = z0; z <= z0 + cd - 1; z++) cube(v, x, y, z, color);
    }
  }
  return v;
}

// ── SDF stamps (M3 D11: рога/кристаллы — smooth-детали через sdfToVoxels) ──────

/** Рог: round-cone (узкое основание → заострённый кончик), загнут вверх. */
function hornStamp(rBase: number, length: number, color: RGB): Voxel[] {
  const r1 = Math.max(0.2, rBase);
  const r2 = Math.max(0.08, rBase * 0.25);
  const h = Math.max(1, Math.round(length));
  const sdf: SDF = (p) => sdRoundCone(p, r1, r2, h);
  const vox = sdfToVoxels(sdf, { min: [-r1 - 1, 0, -r1 - 1], max: [r1 + 1, h, r1 + 1] }, color);
  // сместить базу на y=0 (sdf round-cone считает от y=0 вверх)
  return vox;
}

/** Кристалл: октаэдр-подобный ромб (два конуса основание к основанию) через union сфер. */
function crystalStamp(r: number, h: number, color: RGB): Voxel[] {
  const ir = Math.max(0.4, r);
  const ih = Math.max(1, Math.round(h));
  const half = ih / 2;
  // два конуса (верхний + нижний) — упрощённо через sdSphere, сплющенную по Y (ромб).
  const top: SDF = (p) => {
    // верхний конус: вершина вверху
    const d = sdRoundCone([p[0], p[1] - (ih - half), p[2]], ir * 0.5, 0.1, half);
    return d;
  };
  const bot: SDF = (p) => {
    const d = sdRoundCone([p[0], p[1] - half, p[2]], 0.1, ir * 0.5, half);
    return d;
  };
  const sdf = unionSdf(top, bot);
  return sdfToVoxels(sdf, { min: [-ir - 1, 0, -ir - 1], max: [ir + 1, ih, ir + 1] }, color);
}

/** Octahedron-кристалл через sdSphere (простой, дешёвый) для маленьких акцентов. */
function gemStamp(r: number, color: RGB): Voxel[] {
  const ir = Math.max(0.3, r);
  const sdf: SDF = (p) => sdSphere([p[0], p[1] - ir, p[2]], ir);
  return sdfToVoxels(sdf, { min: [-ir - 1, 0, -ir - 1], max: [ir + 1, ir * 2, ir + 1] }, color);
}

// ── D4/D5: точная roof-геометрия (Hip apex / shingledHipRoof per-shingle hue-jitter) ──

/** Seeded хеш (mulberry32-стиль) для per-shingle jitter. */
function roofHash(seed: number, i: number): number {
  let h = (seed * 374761393 + i * 668265263) | 0;
  h = (h ^ (h >>> 13)) * 1274126177;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/**
 * Shingled hip roof (D5): hip-крыша, выложенная отдельными черепицами (courses),
 * каждая со seeded hue/scale-вариацией (research §15.2F). w×d — основание, h — высота
 * до апекса, overhang — свес, courseStep — высота ряда черепиц.
 */
function shingledHipRoofStamp(
  w: number, h: number, d: number, overhang: number, courseStep: number, shingleW: number, seed: number, baseColor: RGB
): Voxel[] {
  const v: Voxel[] = [];
  const iw = Math.max(2, Math.round(w + overhang * 2));
  const id = Math.max(2, Math.round(d + overhang * 2));
  const ih = Math.max(1, Math.round(h));
  const ics = Math.max(1, Math.round(courseStep));
  const isw = Math.max(1, Math.round(shingleW));
  const halfDiag = Math.min(iw, id) / 2;
  for (let y = 0; y < ih; y += ics) {
    // inset этого course (hip slope: сужается к апексу)
    const t = y / Math.max(1, ih - 1);
    const inset = Math.floor(t * halfDiag);
    const cw = iw - inset * 2;
    const cd = id - inset * 2;
    if (cw <= 0 || cd <= 0) continue;
    const x0 = -Math.floor(cw / 2);
    const z0 = -Math.floor(cd / 2);
    // кладём черепицы с зазором по X, каждая со своим hue-вариантом
    let shIdx = 0;
    for (let x = x0; x <= x0 + cw - 1; x += isw) {
      for (let z = z0; z <= z0 + cd - 1; z += isw) {
        const rnd = roofHash(seed, shIdx++);
        // hue/value-вариация: ±shade factor
        const factor = 0.85 + rnd * 0.3; // 0.85..1.15
        const col = shade(baseColor, factor);
        const sw = Math.min(isw, x0 + cw - x);
        const sd = Math.min(isw, z0 + cd - z);
        for (let dx = 0; dx < sw; dx++) {
          for (let dz = 0; dz < sd; dz++) {
            for (let dy = 0; dy < ics; dy++) {
              cube(v, x + dx, y + dy, z + dz, col);
            }
          }
        }
      }
    }
  }
  return v;
}

// ── registry ─────────────────────────────────────────────────────────────────

/** Material label → dark-palette color. */
export function materialColor(label: string | null | undefined): RGB {
  if (!label) return PALETTE.stone;
  const lc = label.toLowerCase();
  if (lc.includes('stone') || lc.includes('plaster')) return lc.includes('warm') ? shade(PALETTE.stone, 1.1) : PALETTE.stone;
  if (lc.includes('oak')) return lc.includes('dark') ? PALETTE.woodDark : PALETTE.wood;
  if (lc.includes('wood') || lc.includes('roof_slate')) return PALETTE.woodDark;
  if (lc.includes('metal')) return PALETTE.metal;
  if (lc.includes('grass')) return PALETTE.moss;
  if (lc.includes('moss')) return shade(PALETTE.moss, 0.8);
  if (lc.includes('ivy')) return shade(PALETTE.moss, 1.2);
  if (lc.includes('pebble') || lc.includes('flower')) return PALETTE.stoneLight;
  if (lc.includes('smoke')) return shade(PALETTE.stoneLight, 1.4);
  return PALETTE.stone;
}

function entry(
  bboxFn: (p: ParamMap) => BBox,
  stampFn: (p: ParamMap) => Voxel[],
  defaults: ParamMap,
  mat: RGB
): StampEntry {
  return { bbox: bboxFn, stamp: stampFn, defaultParams: () => ({ ...defaults }), defaultMaterial: mat };
}

/** bbox box-примитива (центр XZ, base y=0). */
function boxBBox(w: number, h: number, d: number): BBox {
  return { min: [-w / 2, 0, -d / 2], max: [w / 2, h, d / 2] };
}

/** VoxelStampRegistry — реализация shared PrimitiveRegistry + stamp-провайдер. */
export class VoxelStampRegistry {
  private entries = new Map<string, StampEntry>();

  constructor() {
    this.register('box', entry(
      (p) => boxBBox(f(p, 'w', 1), f(p, 'h', 1), f(p, 'd', 1)),
      (p) => boxStamp(f(p, 'w', 1), f(p, 'h', 1), f(p, 'd', 1), PALETTE.stone),
      { w: { Float: 1 }, h: { Float: 1 }, d: { Float: 1 } },
      PALETTE.stone
    ));
    this.register('slab', entry(
      (p) => boxBBox(f(p, 'w', 4), f(p, 'h', 0.5), f(p, 'd', 4)),
      (p) => boxStamp(f(p, 'w', 4), f(p, 'h', 0.5), f(p, 'd', 4), materialColor('grass')),
      { w: { Float: 4 }, h: { Float: 0.5 }, d: { Float: 4 } },
      PALETTE.moss
    ));
    this.register('cylinder', entry(
      (p) => { const r = f(p, 'r', 1); return { min: [-r, 0, -r], max: [r, f(p, 'h', 1), r] }; },
      (p) => cylinderStamp(f(p, 'r', 1), f(p, 'h', 1), u(p, 'segments', 8), PALETTE.stone),
      { r: { Float: 1 }, h: { Float: 1 }, segments: { Uint: 8 } },
      PALETTE.stone
    ));
    this.register('hip_roof', entry(
      (p) => boxBBox(f(p, 'w', 4), f(p, 'h', 1.5), f(p, 'd', 4)),
      (p) => hipRoofStamp(f(p, 'w', 4), f(p, 'h', 1.5), f(p, 'd', 4), PALETTE.woodDark),
      { w: { Float: 4 }, h: { Float: 1.5 }, d: { Float: 4 } },
      PALETTE.woodDark
    ));
    this.register('wedge_roof', entry(
      (p) => boxBBox(f(p, 'w', 4), f(p, 'h', 1), f(p, 'd', 4)),
      (p) => wedgeRoofStamp(f(p, 'w', 4), f(p, 'h', 1), f(p, 'd', 4), PALETTE.woodDark),
      { w: { Float: 4 }, h: { Float: 1 }, d: { Float: 4 } },
      PALETTE.woodDark
    ));
    this.register('barrel_vault', entry(
      (p) => { const r = f(p, 'r', 0.5); return { min: [-f(p, 'w', 1) / 2, 0, -r], max: [f(p, 'w', 1) / 2, r * 2, r] }; },
      (p) => {
        // полу-цилиндр (половина cylinder по Y)
        const full = cylinderStamp(f(p, 'r', 0.5), f(p, 'r', 0.5), 8, PALETTE.stone);
        const w = Math.max(1, Math.round(f(p, 'w', 1)));
        const out: Voxel[] = [];
        for (let dx = 0; dx < w; dx++) for (const v of full) out.push({ ...v, x: v.x + dx - Math.floor(w / 2) });
        return out;
      },
      { w: { Float: 1 }, d: { Float: 0.8 }, r: { Float: 0.5 }, segments: { Uint: 8 } },
      PALETTE.stone
    ));
    // ── SDF stamps (M3 D11): рога/кристаллы для recipe-структур ──
    this.register('horn', entry(
      (p) => { const r = f(p, 'r', 0.6); const h = f(p, 'h', 4); return { min: [-r - 1, 0, -r - 1], max: [r + 1, h, r + 1] }; },
      (p) => hornStamp(f(p, 'r', 0.6), f(p, 'h', 4), PALETTE.boneDark),
      { r: { Float: 0.6 }, h: { Float: 4 } },
      PALETTE.boneDark
    ));
    this.register('crystal', entry(
      (p) => { const r = f(p, 'r', 1); const h = f(p, 'h', 3); return { min: [-r - 1, 0, -r - 1], max: [r + 1, h, r + 1] }; },
      (p) => crystalStamp(f(p, 'r', 1), f(p, 'h', 3), PALETTE.boneDark),
      { r: { Float: 1 }, h: { Float: 3 } },
      PALETTE.boneDark
    ));
    this.register('gem', entry(
      (p) => { const r = f(p, 'r', 0.6); return { min: [-r - 1, 0, -r - 1], max: [r + 1, r * 2, r + 1] }; },
      (p) => gemStamp(f(p, 'r', 0.6), PALETTE.boneDark),
      { r: { Float: 0.6 } },
      PALETTE.boneDark
    ));
    // ── D5: shingledHipRoof (per-shingle hue-jitter, research §15.2F) ──
    this.register('shingled_hip_roof', entry(
      (p) => { const ov = f(p, 'overhang', 0.4); return { min: [-f(p, 'w', 4) / 2 - ov, 0, -f(p, 'd', 4) / 2 - ov], max: [f(p, 'w', 4) / 2 + ov, f(p, 'h', 2), f(p, 'd', 4) / 2 + ov] }; },
      (p) => shingledHipRoofStamp(
        f(p, 'w', 4), f(p, 'h', 2), f(p, 'd', 4), f(p, 'overhang', 0.4),
        f(p, 'course_step', 1), f(p, 'shingle_w', 1), u(p, 'seed', 7), PALETTE.woodDark
      ),
      { w: { Float: 4 }, h: { Float: 2 }, d: { Float: 4 }, overhang: { Float: 0.4 }, course_step: { Float: 1 }, shingle_w: { Float: 1 }, seed: { Uint: 7 } },
      PALETTE.woodDark
    ));
    // scatter assets (упрощённые stamps)
    this.register('pebble', entry(
      () => ({ min: [-0.3, 0, -0.3], max: [0.3, 0.3, 0.3] }),
      () => boxStamp(0.6, 0.4, 0.6, PALETTE.stoneLight),
      { size: { Float: 1 } },
      PALETTE.stoneLight
    ));
    this.register('grass_tuft', entry(
      () => ({ min: [-0.3, 0, -0.3], max: [0.3, 0.6, 0.3] }),
      () => boxStamp(0.5, 0.8, 0.5, PALETTE.moss),
      { size: { Float: 1 } },
      PALETTE.moss
    ));
    this.register('moss_patch', entry(
      () => ({ min: [-0.5, 0, -0.5], max: [0.5, 0.3, 0.5] }),
      () => boxStamp(1, 0.4, 1, shade(PALETTE.moss, 0.8)),
      { size: { Float: 1 } },
      shade(PALETTE.moss, 0.8)
    ));
    this.register('ivy_patch', entry(
      () => ({ min: [-0.5, 0, -0.2], max: [0.5, 1, 0.2] }),
      () => boxStamp(1, 1.5, 0.4, shade(PALETTE.moss, 1.2)),
      { size: { Float: 1 } },
      shade(PALETTE.moss, 1.2)
    ));
    this.register('flower_head', entry(
      () => ({ min: [-0.2, 0, -0.2], max: [0.2, 0.5, 0.2] }),
      () => boxStamp(0.4, 0.7, 0.4, PALETTE.stoneLight),
      { size: { Float: 1 } },
      PALETTE.stoneLight
    ));
    this.register('smoke_column', entry(
      (p) => ({ min: [-0.5, 0, -0.5], max: [0.5, f(p, 'height', 2), 0.5] }),
      (p) => boxStamp(f(p, 'width', 0.9), f(p, 'height', 2.2), f(p, 'width', 0.9), shade(PALETTE.stoneLight, 1.4)),
      { height: { Float: 2.2 }, width: { Float: 0.9 }, puffs: { Uint: 4 }, seed: { Uint: 7 } },
      shade(PALETTE.stoneLight, 1.4)
    ));
  }

  register(id: string, e: StampEntry): void { this.entries.set(id, e); }

  /** PrimitiveRegistry: bbox для compile. */
  primitiveFor(asset: string): { boundingBox(params: ParamMap): BBox } | undefined {
    const e = this.entries.get(asset);
    return e ? { boundingBox: (p: ParamMap) => e.bbox(p) } : undefined;
  }
  /** PrimitiveRegistry: def (params) для scatter scale-jitter. */
  getDef(asset: string): AssetDef | undefined {
    const e = this.entries.get(asset);
    if (!e) return undefined;
    const dp = e.defaultParams();
    const params: ParamDef[] = Object.entries(dp).map(([k, v]: [string, ParamValue]) => ({
      name: k,
      kind: 'Float' in v ? 'Float' : 'Uint',
      default: v,
      min: 0, max: 100, step: 0.01
    }));
    return { id: asset, display_name: asset, icon: '', params, generator: 'voxel-stamp' };
  }

  /** stamp-провайдер для assembleRecipe. */
  stamp(asset: string, params: ParamMap): Voxel[] {
    const e = this.entries.get(asset);
    if (!e) return [];
    const full = { ...e.defaultParams(), ...params };
    return e.stamp(full);
  }
  materialFor(asset: string): RGB {
    return this.entries.get(asset)?.defaultMaterial ?? PALETTE.stone;
  }
}

/**
 * assembleRecipe: compiled v2 IR (PartV2[]) → master Voxel[] (Фаза P-MO).
 * Для каждого part: stamp(params) из registry, transform по position/rotation
 * (yaw 90°-кратный поворот local (x,z) + трансляция position), union last-wins по клетке.
 * Цвет = materialColor(part.label) || registry.materialFor(part.asset) + hueVariant.
 */
export function assembleRecipe(
  parts: { id: string; asset: string; params: ParamMap; position: [number, number, number]; rotation: [number, number, number]; label?: string | null }[],
  registry: VoxelStampRegistry
): Voxel[] {
  const cells = new Map<string, RGB>();
  for (const part of parts) {
    const local = registry.stamp(part.asset, part.params);
    if (local.length === 0) continue;
    const color = materialColor(part.label) ?? registry.materialFor(part.asset);
    const yaw = part.rotation[1] ?? 0;
    const q = (((Math.round(yaw / 90) % 4) + 4) % 4); // 0..3 четверти
    const px = Math.round(part.position[0]);
    const py = Math.round(part.position[1]);
    const pz = Math.round(part.position[2]);
    for (const v of local) {
      // поворот (x,z) на q×90°
      let rx = v.x, rz = v.z;
      for (let i = 0; i < q; i++) { const tmp = rx; rx = -rz; rz = tmp; }
      const key = `${px + rx},${py + v.y},${pz + rz}`;
      cells.set(key, color); // last-wins
    }
  }
  const out: Voxel[] = [];
  for (const [key, color] of cells) {
    const [xs, ys, zs] = key.split(',');
    out.push({ x: +xs!, y: +ys!, z: +zs!, sx: 1, sy: 1, sz: 1, color });
  }
  return out;
}
