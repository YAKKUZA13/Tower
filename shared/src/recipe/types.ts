/**
 * Recipe v3 типы (порт из forge/src/recipe/v3/types.rs, research §15.2A).
 * Декларативная авторка моделей: Volume/Part/Group/Mirror/Row + Scatter → compile()
 * → плоский v2 IR (PartV2[]). Языконезависимая архитектура (research §15.3).
 *
 * Все вращения — Euler YXZ в градусах: [pitch(X), yaw(Y), roll(Z)]. Мир right-handed Y-up.
 */

// ── Param system ─────────────────────────────────────────────────────────────
export type ParamValue = { Float: number } | { Uint: number };
/** Детерминированная сериализация: ключи в sorted порядке (BTreeMap-эквивалент). */
export type ParamMap = Record<string, ParamValue>;

export interface ParamDef {
  name: string;
  kind: 'Float' | 'Uint';
  default: ParamValue;
  min: number;
  max: number;
  step: number;
}

export interface AssetDef {
  id: string;
  display_name: string;
  icon: string;
  params: ParamDef[];
  generator: string;
}

// ── Bounding box (world-space, для seatedY / Beside half-extents) ────────────
export interface BBox {
  min: [number, number, number];
  max: [number, number, number];
}

/**
 * PrimitiveRegistry — абстракция примитивов (bbox + def). Реализация — на клиенте
 * (voxel-stamps.ts); shared/compile использует только bbox для place-алгебры.
 */
export interface PrimitiveRegistry {
  primitiveFor(asset: string): { boundingBox(params: ParamMap): BBox } | undefined;
  getDef(asset: string): AssetDef | undefined;
}

// ── Place (anchor algebra — discriminated union) ────────────────────────────
export type Face = 'North' | 'South' | 'East' | 'West';
export type Align = 'Start' | 'Center' | 'End';

export type Place =
  | { type: 'Origin'; offset: [number, number, number] }
  | { type: 'At'; pos: [number, number, number] }
  | { type: 'OnTopOf'; target: string; offset: [number, number]; sink?: number }
  | { type: 'Beside'; target: string; face: Face; gap?: number; align?: Align; offset?: [number, number] }
  | { type: 'OnFace'; target: string; face: Face; u?: number; v?: number; out?: number };

// ── Volume + walls + roof + openings ─────────────────────────────────────────
export interface WallSpec {
  material: string;
  thickness?: number;
  quoins?: string | null;
  plinth?: string | null;
}

export interface RoofSpec {
  kind: 'Hip' | 'Wedge';
  height: number;
  overhang?: number;
  material: string;
  low_side?: Face | null;
}

export type OpeningKind =
  | { kind: 'Arch'; w: number; h: number }
  | { kind: 'Door'; w: number; h: number }
  | { kind: 'Window'; w: number; h: number; sill: number };

export interface Opening {
  face: Face;
  kind: OpeningKind;
  off?: number;
  trim?: string | null;
}

// ── Units ────────────────────────────────────────────────────────────────────
export interface Volume {
  id: string;
  footprint: [number, number]; // [w (X), d (Z)]
  height: number;
  at: Place;
  rotation_y?: number;
  walls: WallSpec;
  roof?: RoofSpec | null;
  openings?: Opening[];
}

export interface PartV3 {
  id: string;
  asset: string;
  params?: ParamMap;
  label?: string | null;
  at: Place;
  rotation?: [number, number, number];
}

export interface GroupChild {
  id: string;
  asset: string;
  params?: ParamMap;
  label?: string | null;
  offset: [number, number, number];
  rotation?: [number, number, number];
}

export interface GroupV3 {
  id: string;
  at: Place;
  rotation_y?: number;
  parts: GroupChild[];
}

export interface Mirror {
  id: string;
  of: string;
}

export interface Row {
  id: string;
  asset: string;
  params?: ParamMap;
  label?: string | null;
  start: Place;
  dir: [number, number, number];
  count: number;
  step: number;
  yaw?: number;
}

export type Unit =
  | ({ type: 'Volume' } & Volume)
  | ({ type: 'Part' } & PartV3)
  | ({ type: 'Group' } & GroupV3)
  | ({ type: 'Mirror' } & Mirror)
  | ({ type: 'Row' } & Row);

// ── Scatter + Zone + Rule ────────────────────────────────────────────────────
export type Zone =
  | { type: 'GroundRing'; r_in: number; r_out: number }
  | { type: 'WallFace'; face: Face };

export type Rule =
  | { type: 'Clutter'; assets: Array<[string, number]>; density: number; scale_jitter: number; yaw_jitter_deg: number }
  | { type: 'Patch'; asset: string; count: number; u_range: [number, number]; v_range: [number, number]; scale_jitter: number };

export interface Scatter {
  id: string;
  target: string;
  zone: Zone;
  rule: Rule;
  seed?: number | null;
}

// ── Recipe v3 (вход) ─────────────────────────────────────────────────────────
export interface RecipeV3 {
  format_version: number;
  name: string;
  palette: string;
  seed: number;
  units: Unit[];
  scatters?: Scatter[];
}

// ── v2 flat IR (выход compile) ───────────────────────────────────────────────
export type PartId = string;

export interface PartV2 {
  id: PartId;
  asset: string;
  params: ParamMap;
  position: [number, number, number];
  rotation: [number, number, number];
  label?: string | null;
}

export interface Recipe {
  format_version: number; // 2
  name: string;
  mode: 'Building';
  grid_size: [number, number, number];
  palette: string;
  parts: PartV2[];
  annotations: { part: PartId; text: string }[];
  groups: { name: string; members: PartId[] }[];
}
