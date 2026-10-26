const assert = require('node:assert/strict');
const { inflateSync } = require('node:zlib');

// CDP screenshots are non-interlaced 8-bit RGB(A). No image dependency.
function visualGate(png, region) {
  assert.equal(png.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
  let width, height, channels;
  const compressed = [];
  for (let offset = 8; offset < png.length;) {
    const length = png.readUInt32BE(offset), type = png.toString('ascii', offset + 4, offset + 8);
    const data = png.subarray(offset + 8, offset + 8 + length);
    if (type === 'IHDR') {
      width = data.readUInt32BE(0); height = data.readUInt32BE(4);
      assert.equal(data[8], 8); assert.ok([2, 6].includes(data[9])); assert.equal(data[12], 0);
      channels = data[9] === 2 ? 3 : 4;
    }
    if (type === 'IDAT') compressed.push(data);
    offset += length + 12;
  }
  const raw = inflateSync(Buffer.concat(compressed)), stride = width * channels;
  assert.equal(raw.length, (stride + 1) * height);
  const pixels = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)]; assert.ok(filter <= 4);
    for (let x = 0; x < stride; x++) {
      const left = x >= channels ? pixels[y * stride + x - channels] : 0;
      const up = y ? pixels[(y - 1) * stride + x] : 0;
      const corner = y && x >= channels ? pixels[(y - 1) * stride + x - channels] : 0;
      const estimate = left + up - corner;
      const paeth = Math.abs(estimate - left) <= Math.abs(estimate - up) && Math.abs(estimate - left) <= Math.abs(estimate - corner)
        ? left : Math.abs(estimate - up) <= Math.abs(estimate - corner) ? up : corner;
      pixels[y * stride + x] = (raw[y * (stride + 1) + 1 + x] + [0, left, up, Math.floor((left + up) / 2), paeth][filter]) & 255;
    }
  }
  const colors = new Map(); let samples = 0;
  // Only canvas pixels, never editor text. Ignore a two-pixel border.
  for (let y = 2; y < Math.min(height, region.height) - 2; y++) {
    for (let x = 2; x < Math.min(width, region.width) - 2; x++) {
      const offset = y * stride + x * channels;
      const color = pixels[offset] << 16 | pixels[offset + 1] << 8 | pixels[offset + 2];
      colors.set(color, (colors.get(color) ?? 0) + 1); samples++;
    }
  }
  const dominant = [...colors.values()].reduce((max, count) => Math.max(max, count), 0);
  const foreground = samples - dominant;
  assert.ok(colors.size >= 8 && foreground > 250, `Blank/flat canvas: ${colors.size} colors, ${foreground} non-background pixels`);
  return { colors: colors.size, foreground, samples };
}
module.exports = { visualGate };
