/**
 * compile() — recipe-compiler (порт из forge/src/recipe/v3/compile.rs, research §15.2A).
 * RecipeV3 → плоский v2 IR (PartV2[]) ИЛИ список CompileError. Bottom-up resolve units,
 * register frames, handle Mirror (reflect pitch,-yaw,-roll; negate x), Row (count×step),
 * Scatter (xorshift32 seeded, GroundRing/WallFace, Clutter/Patch).
 *
 * Volume (volume.rs gap в forge-репо): декомпозируется в wall-box + roof PartV2
 * (адаптация — структура сохраняется как primitive assets 'box'/'hip_roof'/'wedge_roof',
 * клиентский assembleRecipe материализует их в voxel-stamps). Documented limitation.
 *
 * Детерминизм: ordered итерация units/frames/assets; НИКАКОЙ Map/Set-итерации в path.
 */
import type {
  GroupV3, Mirror, ParamMap, PartV2, PrimitiveRegistry, Recipe, RecipeV3, Row, Unit, Volume
} from './types.js';
import type { CompileError } from './errors.js';
import {
  footprintWorld, Frame, FrameTable, groupLocalFootprint, partFrame, resolveFootprintBase,
  resolvePlace, seatedY, rotateYaw
} from './place.js';
import { Xorshift32, seedFromId } from './xorshift32.js';

const MAX_TOTAL_PARTS = 4000;
const MAX_ROW_COUNT = 500;
const MAX_SCATTER_INSTANCES = 2000;
const ALLOWED_SCATTER_ASSETS = new Set([
  'pebble', 'grass_tuft', 'ivy_patch', 'moss_patch', 'flower_head', 'smoke_column'
]);
const WALL_FACE_OUT = 0.03;

export type CompileResult = { ok: true; recipe: Recipe } | { ok: false; errors: CompileError[] };

/** compile: RecipeV3 → v2 IR или список ошибок (все ошибки собираются, не bail). */
export function compile(recipe: RecipeV3, registry: PrimitiveRegistry): CompileResult {
  const errors: CompileError[] = [];
  const parts: PartV2[] = [];
  const frames = new FrameTable();
  mirrorPartsSource = parts; // mirror отражает уже эмитнутые part'ы target'а

  if (recipe.format_version !== 3) {
    errors.push({ kind: 'WrongFormatVersion', found: recipe.format_version });
  }

  // pre-pass: duplicate top-level unit ids
  const seenIds = new Set<string>();
  for (const u of recipe.units) {
    const id = unitId(u);
    if (seenIds.has(id)) errors.push({ kind: 'DuplicateId', id });
    else seenIds.add(id);
  }

  // emit units in declaration order
  const partIds = new Set<string>();
  const addPart = (p: PartV2): void => {
    if (partIds.has(p.id)) errors.push({ kind: 'DuplicateId', id: p.id });
    else partIds.add(p.id);
    parts.push(p);
  };

  for (const unit of recipe.units) {
    try {
      emitUnit(unit, registry, frames, addPart, errors);
    } catch (e) {
      const err = e as { kind?: string; id?: string; valid?: string[] };
      if (err?.kind === 'UnknownRef') errors.push({ kind: 'UnknownRef', id: err.id ?? '', valid: err.valid ?? [] });
      else if (err?.kind === 'UnknownAsset') errors.push({ kind: 'UnknownAsset', id: err.id ?? '' });
      else throw e;
    }
  }

  // scatters (после всех units)
  const frameSnapshot = frames.snapshot();
  const volFootprints = frames.volumeSnapshot().map((f) => [
    f.frame.wall_min[0], f.frame.wall_min[2], f.frame.wall_max[0], f.frame.wall_max[2]
  ] as [number, number, number, number]);
  for (const sc of recipe.scatters ?? []) {
    try {
      emitScatter(sc, recipe.seed, frameSnapshot, volFootprints, registry, parts, errors);
    } catch (e) {
      const err = e as { kind?: string; id?: string; valid?: string[] };
      if (err?.kind === 'UnknownRef') errors.push({ kind: 'UnknownRef', id: err.id ?? '', valid: err.valid ?? [] });
      else if (err?.kind === 'UnknownAsset') errors.push({ kind: 'UnknownAsset', id: err.id ?? '' });
      else throw e;
    }
  }

  if (parts.length > MAX_TOTAL_PARTS) {
    errors.push({ kind: 'TotalPartsExceeded', count: parts.length });
  }

  if (errors.length > 0) return { ok: false, errors };

  const out: Recipe = {
    format_version: 2,
    name: recipe.name,
    mode: 'Building',
    grid_size: [16, 16, 16],
    palette: recipe.palette,
    parts,
    annotations: [],
    groups: []
  };
  return { ok: true, recipe: out };
}

function unitId(u: Unit): string {
  return u.id;
}

// ── per-unit emit ────────────────────────────────────────────────────────────
function emitUnit(
  unit: Unit,
  registry: PrimitiveRegistry,
  frames: FrameTable,
  addPart: (p: PartV2) => void,
  errors: CompileError[]
): void {
  switch (unit.type) {
    case 'Part': emitPart(unit, registry, frames, addPart, errors); break;
    case 'Group': emitGroup(unit, registry, frames, addPart, errors); break;
    case 'Mirror': emitMirror(unit, frames, addPart, errors); break;
    case 'Row': emitRow(unit, registry, frames, addPart, errors); break;
    case 'Volume': emitVolume(unit, registry, frames, addPart, errors); break;
  }
}

function checkFiniteRotation(unitId: string, rot: [number, number, number], errors: CompileError[]): void {
  for (let i = 0; i < 3; i++) {
    if (!Number.isFinite(rot[i]!)) errors.push({ kind: 'NonFiniteFloat', unit: unitId, field: `rotation[${i}]` });
  }
}

function checkRotationY(unitId: string, rotY: number | undefined, errors: CompileError[]): void {
  const v = rotY ?? 0;
  if (!Number.isFinite(v)) {
    errors.push({ kind: 'RotationNotMultipleOf90', unit: unitId, value: v });
    return;
  }
  const rem = ((v % 90) + 90) % 90;
  if (!(rem < 1e-4 || rem > 90 - 1e-4)) {
    errors.push({ kind: 'RotationNotMultipleOf90', unit: unitId, value: v });
  }
}

function checkAsset(asset: string, registry: PrimitiveRegistry, errors: CompileError[]): boolean {
  if (!registry.primitiveFor(asset) && !registry.getDef(asset)) {
    errors.push({ kind: 'UnknownAsset', id: asset });
    return false;
  }
  return true;
}

function emitPart(p: { id: string; asset: string; params?: ParamMap; label?: string | null; at: import('./types.js').Place; rotation?: [number, number, number] }, registry: PrimitiveRegistry, frames: FrameTable, addPart: (p: PartV2) => void, errors: CompileError[]): void {
  checkAsset(p.asset, registry, errors);
  const rot = p.rotation ?? [0, 0, 0];
  checkFiniteRotation(p.id, rot, errors);
  const pos = resolvePlace(p.at, p.asset, p.params ?? {}, frames, registry);
  addPart({ id: p.id, asset: p.asset, params: p.params ?? {}, position: pos, rotation: rot, label: p.label ?? null });
  frames.insert(p.id, partFrame(p.asset, p.params ?? {}, pos, registry));
}

function emitGroup(g: GroupV3, registry: PrimitiveRegistry, frames: FrameTable, addPart: (p: PartV2) => void, errors: CompileError[]): void {
  if (g.parts.length === 0) { errors.push({ kind: 'EmptyGroup', id: g.id }); }
  checkRotationY(g.id, g.rotation_y, errors);
  const half = groupLocalFootprint(g, registry);
  const base = resolveFootprintBase(g.at, half, frames);
  const rotY = g.rotation_y ?? 0;
  // group frame: footprint box at base
  const fmin: [number, number, number] = [base[0] - half[0], base[1], base[2] - half[1]];
  const fmax: [number, number, number] = [base[0] + half[0], base[1], base[2] + half[1]];
  for (const child of g.parts) {
    checkAsset(child.asset, registry, errors);
    const rot = child.rotation ?? [0, 0, 0];
    checkFiniteRotation(`${g.id}.${child.id}`, rot, errors);
    const r = rotateYaw([child.offset[0], child.offset[1], child.offset[2]], rotY);
    const pos: [number, number, number] = [base[0] + r[0], base[1] + r[1], base[2] + r[2]];
    addPart({
      id: `${g.id}.${child.id}`, asset: child.asset, params: child.params ?? {},
      position: pos, rotation: rot, label: child.label ?? null
    });
  }
  frames.insert(g.id, Frame.fromAabb(fmin, fmax));
}

function emitMirror(m: Mirror, frames: FrameTable, addPart: (p: PartV2) => void, errors: CompileError[]): void {
  if (frames.isMirror(m.of)) {
    errors.push({ kind: 'MirrorOfMirror', id: m.id, target: m.of });
    return;
  }
  const rec = frames.get(m.of);
  if (!rec) { errors.push({ kind: 'UnknownRef', id: m.of, valid: frames.resolvableIds() }); return; }
  // найти все part'ы таргета (по префиксу id) и отразить
  // ВАЖНО: отражаются уже эмитнутые part'ы target'а. Идём по частям с id == m.of или m.of.*
  // Соберём их из текущего списка — но addPart не возвращает список. Перепроектируем:
  // отражаем через frames.snapshot() не годится (frames — AABB, не parts).
  // Решение: emitMirror получает доступ к parts через замыкание (см. compile) —
  // здесь используем registry-independent отражение известных эмитнутых частей target.
  emitMirrorFromParts(m, addPart);
  frames.insert(m.id, Frame.mirroredX(rec.frame), true);
}

// mirror отражает уже эмитнутые part'ы target (по id-префиксу). Доступ к parts — через
// глобальный capture (см. compile: parts[]). Реализовано через closure в compile.
let mirrorPartsSource: PartV2[] = [];
function emitMirrorFromParts(m: Mirror, addPart: (p: PartV2) => void): void {
  for (const p of mirrorPartsSource) {
    // принадлежит target если id === m.of или начинается с `${m.of}.`
    if (p.id !== m.of && !p.id.startsWith(`${m.of}.`)) continue;
    const dot = p.id.indexOf('.');
    const newId = dot >= 0 ? `${m.id}.${p.id.slice(dot + 1)}` : m.id;
    addPart({
      ...p,
      id: newId,
      position: [-p.position[0], p.position[1], p.position[2]],
      rotation: [p.rotation[0], -p.rotation[1], -p.rotation[2]]
    });
  }
}

function emitRow(row: Row, registry: PrimitiveRegistry, frames: FrameTable, addPart: (p: PartV2) => void, errors: CompileError[]): void {
  if (row.count === 0 || row.count > MAX_ROW_COUNT) {
    errors.push({ kind: 'RowCountOutOfRange', id: row.id, count: row.count });
  }
  checkAsset(row.asset, registry, errors);
  const start = resolvePlace(row.start, row.asset, row.params ?? {}, frames, registry);
  const dir = normalize(row.dir);
  const yaw = row.yaw ?? 0;
  let mn: [number, number, number] = [Infinity, Infinity, Infinity];
  let mx: [number, number, number] = [-Infinity, -Infinity, -Infinity];
  const count = Math.max(0, Math.min(MAX_ROW_COUNT, row.count));
  for (let i = 0; i < count; i++) {
    const step = i * row.step;
    const pos: [number, number, number] = [
      start[0] + step * dir[0], start[1] + step * dir[1], start[2] + step * dir[2]
    ];
    addPart({ id: `${row.id}.${i}`, asset: row.asset, params: row.params ?? {}, position: pos, rotation: [0, yaw, 0], label: row.label ?? null });
    mn = minV(mn, pos); mx = maxV(mx, pos);
  }
  if (count > 0) frames.insert(row.id, Frame.fromAabb(mn, mx));
}

function emitVolume(vol: Volume, registry: PrimitiveRegistry, frames: FrameTable, addPart: (p: PartV2) => void, errors: CompileError[]): void {
  checkRotationY(vol.id, vol.rotation_y, errors);
  // openings validation: ≤1 per face, fits
  const openingsByFace = new Map<string, number>();
  for (const op of vol.openings ?? []) {
    const c = (openingsByFace.get(op.face) ?? 0) + 1;
    if (c > 1) errors.push({ kind: 'MultipleOpeningsOnFace', volume: vol.id, face: op.face });
    openingsByFace.set(op.face, c);
    const ok = openingFits(op, vol);
    if (!ok.fits) errors.push({ kind: 'OpeningExceedsFace', volume: vol.id, face: op.face, detail: ok.detail });
  }
  const rotY = vol.rotation_y ?? 0;
  const [fw, fd] = footprintWorld(vol.footprint[0], vol.footprint[1], rotY);
  const half: [number, number] = [fw * 0.5, fd * 0.5];
  const base = resolveFootprintBase(vol.at, half, frames);
  // wall box PartV2
  const wallParams: ParamMap = { w: { Float: fw }, h: { Float: vol.height }, d: { Float: fd } };
  const wallPos: [number, number, number] = [base[0], seatedY('box', wallParams, registry, base[1]), base[2]];
  addPart({ id: `${vol.id}.walls`, asset: 'box', params: wallParams, position: wallPos, rotation: [0, rotY, 0], label: vol.walls.material });
  // wall AABB
  const wallMin: [number, number, number] = [base[0] - half[0], base[1], base[2] - half[1]];
  const wallMax: [number, number, number] = [base[0] + half[0], base[1] + vol.height, base[2] + half[1]];
  // roof
  let roofMax = wallMax;
  const roof = vol.roof;
  if (roof) {
    const oh = roof.overhang ?? 0.35;
    const roofParams: ParamMap = {
      w: { Float: fw + 2 * oh }, h: { Float: roof.height }, d: { Float: fd + 2 * oh }
    };
    const roofPos: [number, number, number] = [base[0], base[1] + vol.height, base[2]];
    addPart({
      id: `${vol.id}.roof`, asset: roof.kind === 'Hip' ? 'hip_roof' : 'wedge_roof',
      params: roofParams, position: roofPos, rotation: [0, rotY, 0], label: roof.material
    });
    roofMax = [base[0] + half[0] + oh, base[1] + vol.height + roof.height, base[2] + half[1] + oh];
  }
  // frame: wall AABB + roof-inclusive AABB. Volume-frames помечены isVolume (GroundRing
  // избегает только buildings, не props вроде ground_pad).
  frames.insert(vol.id, {
    wall_min: wallMin, wall_max: wallMax,
    roof_min: wallMin, roof_max: roofMax,
    faces_flipped_x: false
  }, false, true);
}

function openingFits(op: import('./types.js').Opening, vol: Volume): { fits: boolean; detail: string } {
  const w = op.kind.kind === 'Window' ? op.kind.w : (op.kind as { w: number }).w;
  const h = op.kind.kind === 'Window' ? op.kind.h : (op.kind as { h: number }).h;
  const faceW = (op.face === 'North' || op.face === 'South') ? vol.footprint[0] : vol.footprint[1];
  const fits = w <= faceW && h <= vol.height;
  return { fits, detail: `opening ${w}x${h} vs face ${faceW}x${vol.height}` };
}

// ── Scatter ──────────────────────────────────────────────────────────────────
function emitScatter(
  sc: import('./types.js').Scatter,
  recipeSeed: number,
  frameSnapshot: { id: string; frame: import('./place.js').Frame; isVolume: boolean }[],
  volFootprints: [number, number, number, number][],
  registry: PrimitiveRegistry,
  parts: PartV2[],
  errors: CompileError[]
): void {
  // validate scatter assets
  const ruleAssets = sc.rule.type === 'Clutter' ? sc.rule.assets.map((a) => a[0]) : [sc.rule.asset];
  for (const a of ruleAssets) {
    if (!ALLOWED_SCATTER_ASSETS.has(a)) {
      errors.push({ kind: 'UnknownAsset', id: a });
    }
  }
  const seed = sc.seed ?? seedFromId(recipeSeed, sc.id);
  const rng = new Xorshift32(seed);
  const baseIdx = parts.length;

  // resolve target frame
  let cx = 0, cz = 0;
  let targetFrame: import('./place.js').Frame | undefined;
  if (sc.target !== 'ground') {
    const rec = frameSnapshot.find((f) => f.id === sc.target);
    if (!rec) { errors.push({ kind: 'UnknownRef', id: sc.target, valid: frameSnapshot.map((f) => f.id) }); return; }
    targetFrame = rec.frame;
    cx = (rec.frame.wall_min[0] + rec.frame.wall_max[0]) * 0.5;
    cz = (rec.frame.wall_min[2] + rec.frame.wall_max[2]) * 0.5;
  }

  if (sc.zone.type === 'GroundRing') {
    const count = sc.rule.type === 'Clutter'
      ? Math.ceil(Math.PI * (sc.zone.r_out * sc.zone.r_out - sc.zone.r_in * sc.zone.r_in) * sc.rule.density)
      : sc.rule.count;
    if (count > MAX_SCATTER_INSTANCES) { errors.push({ kind: 'ScatterTooManyInstances', id: sc.id, projected: count }); return; }
    if (sc.rule.type === 'Clutter') {
      const totalW = sc.rule.assets.reduce((s: number, a: [string, number]) => s + a[1], 0);
      if (totalW <= 0) return;
      for (let i = 0; i < count; i++) {
        const pos = tryPlaceInRing(rng, cx, cz, sc.zone.r_in, sc.zone.r_out, volFootprints);
        if (!pos) continue;
        const asset = weightedPick(sc.rule.assets, totalW, rng);
        const params = buildScaleJitter(asset, sc.rule.scale_jitter, rng, registry);
        const yaw = (rng.nextF32() * 2 - 1) * sc.rule.yaw_jitter_deg;
        addScatterPart(parts, sc.id, baseIdx + i, asset, params, [pos[0], 0, pos[1]], [0, yaw, 0]);
      }
    } else {
      // Patch on ground (u/v unused)
      for (let i = 0; i < count; i++) {
        const pos = tryPlaceInRing(rng, cx, cz, sc.zone.r_in, sc.zone.r_out, volFootprints);
        if (!pos) continue;
        const params = buildScaleJitter(sc.rule.asset, sc.rule.scale_jitter, rng, registry);
        addScatterPart(parts, sc.id, baseIdx + i, sc.rule.asset, params, [pos[0], 0, pos[1]], [0, 0, 0]);
      }
    }
  } else {
    // WallFace
    if (!targetFrame) { errors.push({ kind: 'UnknownRef', id: sc.target, valid: frameSnapshot.map((f) => f.id) }); return; }
    const f = targetFrame;
    const n = effectiveNormal(sc.zone.face, f);
    const [axisIsX, sign] = normalAxisOf(n);
    const halfW = axisIsX ? (f.wall_max[0] - f.wall_min[0]) * 0.5 : (f.wall_max[2] - f.wall_min[2]) * 0.5;
    let faceX: number, faceZ: number;
    if (axisIsX) { faceX = cx + sign * (halfW + WALL_FACE_OUT); faceZ = cz; }
    else { faceX = cx; faceZ = cz + sign * (halfW + WALL_FACE_OUT); }
    const faceYaw = faceOnFaceYawDeg(sc.zone.face);
    const wallH = f.wall_max[1] - f.wall_min[1];
    const baseY = f.wall_min[1];

    if (sc.rule.type === 'Clutter') {
      const count = Math.ceil((halfW * 2) * wallH * sc.rule.density);
      if (count > MAX_SCATTER_INSTANCES) { errors.push({ kind: 'ScatterTooManyInstances', id: sc.id, projected: count }); return; }
      const totalW = sc.rule.assets.reduce((s: number, a: [string, number]) => s + a[1], 0);
      if (totalW <= 0) return;
      for (let i = 0; i < count; i++) {
        const u = (rng.nextF32() - 0.5) * halfW * 2;
        const v = rng.nextF32() * wallH;
        let px: number, pz: number;
        if (axisIsX) { px = faceX; pz = faceZ + u; } else { px = faceX + u; pz = faceZ; }
        const asset = weightedPick(sc.rule.assets, totalW, rng);
        const params = buildScaleJitter(asset, sc.rule.scale_jitter, rng, registry);
        const yaw = faceYaw + (rng.nextF32() * 2 - 1) * sc.rule.yaw_jitter_deg;
        addScatterPart(parts, sc.id, baseIdx + i, asset, params, [px, baseY + v, pz], [0, yaw, 0]);
      }
    } else {
      const count = sc.rule.count;
      if (count > MAX_SCATTER_INSTANCES) { errors.push({ kind: 'ScatterTooManyInstances', id: sc.id, projected: count }); return; }
      for (let i = 0; i < count; i++) {
        const u = sc.rule.u_range[0] + rng.nextF32() * (sc.rule.u_range[1] - sc.rule.u_range[0]);
        const v = sc.rule.v_range[0] + rng.nextF32() * (sc.rule.v_range[1] - sc.rule.v_range[0]);
        let px: number, pz: number;
        if (axisIsX) { px = faceX; pz = faceZ + u; } else { px = faceX + u; pz = faceZ; }
        const params = buildScaleJitter(sc.rule.asset, sc.rule.scale_jitter, rng, registry);
        const yaw = faceYaw + (rng.nextF32() * 2 - 1) * 5;
        addScatterPart(parts, sc.id, baseIdx + i, sc.rule.asset, params, [px, baseY + v, pz], [0, yaw, 0]);
      }
    }
  }
}

function addScatterPart(parts: PartV2[], scatterId: string, idx: number, asset: string, params: ParamMap, position: [number, number, number], rotation: [number, number, number]): void {
  parts.push({ id: `${scatterId}.${idx}`, asset, params, position, rotation, label: null });
}

function tryPlaceInRing(rng: Xorshift32, cx: number, cz: number, rIn: number, rOut: number, volFootprints: [number, number, number, number][], tries = 32): [number, number] | null {
  for (let t = 0; t < tries; t++) {
    const dx = (rng.nextF32() - 0.5) * 2 * rOut;
    const dz = (rng.nextF32() - 0.5) * 2 * rOut;
    const d2 = dx * dx + dz * dz;
    if (d2 < rIn * rIn || d2 > rOut * rOut) continue;
    const px = cx + dx, pz = cz + dz;
    let inside = false;
    for (const fp of volFootprints) {
      if (px >= fp[0] && px <= fp[2] && pz >= fp[1] && pz <= fp[3]) { inside = true; break; }
    }
    if (inside) continue;
    return [px, pz];
  }
  return null;
}

function weightedPick(assets: Array<[string, number]>, totalWeight: number, rng: Xorshift32): string {
  const pick = rng.nextF32() * totalWeight;
  let acc = 0;
  for (const [id, w] of assets) { acc += w; if (pick <= acc) return id; }
  return assets[assets.length - 1]![0];
}

function buildScaleJitter(asset: string, scaleJitter: number, rng: Xorshift32, registry: PrimitiveRegistry): ParamMap {
  const def = registry.getDef(asset);
  let params: ParamMap = {};
  if (def) {
    for (const p of def.params) params[p.name] = p.default;
  }
  if (scaleJitter > 0) {
    const factor = 1 + (rng.nextF32() * 2 - 1) * scaleJitter;
    for (const key of ['size', 'scale', 'w']) {
      const v = params[key];
      if (v && 'Float' in v) { params[key] = { Float: v.Float * factor }; break; }
    }
  }
  return params;
}

// ── vector helpers ───────────────────────────────────────────────────────────
function normalize(v: [number, number, number]): [number, number, number] {
  const len = Math.hypot(v[0], v[1], v[2]);
  return len < 1e-9 ? [1, 0, 0] : [v[0] / len, v[1] / len, v[2] / len];
}
function minV(a: [number, number, number], b: [number, number, number]): [number, number, number] {
  return [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.min(a[2], b[2])];
}
function maxV(a: [number, number, number], b: [number, number, number]): [number, number, number] {
  return [Math.max(a[0], b[0]), Math.max(a[1], b[1]), Math.max(a[2], b[2])];
}
function effectiveNormal(face: import('./types.js').Face, f: import('./place.js').Frame): [number, number, number] {
  const eff = f.faces_flipped_x ? mirrorFaceX(face) : face;
  return faceNormal(eff);
}
function faceNormal(f: import('./types.js').Face): [number, number, number] {
  switch (f) {
    case 'South': return [0, 0, 1];
    case 'North': return [0, 0, -1];
    case 'East': return [1, 0, 0];
    case 'West': return [-1, 0, 0];
  }
}
function mirrorFaceX(f: import('./types.js').Face): import('./types.js').Face {
  if (f === 'East') return 'West';
  if (f === 'West') return 'East';
  return f;
}
function faceOnFaceYawDeg(f: import('./types.js').Face): number {
  switch (f) {
    case 'South': return 0;
    case 'North': return 180;
    case 'East': return 270;
    case 'West': return 90;
  }
}
function normalAxisOf(n: [number, number, number]): [boolean, number] {
  return Math.abs(n[0]) > 0.5 ? [true, Math.sign(n[0])] : [false, Math.sign(n[2])];
}

// части для mirror берутся из этого снапшота, обновляемого в compile перед scatter
export function setMirrorPartsSource(parts: PartV2[]): void { mirrorPartsSource = parts; }
