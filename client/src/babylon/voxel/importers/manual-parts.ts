/**
 * Ручное разбиение процедурного скелета на part-graph (Фаза P0 задача 3).
 *
 * skeletonEnemy() из voxel-builder.ts — монолитный Voxel[]. Здесь он разбит на
 * 11 партов с суставами-пивотами (research §5.1 «stiff limb»): hips/spine/head +
 * upperArmL/R → forearmL/R + thighL/R → shinL/R. Пивоты (research §5.4):
 *   плечо = верх плеча, локоть = верх предплечья, бедро = тазобедренный,
 *   колено = верх голени, шея = основание черепа.
 *
 * Геометрия партов — подмножество вокселей skeletonEnemy() по регионам (те же
 * box3/cube + тёмная палитра). Меч сгруппирован в правое предплечье (хват).
 */
import { box3, cube, type Voxel } from '../voxel-builder';
import { ACCENT, PALETTE } from '../dark-palette';
import type { CharacterDef, PartNode } from '../voxel-parts';
import { ENEMY_RIGS } from './enemy-rigs';

/** Скелет-риг: костяной гуманоид с ржавым мечом в правой руке. */
export function skeletonRigged(): CharacterDef {
  const bo = PALETTE.bone;
  const bod = PALETTE.boneDark;
  const e = ACCENT.eyeRed;
  const sw = PALETTE.metalLight;
  const wd = PALETTE.woodDark;
  const gold = ACCENT.gold;

  // ── HIPS (таз) — pivot (0,9,0) ──
  const hips: PartNode = {
    name: 'hips',
    pivot: [0, 9, 0],
    voxels: mk((v) => {
      box3(v, -2, 2, 9, 10, 0, 1, bod); // таз
    }),
    children: []
  };

  // ── SPINE (позвоночник + рёбра + ключицы) — pivot (0,11,0) ──
  const spine: PartNode = {
    name: 'spine',
    pivot: [0, 11, 0],
    voxels: mk((v) => {
      box3(v, -1, 0, 11, 14, 0, 0, bo);                       // позвоночник
      box3(v, -2, -1, 12, 12, 0, 0, bo); box3(v, 1, 2, 12, 12, 0, 0, bo); // рёбра
      box3(v, -2, -1, 13, 13, 0, 0, bo); box3(v, 1, 2, 13, 13, 0, 0, bo);
      box3(v, -2, -2, 11, 11, 0, 0, bo); box3(v, 2, 3, 11, 11, 0, 0, bo); // нижние рёбра
      box3(v, -2, 2, 14, 14, 0, 1, bo);                       // ключицы
    }),
    children: []
  };

  // ── HEAD (череп + лицо) — pivot (0,15,0) ──
  const head: PartNode = {
    name: 'head',
    pivot: [0, 15, 0],
    voxels: mk((v) => {
      box3(v, -2, 2, 15, 18, -1, 1, bo);   // череп
      box3(v, -1, 1, 19, 19, 0, 0, bo);   // макушка
      cube(v, -1, 17, 1, e); cube(v, 1, 17, 1, e);            // глазницы
      cube(v, 0, 16, 1, bod);                                  // нос-дырка
      box3(v, -1, 1, 14, 14, 0, 1, bod);                      // зубы
    }),
    children: []
  };

  // ── UPPER ARM L/R — pivot (±2,13,0) ──
  const upperArmL: PartNode = {
    name: 'upperArmL',
    pivot: [-2, 13, 0],
    voxels: mk((v) => { box3(v, -3, -2, 10, 13, 0, 0, bod); }),
    children: []
  };
  const upperArmR: PartNode = {
    name: 'upperArmR',
    pivot: [2, 13, 0],
    voxels: mk((v) => { box3(v, 2, 3, 10, 13, 0, 0, bod); }),
    children: []
  };

  // ── FOREARM L/R (предплечье + кисть) — pivot (±2,9,0) ──
  const forearmL: PartNode = {
    name: 'forearmL',
    pivot: [-2, 9, 0],
    voxels: mk((v) => {
      box3(v, -3, -2, 7, 9, 0, 0, bod);
      cube(v, -3, 6, 0, bo);  // кисть
    }),
    children: []
  };
  const forearmR: PartNode = {
    name: 'forearmR',
    pivot: [2, 9, 0],
    voxels: mk((v) => {
      box3(v, 2, 3, 7, 9, 0, 0, bod);
      cube(v, 3, 6, 0, bo);   // кисть
      // ржавый меч в правой кисти
      cube(v, 3, 6, 1, wd);                       // рукоять
      box3(v, 3, 3, 7, 12, 1, 1, sw);             // клинок
      cube(v, 3, 13, 1, gold);                    // набалдашник
    }),
    children: []
  };

  // ── THIGH L/R (бедро) — pivot (±1,8,0) ──
  const thighL: PartNode = {
    name: 'thighL',
    pivot: [-1, 8, 0],
    voxels: mk((v) => { box3(v, -1, -1, 7, 8, 0, 0, bod); }),
    children: []
  };
  const thighR: PartNode = {
    name: 'thighR',
    pivot: [1, 8, 0],
    voxels: mk((v) => { box3(v, 1, 1, 7, 8, 0, 0, bod); }),
    children: []
  };

  // ── SHIN L/R (голень + колено + ступня) — pivot (±1,6,0) ──
  const shinL: PartNode = {
    name: 'shinL',
    pivot: [-1, 6, 0],
    voxels: mk((v) => {
      box3(v, -1, -1, 2, 5, 0, 0, bod);  // голень
      cube(v, -1, 6, 0, bo);             // колено
      box3(v, -2, -1, 0, 1, 0, 1, bod); // ступня
    }),
    children: []
  };
  const shinR: PartNode = {
    name: 'shinR',
    pivot: [1, 6, 0],
    voxels: mk((v) => {
      box3(v, 1, 1, 2, 5, 0, 0, bod);
      cube(v, 1, 6, 0, bo);
      box3(v, 1, 2, 0, 1, 0, 1, bod);
    }),
    children: []
  };

  // иерархия: hips → {spine → head + arms; thighs → shins}
  hips.children.push(spine);
  spine.children.push(head, upperArmL, upperArmR);
  upperArmL.children.push(forearmL);
  upperArmR.children.push(forearmR);
  hips.children.push(thighL, thighR);
  thighL.children.push(shinL);
  thighR.children.push(shinR);

  return { name: 'skeleton', root: hips, animKind: 'humanoid' };
}

/** Хелпер: собрать Voxel[] через fill-функцию (локальный список). */
function mk(fill: (v: Voxel[]) => void): Voxel[] {
  const v: Voxel[] = [];
  fill(v);
  return v;
}

/**
 * Реестр процедурных rigged-дефов по catalogId (расширяется в P4 kit-assembler,
 * M1 — все враги).
 * Включает skeleton (здесь) + гуманоидные/нестандартные риги из enemy-rigs.ts.
 */
export const RIGGED_DEFS: Record<string, () => CharacterDef> = {
  'enemy:skeleton': skeletonRigged,
  ...ENEMY_RIGS
};
