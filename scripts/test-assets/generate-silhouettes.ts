/**
 * Генератор тестовых силуэт-PNG для voxelize.ts CLI (Фаза P2 задача 5).
 * Создаёт front.png + side.png — стилизованный «призрак» (закруглённый верх,
 * сужающийся низ) на прозрачном фоне. Запуск:
 *   npx tsx scripts/test-assets/generate-silhouettes.ts
 */
import { writeFileSync } from 'node:fs';
import { PNG } from 'pngjs';

const W = 32, H = 32;

/** Силуэт «призрака»: верх — полусфера, низ — сужающийся подол. alpha=255 внутри. */
function ghostSilhouette(): Uint8Array {
  const data = new Uint8Array(W * H * 4);
  const cx = W / 2 - 0.5;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const dx = x - cx;
      let inside = false;
      if (y < 16) {
        // верх — купол (полусфера радиус 9 по y∈[7..16])
        const cy = 16;
        const r = 9;
        inside = dx * dx + (y - cy) * (y - cy) <= r * r && y >= 7;
      } else {
        // низ — трапеция, сужается книзу
        const halfW = Math.max(2, 9 - Math.floor((y - 16) * 0.4));
        inside = Math.abs(dx) <= halfW;
      }
      const o = (y * W + x) * 4;
      if (inside) {
        // серо-голубой цвет (как ghost в dark-palette)
        data[o] = 140; data[o + 1] = 158; data[o + 2] = 184; data[o + 3] = 255;
      } else {
        data[o + 3] = 0; // прозрачно
      }
    }
  }
  return data;
}

function main(): void {
  const data = ghostSilhouette();
  const png = new PNG({ width: W, height: H });
  for (let i = 0; i < data.length; i++) png.data[i] = data[i]!;
  const outDir = 'scripts/test-assets';
  const front = PNG.sync.write(png);
  writeFileSync(`${outDir}/ghost-front.png`, front);
  // side = та же силуэта (симметричный призрак)
  writeFileSync(`${outDir}/ghost-side.png`, front);
  console.log(`Wrote ${outDir}/ghost-front.png + ghost-side.png (${W}×${H})`);
}

main();
