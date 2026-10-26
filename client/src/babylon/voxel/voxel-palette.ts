export * from './content/indexed-palette.js';

import { Constants } from '@babylonjs/core/Engines/constants.js';
import { RawTexture } from '@babylonjs/core/Materials/Textures/rawTexture.js';
import { Texture } from '@babylonjs/core/Materials/Textures/texture.js';
import { type Scene } from '@babylonjs/core/scene.js';
import { INDEXED_PALETTE, PALETTE_MAX } from './content/indexed-palette.js';

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
