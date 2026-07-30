export * from '@tower/voxel-core';

import { Constants, RawTexture, Texture, type Scene } from 'babylonjs';
import { INDEXED_PALETTE, PALETTE_MAX } from '@tower/voxel-core';

export function buildPaletteTexture(scene: Scene): RawTexture {
  const data = new Uint8Array(PALETTE_MAX * 4);
  const n = INDEXED_PALETTE.length;
  for (let i = 0; i < PALETTE_MAX; i++) {
    const c = i < n ? INDEXED_PALETTE[i]! : INDEXED_PALETTE[n - 1]!;
    data[i * 4] = Math.round(c[0] * 255);
    data[i * 4 + 1] = Math.round(c[1] * 255);
    data[i * 4 + 2] = Math.round(c[2] * 255);
    data[i * 4 + 3] = 255;
  }
  const tex = new RawTexture(
    data, PALETTE_MAX, 1, Constants.TEXTUREFORMAT_RGBA, scene,
    false, false, Texture.NEAREST_SAMPLINGMODE
  );
  tex.name = 'voxel-indexed-palette';
  return tex;
}
