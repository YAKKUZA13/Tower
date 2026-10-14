/**
 * M2 (voxel-migration-plan): rigged-дефы RTS-юнитов (knight/archer/mage/commander).
 *
 * Все — гуманоиды 11-партного рига (hips/spine/head/upperArmL,R/forearmL,R/
 * thighL,R/shinL,R) с оружием, сгруппированным в forearm (хват). animKind 'humanoid'
 * → общий walk-cycle. Оружие: меч (knight), лук (archer), посох (mage/commander).
 *
 * Атака (render-only): RiggedUnitRenderer детектит reset cooldown → swing forearmR.
 * Каст командира: при новом ActiveSpell → поднимает посох (forearmR up).
 *
 * Координаты — модельные unit-воксели (как enemy-rigs); normalizeMesh в assembleRig.
 */
import { box3, cube, type Voxel } from '../voxel-builder';
import { ACCENT, PALETTE, shade } from '../dark-palette';
import type { CharacterDef, PartNode } from '../voxel-parts';

function mk(fill: (v: Voxel[]) => void): Voxel[] {
  const v: Voxel[] = [];
  fill(v);
  return v;
}

/** Рыцарь — латник со щитом (левая рука) и мечом (правая). */
export function knightRigged(): CharacterDef {
  const m = PALETTE.metal, md = PALETTE.metalDark, ml = PALETTE.metalLight, wd = PALETTE.woodDark;
  const e = ACCENT.soul, g = ACCENT.gold;

  const hips: PartNode = {
    name: 'hips', pivot: [0, 7, 0],
    voxels: mk((v) => {
      box3(v, -2, 2, 7, 8, 0, 1, m);
      box3(v, -1, 1, 5, 8, 2, 2, shade(m, 0.82));      // front tabard
      box3(v, -2, 2, 8, 8, 2, 2, g);                   // belt trim
    }),
    children: []
  };
  const spine: PartNode = {
    name: 'spine', pivot: [0, 10, 0],
    voxels: mk((v) => {
      box3(v, -2, 2, 10, 12, 0, 1, m);                 // нагрудник
      box3(v, -1, 1, 12, 13, 1, 1, ml);                // грудь-блик
      cube(v, 0, 11, 1, g);                             // эмблема
      box3(v, -3, -2, 10, 11, 0, 1, md); box3(v, 2, 3, 10, 11, 0, 1, md); // наплечники
      box3(v, -2, 2, 8, 13, -2, -1, shade(md, 0.72));  // split heavy cape
      cube(v, -2, 13, -1, g); cube(v, 2, 13, -1, g);   // cape clasps
    }),
    children: []
  };
  const head: PartNode = {
    name: 'head', pivot: [0, 14, 0],
    voxels: mk((v) => {
      box3(v, -2, 2, 14, 16, 0, 1, md);                // шлем
      box3(v, 0, 0, 17, 19, -1, 0, g);                 // tall readable crest
      cube(v, -2, 16, 0, ml); cube(v, 2, 16, 0, ml);   // cheek guards
      cube(v, -1, 15, 1, e); cube(v, 1, 15, 1, e);     // глазница-щель
    }),
    children: []
  };
  const upperArmL: PartNode = {
    name: 'upperArmL', pivot: [-2, 12, 0],
    voxels: mk((v) => { box3(v, -3, -2, 12, 13, 0, 0, md); }),
    children: []
  };
  const upperArmR: PartNode = {
    name: 'upperArmR', pivot: [2, 12, 0],
    voxels: mk((v) => { box3(v, 2, 3, 12, 13, 0, 0, md); }),
    children: []
  };
  const forearmL: PartNode = {
    name: 'forearmL', pivot: [-2, 12, 0],
    voxels: mk((v) => {
      box3(v, -3, -2, 13, 14, 0, 0, md);
      // щит на левой руке
      box3(v, -5, -3, 11, 15, 1, 2, shade(m, 0.9));
      box3(v, -5, -3, 12, 14, 3, 3, md);
      box3(v, -4, -4, 12, 14, 3, 3, g);                // shield rune
    }),
    children: []
  };
  const forearmR: PartNode = {
    name: 'forearmR', pivot: [2, 12, 0],
    voxels: mk((v) => {
      box3(v, 2, 3, 13, 14, 0, 0, md);
      // меч в правой кисти (качается при swing forearmR)
      cube(v, 3, 9, 1, wd);                             // рукоять
      box3(v, 3, 3, 10, 15, 1, 1, ml);                 // клинок
      box3(v, 2, 4, 10, 10, 1, 1, g);                  // guard
      cube(v, 3, 16, 1, g);                             // набалдашник
    }),
    children: []
  };
  const thighL: PartNode = {
    name: 'thighL', pivot: [-1, 6, 0],
    voxels: mk((v) => { box3(v, -2, -1, 2, 6, 0, 0, md); }),
    children: []
  };
  const thighR: PartNode = {
    name: 'thighR', pivot: [1, 6, 0],
    voxels: mk((v) => { box3(v, 1, 2, 2, 6, 0, 0, md); }),
    children: []
  };
  const shinL: PartNode = {
    name: 'shinL', pivot: [-1, 2, 0],
    voxels: mk((v) => { box3(v, -2, -1, 0, 1, 0, 1, md); }),
    children: []
  };
  const shinR: PartNode = {
    name: 'shinR', pivot: [1, 2, 0],
    voxels: mk((v) => { box3(v, 1, 2, 0, 1, 0, 1, md); }),
    children: []
  };
  hips.children.push(spine);
  spine.children.push(head, upperArmL, upperArmR);
  upperArmL.children.push(forearmL);
  upperArmR.children.push(forearmR);
  hips.children.push(thighL, thighR);
  thighL.children.push(shinL);
  thighR.children.push(shinR);
  return { name: 'knight', root: hips, animKind: 'humanoid' };
}

/** Лучник — лёгкий боец с луком (левая рука) и колчаном. */
export function archerRigged(): CharacterDef {
  const f = PALETTE.flesh, fd = PALETTE.fleshDark, w = PALETTE.wood, wl = PALETTE.woodLight;
  const e = ACCENT.soul, g = ACCENT.gold;

  const hips: PartNode = {
    name: 'hips', pivot: [0, 7, 0],
    voxels: mk((v) => {
      box3(v, -2, 2, 7, 13, 0, 1, shade(f, 0.85));
      box3(v, -2, 2, 6, 9, -2, -1, shade(fd, 0.72));   // short travelling cloak
      box3(v, -2, 2, 8, 8, 2, 2, g);                  // utility belt
    }),
    children: []
  };
  const spine: PartNode = {
    name: 'spine', pivot: [0, 10, 0],
    voxels: mk((v) => {
      box3(v, -2, 2, 10, 13, 0, 1, shade(f, 0.85));    // лиф туники
      cube(v, 2, 12, 1, g);                             // пояс-пряжка
      box3(v, -3, -2, 11, 12, 0, 1, shade(fd, 0.8));
      box3(v, 2, 3, 11, 12, 0, 1, shade(fd, 0.8));     // leather shoulder guards
    }),
    children: []
  };
  const head: PartNode = {
    name: 'head', pivot: [0, 14, 0],
    voxels: mk((v) => {
      box3(v, -2, 2, 13, 14, -1, 1, fd); box3(v, -2, 2, 13, 14, 1, 2, fd); // капюшон
      box3(v, -1, 1, 14, 15, 0, 1, f);                 // лицо
      cube(v, -1, 14, 1, e); cube(v, 1, 14, 1, e);
      cube(v, 0, 16, -1, shade(fd, 0.8));              // hood peak
    }),
    children: []
  };
  const upperArmL: PartNode = {
    name: 'upperArmL', pivot: [-2, 12, 0],
    voxels: mk((v) => {
      box3(v, -3, -2, 12, 13, 0, 0, fd);
      // колчан за спиной (висит на плече)
      box3(v, -1, 1, 9, 12, -2, -2, w);
      box3(v, -1, 1, 8, 8, -2, -2, shade(fd, 0.7));
      cube(v, 0, 13, -2, wl); cube(v, -1, 13, -2, wl); cube(v, 1, 13, -2, wl);
    }),
    children: []
  };
  const upperArmR: PartNode = {
    name: 'upperArmR', pivot: [2, 12, 0],
    voxels: mk((v) => { box3(v, 2, 3, 12, 13, 0, 0, fd); }),
    children: []
  };
  const forearmL: PartNode = {
    name: 'forearmL', pivot: [-2, 12, 0],
    voxels: mk((v) => {
      box3(v, -3, -2, 13, 14, 0, 0, fd);
      // лук в левой руке (натягивается при swing forearmL)
      box3(v, -4, -4, 10, 16, 1, 1, w);
      cube(v, -3, 9, 1, w); cube(v, -3, 17, 1, w);
      cube(v, -4, 13, 2, wl);                          // стрела на тетиве
    }),
    children: []
  };
  const forearmR: PartNode = {
    name: 'forearmR', pivot: [2, 12, 0],
    voxels: mk((v) => { box3(v, 2, 3, 13, 14, 0, 0, fd); }), // правая тянет тетиву
    children: []
  };
  const thighL: PartNode = {
    name: 'thighL', pivot: [-1, 6, 0],
    voxels: mk((v) => { box3(v, -2, -1, 2, 6, 0, 0, fd); }),
    children: []
  };
  const thighR: PartNode = {
    name: 'thighR', pivot: [1, 6, 0],
    voxels: mk((v) => { box3(v, 1, 2, 2, 6, 0, 0, fd); }),
    children: []
  };
  const shinL: PartNode = {
    name: 'shinL', pivot: [-1, 2, 0],
    voxels: mk((v) => { box3(v, -2, -1, 0, 1, 0, 1, fd); }),
    children: []
  };
  const shinR: PartNode = {
    name: 'shinR', pivot: [1, 2, 0],
    voxels: mk((v) => { box3(v, 1, 2, 0, 1, 0, 1, fd); }),
    children: []
  };
  hips.children.push(spine);
  spine.children.push(head, upperArmL, upperArmR);
  upperArmL.children.push(forearmL);
  upperArmR.children.push(forearmR);
  hips.children.push(thighL, thighR);
  thighL.children.push(shinL);
  thighR.children.push(shinR);
  return { name: 'archer', root: hips, animKind: 'humanoid' };
}

/** Маг — могильный капеллан: костяная маска, тяжёлая мантия и фонарь-посох. */
export function mageRigged(): CharacterDef {
  const robe = shade(PALETTE.metalDark, 1.18), robeHi = shade(PALETTE.stoneDark, 1.32);
  const bone = PALETTE.bone, boneDark = PALETTE.boneDark;
  const soul = ACCENT.soul, soulCore = shade(ACCENT.soul, 1.15), blood = ACCENT.blood;

  const hips: PartNode = {
    name: 'hips', pivot: [0, 6, 0],
    voxels: mk((v) => {
      box3(v, -3, 3, 0, 6, -1, 1, robe);               // тяжёлый треугольный подол
      box3(v, -2, 2, 1, 6, 2, 2, robeHi);              // читаемая передняя пола
      box3(v, -3, 3, 0, 1, -2, 2, shade(robe, 0.72));  // ступенчатый силуэт
      box3(v, 0, 0, 1, 5, 3, 3, blood);                // орденская вертикаль
      box3(v, -1, 1, 3, 3, 3, 3, blood);               // крест на мантии
    }),
    children: []
  };
  const spine: PartNode = {
    name: 'spine', pivot: [0, 9, 0],
    voxels: mk((v) => {
      box3(v, -2, 2, 7, 11, -1, 1, robeHi);
      box3(v, -2, 2, 11, 12, -1, 1, robe);
      box3(v, -4, -2, 10, 12, -1, 1, robe);            // широкие плечи
      box3(v, 2, 4, 10, 12, -1, 1, robe);
      cube(v, -4, 12, 0, boneDark); cube(v, 4, 12, 0, boneDark);
    }),
    children: []
  };
  const head: PartNode = {
    name: 'head', pivot: [0, 12, 0],
    voxels: mk((v) => {
      box3(v, -3, 3, 12, 16, -1, 1, robe);             // массивный капюшон
      box3(v, -2, 2, 13, 16, 2, 2, bone);              // костяная маска
      cube(v, -2, 13, 2, boneDark); cube(v, 2, 13, 2, boneDark);
      cube(v, -1, 15, 3, soulCore); cube(v, 1, 15, 3, soulCore);
      box3(v, -1, 1, 17, 18, -1, 0, robeHi);           // высокий сломанный колпак
      cube(v, 1, 19, -1, robeHi);
    }),
    children: []
  };
  const upperArmL: PartNode = {
    name: 'upperArmL', pivot: [-2, 11, 0],
    voxels: mk((v) => { box3(v, -4, -3, 8, 11, 0, 1, robe); }),
    children: []
  };
  const upperArmR: PartNode = {
    name: 'upperArmR', pivot: [2, 11, 0],
    voxels: mk((v) => { box3(v, 3, 4, 8, 11, 0, 1, robe); }),
    children: []
  };
  const forearmL: PartNode = {
    name: 'forearmL', pivot: [-2, 9, 0],
    voxels: mk((v) => { box3(v, -4, -3, 6, 8, 0, 1, robeHi); }),
    children: []
  };
  const forearmR: PartNode = {
    name: 'forearmR', pivot: [2, 9, 0],
    voxels: mk((v) => {
      box3(v, 3, 4, 6, 8, 0, 1, robeHi);
      box3(v, 5, 5, 4, 15, 1, 1, boneDark);            // длинный костяной посох
      box3(v, 4, 6, 15, 15, 1, 1, bone);               // перекладина-фонарь
      cube(v, 4, 16, 1, bone); cube(v, 6, 16, 1, bone);
      box3(v, 5, 5, 16, 18, 1, 1, soul);               // зелёное пламя
      cube(v, 5, 19, 1, soulCore);
    }),
    children: []
  };
  const thighL: PartNode = {
    name: 'thighL', pivot: [-1, 5, 0],
    voxels: mk((v) => { box3(v, -2, -1, 2, 5, 0, 1, robe); }),
    children: []
  };
  const thighR: PartNode = {
    name: 'thighR', pivot: [1, 5, 0],
    voxels: mk((v) => { box3(v, 1, 2, 2, 5, 0, 1, robe); }),
    children: []
  };
  const shinL: PartNode = {
    name: 'shinL', pivot: [-1, 3, 0],
    voxels: mk((v) => { box3(v, -2, -1, 0, 2, 0, 1, boneDark); }),
    children: []
  };
  const shinR: PartNode = {
    name: 'shinR', pivot: [1, 3, 0],
    voxels: mk((v) => { box3(v, 1, 2, 0, 2, 0, 1, boneDark); }),
    children: []
  };
  hips.children.push(spine);
  spine.children.push(head, upperArmL, upperArmR);
  upperArmL.children.push(forearmL);
  upperArmR.children.push(forearmR);
  hips.children.push(thighL, thighR);
  thighL.children.push(shinL);
  thighR.children.push(shinR);
  return { name: 'mage', root: hips, animKind: 'humanoid' };
}

/** Командир-некромант — увеличенный маг с короной и двойным посохом (кастует). */
export function commanderRigged(): CharacterDef {
  const sd = PALETTE.stoneDark, sl = PALETTE.stoneLight, bo = PALETTE.bone, bd = PALETTE.boneDark;
  const ar = ACCENT.arcane, arc = ACCENT.arcaneCore, bl = ACCENT.blood, g = ACCENT.gold;

  const hips: PartNode = {
    name: 'hips', pivot: [0, 6, 0],
    voxels: mk((v) => {
      box3(v, -3, 3, 0, 6, 0, 1, shade(sd, 0.6));      // широкий подол плаща
      box3(v, -2, 2, 3, 4, 0, 1, sl);
    }),
    children: []
  };
  const spine: PartNode = {
    name: 'spine', pivot: [0, 9, 0],
    voxels: mk((v) => {
      box3(v, -3, 3, 7, 12, 0, 1, sl);
      box3(v, -3, 3, 12, 13, 0, 1, shade(sd, 0.75));
      cube(v, -2, 10, 1, ar); cube(v, 0, 10, 1, ar); cube(v, 2, 10, 1, ar); // рунный пояс
    }),
    children: []
  };
  const head: PartNode = {
    name: 'head', pivot: [0, 13, 0],
    voxels: mk((v) => {
      box3(v, -2, 2, 13, 17, 0, 1, sd);                // крупный капюшон
      box3(v, -1, 1, 14, 15, 1, 1, PALETTE.metalDark);
      box3(v, -2, 2, 18, 18, 0, 0, bo); box3(v, -1, 1, 18, 18, 0, 0, bo); box3(v, 1, 2, 18, 18, 0, 0, bo); // корона
      cube(v, -1, 19, 0, g); cube(v, 1, 19, 0, g);
      cube(v, -1, 15, 1, arc); cube(v, 1, 15, 1, arc); // горящие глаза
    }),
    children: []
  };
  const upperArmL: PartNode = {
    name: 'upperArmL', pivot: [-3, 12, 0],
    voxels: mk((v) => { box3(v, -4, -3, 8, 11, 0, 0, shade(sd, 0.7)); }),
    children: []
  };
  const upperArmR: PartNode = {
    name: 'upperArmR', pivot: [3, 12, 0],
    voxels: mk((v) => { box3(v, 3, 4, 8, 11, 0, 0, shade(sd, 0.7)); }),
    children: []
  };
  const forearmL: PartNode = {
    name: 'forearmL', pivot: [-3, 9, 0],
    voxels: mk((v) => { box3(v, -4, -3, 6, 8, 0, 0, shade(sd, 0.7)); }),
    children: []
  };
  const forearmR: PartNode = {
    name: 'forearmR', pivot: [3, 9, 0],
    voxels: mk((v) => {
      box3(v, 3, 4, 6, 8, 0, 0, shade(sd, 0.7));
      // посох-жезл с двумя кристаллами (поднимается при касте)
      box3(v, 4, 4, 5, 15, 1, 1, bd);
      box3(v, 3, 5, 16, 17, 0, 2, ar);
      cube(v, 4, 17, 1, arc);
      cube(v, 4, 10, 1, bl);                           // кровавый кристалл
    }),
    children: []
  };
  const thighL: PartNode = {
    name: 'thighL', pivot: [-1, 5, 0],
    voxels: mk((v) => { box3(v, -1, -1, 3, 5, 0, 1, shade(sd, 0.6)); }),
    children: []
  };
  const thighR: PartNode = {
    name: 'thighR', pivot: [1, 5, 0],
    voxels: mk((v) => { box3(v, 1, 1, 3, 5, 0, 1, shade(sd, 0.6)); }),
    children: []
  };
  const shinL: PartNode = {
    name: 'shinL', pivot: [-1, 3, 0],
    voxels: mk((v) => { box3(v, -1, -1, 0, 2, 0, 1, shade(sd, 0.6)); }),
    children: []
  };
  const shinR: PartNode = {
    name: 'shinR', pivot: [1, 3, 0],
    voxels: mk((v) => { box3(v, 1, 1, 0, 2, 0, 1, shade(sd, 0.6)); }),
    children: []
  };
  hips.children.push(spine);
  spine.children.push(head, upperArmL, upperArmR);
  upperArmL.children.push(forearmL);
  upperArmR.children.push(forearmR);
  hips.children.push(thighL, thighR);
  thighL.children.push(shinL);
  thighR.children.push(shinR);
  return { name: 'commander', root: hips, animKind: 'humanoid' };
}

/**
 * Worker (M8-fix) — крестьянин-рабочий: добывает ресурсы, строит здания.
 *
 * Раньше у `unit:worker` НЕ было ни rigged-дефа, ни voxel-билдера, ни glTF →
 * resolveUnitDef возвращал пустой риг без мешей → workers были невидимы на сцене
 * (на минимапе видны, т.к. минимап читает col/row из сима). Этот риг закрывает дыру.
 *
 * Простой гуманоид в тунике с капюшоном, держит кирку в правой руке (forearmR),
 * чтобы анимация walk-cycle и swing смотрелись осмысленно. animKind 'humanoid'
 * → общий walk-cycle из RiggedUnitRenderer.
 */
export function workerRigged(): CharacterDef {
  // Workers are the first units visible in the RTS showcase. Lift the shared
  // dark-fantasy palette locally so their hood, pack and tool read at RTS zoom.
  const f = shade(PALETTE.flesh, 1.35), fd = shade(PALETTE.fleshDark, 1.35);
  const w = shade(PALETTE.wood, 1.65), wd = shade(PALETTE.woodDark, 1.5), wl = shade(PALETTE.woodLight, 1.45);
  const m = shade(PALETTE.metal, 1.35), md = shade(PALETTE.metalDark, 1.4);
  const e = ACCENT.soul;

  const hips: PartNode = {
    name: 'hips', pivot: [0, 7, 0],
    voxels: mk((v) => {
      box3(v, -2, 2, 7, 12, 0, 1, shade(w, 0.85));
      box3(v, -2, 2, 7, 8, 2, 2, wd);                  // tool belt
      cube(v, -2, 8, 3, m); cube(v, 2, 8, 3, m);       // belt tools
    }),
    children: []
  };
  const spine: PartNode = {
    name: 'spine', pivot: [0, 10, 0],
    voxels: mk((v) => {
      box3(v, -2, 2, 10, 13, 0, 1, shade(w, 0.9));       // лиф туники
      box3(v, -2, 2, 8, 9, 0, 1, shade(wd, 0.9));         // ремень
      box3(v, -2, 2, 9, 12, -2, -1, wd);                // supply pack
      box3(v, -1, 1, 10, 11, -3, -3, wl);               // rolled blanket
    }),
    children: []
  };
  const head: PartNode = {
    name: 'head', pivot: [0, 14, 0],
    voxels: mk((v) => {
      box3(v, -2, 2, 14, 15, 0, 1, f);                   // лицо
      box3(v, -2, 2, 15, 16, -1, 1, wd); box3(v, -2, 2, 15, 16, 1, 2, wd); // капюшон
      cube(v, -1, 14, 1, e); cube(v, 1, 14, 1, e);       // глаза
      box3(v, -2, 2, 13, 13, 1, 1, wl);                  // scarf
    }),
    children: []
  };
  const upperArmL: PartNode = {
    name: 'upperArmL', pivot: [-2, 12, 0],
    voxels: mk((v) => { box3(v, -3, -2, 12, 13, 0, 0, fd); }),
    children: []
  };
  const upperArmR: PartNode = {
    name: 'upperArmR', pivot: [2, 12, 0],
    voxels: mk((v) => { box3(v, 2, 3, 12, 13, 0, 0, fd); }),
    children: []
  };
  // Левая рука — просто кисть (опора при работе).
  const forearmL: PartNode = {
    name: 'forearmL', pivot: [-2, 12, 0],
    voxels: mk((v) => { box3(v, -3, -2, 13, 14, 0, 0, fd); }),
    children: []
  };
  // Правая рука — держит кирку (обух в forearmR, качается при swing/walk).
  const forearmR: PartNode = {
    name: 'forearmR', pivot: [2, 12, 0],
    voxels: mk((v) => {
      box3(v, 2, 3, 13, 14, 0, 0, fd);
      // древко кирки
      box3(v, 3, 3, 8, 15, 1, 1, wl);
      // металлическая головка кирки (двусторонняя)
      box3(v, 2, 4, 8, 9, 0, 2, md);
      cube(v, 1, 8, 1, m); cube(v, 5, 8, 1, m);
    }),
    children: []
  };
  const thighL: PartNode = {
    name: 'thighL', pivot: [-1, 6, 0],
    voxels: mk((v) => { box3(v, -2, -1, 2, 6, 0, 0, shade(wd, 0.9)); }),
    children: []
  };
  const thighR: PartNode = {
    name: 'thighR', pivot: [1, 6, 0],
    voxels: mk((v) => { box3(v, 1, 2, 2, 6, 0, 0, shade(wd, 0.9)); }),
    children: []
  };
  const shinL: PartNode = {
    name: 'shinL', pivot: [-1, 2, 0],
    voxels: mk((v) => { box3(v, -2, -1, 0, 1, 0, 1, fd); }),
    children: []
  };
  const shinR: PartNode = {
    name: 'shinR', pivot: [1, 2, 0],
    voxels: mk((v) => { box3(v, 1, 2, 0, 1, 0, 1, fd); }),
    children: []
  };
  hips.children.push(spine);
  spine.children.push(head, upperArmL, upperArmR);
  upperArmL.children.push(forearmL);
  upperArmR.children.push(forearmR);
  hips.children.push(thighL, thighR);
  thighL.children.push(shinL);
  thighR.children.push(shinR);
  return { name: 'worker', root: hips, animKind: 'humanoid' };
}

/** Реестр rigged-дефов RTS-юнитов (M2). */
export const UNIT_RIGS: Record<string, () => CharacterDef> = {
  'unit:knight': knightRigged,
  'unit:archer': archerRigged,
  'unit:mage': mageRigged,
  'unit:commander': commanderRigged,
  'unit:worker': workerRigged
};
