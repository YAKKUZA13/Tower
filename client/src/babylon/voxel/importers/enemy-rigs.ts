/**
 * M1 (voxel-migration-plan): rigged-дефы для всех типов врагов.
 *
 * Гуманоидные (goblin/zombie/demon/boss) — 11-партный риг с теми же именами
 * суставов, что skeletonRigged (hips/spine/head/upperArmL,R/forearmL,R/thighL,R/
 * shinL,R) → существующий walk-cycle работает без правок. Пропорции/детали —
 * по archetype (сутулость, рога, когти, дубина/посох).
 *
 * Нестандартные (bat/spider/ghost/slime) — собственные part-pattern'ы + animKind:
 *  - bat: body + wingL/wingR → взмах крыльев.
 *  - spider: body + 8 ног (legL1..4/legR1..4) → перебирание.
 *  - ghost: body + armL/armR (без ног) → парение + покачивание.
 *  - slime: single body blob → сжатие/растяжение (squash/stretch).
 *
 * Координаты — модельные unit-воксели (как skeletonRigged); normalizeMesh в
 * assembleRig приводит к height=1.0, base@-0.5. Пивоты = суставы (research §5.4).
 */
import { box3, cube, type Voxel } from '../voxel-builder';
import { ACCENT, PALETTE, shade } from '../dark-palette';
import type { CharacterDef, PartNode } from '../voxel-parts';

/** Хелпер: собрать Voxel[] через fill-функцию (локальный список). */
function mk(fill: (v: Voxel[]) => void): Voxel[] {
  const v: Voxel[] = [];
  fill(v);
  return v;
}

/** Хелпер: пустой парт (только сустав-носитель детей, без собственной геометрии). */
function jointNode(name: string, pivot: [number, number, number]): PartNode {
  return { name, pivot, voxels: [], children: [] };
}

// ════════════════════════════════════════════════════════════════════════════
//  ГУМАНОИДНЫЕ ВРАГИ (walk-cycle — общий с skeleton)
// ════════════════════════════════════════════════════════════════════════════

/** Гоблин — мелкий, сутулый, длинные руки до земли, дубина в правой руке. */
export function goblinRigged(): CharacterDef {
  const f = PALETTE.flesh, fd = PALETTE.fleshDark, mo = PALETTE.moss;
  const e = ACCENT.eyeDemon, wd = PALETTE.woodDark;

  const hips: PartNode = {
    name: 'hips', pivot: [0, 5, 0],
    voxels: mk((v) => { box3(v, -2, 2, 5, 6, 0, 1, mo); }),
    children: []
  };
  const spine: PartNode = {
    name: 'spine', pivot: [0, 7, 0],
    voxels: mk((v) => {
      box3(v, -2, 2, 7, 9, 0, 1, f);                 // сгорбленный торс
      box3(v, -1, 2, 10, 11, 1, 2, f);               // грудь вперёд
    }),
    children: []
  };
  const head: PartNode = {
    name: 'head', pivot: [0, 12, 0],
    voxels: mk((v) => {
      box3(v, -2, 2, 11, 13, 1, 2, f);               // большая голова
      box3(v, -3, -3, 12, 13, 1, 1, fd); box3(v, 2, 3, 12, 13, 1, 1, fd); // уши
      cube(v, 0, 12, 3, fd);                          // нос-клюв
      cube(v, -1, 12, 2, e); cube(v, 1, 12, 2, e);   // глаза
    }),
    children: []
  };
  const upperArmL: PartNode = {
    name: 'upperArmL', pivot: [-2, 9, 0],
    voxels: mk((v) => { box3(v, -3, -2, 6, 9, 0, 0, fd); }),
    children: []
  };
  const upperArmR: PartNode = {
    name: 'upperArmR', pivot: [2, 9, 0],
    voxels: mk((v) => { box3(v, 2, 3, 6, 9, 0, 0, fd); }),
    children: []
  };
  const forearmL: PartNode = {
    name: 'forearmL', pivot: [-2, 6, 0],
    voxels: mk((v) => {
      box3(v, -3, -2, 4, 6, 0, 0, fd);
      cube(v, -3, 3, 0, fd);                          // кисть
    }),
    children: []
  };
  const forearmR: PartNode = {
    name: 'forearmR', pivot: [2, 6, 0],
    voxels: mk((v) => {
      box3(v, 2, 3, 4, 6, 0, 0, fd);
      cube(v, 3, 3, 0, fd);                           // кисть
      // дубина в правой кисти
      cube(v, 3, 3, 1, wd);
      box3(v, 3, 3, 6, 8, 1, 1, wd);
      cube(v, 3, 9, 1, wd);
    }),
    children: []
  };
  const thighL: PartNode = {
    name: 'thighL', pivot: [-1, 4, 0],
    voxels: mk((v) => { box3(v, -1, -1, 2, 4, 0, 1, fd); }),
    children: []
  };
  const thighR: PartNode = {
    name: 'thighR', pivot: [1, 4, 0],
    voxels: mk((v) => { box3(v, 1, 1, 2, 4, 0, 1, fd); }),
    children: []
  };
  const shinL: PartNode = {
    name: 'shinL', pivot: [-1, 2, 0],
    voxels: mk((v) => {
      box3(v, -2, -1, 0, 1, 0, 1, fd); box3(v, -1, -1, 0, 1, 0, 0, fd); // короткие кривые ноги
    }),
    children: []
  };
  const shinR: PartNode = {
    name: 'shinR', pivot: [1, 2, 0],
    voxels: mk((v) => {
      box3(v, 1, 2, 0, 1, 0, 1, fd); box3(v, 1, 1, 0, 1, 0, 0, fd);
    }),
    children: []
  };

  hips.children.push(spine);
  spine.children.push(head, upperArmL, upperArmR);
  upperArmL.children.push(forearmL);
  upperArmR.children.push(forearmR);
  hips.children.push(thighL, thighR);
  thighL.children.push(shinL);
  thighR.children.push(shinR);
  return { name: 'goblin', root: hips, animKind: 'humanoid' };
}

/** Зомби — гнилое туловище, одна рука длиннее, хромота. */
export function zombieRigged(): CharacterDef {
  const f = PALETTE.fleshDark, fd = shade(PALETTE.fleshDark, 0.7), fl = shade(PALETTE.fleshDark, 1.15);
  const e = ACCENT.eyeRed;

  const hips: PartNode = {
    name: 'hips', pivot: [0, 7, 0],
    voxels: mk((v) => { box3(v, -2, 2, 7, 8, 0, 1, fd); }),
    children: []
  };
  const spine: PartNode = {
    name: 'spine', pivot: [0, 9, 0],
    voxels: mk((v) => {
      box3(v, -2, 2, 9, 13, 0, 1, f);                 // раздутый живот
      cube(v, 0, 11, 1, fd);                          // провал живота
    }),
    children: []
  };
  const head: PartNode = {
    name: 'head', pivot: [0, 14, 0],
    voxels: mk((v) => {
      box3(v, -1, 3, 14, 16, 0, 1, fl);               // скособоченная голова
      cube(v, -2, 15, 1, f); cube(v, 2, 15, 1, f);    // глаза
      cube(v, -2, 15, 1, e); cube(v, 2, 15, 1, e);
      box3(v, -1, 2, 16, 16, 0, 1, fd);               // волосы/гниль
      cube(v, 1, 15, 1, fd);                          // рот
    }),
    children: []
  };
  const upperArmL: PartNode = {
    name: 'upperArmL', pivot: [-2, 12, 0],
    voxels: mk((v) => { box3(v, -3, -3, 9, 12, 0, 0, fd); }),
    children: []
  };
  const upperArmR: PartNode = {
    name: 'upperArmR', pivot: [2, 12, 0],
    voxels: mk((v) => { box3(v, 2, 3, 9, 13, 1, 1, fd); }), // правая длиннее, тянется вперёд
    children: []
  };
  const forearmL: PartNode = {
    name: 'forearmL', pivot: [-2, 9, 0],
    voxels: mk((v) => { box3(v, -3, -3, 7, 9, 0, 0, fd); cube(v, -3, 6, 0, fd); }),
    children: []
  };
  const forearmR: PartNode = {
    name: 'forearmR', pivot: [2, 9, 0],
    voxels: mk((v) => {
      box3(v, 2, 3, 13, 14, 1, 1, fd);                // вытянутая кисть (светлее)
      box3(v, 2, 3, 14, 14, 1, 1, fl);
    }),
    children: []
  };
  const thighL: PartNode = {
    name: 'thighL', pivot: [-1, 6, 0],
    voxels: mk((v) => { box3(v, -1, -1, 2, 6, 0, 0, fd); }), // длинная нога
    children: []
  };
  const thighR: PartNode = {
    name: 'thighR', pivot: [1, 6, 0],
    voxels: mk((v) => { box3(v, 1, 1, 2, 5, 0, 0, fd); }),   // короткая (хромота)
    children: []
  };
  const shinL: PartNode = {
    name: 'shinL', pivot: [-1, 2, 0],
    voxels: mk((v) => { box3(v, -1, -1, 0, 1, 0, 1, fd); }),
    children: []
  };
  const shinR: PartNode = {
    name: 'shinR', pivot: [1, 1, 0],
    voxels: mk((v) => { box3(v, 1, 1, 0, 1, 0, 1, fd); }),
    children: []
  };

  hips.children.push(spine);
  spine.children.push(head, upperArmL, upperArmR);
  upperArmL.children.push(forearmL);
  upperArmR.children.push(forearmR);
  hips.children.push(thighL, thighR);
  thighL.children.push(shinL);
  thighR.children.push(shinR);
  return { name: 'zombie', root: hips, animKind: 'humanoid' };
}

/** Демон — крупный, рогатый, тёмно-багровый, когти. */
export function demonRigged(): CharacterDef {
  const sk = PALETTE.metalDark, bl = ACCENT.blood, bls = shade(ACCENT.blood, 0.55);
  const e = ACCENT.eyeDemon, bd = PALETTE.boneDark, bo = PALETTE.bone;

  const hips: PartNode = {
    name: 'hips', pivot: [0, 8, 0],
    voxels: mk((v) => { box3(v, -3, 3, 8, 9, 0, 0, sk); }), // массивный таз
    children: []
  };
  const spine: PartNode = {
    name: 'spine', pivot: [0, 10, 0],
    voxels: mk((v) => {
      box3(v, -3, 3, 9, 13, 0, 1, bls);               // бочкообразный торс
      box3(v, -2, 2, 9, 13, 2, 2, sk);
      cube(v, 0, 11, 1, bl); cube(v, 0, 12, 1, bl);   // рубцы
    }),
    children: []
  };
  const head: PartNode = {
    name: 'head', pivot: [0, 15, 0],
    voxels: mk((v) => {
      box3(v, -2, 2, 14, 17, 0, 1, bls);
      cube(v, -1, 16, 1, e); cube(v, 1, 16, 1, e);    // глаза
      box3(v, -1, 1, 14, 14, 1, 1, bl);               // пасть
      // рога (висят на голове — покачиваются при ходьбе)
      box3(v, -3, -2, 17, 18, 0, 0, bd); box3(v, 2, 3, 17, 18, 0, 0, bd);
      cube(v, -3, 19, 0, bo); cube(v, 3, 19, 0, bo);
    }),
    children: []
  };
  const upperArmL: PartNode = {
    name: 'upperArmL', pivot: [-3, 12, 0],
    voxels: mk((v) => { box3(v, -4, -3, 10, 12, 0, 1, sk); }),
    children: []
  };
  const upperArmR: PartNode = {
    name: 'upperArmR', pivot: [3, 12, 0],
    voxels: mk((v) => { box3(v, 2, 4, 10, 12, 0, 1, sk); }),
    children: []
  };
  const forearmL: PartNode = {
    name: 'forearmL', pivot: [-3, 9, 0],
    voxels: mk((v) => {
      box3(v, -4, -3, 7, 9, 0, 0, sk);
      cube(v, -4, 6, 0, e);                            // коготь-свет
    }),
    children: []
  };
  const forearmR: PartNode = {
    name: 'forearmR', pivot: [3, 9, 0],
    voxels: mk((v) => {
      box3(v, 3, 4, 7, 9, 0, 0, sk);
      cube(v, 4, 6, 0, e);
    }),
    children: []
  };
  const thighL: PartNode = {
    name: 'thighL', pivot: [-2, 6, 0],
    voxels: mk((v) => { box3(v, -3, -2, 2, 6, 0, 1, sk); }),
    children: []
  };
  const thighR: PartNode = {
    name: 'thighR', pivot: [2, 6, 0],
    voxels: mk((v) => { box3(v, 2, 3, 2, 6, 0, 1, sk); }),
    children: []
  };
  const shinL: PartNode = {
    name: 'shinL', pivot: [-2, 2, 0],
    voxels: mk((v) => {
      box3(v, -3, -1, 0, 1, 0, 2, sk);                // стопа-когтиста
    }),
    children: []
  };
  const shinR: PartNode = {
    name: 'shinR', pivot: [2, 2, 0],
    voxels: mk((v) => { box3(v, 1, 2, 0, 1, 0, 2, sk); }),
    children: []
  };

  hips.children.push(spine);
  spine.children.push(head, upperArmL, upperArmR);
  upperArmL.children.push(forearmL);
  upperArmR.children.push(forearmR);
  hips.children.push(thighL, thighR);
  thighL.children.push(shinL);
  thighR.children.push(shinR);
  return { name: 'demon', root: hips, animKind: 'humanoid' };
}

/** Владыка (босс) — огромный тёмный лорд с большими рогами и магией. */
export function bossRigged(): CharacterDef {
  const sd = PALETTE.stoneDark, bl = ACCENT.blood, bls = shade(ACCENT.blood, 0.4);
  const ar = ACCENT.arcane, e = ACCENT.eyeDemon, bd = PALETTE.boneDark, bo = PALETTE.bone;

  const hips: PartNode = {
    name: 'hips', pivot: [0, 8, 0],
    voxels: mk((v) => {
      box3(v, -4, 4, 8, 8, 0, 1, sd);
      box3(v, -5, 5, 9, 11, -1, 2, shade(sd, 0.8));   // подол плаща
    }),
    children: []
  };
  const spine: PartNode = {
    name: 'spine', pivot: [0, 11, 0],
    voxels: mk((v) => {
      box3(v, -4, 4, 9, 15, -1, 2, bls);              // массивный торс-плащ
      box3(v, -3, 3, 9, 15, 2, 3, sd);
      box3(v, -5, 5, 12, 15, 0, 1, sd);               // рукава плаща
      cube(v, -6, 9, 0, bl); cube(v, 6, 9, 0, bl);    // когти (висят на торсе)
    }),
    children: []
  };
  const head: PartNode = {
    name: 'head', pivot: [0, 17, 0],
    voxels: mk((v) => {
      box3(v, -3, 3, 16, 20, 0, 1, bls);
      cube(v, -2, 18, 1, e); cube(v, 2, 18, 1, e);    // горящие глаза
      box3(v, -1, 2, 16, 16, 1, 1, ar);               // светящаяся пасть
      cube(v, 0, 19, 1, ar);                           // руна на лбу
      // большие изогнутые рога (покачиваются при ходьбе/касте)
      box3(v, -4, -3, 18, 22, 0, 0, bd); box3(v, 3, 4, 18, 22, 0, 0, bd);
      box3(v, -5, -4, 22, 24, 0, 0, bd); box3(v, 4, 5, 22, 24, 0, 0, bd);
      cube(v, -5, 25, 0, bo); cube(v, 5, 25, 0, bo);
    }),
    children: []
  };
  const upperArmL: PartNode = {
    name: 'upperArmL', pivot: [-5, 13, 0],
    voxels: mk((v) => { box3(v, -6, -5, 11, 13, 0, 1, shade(sd, 0.8)); }),
    children: []
  };
  const upperArmR: PartNode = {
    name: 'upperArmR', pivot: [5, 13, 0],
    voxels: mk((v) => { box3(v, 4, 6, 11, 13, 0, 1, shade(sd, 0.8)); }),
    children: []
  };
  const forearmL: PartNode = {
    name: 'forearmL', pivot: [-5, 11, 0],
    voxels: mk((v) => { box3(v, -6, -5, 9, 11, 0, 1, shade(sd, 0.8)); }),
    children: []
  };
  const forearmR: PartNode = {
    name: 'forearmR', pivot: [5, 11, 0],
    voxels: mk((v) => { box3(v, 4, 6, 9, 11, 0, 1, shade(sd, 0.8)); }),
    children: []
  };
  const thighL: PartNode = {
    name: 'thighL', pivot: [-2, 6, 0],
    voxels: mk((v) => { box3(v, -4, -2, 2, 6, 0, 1, sd); }),
    children: []
  };
  const thighR: PartNode = {
    name: 'thighR', pivot: [2, 6, 0],
    voxels: mk((v) => { box3(v, 2, 4, 2, 6, 0, 1, sd); }),
    children: []
  };
  const shinL: PartNode = {
    name: 'shinL', pivot: [-2, 2, 0],
    voxels: mk((v) => { box3(v, -4, -2, 0, 1, 0, 2, sd); }),
    children: []
  };
  const shinR: PartNode = {
    name: 'shinR', pivot: [2, 2, 0],
    voxels: mk((v) => { box3(v, 2, 4, 0, 1, 0, 2, sd); }),
    children: []
  };

  hips.children.push(spine);
  spine.children.push(head, upperArmL, upperArmR);
  upperArmL.children.push(forearmL);
  upperArmR.children.push(forearmR);
  hips.children.push(thighL, thighR);
  thighL.children.push(shinL);
  thighR.children.push(shinR);
  return { name: 'boss', root: hips, animKind: 'humanoid' };
}

// ════════════════════════════════════════════════════════════════════════════
//  НЕСТАНДАРТНЫЕ ВРАГИ (кастомные animKind)
// ════════════════════════════════════════════════════════════════════════════

/** Летучая мышь — тело + голова + 2 крыла (взмах). */
export function batRigged(): CharacterDef {
  const sk = PALETTE.metalDark, skd = shade(PALETTE.metalDark, 0.6);
  const e = ACCENT.eyeRed, fl = shade(PALETTE.metalDark, 1.4);

  const body: PartNode = {
    name: 'hips', pivot: [0, 3, 0],
    voxels: mk((v) => {
      box3(v, -1, 1, 2, 4, -1, 1, sk);                // тело-шарик
      cube(v, 0, 5, 0, sk);                            // голова
      cube(v, 0, 6, 0, skd);                           // уши
      cube(v, -1, 6, 0, skd); cube(v, 1, 6, 0, skd);
      cube(v, -1, 5, 1, e); cube(v, 1, 5, 1, e);      // горящие глаза
      cube(v, 0, 1, -1, skd); cube(v, -1, 0, -1, skd); cube(v, 1, 0, -1, skd); // хвост/лапки
    }),
    children: []
  };
  const wingL: PartNode = {
    name: 'wingL', pivot: [-1, 3, 0],
    voxels: mk((v) => {
      box3(v, -2, -3, 1, 2, 0, 1, fl);                 // внутренний сегмент
      box3(v, -5, -4, 1, 1, 1, 1, fl);                 // средний (тонкий)
      cube(v, -6, 1, 1, fl); cube(v, -7, 1, 1, fl);    // кончик
    }),
    children: []
  };
  const wingR: PartNode = {
    name: 'wingR', pivot: [1, 3, 0],
    voxels: mk((v) => {
      box3(v, 2, 3, 1, 2, 0, 1, fl);
      box3(v, 4, 5, 1, 1, 1, 1, fl);
      cube(v, 6, 1, 1, fl); cube(v, 7, 1, 1, fl);
    }),
    children: []
  };
  body.children.push(wingL, wingR);
  return { name: 'bat', root: body, animKind: 'bat' };
}

/** Паук — брюшко + головогрудь + 8 ног (4 симметричные пары). */
export function spiderRigged(): CharacterDef {
  const sk = PALETTE.metalDark, skd = shade(PALETTE.metalDark, 0.65);
  const e = ACCENT.eyeRed;

  const body: PartNode = {
    name: 'hips', pivot: [0, 2, 0],
    voxels: mk((v) => {
      box3(v, -2, 2, 1, 4, -2, 2, sk);                 // брюшко
      box3(v, -2, 2, 5, 6, -2, 2, skd);
      cube(v, 0, 6, 0, skd);
      box3(v, -1, 1, -1, 1, -1, 1, sk);               // головогрудь
      cube(v, -1, 0, 0, e); cube(v, 1, 0, 0, e);      // 6 глаз
      cube(v, -2, 0, 0, e); cube(v, 2, 0, 0, e);
      cube(v, -1, 1, 0, e); cube(v, 1, 1, 0, e);
    }),
    children: []
  };
  // 8 ног: legL1..4 / legR1..4 (две фаланги, pivot у тела).
  const legs: PartNode[] = [];
  const zRows = [1, 3, 5, 7];
  for (let i = 0; i < 4; i++) {
    const z = zRows[i]!;
    // левая нога
    legs.push({
      name: `legL${i + 1}`, pivot: [-2, 2, z],
      voxels: mk((v) => {
        box3(v, -3, -2, z, z, 0, 0, skd); box3(v, -5, -4, z, z, 0, 0, skd);
      }),
      children: []
    });
    // правая нога (X-зеркало)
    legs.push({
      name: `legR${i + 1}`, pivot: [2, 2, z],
      voxels: mk((v) => {
        box3(v, 2, 3, z, z, 0, 0, skd); box3(v, 4, 5, z, z, 0, 0, skd);
      }),
      children: []
    });
  }
  body.children.push(...legs);
  return { name: 'spider', root: body, animKind: 'spider' };
}

/** Призрак — капюшон + струящееся тело + 2 руки; парит (без ног). */
export function ghostRigged(): CharacterDef {
  const body = desaturateBody();
  const dark = shade(body, 0.55);
  const light = shade(body, 1.25);
  const e = ACCENT.soul;

  const torso: PartNode = {
    name: 'hips', pivot: [0, 4, 0],
    voxels: mk((v) => {
      box3(v, -3, 3, 1, 3, -1, 1, body);               // струящееся тело
      box3(v, -2, 2, 0, 0, -1, 1, dark);               // сужение книзу
      cube(v, -2, 0, 0, dark); cube(v, 0, 0, 0, dark); cube(v, 2, 0, 0, dark); // рваный подол
      cube(v, -3, 0, 1, dark); cube(v, 3, 0, 1, dark);
    }),
    children: []
  };
  const hood: PartNode = {
    name: 'head', pivot: [0, 6, 0],
    voxels: mk((v) => {
      box3(v, -2, 2, 5, 7, -1, 1, light);              // верх-капюшон
      box3(v, -3, 3, 4, 5, -1, 1, body);
      cube(v, 0, 7, 0, light); cube(v, -1, 7, 0, light); cube(v, 1, 7, 0, light);
      box3(v, -1, 1, 4, 5, 0, 1, PALETTE.metalDark);   // лицо — тень под капюшоном
      cube(v, -1, 5, 2, e); cube(v, 1, 5, 2, e);       // светящиеся глаза
      cube(v, 0, 4, 2, dark);                          // рот-провал
    }),
    children: []
  };
  const armL: PartNode = {
    name: 'armL', pivot: [-3, 4, 0],
    voxels: mk((v) => { box3(v, -4, -4, 2, 4, 0, 0, light); }),
    children: []
  };
  const armR: PartNode = {
    name: 'armR', pivot: [3, 4, 0],
    voxels: mk((v) => { box3(v, 3, 4, 2, 4, 0, 0, light); }),
    children: []
  };
  torso.children.push(hood, armL, armR);
  return { name: 'ghost', root: torso, animKind: 'ghost' };
}

/** Бледно-голубое тело призрака (десатурация). */
function desaturateBody(): [number, number, number] {
  const base: [number, number, number] = [0.55, 0.62, 0.72];
  // упрощённая десатурация (luminance mix)
  const lum = 0.299 * base[0] + 0.587 * base[1] + 0.114 * base[2];
  return [
    base[0] + (lum - base[0]) * 0.18,
    base[1] + (lum - base[1]) * 0.18,
    base[2] + (lum - base[2]) * 0.18
  ];
}

/** Слизень — единый полусферический блоб (squash/stretch idle). */
export function slimeRigged(): CharacterDef {
  const base = shade(PALETTE.moss, 0.85);
  const dark = shade(base, 0.6);
  const light = shade(base, 1.3);
  const ar = ACCENT.arcane;

  const body: PartNode = {
    name: 'hips', pivot: [0, 2, 0],
    voxels: mk((v) => {
      box3(v, -3, 3, 0, 0, -2, 2, dark);               // нижний слой
      box3(v, -4, 4, 1, 1, -3, 3, base);               // средний (широкий)
      box3(v, -3, 3, 2, 2, -2, 2, light);              // верхний
      box3(v, -2, 2, 3, 3, -1, 1, light);              // купол
      cube(v, 0, 4, 0, light);
      cube(v, -1, 4, 1, light); cube(v, 1, 4, 1, light);
      cube(v, -2, 2, 3, ar); cube(v, 2, 2, 3, ar);     // глаза
      cube(v, -4, 0, 2, dark); cube(v, 4, 0, -2, dark); // капли слизи
      cube(v, 0, 0, 3, dark); cube(v, 0, 0, -3, dark);
    }),
    children: []
  };
  return { name: 'slime', root: body, animKind: 'slime' };
}

// ════════════════════════════════════════════════════════════════════════════
//  Реестр rigged-дефов (расширение skeleton из manual-parts)
// ════════════════════════════════════════════════════════════════════════════

/** Дополнительные rigged-дефы врагов (M1). Сливаются с RIGGED_DEFS в manual-parts. */
export const ENEMY_RIGS: Record<string, () => CharacterDef> = {
  'enemy:goblin': goblinRigged,
  'enemy:zombie': zombieRigged,
  'enemy:demon': demonRigged,
  'enemy:boss': bossRigged,
  'enemy:bat': batRigged,
  'enemy:spider': spiderRigged,
  'enemy:ghost': ghostRigged,
  'enemy:slime': slimeRigged
};

void jointNode; // зарезервирован для будущих carrier-суставов
