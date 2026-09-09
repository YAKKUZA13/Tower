/**
 * Procedural voxel model builders.
 *
 * Voxel = one unit-cube in integer grid (center at (x,y,z)∈ℤ, size 1).
 * Model = set of such cubes, each with its own color.
 *
 * Authoring model written in "coarse" integer coordinates (Y up, feet at
 * y=0; X — width; Z — depth, face in +Z).
 *
 * Extracted from voxel-builder.ts — zero Babylon.js/Vue dependencies.
 */
import { ACCENT, PALETTE, desaturate, shade } from './dark-palette.js';
import type { RGB } from './dark-palette.js';
import { box3, cube } from './voxel-helpers.js';
import type { Voxel } from './types.js';

// ── Model definitions. Coordinates — integer grid (unit-cubes).
//    Humanoids: width X (− left, + right), face in +Z, feet y=0, height ~16–20.

/** Skeleton — bone humanoid with ribs, skull and rusty sword. */
export function skeletonEnemy(): Voxel[] {
  const v: Voxel[] = [];
  const bo = PALETTE.bone, bod = PALETTE.boneDark;
  const e = ACCENT.eyeRed, sw = PALETTE.metalLight, wd = PALETTE.woodDark;
  // legs
  box3(v, -2, -1, 0, 1, 0, 1, bod);   box3(v, 1, 2, 0, 1, 0, 1, bod);   // feet
  box3(v, -1, -1, 2, 5, 0, 0, bod);   box3(v, 1, 1, 2, 5, 0, 0, bod);   // shins
  cube(v, -1, 6, 0, bo);              cube(v, 1, 6, 0, bo);             // knees
  box3(v, -1, -1, 7, 8, 0, 0, bod);   box3(v, 1, 1, 7, 8, 0, 0, bod);   // thighs
  // pelvis
  box3(v, -2, 2, 9, 10, 0, 1, bod);
  // spine + ribs
  box3(v, -1, 0, 11, 14, 0, 0, bo);
  box3(v, -2, -1, 12, 12, 0, 0, bo);  box3(v, 1, 2, 12, 12, 0, 0, bo);
  box3(v, -2, -1, 13, 13, 0, 0, bo);  box3(v, 1, 2, 13, 13, 0, 0, bo);
  box3(v, -2, -2, 11, 11, 0, 0, bo);  box3(v, 2, 3, 11, 11, 0, 0, bo);  // lower ribs
  // shoulders + arms
  box3(v, -2, 2, 14, 14, 0, 1, bo);                                     // collar bones
  box3(v, -3, -2, 10, 13, 0, 0, bod); box3(v, 2, 3, 10, 13, 0, 0, bod); // upper arms
  box3(v, -3, -2, 7, 9, 0, 0, bod);  box3(v, 2, 3, 7, 9, 0, 0, bod);    // forearms
  cube(v, -3, 6, 0, bo);             cube(v, 3, 6, 0, bo);              // hands
  // skull
  box3(v, -2, 2, 15, 18, -1, 1, bo);
  box3(v, -1, 1, 19, 19, 0, 0, bo);                                     // crown
  cube(v, -1, 17, 1, e);             cube(v, 1, 17, 1, e);              // eye sockets
  cube(v, 0, 16, 1, bod);                                               // nose hole
  box3(v, -1, 1, 14, 14, 0, 1, bod);                                    // teeth (dark stripe)
  // rusty sword in right hand
  cube(v, 3, 6, 1, wd);
  box3(v, 3, 3, 7, 12, 1, 1, sw);
  cube(v, 3, 13, 1, ACCENT.gold);
  return v;
}

/** Goblin — hunched, green, long arms, big ears, club. */
export function goblinEnemy(): Voxel[] {
  const v: Voxel[] = [];
  const f = PALETTE.flesh, fd = PALETTE.fleshDark, mo = PALETTE.moss;
  const e = ACCENT.eyeDemon, wd = PALETTE.woodDark;
  // short crooked legs
  box3(v, -2, -1, 0, 1, 0, 1, fd);  box3(v, 1, 2, 0, 1, 0, 1, fd);
  box3(v, -1, -1, 2, 4, 0, 0, fd);  box3(v, 1, 1, 2, 4, 0, 0, fd);
  // pelvis + hunched torso (upper layers shifted forward +Z — stoop)
  box3(v, -2, 2, 5, 6, 0, 1, mo);
  box3(v, -2, 2, 7, 9, 0, 1, f);
  box3(v, -1, 2, 10, 12, 1, 2, f);
  // long arms to ground
  box3(v, -3, -3, 6, 11, 0, 0, fd); box3(v, 2, 3, 6, 11, 0, 0, fd);
  cube(v, -3, 5, 0, fd);            cube(v, 3, 5, 0, fd);
  // head (large, forward)
  box3(v, -2, 2, 11, 14, 1, 2, f);
  // big ears
  box3(v, -3, -3, 12, 13, 1, 1, fd); box3(v, 2, 3, 12, 13, 1, 1, fd);
  cube(v, 0, 12, 3, fd);                                               // beak-nose
  cube(v, -1, 13, 2, e);            cube(v, 1, 13, 2, e);              // eyes
  // club in right hand
  cube(v, 3, 5, 1, wd);
  box3(v, 3, 3, 6, 9, 1, 1, wd);
  cube(v, 3, 10, 1, wd);
  return v;
}

/** Zombie — rotten torso, one arm longer, torn flesh. */
export function zombieEnemy(): Voxel[] {
  const v: Voxel[] = [];
  const f = PALETTE.fleshDark, fd = shade(PALETTE.fleshDark, 0.7), fl = shade(PALETTE.fleshDark, 1.15);
  const e = ACCENT.eyeRed;
  // legs (one shorter — limp)
  box3(v, -2, -1, 0, 1, 0, 1, fd);  box3(v, 1, 2, 0, 1, 0, 1, fd);
  box3(v, -1, -1, 2, 6, 0, 0, fd);  box3(v, 1, 1, 2, 5, 0, 0, fd);
  // pelvis + swollen belly
  box3(v, -2, 2, 7, 8, 0, 1, fd);
  box3(v, -2, 2, 9, 13, 0, 1, f);
  cube(v, 0, 11, 1, fd);                                               // belly hole
  // left arm (normal), right (longer, reaching forward)
  box3(v, -3, -3, 9, 13, 0, 0, fd);
  box3(v, 2, 3, 9, 14, 1, 1, fd);                                      // extended arm
  box3(v, 2, 3, 15, 16, 1, 1, fl);                                     // hand (lighter)
  cube(v, -3, 8, 0, fd);
  // head (askew)
  box3(v, -1, 3, 14, 17, 0, 1, fl);
  cube(v, -2, 15, 1, f);            cube(v, 2, 15, 1, f);              // eyes (dull)
  cube(v, -2, 15, 1, e);            cube(v, 2, 15, 1, e);
  box3(v, -1, 2, 17, 17, 0, 1, fd);                                    // hair/rot
  cube(v, 1, 16, 1, fd);                                               // open mouth
  return v;
}

/** Demon — large, horned, dark crimson, claws. */
export function demonEnemy(): Voxel[] {
  const v: Voxel[] = [];
  const sk = PALETTE.metalDark, bl = ACCENT.blood, bls = shade(ACCENT.blood, 0.55);
  const e = ACCENT.eyeDemon;
  // massive legs (hind, bent)
  box3(v, -3, -1, 0, 1, 0, 2, sk);  box3(v, 1, 3, 0, 1, 0, 2, sk);
  box3(v, -3, -2, 2, 6, 0, 1, sk);  box3(v, 2, 3, 2, 6, 0, 1, sk);
  box3(v, -3, -1, 7, 8, 0, 0, sk);  box3(v, 1, 2, 7, 8, 0, 0, sk);     // feet-claws forward
  // barrel torso
  box3(v, -3, 3, 9, 14, 0, 1, bls);
  box3(v, -2, 2, 9, 14, 2, 2, sk);
  cube(v, 0, 12, 1, bl);            cube(v, 0, 13, 1, bl);             // chest scars
  // massive shoulders + arms (long, with claws)
  box3(v, -4, -3, 11, 13, 0, 1, sk); box3(v, 2, 4, 11, 13, 0, 1, sk);
  box3(v, -4, -3, 8, 10, 0, 0, sk); box3(v, 3, 4, 8, 10, 0, 0, sk);
  cube(v, -4, 7, 0, e);             cube(v, 4, 7, 0, e);               // claw-light
  // head
  box3(v, -2, 2, 15, 18, 0, 1, bls);
  box3(v, -1, 2, 19, 19, 0, 1, bls);                                   // forehead/nose
  cube(v, -1, 17, 1, e);            cube(v, 1, 17, 1, e);              // eyes
  box3(v, -1, 1, 15, 15, 1, 1, bl);                                    // maw/fangs
  // horns
  box3(v, -3, -2, 18, 20, 0, 0, PALETTE.boneDark); box3(v, 2, 3, 18, 20, 0, 0, PALETTE.boneDark);
  cube(v, -3, 21, 0, PALETTE.bone); cube(v, 3, 21, 0, PALETTE.bone);    // horn tips
  return v;
}

/** Lord (boss) — huge dark lord with large horns and magic. */
export function bossEnemy(): Voxel[] {
  const v: Voxel[] = [];
  const sd = PALETTE.stoneDark, bl = ACCENT.blood, bls = shade(ACCENT.blood, 0.4);
  const ar = ACCENT.arcane, e = ACCENT.eyeDemon;
  // huge legs
  box3(v, -4, -2, 0, 1, 0, 2, sd);  box3(v, 2, 4, 0, 1, 0, 2, sd);
  box3(v, -4, -2, 2, 8, 0, 1, sd);  box3(v, 2, 4, 2, 8, 0, 1, sd);
  // massive torso (cloak widens downward)
  box3(v, -4, 4, 9, 16, -1, 2, bls);
  box3(v, -3, 3, 9, 16, 2, 3, sd);
  box3(v, -5, 5, 9, 12, -1, 2, shade(sd, 0.8));                        // shoulder pauldrons
  box3(v, -5, 5, 13, 16, 0, 1, sd);                                    // cloak sleeves
  // arms
  box3(v, -6, -5, 11, 16, 0, 1, shade(sd, 0.8)); box3(v, 4, 6, 11, 16, 0, 1, shade(sd, 0.8));
  cube(v, -6, 10, 0, bl);           cube(v, 6, 10, 0, bl);             // claws
  // head
  box3(v, -3, 3, 17, 21, 0, 1, bls);
  box3(v, -2, 2, 22, 22, 0, 1, bls);
  cube(v, -2, 19, 1, e);            cube(v, 2, 19, 1, e);              // burning eyes
  box3(v, -1, 2, 17, 17, 1, 1, ar);                                    // glowing maw
  cube(v, 0, 20, 1, ar);                                               // forehead rune
  // large horns (curved)
  box3(v, -4, -3, 19, 23, 0, 0, PALETTE.boneDark); box3(v, 3, 4, 19, 23, 0, 0, PALETTE.boneDark);
  box3(v, -5, -4, 23, 25, 0, 0, PALETTE.boneDark); box3(v, 4, 5, 23, 25, 0, 0, PALETTE.boneDark);
  cube(v, -5, 26, 0, PALETTE.bone); cube(v, 5, 26, 0, PALETTE.bone);
  return v;
}

/** Slime — low, wide, trembling; acid-green with purple speckles. */
export function slimeEnemy(): Voxel[] {
  const v: Voxel[] = [];
  const base = shade(PALETTE.moss, 0.85);
  const dark = shade(base, 0.6);
  const light = shade(base, 1.3);
  const ar = ACCENT.arcane;
  box3(v, -3, 3, 0, 0, -2, 2, dark);
  box3(v, -4, 4, 1, 1, -3, 3, base);
  box3(v, -3, 3, 2, 2, -2, 2, light);
  box3(v, -2, 2, 3, 3, -1, 1, light);
  cube(v, 0, 4, 0, light);
  cube(v, -1, 4, 1, light); cube(v, 1, 4, 1, light);
  cube(v, -2, 2, 3, ar); cube(v, 2, 2, 3, ar);
  cube(v, -4, 0, 2, dark); cube(v, 4, 0, -2, dark);
  cube(v, 0, 0, 3, dark); cube(v, 0, 0, -3, dark);
  return v;
}

/** Bat — small, winged; flies (flies=true in catalog). */
export function batEnemy(): Voxel[] {
  const v: Voxel[] = [];
  const sk = PALETTE.metalDark, skd = shade(PALETTE.metalDark, 0.6);
  const e = ACCENT.eyeRed, fl = shade(PALETTE.metalDark, 1.4);
  box3(v, -1, 1, 2, 4, -1, 1, sk);
  cube(v, 0, 5, 0, sk);
  cube(v, 0, 6, 0, skd);
  cube(v, -1, 6, 0, skd); cube(v, 1, 6, 0, skd);
  cube(v, -1, 5, 1, e); cube(v, 1, 5, 1, e);
  box3(v, -2, -3, 1, 2, 0, 1, fl);
  box3(v, -5, -4, 1, 1, 1, 1, fl);
  cube(v, -6, 1, 1, fl); cube(v, -7, 1, 1, fl);
  box3(v, 2, 3, 1, 2, 0, 1, fl);
  box3(v, 4, 5, 1, 1, 1, 1, fl);
  cube(v, 6, 1, 1, fl); cube(v, 7, 1, 1, fl);
  cube(v, 0, 1, -1, skd); cube(v, -1, 0, -1, skd); cube(v, 1, 0, -1, skd);
  return v;
}

/** Spider — compact body + 8 legs; dark, with red eyes. */
export function spiderEnemy(): Voxel[] {
  const v: Voxel[] = [];
  const sk = PALETTE.metalDark, skd = shade(PALETTE.metalDark, 0.65);
  const e = ACCENT.eyeRed;
  box3(v, -2, 2, 1, 4, -2, 2, sk);
  box3(v, -2, 2, 5, 6, -2, 2, skd);
  cube(v, 0, 7, 0, skd);
  box3(v, -1, 1, -1, 1, -1, 1, sk);
  cube(v, -1, 0, 0, e); cube(v, 1, 0, 0, e);
  cube(v, -2, 0, 0, e); cube(v, 2, 0, 0, e);
  cube(v, -1, 1, 0, e); cube(v, 1, 1, 0, e);
  box3(v, -3, -2, 1, 1, 0, 0, skd); box3(v, -5, -4, 1, 1, 0, 0, skd);
  box3(v, -3, -2, 3, 3, 0, 0, skd); box3(v, -5, -4, 3, 3, 0, 0, skd);
  box3(v, -3, -2, 5, 5, 0, 0, skd); box3(v, -5, -4, 5, 5, 0, 0, skd);
  box3(v, -3, -2, 7, 7, 0, 0, skd); box3(v, -5, -4, 7, 7, 0, 0, skd);
  box3(v, 2, 3, 1, 1, 0, 0, skd); box3(v, 4, 5, 1, 1, 0, 0, skd);
  box3(v, 2, 3, 3, 3, 0, 0, skd); box3(v, 4, 5, 3, 3, 0, 0, skd);
  box3(v, 2, 3, 5, 5, 0, 0, skd); box3(v, 4, 5, 5, 5, 0, 0, skd);
  box3(v, 2, 3, 7, 7, 0, 0, skd); box3(v, 4, 5, 7, 7, 0, 0, skd);
  return v;
}

/** Ghost — hovering, legless, semi-transparent; pale blue with dark eyes. */
export function ghostEnemy(): Voxel[] {
  const v: Voxel[] = [];
  const body = desaturate([0.55, 0.62, 0.72], 0.18);
  const dark = shade(body, 0.55);
  const light = shade(body, 1.25);
  const e = ACCENT.soul;
  box3(v, -2, 2, 6, 8, -1, 1, light);
  box3(v, -3, 3, 4, 5, -1, 1, body);
  cube(v, 0, 8, 0, light); cube(v, -1, 8, 0, light); cube(v, 1, 8, 0, light);
  box3(v, -1, 1, 4, 5, 0, 1, PALETTE.metalDark);
  cube(v, -1, 5, 2, e); cube(v, 1, 5, 2, e);
  cube(v, 0, 4, 2, dark);
  box3(v, -3, 3, 1, 3, -1, 1, body);
  box3(v, -2, 2, 0, 0, -1, 1, dark);
  cube(v, -2, 0, 0, dark); cube(v, 0, 0, 0, dark); cube(v, 2, 0, 0, dark);
  cube(v, -3, 0, 1, dark); cube(v, 3, 0, 1, dark);
  box3(v, -4, -4, 2, 4, 0, 0, light);
  box3(v, 3, 4, 2, 4, 0, 0, light);
  return v;
}

/** Archer — wooden watchtower: 4 corner posts, platform, railings, sharp roof, torch. */
export function arrowTower(): Voxel[] {
  const v: Voxel[] = [];
  const w = PALETTE.wood, wd = PALETTE.woodDark, wl = PALETTE.woodLight;
  box3(v, -4, -3, 0, 14, -3, -3, wd); box3(v, 3, 4, 0, 14, -3, -3, wd);
  box3(v, -4, -3, 0, 14, 3, 3, wd);  box3(v, 3, 4, 0, 14, 3, 3, wd);
  box3(v, -4, 4, 5, 5, -3, 3, w);    box3(v, -4, 4, 10, 10, -3, 3, w);
  box3(v, -4, 4, 14, 15, -3, 3, wl);
  box3(v, -4, -4, 16, 18, -3, -3, w); box3(v, 3, 4, 16, 18, -3, -3, w);
  box3(v, -4, -4, 16, 18, 3, 3, w);   box3(v, 3, 4, 16, 18, 3, 3, w);
  cube(v, -2, 17, -3, w); cube(v, 0, 17, -3, w); cube(v, 2, 17, -3, w);
  box3(v, -4, 4, 19, 19, -3, 3, shade(wd, 0.85));
  box3(v, -3, 3, 20, 20, -3, 3, shade(wd, 0.85));
  box3(v, -2, 2, 21, 21, -2, 2, shade(wd, 0.85));
  box3(v, -1, 1, 22, 22, -1, 1, shade(wd, 0.8));
  cube(v, 0, 23, 0, ACCENT.gold);
  cube(v, 4, 12, -3, wd);
  cube(v, 4, 14, -3, ACCENT.fireCore);
  cube(v, 4, 15, -3, ACCENT.fire);
  return v;
}

/** Siege — stone fortress with black cannon. */
export function cannonTower(): Voxel[] {
  const v: Voxel[] = [];
  const s = PALETTE.stone, sd = PALETTE.stoneDark, sl = PALETTE.stoneLight;
  const md = PALETTE.metalDark, m = PALETTE.metal;
  box3(v, -5, 5, 0, 4, -4, 4, sd);
  box3(v, -4, 4, 4, 8, -4, 4, s);
  box3(v, -4, 4, 5, 5, -4, 4, shade(s, 0.9));
  box3(v, -4, 4, 7, 7, -4, 4, shade(s, 0.9));
  box3(v, -5, -4, 9, 11, -4, -4, sl); box3(v, -1, 0, 9, 11, -4, -4, sl); box3(v, 3, 5, 9, 11, -4, -4, sl);
  box3(v, -5, -4, 9, 11, 4, 4, sl);   box3(v, -1, 0, 9, 11, 4, 4, sl);   box3(v, 3, 5, 9, 11, 4, 4, sl);
  box3(v, -5, -5, 9, 11, -1, -1, sl); box3(v, 3, 5, 9, 11, -1, -1, sl);
  box3(v, -5, -5, 9, 11, 1, 1, sl);   box3(v, 3, 5, 9, 11, 1, 1, sl);
  box3(v, -1, 1, 6, 11, 3, 4, md);
  box3(v, -2, 2, 4, 6, 2, 5, m);
  cube(v, 0, 8, 4, ACCENT.fireCore); cube(v, 0, 9, 4, ACCENT.fireCore);
  cube(v, -2, 5, 4, sd); cube(v, 2, 5, 4, sd); cube(v, -2, 5, -4, sd); cube(v, 2, 5, -4, sd);
  return v;
}

/** Arcane — dark obelisk with glowing crystal and runes. */
export function arcaneTower(): Voxel[] {
  const v: Voxel[] = [];
  const sd = PALETTE.stoneDark, sl = PALETTE.stoneLight;
  const ar = ACCENT.arcane, arc = ACCENT.arcaneCore;
  box3(v, -4, 4, 0, 3, -4, 4, sd);
  box3(v, -3, 3, 3, 5, -3, 3, sl);
  box3(v, -3, 3, 6, 10, -3, 3, sd);
  box3(v, -3, 3, 6, 10, -3, 3, sl);
  box3(v, -2, 2, 6, 9, -2, 2, sd);
  box3(v, -2, 2, 11, 14, -2, 2, sl);
  box3(v, -1, 1, 11, 13, -1, 1, sd);
  box3(v, -1, 1, 15, 17, -1, 1, sl);
  cube(v, 0, 8, 3, ar); cube(v, 0, 11, 3, ar); cube(v, 0, 14, 3, ar);
  cube(v, -3, 8, 0, ar); cube(v, 3, 11, 0, ar);
  box3(v, -1, 1, 18, 18, -1, 1, ar);
  cube(v, 0, 19, 0, ar); cube(v, 0, 17, 0, ar);
  cube(v, -1, 18, 0, ar); cube(v, 1, 18, 0, ar); cube(v, 0, 18, -1, ar); cube(v, 0, 18, 1, ar);
  cube(v, 0, 20, 0, arc); cube(v, 0, 16, 0, arc);
  return v;
}

/** Ice — iced spire with ice crystal and icicles. */
export function iceTower(): Voxel[] {
  const v: Voxel[] = [];
  const s = PALETTE.stoneLight, sd = PALETTE.stoneDark;
  const ic = ACCENT.ice, icc = ACCENT.iceCore;
  box3(v, -4, 4, 0, 3, -4, 4, sd);
  box3(v, -3, 3, 3, 5, -3, 3, s);
  box3(v, -3, 3, 6, 9, -3, 3, s);
  box3(v, -2, 2, 10, 13, -2, 2, shade(s, 0.92));
  box3(v, -1, 1, 14, 16, -1, 1, shade(s, 0.85));
  box3(v, -4, -4, 6, 7, 0, 0, ic); box3(v, 3, 4, 6, 8, 0, 0, ic);
  box3(v, 0, 0, 6, 7, -4, -4, ic); box3(v, 0, 0, 6, 8, 3, 4, ic);
  box3(v, -1, 1, 17, 17, -1, 1, ic);
  cube(v, 0, 18, 0, ic);
  cube(v, -1, 17, 0, ic); cube(v, 1, 17, 0, ic); cube(v, 0, 17, -1, ic); cube(v, 0, 17, 1, ic);
  cube(v, 0, 19, 0, icc); cube(v, 0, 16, 0, icc);
  return v;
}

/** Base — altar with soul-crystal. */
export function baseAltar(): Voxel[] {
  const v: Voxel[] = [];
  const sd = PALETTE.stoneDark, s = PALETTE.stone;
  const so = ACCENT.soul, icc = ACCENT.iceCore, g = ACCENT.gold;
  box3(v, -5, 5, 0, 2, -5, 5, sd);
  box3(v, -4, 4, 2, 3, -4, 4, s);
  box3(v, -3, 3, 3, 4, -3, 3, shade(s, 0.92));
  cube(v, -4, 1, -4, g); cube(v, 4, 1, -4, g); cube(v, -4, 1, 4, g); cube(v, 4, 1, 4, g);
  cube(v, -4, 2, -4, g); cube(v, 4, 2, -4, g); cube(v, -4, 2, 4, g); cube(v, 4, 2, 4, g);
  box3(v, -3, -3, 4, 9, -3, -3, sd); box3(v, 3, 3, 4, 9, -3, -3, sd);
  box3(v, -3, -3, 4, 9, 3, 3, sd);   box3(v, 3, 3, 4, 9, 3, 3, sd);
  box3(v, -2, 2, 5, 10, -2, 2, so);
  cube(v, 0, 11, 0, so); cube(v, 0, 4, 0, so);
  cube(v, -3, 7, 0, so); cube(v, 3, 7, 0, so); cube(v, 0, 7, -3, so); cube(v, 0, 7, 3, so);
  cube(v, 0, 8, 0, icc); cube(v, 0, 6, 0, icc);
  return v;
}

/** Spawn — dark portal with fire core. */
export function spawnPortal(): Voxel[] {
  const v: Voxel[] = [];
  const sd = PALETTE.stoneDark, s = PALETTE.stone;
  const fi = ACCENT.fire, fic = ACCENT.fireCore, bl = ACCENT.blood;
  box3(v, -5, 5, 0, 2, -3, 3, sd);
  box3(v, -4, 4, 2, 3, -3, 3, s);
  box3(v, -4, -3, 3, 12, -2, -2, shade(sd, 0.8)); box3(v, 3, 4, 3, 12, -2, -2, shade(sd, 0.8));
  box3(v, -4, -3, 3, 12, 2, 2, shade(sd, 0.8));   box3(v, 3, 4, 3, 12, 2, 2, shade(sd, 0.8));
  box3(v, -3, 3, 13, 14, -2, 2, shade(sd, 0.7));
  box3(v, -2, 2, 15, 15, -1, 1, shade(sd, 0.7));
  box3(v, -2, 2, 5, 12, -1, 1, fi);
  box3(v, -1, 1, 6, 11, 0, 0, fic);
  cube(v, -2, 1, 3, bl); cube(v, 0, 1, 3, bl); cube(v, 2, 1, 3, bl);
  return v;
}

/** Projectile — short bolt. */
export function projectileBolt(): Voxel[] {
  const v: Voxel[] = [];
  box3(v, -1, 1, 0, 0, 0, 0, PALETTE.metalLight);
  cube(v, 2, 0, 0, ACCENT.fireCore);
  cube(v, -2, 0, 0, PALETTE.metalDark);
  return v;
}

// ── Maze walls ──────────────────────────────────────────────────────────────

/** Wood wall — palisade of logs with crossbeam. */
export function woodWall(): Voxel[] {
  const v: Voxel[] = [];
  const w = PALETTE.wood, wd = PALETTE.woodDark;
  box3(v, -3, -1, 0, 8, -2, 2, wd); box3(v, -1, 1, 0, 8, -2, 2, wd); box3(v, 1, 3, 0, 8, -2, 2, wd);
  cube(v, -2, 9, 0, shade(wd, 0.8)); cube(v, 0, 9, 0, shade(wd, 0.8)); cube(v, 2, 9, 0, shade(wd, 0.8));
  box3(v, -3, 3, 2, 3, -2, 2, w); box3(v, -3, 3, 6, 6, -2, 2, w);
  return v;
}

/** Stone wall — rough masonry of boulders. */
export function stoneWall(): Voxel[] {
  const v: Voxel[] = [];
  const s = PALETTE.stone, sd = PALETTE.stoneDark, sl = PALETTE.stoneLight;
  box3(v, -3, 3, 0, 2, -2, 2, sd);
  box3(v, -3, 3, 3, 5, -2, 2, s);
  box3(v, -3, 3, 6, 7, -2, 2, shade(s, 0.92));
  box3(v, -2, 0, 8, 9, -2, 2, sl);
  box3(v, 1, 3, 8, 9, -1, 1, shade(sl, 0.9));
  cube(v, -3, 8, 0, sd); cube(v, 3, 8, 0, sd);
  return v;
}

/** Bone wall — barricade of bones and skulls. */
export function boneWall(): Voxel[] {
  const v: Voxel[] = [];
  const bo = PALETTE.bone, bod = PALETTE.boneDark, e = ACCENT.eyeRed;
  box3(v, -3, 3, 0, 2, -2, 2, bod);
  box3(v, -3, -2, 3, 8, -1, -1, bo); box3(v, 0, 1, 3, 8, -1, -1, bo); box3(v, 2, 3, 3, 8, 1, 1, bo);
  cube(v, -3, 2, 0, bod); cube(v, 0, 2, 0, bod); cube(v, 2, 2, 0, bod);
  box3(v, -2, -1, 9, 10, -1, 1, bo);
  cube(v, -1, 9, 1, e); cube(v, 1, 9, 1, e);
  box3(v, 1, 2, 9, 10, -1, 1, shade(bo, 0.95));
  cube(v, 1, 9, 1, e); cube(v, 2, 9, 1, e);
  return v;
}

// ── Relic totems ─────────────────────────────────────────────────────────────

/** Fire totem — black obelisk with flame. */
export function relicFireTotem(): Voxel[] {
  const v: Voxel[] = [];
  const sd = PALETTE.stoneDark, s = PALETTE.stone;
  const fi = ACCENT.fire, fic = ACCENT.fireCore;
  box3(v, -3, 3, 0, 2, -3, 3, sd);
  box3(v, -2, 2, 3, 4, -2, 2, s);
  box3(v, -2, 2, 5, 8, -2, 2, sd);
  box3(v, -1, 1, 9, 11, -1, 1, s);
  box3(v, -1, 1, 12, 14, -1, 1, fi);
  cube(v, 0, 15, 0, fic); cube(v, 0, 16, 0, fic);
  cube(v, 0, 3, 2, fi);                                       // base rune
  return v;
}

/** Arcane totem — obelisk shards with purple crystal. */
export function relicArcaneTotem(): Voxel[] {
  const v: Voxel[] = [];
  const sd = PALETTE.stoneDark, sl = PALETTE.stoneLight;
  const ar = ACCENT.arcane, arc = ACCENT.arcaneCore;
  box3(v, -3, 3, 0, 2, -3, 3, sd);
  box3(v, -2, -1, 3, 10, -1, -1, sl);
  box3(v, 0, 2, 3, 9, 1, 1, sd);
  cube(v, 1, 11, 0, sl);
  box3(v, -1, 1, 12, 13, -1, 1, ar);
  cube(v, 0, 14, 0, arc); cube(v, 0, 11, 0, arc);
  return v;
}

/** Gold totem — column with rune ring and gold sphere. */
export function relicGoldTotem(): Voxel[] {
  const v: Voxel[] = [];
  const sd = PALETTE.stoneDark, s = PALETTE.stone, g = ACCENT.gold;
  box3(v, -3, 3, 0, 2, -3, 3, sd);
  box3(v, -1, 1, 3, 10, -1, 1, s);
  box3(v, -2, 2, 4, 5, -2, 2, g);
  box3(v, -2, 2, 8, 9, -2, 2, g);
  box3(v, -1, 1, 11, 13, -1, 1, g);
  cube(v, 0, 14, 0, ACCENT.fireCore);
  return v;
}

/** Ice totem — iced spire with crystal. */
export function relicIceTotem(): Voxel[] {
  const v: Voxel[] = [];
  const sd = PALETTE.stoneDark, sl = PALETTE.stoneLight;
  const ic = ACCENT.ice, icc = ACCENT.iceCore;
  box3(v, -3, 3, 0, 2, -3, 3, sd);
  box3(v, -2, 2, 3, 6, -2, 2, shade(sl, 0.92));
  box3(v, -1, 1, 7, 10, -1, 1, shade(sl, 0.85));
  box3(v, -3, -3, 4, 6, 0, 0, ic); box3(v, 3, 3, 4, 6, 0, 0, ic);
  box3(v, -1, 1, 11, 13, -1, 1, ic);
  cube(v, 0, 14, 0, icc);
  return v;
}

/** Blood totem — skulls on pillar with bloody stone. */
export function relicBloodTotem(): Voxel[] {
  const v: Voxel[] = [];
  const bo = PALETTE.bone, bod = PALETTE.boneDark, sd = PALETTE.stoneDark;
  const bl = ACCENT.blood, e = ACCENT.eyeRed;
  box3(v, -3, 3, 0, 2, -3, 3, sd);
  box3(v, -1, 1, 3, 9, -1, 1, bod);
  box3(v, -1, 1, 9, 10, -1, 1, bo);
  box3(v, -1, 1, 11, 13, -1, 1, bl);
  cube(v, 0, 11, 1, e); cube(v, 0, 12, 1, e);
  cube(v, -3, 1, 2, bo); cube(v, 3, 1, 2, bo);
  cube(v, -3, 1, 3, e); cube(v, 3, 1, 3, e);
  return v;
}

// ── RTS: production buildings ────────────────────────────────────────────────

/** Sawmill — wooden canopy with log and saw. */
export function sawmillBuilding(): Voxel[] {
  const v: Voxel[] = [];
  const w = PALETTE.wood, wd = PALETTE.woodDark, wl = PALETTE.woodLight;
  box3(v, -5, 5, 0, 2, -4, 4, PALETTE.earth);
  box3(v, -5, -4, 3, 10, -4, -4, wd); box3(v, 4, 5, 3, 10, -4, -4, wd);
  box3(v, -5, -4, 3, 10, 4, 4, wd);   box3(v, 4, 5, 3, 10, 4, 4, wd);
  box3(v, -5, 5, 11, 12, -4, 4, shade(wd, 0.85));
  box3(v, -4, 4, 13, 14, -4, 4, shade(wd, 0.8));
  box3(v, -2, 2, 15, 15, -3, 3, shade(wd, 0.75));
  box3(v, -2, 2, 3, 5, -2, 2, w);
  box3(v, -1, 1, 6, 7, 3, 3, PALETTE.metalLight);
  cube(v, 0, 6, 3, ACCENT.gold);
  cube(v, -3, 2, 3, ACCENT.fire); cube(v, -4, 2, 3, ACCENT.fire);
  void wl;
  return v;
}

/** Mine — shaft in mountain with wooden support. */
export function mineBuilding(): Voxel[] {
  const v: Voxel[] = [];
  const s = PALETTE.stone, sd = PALETTE.stoneDark, wd = PALETTE.woodDark;
  box3(v, -5, 5, 0, 3, -4, 4, sd);
  box3(v, -4, 4, 3, 6, -4, 4, s);
  box3(v, -3, 3, 6, 8, -3, 3, shade(s, 0.92));
  box3(v, -2, 2, 4, 8, -2, 2, PALETTE.metalDark);
  box3(v, -3, -3, 3, 10, -3, -3, wd); box3(v, 3, 3, 3, 10, -3, -3, wd);
  box3(v, -3, 3, 11, 11, -3, 3, wd);
  cube(v, -3, 3, 3, ACCENT.gold); cube(v, 3, 4, 3, ACCENT.gold); cube(v, 0, 5, 3, ACCENT.gold);
  cube(v, 0, 9, 3, ACCENT.fireCore);
  return v;
}

/** Smelter — stone furnace with fire maw. */
export function smelterBuilding(): Voxel[] {
  const v: Voxel[] = [];
  const s = PALETTE.stone, sd = PALETTE.stoneDark, md = PALETTE.metalDark;
  const fi = ACCENT.fire, fic = ACCENT.fireCore;
  box3(v, -5, 5, 0, 2, -4, 4, sd);
  box3(v, -4, 4, 3, 5, -4, 4, s);
  box3(v, -3, 3, 6, 9, -3, 3, shade(s, 0.88));
  box3(v, -1, 1, 10, 13, -1, 1, md);
  box3(v, -2, 2, 5, 7, -2, 2, PALETTE.metalDark);
  box3(v, -1, 1, 6, 7, 0, 0, fi);
  cube(v, 0, 7, 0, fic);
  box3(v, 4, 4, 3, 4, 3, 3, md); box3(v, 3, 5, 4, 5, 3, 3, PALETTE.metal);
  cube(v, 2, 7, 3, fic);
  return v;
}

/** Barracks — low bunker with weapons at entrance. */
export function barracksBuilding(): Voxel[] {
  const v: Voxel[] = [];
  const s = PALETTE.stone, sd = PALETTE.stoneDark, wd = PALETTE.woodDark, m = PALETTE.metal;
  box3(v, -5, 5, 0, 2, -4, 4, sd);
  box3(v, -4, 4, 3, 7, -4, 4, s);
  box3(v, -4, 4, 4, 4, -2, -2, PALETTE.metalDark); box3(v, -4, 4, 4, 4, 2, 2, PALETTE.metalDark);
  box3(v, -4, 4, 6, 6, -2, -2, PALETTE.metalDark); box3(v, -4, 4, 6, 6, 2, 2, PALETTE.metalDark);
  cube(v, -4, 8, -4, shade(sd, 0.9)); cube(v, -1, 8, -4, shade(sd, 0.9)); cube(v, 2, 8, -4, shade(sd, 0.9));
  cube(v, -4, 8, 4, shade(sd, 0.9)); cube(v, -1, 8, 4, shade(sd, 0.9)); cube(v, 2, 8, 4, shade(sd, 0.9));
  box3(v, -1, 1, 3, 5, 0, 0, PALETTE.metalDark);
  cube(v, 3, 3, 3, wd); box3(v, 3, 3, 4, 7, 3, 3, m);
  cube(v, -4, 6, 3, wd); cube(v, -4, 7, 3, ACCENT.fire);
  return v;
}

/** Town Hall L1 — central building of base: stone hall with gable roof and flag. */
export function townHallBuilding(): Voxel[] {
  const v: Voxel[] = [];
  const s = PALETTE.stone, sd = PALETTE.stoneDark, sl = PALETTE.stoneLight;
  const wd = PALETTE.woodDark, w = PALETTE.wood, wl = PALETTE.woodLight;
  const g = ACCENT.gold, fire = ACCENT.fire;
  box3(v, -6, 6, 0, 1, -5, 5, sd);
  box3(v, -5, 5, 1, 2, -4, 4, s);
  box3(v, -5, 5, 2, 8, -4, 4, s);
  box3(v, -6, -5, 2, 9, -5, -5, shade(sd, 0.92)); box3(v, 5, 6, 2, 9, -5, -5, shade(sd, 0.92));
  box3(v, -6, -5, 2, 9, 5, 5, shade(sd, 0.92));   box3(v, 5, 6, 2, 9, 5, 5, shade(sd, 0.92));
  box3(v, -5, 5, 4, 4, -3, -3, PALETTE.metalDark); box3(v, -5, 5, 4, 4, 3, 3, PALETTE.metalDark);
  box3(v, -5, 5, 6, 6, -3, -3, PALETTE.metalDark); box3(v, -5, 5, 6, 6, 3, 3, PALETTE.metalDark);
  box3(v, -3, -3, 5, 6, -4, -4, PALETTE.metalDark); box3(v, 3, 4, 5, 6, -4, -4, PALETTE.metalDark);
  box3(v, -3, -3, 5, 6, 4, 4, PALETTE.metalDark);   box3(v, 3, 4, 5, 6, 4, 4, PALETTE.metalDark);
  // Front facade must sit outside the solid z=-4..4 hall volume. The old
  // z=0/1 details were fully occluded, making the normalized building read as
  // an unbroken black slab from the RTS camera.
  box3(v, -2, 2, 2, 6, -5, -5, w);
  box3(v, -3, 3, 7, 7, -5, -5, sd);
  cube(v, -1, 3, -6, g); cube(v, 1, 3, -6, g);
  cube(v, -1, 5, -6, shade(g, 0.78)); cube(v, 1, 5, -6, shade(g, 0.78));
  box3(v, -6, 6, 9, 10, -5, 5, shade(wd, 0.85));
  box3(v, -5, 5, 11, 12, -4, 4, shade(wd, 0.8));
  box3(v, -4, 4, 13, 13, -3, 3, shade(wd, 0.75));
  box3(v, -2, 2, 14, 14, -2, 2, shade(wd, 0.7));
  cube(v, 0, 15, 0, g);
  cube(v, 0, 13, 5, wd); cube(v, 0, 14, 5, wd); cube(v, 0, 15, 5, wd);
  cube(v, 1, 15, 5, g); cube(v, 2, 15, 5, g);
  cube(v, 1, 14, 5, shade(g, 0.85));
  cube(v, -4, 5, -5, wd); cube(v, -4, 6, -5, fire);
  cube(v, 4, 5, -5, wd); cube(v, 4, 6, -5, fire);
  // Side windows keep the building readable under any 45-degree RTS rotation.
  box3(v, -6, -6, 4, 6, -2, -1, fire);
  box3(v, 6, 6, 4, 6, -2, -1, fire);
  box3(v, -6, -6, 4, 6, 1, 2, shade(g, 0.8));
  box3(v, 6, 6, 4, 6, 1, 2, shade(g, 0.8));
  void sl; void wl;
  return v;
}

/** Town Hall L2 — fortified version: taller, with corner turrets and crenellations. */
export function townHallL2Building(): Voxel[] {
  const v: Voxel[] = [];
  const s = PALETTE.stone, sd = PALETTE.stoneDark, sl = PALETTE.stoneLight;
  const wd = PALETTE.woodDark, g = ACCENT.gold, fire = ACCENT.fire;
  box3(v, -7, 7, 0, 1, -6, 6, sd);
  box3(v, -6, 6, 1, 2, -5, 5, s);
  box3(v, -6, 6, 2, 10, -5, 5, s);
  box3(v, -7, -6, 2, 13, -6, -6, shade(sd, 0.9)); box3(v, 6, 7, 2, 13, -6, -6, shade(sd, 0.9));
  box3(v, -7, -6, 2, 13, 6, 6, shade(sd, 0.9));   box3(v, 6, 7, 2, 13, 6, 6, shade(sd, 0.9));
  for (const [bx, bz] of [[-6, -6], [6, -6], [-6, 6], [6, 6]] as const) {
    cube(v, bx, 14, bz, shade(sd, 0.85));
    cube(v, bx + (bx < 0 ? 1 : -1), 14, bz, shade(sd, 0.85));
    cube(v, bx, 14, bz + (bz < 0 ? 1 : -1), shade(sd, 0.85));
  }
  box3(v, -6, 6, 5, 5, -3, -3, PALETTE.metalDark); box3(v, -6, 6, 5, 5, 3, 3, PALETTE.metalDark);
  box3(v, -6, 6, 7, 7, -3, -3, PALETTE.metalDark); box3(v, -6, 6, 7, 7, 3, 3, PALETTE.metalDark);
  box3(v, -4, -4, 5, 7, -6, -6, PALETTE.metalDark); box3(v, 4, 5, 5, 7, -6, -6, PALETTE.metalDark);
  box3(v, -4, -4, 5, 7, 6, 6, PALETTE.metalDark);   box3(v, 4, 5, 5, 7, 6, 6, PALETTE.metalDark);
  box3(v, -2, 2, 2, 6, 0, 0, PALETTE.metalDark);
  cube(v, -3, 5, 1, wd); cube(v, 3, 5, 1, wd);
  box3(v, -6, 6, 11, 12, -5, 5, shade(wd, 0.85));
  box3(v, -5, 5, 13, 14, -4, 4, shade(wd, 0.8));
  box3(v, -3, 3, 15, 15, -3, 3, shade(wd, 0.75));
  cube(v, 0, 16, 0, g);
  cube(v, 0, 14, 6, wd); cube(v, 0, 15, 6, wd); cube(v, 0, 16, 6, wd); cube(v, 0, 17, 6, wd);
  box3(v, 1, 3, 16, 17, 6, 6, g);
  cube(v, -3, 5, 1, wd); cube(v, -3, 6, 1, fire);
  cube(v, 3, 5, 1, wd); cube(v, 3, 6, 1, fire);
  void sl;
  return v;
}

/** Watch Tower — narrow lookout tower: tall base + upper platform with crenellations. */
export function watchTowerBuilding(): Voxel[] {
  const v: Voxel[] = [];
  const s = PALETTE.stone, sd = PALETTE.stoneDark, wd = PALETTE.woodDark;
  const fire = ACCENT.fire, g = ACCENT.gold, e = ACCENT.soul;
  box3(v, -3, 3, 0, 2, -3, 3, sd);
  box3(v, -3, 3, 3, 10, -3, 3, s);
  box3(v, -3, 3, 5, 5, -2, -2, PALETTE.metalDark); box3(v, -3, 3, 5, 5, 2, 2, PALETTE.metalDark);
  box3(v, -3, 3, 8, 8, -2, -2, PALETTE.metalDark); box3(v, -3, 3, 8, 8, 2, 2, PALETTE.metalDark);
  box3(v, -2, 2, 5, 5, -3, -3, PALETTE.metalDark); box3(v, 2, 3, 5, 5, -3, -3, PALETTE.metalDark);
  box3(v, -2, 2, 5, 5, 3, 3, PALETTE.metalDark);   box3(v, 2, 3, 5, 5, 3, 3, PALETTE.metalDark);
  box3(v, -4, 4, 11, 12, -4, 4, shade(sd, 0.95));
  cube(v, -4, 13, -4, shade(sd, 0.85)); cube(v, -1, 13, -4, shade(sd, 0.85)); cube(v, 2, 13, -4, shade(sd, 0.85));
  cube(v, -4, 13, 4, shade(sd, 0.85));  cube(v, -1, 13, 4, shade(sd, 0.85));  cube(v, 2, 13, 4, shade(sd, 0.85));
  cube(v, -4, 13, -1, shade(sd, 0.85)); cube(v, -4, 13, 2, shade(sd, 0.85));
  cube(v, 4, 13, -1, shade(sd, 0.85));  cube(v, 4, 13, 2, shade(sd, 0.85));
  box3(v, -3, 3, 14, 15, -3, 3, shade(wd, 0.8));
  box3(v, -2, 2, 16, 16, -2, 2, shade(wd, 0.75));
  cube(v, 0, 17, 0, g);
  cube(v, 0, 13, 0, fire); cube(v, 1, 13, 0, fire); cube(v, 0, 14, 0, ACCENT.fireCore);
  box3(v, -1, 1, 3, 5, 0, 0, PALETTE.metalDark);
  cube(v, -2, 5, 1, wd); cube(v, -2, 6, 1, fire);
  cube(v, 2, 5, 1, wd); cube(v, 2, 6, 1, fire);
  void e;
  return v;
}

// ── RTS: defender units ────────────────────────────────────────────────────

/** Worker (static fallback) — peasant with pickaxe (for non-rigged path / smoke-tests). */
export function workerUnit(): Voxel[] {
  const v: Voxel[] = [];
  const f = PALETTE.flesh, fd = PALETTE.fleshDark;
  const w = PALETTE.wood, wd = PALETTE.woodDark, wl = PALETTE.woodLight;
  const md = PALETTE.metalDark, m = PALETTE.metal;
  const e = ACCENT.soul;
  box3(v, -2, -1, 0, 1, 0, 1, fd); box3(v, 1, 2, 0, 1, 0, 1, fd);
  box3(v, -2, -1, 2, 6, 0, 0, fd); box3(v, 1, 2, 2, 6, 0, 0, fd);
  box3(v, -2, 2, 7, 13, 0, 1, shade(w, 0.85));
  box3(v, -2, 2, 8, 9, 0, 1, shade(wd, 0.9));
  box3(v, -2, 2, 14, 15, -1, 1, wd); box3(v, -2, 2, 14, 15, 1, 2, wd);
  box3(v, -1, 1, 14, 15, 0, 1, f);
  cube(v, -1, 14, 1, e); cube(v, 1, 14, 1, e);
  box3(v, -3, -2, 12, 14, 0, 0, fd); box3(v, 2, 3, 12, 14, 0, 0, fd);
  box3(v, 3, 3, 8, 15, 1, 1, wl);
  box3(v, 2, 4, 8, 9, 0, 2, md);
  cube(v, 1, 8, 1, m); cube(v, 5, 8, 1, m);
  return v;
}

/** Knight — armored fighter with shield and sword. */
export function knightUnit(): Voxel[] {
  const v: Voxel[] = [];
  const m = PALETTE.metal, md = PALETTE.metalDark, ml = PALETTE.metalLight, wd = PALETTE.woodDark;
  const e = ACCENT.soul, g = ACCENT.gold;
  box3(v, -2, -1, 0, 1, 0, 1, md); box3(v, 1, 2, 0, 1, 0, 1, md);
  box3(v, -2, -1, 2, 6, 0, 0, md); box3(v, 1, 2, 2, 6, 0, 0, md);
  box3(v, -2, 2, 7, 9, 0, 1, m);
  box3(v, -2, 2, 10, 13, 0, 1, m);
  box3(v, -1, 1, 12, 13, 1, 1, ml);
  cube(v, 0, 11, 1, g);
  box3(v, -3, -2, 10, 11, 0, 1, md); box3(v, 2, 3, 10, 11, 0, 1, md);
  box3(v, -3, -2, 12, 14, 0, 0, md); box3(v, 2, 3, 12, 14, 0, 0, md);
  box3(v, -2, 2, 14, 17, 0, 1, md);
  cube(v, 0, 18, 0, g);
  cube(v, -1, 16, 1, e); cube(v, 1, 16, 1, e);
  box3(v, -4, -3, 10, 14, 1, 2, shade(m, 0.9));
  cube(v, -4, 12, 2, g);
  cube(v, 3, 9, 1, wd);
  box3(v, 3, 3, 10, 15, 1, 1, ml);
  cube(v, 3, 16, 1, g);
  return v;
}

/** Archer — light fighter with bow and quiver. */
export function archerUnit(): Voxel[] {
  const v: Voxel[] = [];
  const f = PALETTE.flesh, fd = PALETTE.fleshDark, w = PALETTE.wood, wl = PALETTE.woodLight;
  const e = ACCENT.soul, g = ACCENT.gold;
  box3(v, -2, -1, 0, 1, 0, 1, fd); box3(v, 1, 2, 0, 1, 0, 1, fd);
  box3(v, -2, -1, 2, 6, 0, 0, fd); box3(v, 1, 2, 2, 6, 0, 0, fd);
  box3(v, -2, 2, 7, 13, 0, 1, shade(f, 0.85));
  box3(v, -2, 2, 14, 15, -1, 1, fd);
  box3(v, -2, 2, 13, 14, 1, 2, fd);
  box3(v, -1, 1, 14, 16, 0, 1, f);
  cube(v, -1, 15, 1, e); cube(v, 1, 15, 1, e);
  box3(v, -1, 1, 9, 13, -2, -2, w);
  cube(v, 0, 14, -2, wl); cube(v, -1, 14, -2, wl);
  box3(v, -3, -3, 11, 15, 1, 1, w);
  cube(v, -3, 10, 1, w); cube(v, -3, 16, 1, w);
  cube(v, -3, 13, 2, wl);
  cube(v, 2, 13, 1, g);
  return v;
}

/** Mage — in robe with staff and hood. */
export function mageUnit(): Voxel[] {
  const v: Voxel[] = [];
  const sd = PALETTE.stoneDark, sl = PALETTE.stoneLight;
  const ar = ACCENT.arcane, arc = ACCENT.arcaneCore;
  box3(v, -2, 2, 0, 6, 0, 1, shade(sd, 0.7));
  box3(v, -1, 1, 3, 4, 0, 1, sl);
  box3(v, -2, 2, 7, 12, 0, 1, sl);
  box3(v, -2, 2, 11, 13, 0, 1, shade(sd, 0.8));
  box3(v, -3, -2, 8, 12, 0, 0, shade(sd, 0.7)); box3(v, 2, 3, 8, 12, 0, 0, shade(sd, 0.7));
  box3(v, -2, 2, 13, 16, 0, 1, sd);
  box3(v, -1, 1, 14, 15, 1, 1, PALETTE.metalDark);
  cube(v, -1, 15, 1, arc); cube(v, 1, 15, 1, arc);
  box3(v, 3, 3, 6, 14, 1, 1, PALETTE.woodDark);
  box3(v, 2, 4, 15, 17, 0, 2, ar);
  cube(v, 3, 16, 1, arc);
  cube(v, 0, 10, 1, ar);
  return v;
}

/** Commander-necromancer — enlarged mage with crown and dual staff. */
export function commanderUnit(): Voxel[] {
  const v: Voxel[] = [];
  const sd = PALETTE.stoneDark, sl = PALETTE.stoneLight, bo = PALETTE.bone;
  const ar = ACCENT.arcane, arc = ACCENT.arcaneCore, bl = ACCENT.blood, g = ACCENT.gold;
  box3(v, -3, 3, 0, 6, 0, 1, shade(sd, 0.6));
  box3(v, -2, 2, 3, 4, 0, 1, sl);
  box3(v, -3, 3, 7, 13, 0, 1, sl);
  box3(v, -3, 3, 12, 14, 0, 1, shade(sd, 0.75));
  box3(v, -4, -3, 8, 13, 0, 0, shade(sd, 0.7)); box3(v, 3, 4, 8, 13, 0, 0, shade(sd, 0.7));
  box3(v, -2, 2, 14, 18, 0, 1, sd);
  box3(v, -1, 1, 15, 16, 1, 1, PALETTE.metalDark);
  box3(v, -2, 2, 19, 19, 0, 0, bo); box3(v, -1, 1, 19, 19, 0, 0, bo); box3(v, 1, 2, 19, 19, 0, 0, bo);
  cube(v, -1, 20, 0, g); cube(v, 1, 20, 0, g);
  cube(v, -1, 16, 1, arc); cube(v, 1, 16, 1, arc);
  box3(v, 4, 4, 5, 16, 1, 1, PALETTE.boneDark);
  box3(v, 3, 5, 17, 19, 0, 2, ar);
  cube(v, 4, 18, 1, arc);
  cube(v, 4, 10, 1, bl);
  cube(v, -2, 10, 1, ar); cube(v, 0, 10, 1, ar); cube(v, 2, 10, 1, ar);
  return v;
}

// ── Phase T: terrain tiles (reference 'Isometric Fantasy Tiles') ───────────

/** Grass tile — mossy green-brown slab with dark moss spots. */
export function tileGrass(): Voxel[] {
  const v: Voxel[] = [];
  const g = PALETTE.moss;
  const dark = shade(g, 0.65);
  const light = shade(g, 1.25);
  box3(v, 0, 5, 0, 0, 0, 5, g);
  cube(v, 1, 0, 1, dark); cube(v, 4, 0, 3, dark); cube(v, 2, 0, 4, dark); cube(v, 5, 0, 0, dark);
  cube(v, 3, 0, 0, light); cube(v, 0, 0, 2, light); cube(v, 5, 0, 5, light);
  return v;
}

/** Dirt tile — earthy brown slab with dark cracks. */
export function tileDirt(): Voxel[] {
  const v: Voxel[] = [];
  const d = PALETTE.earth;
  const dark = shade(d, 0.6);
  const light = shade(d, 1.2);
  box3(v, 0, 5, 0, 0, 0, 5, d);
  cube(v, 1, 0, 1, dark); cube(v, 2, 0, 1, dark); cube(v, 4, 0, 3, dark); cube(v, 3, 0, 4, dark); cube(v, 5, 0, 5, dark);
  cube(v, 0, 0, 5, light); cube(v, 5, 0, 0, light); cube(v, 2, 0, 3, light);
  return v;
}

/** Road tile — paved stone slab (for enemy path). */
export function tileRoad(): Voxel[] {
  const v: Voxel[] = [];
  const s = PALETTE.stone;
  const dark = PALETTE.stoneDark;
  const light = PALETTE.stoneLight;
  box3(v, 0, 5, 0, 0, 0, 5, s);
  cube(v, 2, 0, 0, dark); cube(v, 2, 0, 1, dark); cube(v, 2, 0, 2, dark); cube(v, 2, 0, 3, dark); cube(v, 2, 0, 4, dark); cube(v, 2, 0, 5, dark);
  cube(v, 0, 0, 4, dark); cube(v, 1, 0, 4, dark); cube(v, 3, 0, 4, dark); cube(v, 4, 0, 4, dark); cube(v, 5, 0, 4, dark);
  cube(v, 0, 0, 0, light); cube(v, 4, 0, 1, light); cube(v, 1, 0, 3, light); cube(v, 5, 0, 5, light);
  return v;
}

/** Water tile — dark water surface with teal emissive glow "dead water". */
export function tileWater(): Voxel[] {
  const v: Voxel[] = [];
  const w = desaturate([0.05, 0.10, 0.18], 0.18);
  const dark = shade(w, 0.55);
  const glow = ACCENT.soul;
  box3(v, 0, 5, 0, 0, 0, 5, w);
  cube(v, 0, 0, 0, dark); cube(v, 5, 0, 0, dark); cube(v, 0, 0, 5, dark); cube(v, 5, 0, 5, dark); cube(v, 2, 0, 2, dark);
  cube(v, 1, 0, 1, glow); cube(v, 4, 0, 2, glow); cube(v, 2, 0, 4, glow);
  return v;
}

/** Rock tile — gray stone slab with dark speckles and light veins. */
export function tileRock(): Voxel[] {
  const v: Voxel[] = [];
  const r = PALETTE.stone;
  const dark = PALETTE.stoneDark;
  const light = PALETTE.stoneLight;
  box3(v, 0, 5, 0, 0, 0, 5, r);
  cube(v, 0, 0, 0, dark); cube(v, 3, 0, 1, dark); cube(v, 5, 0, 3, dark); cube(v, 2, 0, 5, dark); cube(v, 4, 0, 5, dark);
  cube(v, 4, 0, 0, light); cube(v, 1, 0, 2, light); cube(v, 5, 0, 5, light); cube(v, 0, 0, 4, light);
  return v;
}

/** Sand tile — sandy-beige slab with rare grains. */
export function tileSand(): Voxel[] {
  const v: Voxel[] = [];
  const base = desaturate([0.50, 0.42, 0.28], 0.28);
  const dark = shade(base, 0.7);
  const light = shade(base, 1.25);
  box3(v, 0, 5, 0, 0, 0, 5, base);
  cube(v, 1, 0, 2, dark); cube(v, 4, 0, 4, dark); cube(v, 5, 0, 1, dark);
  cube(v, 3, 0, 0, light); cube(v, 0, 0, 5, light); cube(v, 2, 0, 3, light);
  return v;
}

/** Registry of procedural builders by name (used by asset-catalog). */
export const VOXEL_BUILDERS: Record<string, () => Voxel[]> = {
  'tower:arrow': arrowTower,
  'tower:cannon': cannonTower,
  'tower:arcane': arcaneTower,
  'tower:ice': iceTower,
  'enemy:skeleton': skeletonEnemy,
  'enemy:goblin': goblinEnemy,
  'enemy:zombie': zombieEnemy,
  'enemy:demon': demonEnemy,
  'enemy:boss': bossEnemy,
  'enemy:slime': slimeEnemy,
  'enemy:bat': batEnemy,
  'enemy:spider': spiderEnemy,
  'enemy:ghost': ghostEnemy,
  'base:altar': baseAltar,
  'spawn:portal': spawnPortal,
  'projectile:bolt': projectileBolt,
  'wall:wood': woodWall,
  'wall:stone': stoneWall,
  'wall:bone': boneWall,
  'relic:totem-fire': relicFireTotem,
  'relic:totem-arcane': relicArcaneTotem,
  'relic:totem-gold': relicGoldTotem,
  'relic:totem-ice': relicIceTotem,
  'relic:totem-blood': relicBloodTotem,
  'building:sawmill': sawmillBuilding,
  'building:mine': mineBuilding,
  'building:smelter': smelterBuilding,
  'building:barracks': barracksBuilding,
  'building:town-hall': townHallBuilding,
  'building:town-hall-l2': townHallL2Building,
  'building:watch-tower': watchTowerBuilding,
  'unit:knight': knightUnit,
  'unit:archer': archerUnit,
  'unit:mage': mageUnit,
  'unit:commander': commanderUnit,
  'unit:worker': workerUnit,
  'tile:grass': tileGrass,
  'tile:dirt': tileDirt,
  'tile:road': tileRoad,
  'tile:water': tileWater,
  'tile:rock': tileRock,
  'tile:sand': tileSand
};

/** Emissive accent of model by builder name (for material). */
export function builderEmissive(builderName: string): RGB | undefined {
  switch (builderName) {
    case 'tower:arrow': return ACCENT.fire;
    case 'tower:cannon': return ACCENT.fireCore;
    case 'tower:arcane': return ACCENT.arcane;
    case 'tower:ice': return ACCENT.ice;
    case 'enemy:boss': return ACCENT.arcane;
    case 'enemy:demon': return ACCENT.eyeDemon;
    case 'enemy:slime': return ACCENT.arcane;
    case 'enemy:bat': return ACCENT.eyeRed;
    case 'enemy:spider': return ACCENT.eyeRed;
    case 'enemy:ghost': return ACCENT.soul;
    case 'base:altar': return ACCENT.soul;
    case 'spawn:portal': return ACCENT.fire;
    case 'projectile:bolt': return ACCENT.fireCore;
    case 'wall:bone': return ACCENT.eyeRed;
    case 'relic:totem-fire': return ACCENT.fire;
    case 'relic:totem-arcane': return ACCENT.arcane;
    case 'relic:totem-gold': return ACCENT.gold;
    case 'relic:totem-ice': return ACCENT.ice;
    case 'relic:totem-blood': return ACCENT.blood;
    case 'building:sawmill': return ACCENT.fire;
    case 'building:mine': return ACCENT.gold;
    case 'building:smelter': return ACCENT.fireCore;
    case 'building:barracks': return ACCENT.blood;
    case 'building:town-hall': return ACCENT.gold;
    case 'building:town-hall-l2': return ACCENT.gold;
    case 'building:watch-tower': return ACCENT.fire;
    case 'unit:knight': return ACCENT.soul;
    case 'unit:archer': return ACCENT.gold;
    case 'unit:mage': return ACCENT.arcane;
    case 'unit:commander': return ACCENT.arcaneCore;
    case 'unit:worker': return ACCENT.soul;
    case 'tile:water': return ACCENT.soul;
    default: return undefined;
  }
}
