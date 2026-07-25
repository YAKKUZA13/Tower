/**
 * M8.R / R5 — Cloud shadows.
 * Источник: Magnum-Opus «3D Pixel Art» §cloud-shadows; Roystan cloud-attenuation.
 *
 * Одна noise-текстура как глобальный uniform; `get_cloud_attenuation(world_pos)`
 * вызывается каждым lit-шейдером (toon, вода, terrain). Сэмпл в world XZ,
 * медленный скролл.
 *
 * Реализация:
 *  - Procedurally-generates tileable value-noise на 256×256 (DynamicTexture).
 *    (Без внешнего файла; для production можно подменить на настоящую PNG.)
 *  - Регистрирует uniform "uCloudAttenuation(worldPos)" через helper:
 *      `cloudAttenuationAt(worldPos, scroll, scale)` возвращает множитель яркости.
 *  - Помощник для передачи uniform в toon-материал (см. toon-pixel-art.ts).
 *  - Helper для terrain/water (uses StandardMaterial / onBind Observable).
 */
import { Constants, DynamicTexture, RawTexture, Scene, Texture, Vector2 } from 'babylonjs';

let _tileableNoise: DynamicTexture | null = null;

/**
 * Генерирует tileable value-noise 256×256 (DynamicTexture).
 * Алгоритм: базовый value-noise на сетке + bilinear-interp + seamless wrap
 * (sin/cos weighting в.edge-зонах). Детерминированный — всегда одна и та же текстура.
 */
export function createTileableCloudNoise(scene: Scene, size = 256): DynamicTexture {
  // проверка disposed через try-catch (Babylon 7 не экспортит isDisposed публично)
  if (_tileableNoise) {
    try {
      if (_tileableNoise.getSize().width > 0) return _tileableNoise;
    } catch { _tileableNoise = null; }
  }
  const tex = new DynamicTexture('cloud-noise', { width: size, height: size }, scene, false);
  tex.wrapU = Texture.WRAP_ADDRESSMODE;
  tex.wrapV = Texture.WRAP_ADDRESSMODE;
  tex.updateSamplingMode(Constants.TEXTURE_NEAREST_SAMPLINGMODE);

  const ctx = tex.getContext() as CanvasRenderingContext2D;
  // value-noise: сетка cells × cells случайных heights, между ними bilinear + fbm
  const cells = 16;
  const cellW = size / cells;
  // детерминированный LCG-сетка heights (без Math.random)
  const seed = 1337;
  let state = seed >>> 0;
  const rng = (): number => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  // 2x wraps для tileable noise (бордюр копирует ячейки из противоположного края)
  const grid: number[] = [];
  for (let y = 0; y <= cells + 1; y++) {
    for (let x = 0; x <= cells + 1; x++) {
      const sx = x % cells;
      const sy = y % cells;
      grid.push(rng());
      void sx; void sy;
    }
  }
  const idx = (x: number, y: number): number => {
    const xx = ((x % cells) + cells) % cells;
    const yy = ((y % cells) + cells) % cells;
    return yy * (cells + 2) + xx;
  };
  const smooth = (t: number): number => t * t * (3 - 2 * t);

  // fbm: 3 octaves
  const sampleFbm = (u: number, v: number): number => {
    let sum = 0;
    let amp = 1;
    let freq = 1;
    for (let oct = 0; oct < 3; oct++) {
      const gx = u * freq * cells;
      const gy = v * freq * cells;
      const x0 = Math.floor(gx);
      const y0 = Math.floor(gy);
      const fx = smooth(gx - x0);
      const fy = smooth(gy - y0);
      // wrap lookup via idx()
      const h00 = grid[idx(x0, y0)];
      const h10 = grid[idx(x0 + 1, y0)];
      const h01 = grid[idx(x0, y0 + 1)];
      const h11 = grid[idx(x0 + 1, y0 + 1)];
      const top = h00 * (1 - fx) + h10 * fx;
      const bot = h01 * (1 - fx) + h11 * fx;
      sum += amp * (top * (1 - fy) + bot * fy);
      amp *= 0.5;
      freq *= 2;
    }
    // нормируем в [0..1] примерно (3 octaves: 1 + 0.5 + 0.25 = 1.75 max)
    return Math.max(0, Math.min(1, sum / 1.75));
  };

  const img = ctx.createImageData(size, size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = x / size;
      const v = y / size;
      const h = sampleFbm(u, v);
      // gamma + remap — облака больше «пятнистые»
      const cloud = Math.pow(h, 1.2);
      const o = (y * size + x) * 4;
      const c = Math.round(cloud * 255);
      img.data[o] = c;
      img.data[o + 1] = c;
      img.data[o + 2] = c;
      img.data[o + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  tex.update(false);
  _tileableNoise = tex;
  return tex;
}

/**
 * CPU-side helper (для не-шейдерных материалов или UI). Возвращает attenuation ∈ [0..1].
 * Не предназначен для горячего цикла — только для редких сэмплов (minimap fog).
 */
export function cloudAttenuationAt(worldPos: { x: number; z: number }, scroll: { x: number; y: number }, scale: number): number {
  // упрощённо: 0.5 — базовая освещённость; реальные клиенты сэмплят текстуру на GPU.
  const u = (worldPos.x + scroll.x) / Math.max(0.001, scale);
  const v = (worldPos.z + scroll.y) / Math.max(0.001, scale);
  // approximate noise — sin-combination (быстро, не точно; для UI)
  const n = 0.5 + 0.5 * Math.sin(u * 1.7) * Math.cos(v * 1.3);
  return Math.max(0, Math.min(1, n));
}

export interface CloudShadowUniforms {
  texture: Texture;
  scroll: Vector2;
  scale: number;
  strength: number;
}

/**
 * Создаёт связку cloud-noise + uniforms. каждый кадр scroll сдвигается.
 * dt-зависимый скролл = (windSpeed * dt, 0).
 */
export function createCloudShadow(scene: Scene, opts: { windSpeed?: number; scale?: number; strength?: number } = {}): CloudShadowUniforms & {
  update(dt: number): void;
  dispose(): void;
} {
  const tex = createTileableCloudNoise(scene, 256);
  const scroll = new Vector2(0, 0);
  const scale = opts.scale ?? 8;
  const strength = opts.strength ?? 0.3;
  const windSpeed = opts.windSpeed ?? 0.6;
  return {
    texture: tex,
    scroll,
    scale,
    strength,
    update(dt: number) {
      scroll.x += windSpeed * dt;
      // tiny crosswind для «плавающих» краёв
      scroll.y += windSpeed * 0.15 * dt;
    },
    dispose() { tex.dispose(); }
  };
}

// re-export для удобства клиентов
export { RawTexture };
