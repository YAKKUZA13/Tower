import {VoxelStampRegistry as EngineStampRegistry} from '@voxkera/voxel-core';
import {PALETTE, ACCENT, shade, type RGB} from './dark-palette.js';
/** Material label → dark-palette color. */
export function materialColor(label: string | null | undefined): RGB {
  if (!label) return PALETTE.stone;
  const lc = label.toLowerCase();
  if (lc.includes('gold') || lc.includes('ore')) return ACCENT.gold;
  if (lc.includes('fire')) return lc.includes('core') ? ACCENT.fireCore : ACCENT.fire;
  if (lc.includes('void')) return shade(PALETTE.metalDark, 0.42);
  if (lc.includes('metal')) {
    if (lc.includes('light')) return PALETTE.metalLight;
    if (lc.includes('dark')) return PALETTE.metalDark;
    return PALETTE.metal;
  }
  if (lc.includes('stone') || lc.includes('plaster')) {
    if (lc.includes('dark')) return PALETTE.stoneDark;
    if (lc.includes('light')) return PALETTE.stoneLight;
    if (lc.includes('warm')) return shade(PALETTE.stone, 0.96);
    return PALETTE.stone;
  }
  if (lc.includes('oak') || lc.includes('wood')) {
    if (lc.includes('light')) return PALETTE.woodLight;
    if (lc.includes('dark')) return PALETTE.woodDark;
    return PALETTE.wood;
  }
  if (lc.includes('roof_slate')) return PALETTE.woodDark;
  if (lc.includes('grass')) return PALETTE.moss;
  if (lc.includes('moss')) return shade(PALETTE.moss, 0.8);
  if (lc.includes('ivy')) return shade(PALETTE.moss, 1.2);
  if (lc.includes('pebble') || lc.includes('flower')) return PALETTE.stoneLight;
  if (lc.includes('smoke')) return shade(PALETTE.stoneLight, 1.4);
  return PALETTE.stone;
}

/** Tower's original materials over the reusable geometry registry. */
export class VoxelStampRegistry extends EngineStampRegistry {
 constructor() {super({colors: {...PALETTE, ...ACCENT}, resolveMaterial: materialColor});}
}
