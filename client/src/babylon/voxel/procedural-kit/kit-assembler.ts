/**
 * Процедурный kit-assembler (Фаза P4, research §7).
 *
 * assembleCharacter(seed): slot-random сборка вариантного CharacterDef из библиотеки
 * партов (parts-library). Seeded mulberry32 (как в sim — для согласованности) →
 * детерминирован: тот же seed → byte-identical воксели. Уровень 1 (slot-random) +
 * Уровень 2 (constraints-грамматика): weapon=staff → accessory=capt; head=helmet →
 * без horns. Зеркальные L/R пары берутся из одного выбора + mirrorX.
 *
 * Иерархия/пивоты — стандартный гуманоидный скелет (как skeletonRigged) → walk-cycle
 * из P0 работает на любой сборке без изменений. Все цвета — через archetypeTheme
 * (палитра-дисциплина, research §15.2B).
 */
import { box3, type Voxel } from '../voxel-builder';
import { PALETTE, shade, type RGB } from '../dark-palette';
import type { CharacterDef, PartNode } from '../voxel-parts';
import {
  SLOT_CATALOG,
  archetypeTheme,
  mirrorX,
  type Archetype,
  type ThemeColors
} from './parts-library';

/** mulberry32 PRNG (реплика sim/rng.ts — детерминизм-консистентность, без cross-coupling). */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface AssembleOptions {
  archetype?: Archetype;
}

/**
 * assembleCharacter: seeded slot-random сборка вариантного персонажа.
 * @param seed детерминированный сид (тот же seed → идентичные воксели)
 */
export function assembleCharacter(seed: number, options?: AssembleOptions): CharacterDef {
  const rng = mulberry32(seed);
  const archetype = options?.archetype ?? pickArchetype(rng);
  const theme = archetypeTheme(archetype);
  // лёгкая hue-вариация темы (per-character разнообразие в рамках архетипа)
  const themed: ThemeColors = varyTheme(theme, rng());

  // ── выбор вариантов по слотам ──
  const headIdx = pickIndex(rng, SLOT_CATALOG.head.length);
  const torsoIdx = pickIndex(rng, SLOT_CATALOG.torso.length);
  const armIdx = pickIndex(rng, SLOT_CATALOG.upperArm.length);
  const foreIdx = pickIndex(rng, SLOT_CATALOG.forearm.length);
  const thighIdx = pickIndex(rng, SLOT_CATALOG.thigh.length);
  const shinIdx = pickIndex(rng, SLOT_CATALOG.shin.length);
  const weaponIdx = pickIndex(rng, SLOT_CATALOG.weapon.length);

  // ── constraints-грамматика (research §7.2) ──
  let accessoryIdx = pickIndex(rng, SLOT_CATALOG.accessory.length);
  const headId = SLOT_CATALOG.head[headIdx]!.id;
  const weaponId = SLOT_CATALOG.weapon[weaponIdx]!.id;
  const accessoryId = SLOT_CATALOG.accessory[accessoryIdx]!.id;
  // weapon=staff → маг → cape (без horns); head=helmet → без horns (не помещается)
  if (weaponId === 'staff' && accessoryId !== 'cape') accessoryIdx = indexOf(SLOT_CATALOG.accessory, 'cape');
  if (headId === 'skullHelmet' && SLOT_CATALOG.accessory[accessoryIdx]!.id === 'horns') {
    accessoryIdx = indexOf(SLOT_CATALOG.accessory, 'none');
  }

  // ── сборка партов ──
  const head = SLOT_CATALOG.head[headIdx]!.build(themed);
  const torso = SLOT_CATALOG.torso[torsoIdx]!.build(themed);
  const hips = buildHips(themed);
  // arms/legs: L из выбранного варианта (side='L'), R = mirrorX того же варианта (side='R')
  const upperArmL = SLOT_CATALOG.upperArm[armIdx]!.build(themed, 'L');
  const upperArmR = SLOT_CATALOG.upperArm[armIdx]!.build(themed, 'R');
  const forearmL = SLOT_CATALOG.forearm[foreIdx]!.build(themed, 'L');
  const forearmR = SLOT_CATALOG.forearm[foreIdx]!.build(themed, 'R');
  const thighL = SLOT_CATALOG.thigh[thighIdx]!.build(themed, 'L');
  const thighR = SLOT_CATALOG.thigh[thighIdx]!.build(themed, 'R');
  const shinL = SLOT_CATALOG.shin[shinIdx]!.build(themed, 'L');
  const shinR = SLOT_CATALOG.shin[shinIdx]!.build(themed, 'R');
  const weapon = SLOT_CATALOG.weapon[weaponIdx]!.build(themed);
  // accessory крепится к head (horns) или spine (cape)
  const accessory = SLOT_CATALOG.accessory[accessoryIdx]!.build(themed);
  const accId = SLOT_CATALOG.accessory[accessoryIdx]!.id;
  if (accId === 'horns') head.push(...accessory);
  if (accId === 'cape') torso.push(...accessory);

  // оружие в правое предплечье
  forearmR.push(...weapon);

  // ── стандартный гуманоидный скелет (пивоты как skeletonRigged) ──
  const hipsNode: PartNode = { name: 'hips', pivot: [0, 9, 0], voxels: hips, children: [] };
  const spine: PartNode = { name: 'spine', pivot: [0, 11, 0], voxels: torso, children: [] };
  const headNode: PartNode = { name: 'head', pivot: [0, 15, 0], voxels: head, children: [] };
  const upperArmL_: PartNode = { name: 'upperArmL', pivot: [-2, 13, 0], voxels: upperArmL, children: [] };
  const forearmL_: PartNode = { name: 'forearmL', pivot: [-2, 9, 0], voxels: forearmL, children: [] };
  const upperArmR_: PartNode = { name: 'upperArmR', pivot: [2, 13, 0], voxels: upperArmR, children: [] };
  const forearmR_: PartNode = { name: 'forearmR', pivot: [2, 9, 0], voxels: forearmR, children: [] };
  const thighL_: PartNode = { name: 'thighL', pivot: [-1, 8, 0], voxels: thighL, children: [] };
  const shinL_: PartNode = { name: 'shinL', pivot: [-1, 6, 0], voxels: shinL, children: [] };
  const thighR_: PartNode = { name: 'thighR', pivot: [1, 8, 0], voxels: thighR, children: [] };
  const shinR_: PartNode = { name: 'shinR', pivot: [1, 6, 0], voxels: shinR, children: [] };

  hipsNode.children.push(spine);
  spine.children.push(headNode, upperArmL_, upperArmR_);
  upperArmL_.children.push(forearmL_);
  upperArmR_.children.push(forearmR_);
  hipsNode.children.push(thighL_, thighR_);
  thighL_.children.push(shinL_);
  thighR_.children.push(shinR_);

  void mirrorX; // mirrorX не нужен: варианты строятся с side='L'/'R' напрямую

  return { name: `procedural-${archetype}-${seed}`, root: hipsNode };
}

/** assembleCrowd: count уникальных персонажей (seed+i). */
export function assembleCrowd(seed: number, count: number): CharacterDef[] {
  const out: CharacterDef[] = [];
  for (let i = 0; i < count; i++) out.push(assembleCharacter(seed + i));
  return out;
}

// ── helpers ──
function pickIndex(rng: () => number, n: number): number {
  return Math.floor(rng() * n) % n;
}
function indexOf(slot: readonly { id: string }[], id: string): number {
  const i = slot.findIndex((v) => v.id === id);
  return i < 0 ? 0 : i;
}
function pickArchetype(rng: () => number): Archetype {
  const all: Archetype[] = ['skeleton', 'zombie', 'demon', 'generic'];
  return all[Math.floor(rng() * all.length) % all.length]!;
}
/** Пер-персонажная hue/value-вариация темы (±тени, research §15.2B). */
function varyTheme(t: ThemeColors, r: number): ThemeColors {
  const f = 0.92 + r * 0.16; // 0.92..1.08
  return {
    bone: shade(t.bone, f),
    dark: shade(t.dark, f),
    flesh: shade(t.flesh, f),
    metal: shade(t.metal, f),
    cloth: shade(t.cloth, f),
    accent: t.accent // акценты не варьируем (магия/глаза стабильны)
  };
}
/** Таз (hips) — общий для всех архетипов. */
function buildHips(t: ThemeColors): Voxel[] {
  const v: Voxel[] = [];
  box3(v, -2, 2, 9, 10, 0, 1, t.dark);
  return v;
}

// экспорт темы для UI/отладки
export { archetypeTheme, type Archetype, type ThemeColors };
// реэкспорт типов палитры для удобства
void PALETTE;
