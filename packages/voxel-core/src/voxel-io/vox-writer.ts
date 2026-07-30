/**
 * Minimal MagicaVoxel `.vox` writer (Phase P2, research §5.3/§15).
 *
 * Format: VOX-magic + version 150 + MAIN chunk → SIZE + XYZI + RGBA chunks.
 * Purpose — round-trip with MagicaVoxel/Blockbench for offline authoring (export our
 * procedural/visual-hull model → edit → reimport via vox-importer in P3).
 *
 * Specification: ephtracy/voxel-model (.vox extension spec). Palette 256 RGBA;
 * index 0 reserved (empty), voxels use colorIndex 1..255.
 */

export interface VoxVoxel {
  x: number;
  y: number;
  z: number;
  /** Color index in palette 1..255 (0 = empty, not written). */
  colorIndex: number;
}

export interface VoxSize {
  x: number;
  y: number;
  z: number;
}

const VOX_MAGIC = 'VOX ';
const VOX_VERSION = 150;

/** Small little-endian byte-writer. */
class ByteWriter {
  private buf: number[] = [];
  writeUint8(v: number): void { this.buf.push(v & 0xff); }
  writeUint32(v: number): void {
    this.buf.push(v & 0xff, (v >>> 8) & 0xff, (v >>> 16) & 0xff, (v >>> 24) & 0xff);
  }
  writeAscii(s: string): void { for (let i = 0; i < s.length; i++) this.buf.push(s.charCodeAt(i) & 0xff); }
  writeBytes(arr: Uint8Array): void { for (let i = 0; i < arr.length; i++) this.buf.push(arr[i]!); }
  length(): number { return this.buf.length; }
  toArray(): Uint8Array { return new Uint8Array(this.buf); }
}

/** Writes a chunk: id + contentSize + childrenSize + content (+ children appended after). */
function beginChunk(w: ByteWriter, id: string, contentSize: number, childrenSize: number): void {
  w.writeAscii(id);
  w.writeUint32(contentSize);
  w.writeUint32(childrenSize);
}

/**
 * writeVox: size + voxels + palette → Uint8Array (.vox).
 * @param size model dimensions
 * @param voxels voxels with colorIndex 1..255
 * @param palette RGB[] (≤255); palette index → slot colorIndex+1 (1..255)
 */
export function writeVox(size: VoxSize, voxels: VoxVoxel[], palette: number[][]): Uint8Array {
  const w = new ByteWriter();

  // header
  w.writeAscii(VOX_MAGIC.trim() + ' '); // 'VOX '
  w.writeUint32(VOX_VERSION);

  // MAIN chunk (contentSize=0, childrenSize = sum of SIZE+XYZI+RGBA chunk sizes)
  const mainChildrenStart = w.length() + 12; // after MAIN header (id+2×uint32 = 12)
  beginChunk(w, 'MAIN', 0, 0); // childrenSize filled below

  const childrenSizePos = mainChildrenStart - 4; // childrenSize field position in MAIN
  const childrenStart = w.length();

  // SIZE chunk: content = x,y,z (3× uint32)
  beginChunk(w, 'SIZE', 12, 0);
  w.writeUint32(size.x); w.writeUint32(size.y); w.writeUint32(size.z);

  // XYZI chunk: content = numVoxels (uint32) + numVoxels × (x,y,z,colorIndex) uint8
  beginChunk(w, 'XYZI', 4 + voxels.length * 4, 0);
  w.writeUint32(voxels.length);
  for (const v of voxels) {
    w.writeUint8(v.x & 0xff);
    w.writeUint8(v.y & 0xff);
    w.writeUint8(v.z & 0xff);
    w.writeUint8(v.colorIndex & 0xff);
  }

  // RGBA chunk: content = 256 × (r,g,b,a) uint8. index i (0..255) → palette slot i.
  beginChunk(w, 'RGBA', 256 * 4, 0);
  for (let i = 0; i < 256; i++) {
    const c = palette[i % Math.max(1, palette.length)] ?? [0, 0, 0];
    w.writeUint8(Math.round(c[0] * 255));
    w.writeUint8(Math.round(c[1] * 255));
    w.writeUint8(Math.round(c[2] * 255));
    w.writeUint8(255);
  }

  // retroactively write MAIN childrenSize
  const childrenSize = w.length() - childrenStart;
  const out = w.toArray();
  out[childrenSizePos] = childrenSize & 0xff;
  out[childrenSizePos + 1] = (childrenSize >>> 8) & 0xff;
  out[childrenSizePos + 2] = (childrenSize >>> 16) & 0xff;
  out[childrenSizePos + 3] = (childrenSize >>> 24) & 0xff;
  return out;
}

/**
 * Converts Voxel[] (RGB) + palette → {size, voxels: VoxVoxel[], palette},
 * snapping colors to palette. Utility for voxelize CLI / procedural model export.
 */
export function voxelsToVoxFormat(
  voxels: { x: number; y: number; z: number; color: number[] }[],
  palette: number[][]
): { size: VoxSize; voxels: VoxVoxel[]; palette: number[][] } {
  const map = new Map<string, number[]>();
  for (const v of voxels) map.set(`${v.x},${v.y},${v.z}`, v.color);
  const out: VoxVoxel[] = [];
  for (const [key, rgb] of map) {
    const [xs, ys, zs] = key.split(',');
    const idx = nearestPaletteIndex(rgb, palette);
    out.push({ x: +xs!, y: +ys!, z: +zs!, colorIndex: idx + 1 });
  }
  let mx = 0, my = 0, mz = 0;
  for (const v of out) {
    if (v.x + 1 > mx) mx = v.x + 1;
    if (v.y + 1 > my) my = v.y + 1;
    if (v.z + 1 > mz) mz = v.z + 1;
  }
  return { size: { x: mx, y: my, z: mz }, voxels: out, palette };
}

/** Nearest-neighbor in RGB palette (for export). */
function nearestPaletteIndex(rgb: number[], palette: number[][]): number {
  let best = 0, bestD = Infinity;
  for (let i = 0; i < palette.length; i++) {
    const p = palette[i]!;
    const dr = p[0] - rgb[0], dg = p[1] - rgb[1], db = p[2] - rgb[2];
    const d = dr * dr + dg * dg + db * db;
    if (d < bestD) { bestD = d; best = i; }
  }
  return best;
}
