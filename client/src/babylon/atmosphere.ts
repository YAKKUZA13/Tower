/**
 * Атмосфера TD-сцены.
 *
 * Состав:
 *  - DefaultRenderingPipeline: ACES tonemap, bloom, grain, vignette, chromatic aberration, FXAA/MSAA.
 *  - SSAO2RenderingPipeline: ambient occlusion (crevice-затенение как на воксель-референсе).
 *  - DirectionalLight (фиксированное яркое солнце) + ShadowGenerator (PCF; только акторы).
 *  - HemisphericLight как sky/ground ambient-fill.
 *  - В режиме TD НЕТ смены дня/ночи: всегда яркий день (timeOfDay из сима игнорируется).
 *  - WeatherController: rain/storm → particle system + fog density↑; storm → редкие молнии.
 *  - Цветные PointLight: свечение базы (алтарь) + «глаза» боссов + тёплый фокальный fill.
 *
 * ADR: тени рендерятся между акторами и воксельным полом (receiveShadows=true на ground).
 */
import {
  Color3,
  Color4,
  Constants,
  DefaultRenderingPipeline,
  DirectionalLight,
  HemisphericLight,
  ImageProcessingConfiguration,
  Mesh,
  ParticleSystem,
  PointLight,
  RawTexture,
  Scene,
  SSAO2RenderingPipeline,
  ShadowGenerator,
  Texture,
  Vector3,
  type Camera
} from 'babylonjs';
import type { Enemy, GameSnapshot, Weather } from '@tower/shared';

// ── палитра «яркий день» (TD: смены дня/ночи нет) ────────────────────────────
const DAY_SUN_COLOR = new Color3(0.90, 0.92, 1.0);  // солнце — объём/тени на фигурах
const DAY_SKY_COLOR = new Color3(0.40, 0.43, 0.52); // умеренный sky-fill (не заливает фон)
const DAY_GROUND_COLOR = new Color3(0.18, 0.16, 0.14); // тёплый ground-fill
const DAY_FOG_COLOR = new Color3(0.05, 0.06, 0.09);  // тёмный «воздух»/void как на референсе
const BASE_FOG_DENSITY = 0.006;

const BOSS_LIGHT_COLOR = new Color3(0.85, 0.22, 0.18); // кровавые «глаза» босса
const BASE_LIGHT_COLOR = new Color3(0.25, 0.70, 0.58); // холодное свечение алтаря
// Тёплый фокальный «фонарь» над центром поля (как фонарь с референса) —
// тёплый контраст и подъём читаемости фигур.
const FOCAL_LIGHT_COLOR = new Color3(0.95, 0.78, 0.50);

export interface AtmosphereOptions {
  /** Существующий HemisphericLight (используется как ambient-fill). */
  hemispheric: HemisphericLight;
  /** Игровой ground-меш (принимает тени). Опционально. */
  ground?: Mesh;
  /** Размеры поля (для области эмиссии дождя). */
  board?: { width: number; height: number };
  /** TypeId врагов, которые несут «глазной» PointLight (обычно boss-категория). */
  bossTypeIds?: Set<string>;
}

export class AtmosphereRenderer {
  private readonly scene: Scene;
  private readonly hemispheric: HemisphericLight;
  private readonly sun: DirectionalLight;
  private readonly shadowGen: ShadowGenerator;
  private readonly ssao: SSAO2RenderingPipeline;
  private readonly pipeline: DefaultRenderingPipeline;
  private readonly ground?: Mesh;
  private readonly boardHalf: { x: number; z: number };
  private readonly skyHeight: number;

  private readonly rain: ParticleSystem;
  private readonly rainTexture: RawTexture;
  private weather: Weather = 'clear';
  private weatherTransition = 0; // 0..1, плавный нагнет/спад дождя

  private readonly lightning: PointLight;
  private lightningTimer = 0;
  private lightningFlash = 0;

  private readonly bossLights: PointLight[];
  private readonly bossTypeIds: Set<string>;
  private readonly baseLight: PointLight;
  private baseAttached = false;
  private readonly focalLight: PointLight; // тёплый фокальный fill над полем

  constructor(scene: Scene, camera: Camera, grid: { cols: number; rows: number; cellSize: number }, options: AtmosphereOptions) {
    this.scene = scene;
    this.hemispheric = options.hemispheric;
    this.ground = options.ground;
    const boardW = options.board?.width ?? grid.cols * grid.cellSize;
    const boardH = options.board?.height ?? grid.rows * grid.cellSize;
    this.boardHalf = { x: boardW / 2, z: boardH / 2 };
    this.skyHeight = Math.max(boardW, boardH) * 1.0;
    this.bossTypeIds = options.bossTypeIds ?? new Set();

    // ── DirectionalLight: фиксированное яркое солнце (смены дня/ночи нет) ──
    const sunDir = new Vector3(0.4, -0.8, 0.45).normalize();
    this.sun = new DirectionalLight('sun', sunDir, scene);
    // позиция — высоко над центром, против направления (для фрустума теней)
    this.sun.position = new Vector3(-sunDir.x * this.skyHeight * 1.4, this.skyHeight * 1.3, -sunDir.z * this.skyHeight * 1.4);
    this.sun.intensity = 0.9;
    this.sun.diffuse = DAY_SUN_COLOR.clone();

    // ── Тени (PCF, low-med map). Только акторы — регистрируются через addShadowCaster. ──
    this.shadowGen = new ShadowGenerator(1024, this.sun);
    this.shadowGen.usePercentageCloserFiltering = true;
    this.shadowGen.filteringQuality = ShadowGenerator.QUALITY_MEDIUM;
    this.shadowGen.bias = 0.0012;
    this.shadowGen.normalBias = 0.02;
    this.shadowGen.darkness = 0.45;
    this.shadowGen.transparencyShadow = false;

    // Phase D: воксельная плита принимает тени (StandardMaterial с shadow-pass) —
    // акторы больше не «парят» над гладким ландшафтом, тени ложатся на пол.
    if (this.ground) this.ground.receiveShadows = true;

    // ── HemisphericLight → умеренный sky/ground fill (фон держим тёмным) ──
    this.hemispheric.intensity = 0.7;
    this.hemispheric.diffuse = DAY_SKY_COLOR.clone();
    this.hemispheric.groundColor = DAY_GROUND_COLOR.clone();

    // ── SSAO2 (создаём ПЕРВЫМ, чтобы AO композился до tonemap в DefaultRenderingPipeline) ──
    // crevice-затенение как на воксель-референсе. Консервативные значения: видимый,
    // но не давящий AO. При артефактах — изолированно отключается одним полем.
    this.ssao = new SSAO2RenderingPipeline('ssao2', scene, { ssaoRatio: 0.5, blurRatio: 0.5 }, [camera]);
    this.ssao.totalStrength = 1.3;
    this.ssao.radius = 1.2;
    this.ssao.samples = 12;
    this.ssao.expensiveBlur = true;
    this.ssao.bilateralSamples = 8;

    // ── Пост-процесс ──
    this.pipeline = new DefaultRenderingPipeline('atmosphere-pipeline', true, scene, [camera]);
    this.pipeline.samples = 2; // MSAA
    this.pipeline.fxaaEnabled = true;

    this.pipeline.bloomEnabled = true;
    // TD-104: bloom чуть агрессивнее на ярких акцентах (факелы/руны/кристаллы),
    // чтобы они «горели» как фонарь и магический шар с референса.
    this.pipeline.bloomThreshold = 0.72;
    this.pipeline.bloomWeight = 0.5;
    this.pipeline.bloomKernel = 64;
    this.pipeline.bloomScale = 0.5;

    this.pipeline.imageProcessingEnabled = true;
    this.pipeline.imageProcessing.toneMappingEnabled = true;
    this.pipeline.imageProcessing.toneMappingType = ImageProcessingConfiguration.TONEMAPPING_ACES;
    // TD-101: пост-процесс ослаблен — ACES+contrast+vignette ранее дробили
    // полутона в чёрное, фигурки терялись. exposure↑, contrast↓, vignette↓.
    this.pipeline.imageProcessing.exposure = 1.1;
    this.pipeline.imageProcessing.contrast = 1.12;
    this.pipeline.imageProcessing.vignetteEnabled = true;
    this.pipeline.imageProcessing.vignetteWeight = 2.4;
    this.pipeline.imageProcessing.vignetteStretch = 0.35;
    this.pipeline.imageProcessing.vignetteColor = new Color4(0, 0, 0, 1);

    this.pipeline.grainEnabled = true;
    this.pipeline.grain.intensity = 0.08;
    this.pipeline.grain.animated = true;

    this.pipeline.chromaticAberrationEnabled = true;
    this.pipeline.chromaticAberration.aberrationAmount = 14; // «пиксели» экрана
    this.pipeline.chromaticAberration.radialIntensity = 0.6;

    // ── Ястрый светлый fog + clearColor (фиксированный «день») ──
    scene.fogMode = Scene.FOGMODE_EXP2;
    scene.fogColor = DAY_FOG_COLOR.clone();
    scene.fogDensity = BASE_FOG_DENSITY;
    const cc = scene.clearColor;
    cc.r = DAY_FOG_COLOR.r; cc.g = DAY_FOG_COLOR.g; cc.b = DAY_FOG_COLOR.b; cc.a = 1;

    // ── Дождь (particle system; стартует/останавливается по weather) ──
    this.rainTexture = makeRainTexture(scene);
    this.rain = new ParticleSystem('rain', 2500, scene);
    this.rain.particleTexture = this.rainTexture;
    this.rain.emitter = new Vector3(0, 0, 0);
    this.rain.minEmitBox = new Vector3(-this.boardHalf.x - 4, this.skyHeight * 0.9, -this.boardHalf.z - 4);
    this.rain.maxEmitBox = new Vector3(this.boardHalf.x + 4, this.skyHeight * 1.15, this.boardHalf.z + 4);
    this.rain.color1 = new Color4(0.62, 0.66, 0.78, 0.45);
    this.rain.color2 = new Color4(0.5, 0.54, 0.66, 0.4);
    this.rain.colorDead = new Color4(0.4, 0.44, 0.55, 0);
    this.rain.minSize = 0.04;
    this.rain.maxSize = 0.1;
    this.rain.minLifeTime = 0.8;
    this.rain.maxLifeTime = 1.4;
    this.rain.emitRate = 0;
    this.rain.direction1 = new Vector3(-1.2, -14, -1.2);
    this.rain.direction2 = new Vector3(1.2, -20, 1.2);
    this.rain.gravity = new Vector3(0, -2, 0);
    this.rain.minAngularSpeed = 0;
    this.rain.maxAngularSpeed = 0;
    this.rain.blendMode = ParticleSystem.BLENDMODE_STANDARD;
    this.rain.billboardMode = ParticleSystem.BILLBOARDMODE_STRETCHED;
    this.rain.start();

    // ── Молнии (только storm) ──
    this.lightning = new PointLight('lightning', new Vector3(0, this.skyHeight, 0), scene);
    this.lightning.diffuse = new Color3(0.7, 0.78, 1.0);
    this.lightning.specular = new Color3(0.1, 0.1, 0.15);
    this.lightning.intensity = 0;
    this.lightning.range = Math.max(boardW, boardH) * 1.6;

    // ── Боссовые огни (пул) ──
    this.bossLights = [];
    const bossCount = 4;
    for (let i = 0; i < bossCount; i++) {
      const l = new PointLight(`boss-eye-${i}`, new Vector3(0, 0, 0), scene);
      l.diffuse = BOSS_LIGHT_COLOR.clone();
      l.specular = new Color3(0.1, 0.02, 0.02);
      l.intensity = 0;
      l.range = grid.cellSize * 4.5;
      this.bossLights.push(l);
    }

    // ── Свечение алтаря базы ──
    this.baseLight = new PointLight('base-glow', new Vector3(0, 0, 0), scene);
    this.baseLight.diffuse = BASE_LIGHT_COLOR.clone();
    this.baseLight.specular = new Color3(0.05, 0.2, 0.18);
    this.baseLight.intensity = 0;
    this.baseLight.range = grid.cellSize * 5;

    // ── TD-104: фокальный тёплый fill над центром поля ──
    // Высокий overhead PointLight с большим радиусом → мягкий тёплый подъём
    // над всей игровой зоной; не конкурирует с DirectionalLight, а заполняет
    // тени на фигурах, чтобы они читались и днём, и ночью.
    this.focalLight = new PointLight('focal-fill', new Vector3(0, this.skyHeight * 0.55, 0), scene);
    this.focalLight.diffuse = FOCAL_LIGHT_COLOR.clone();
    this.focalLight.specular = new Color3(0.12, 0.10, 0.06);
    this.focalLight.intensity = 0.5;
    this.focalLight.range = Math.hypot(boardW, boardH) * 1.3;
  }

  // ── публичный API ──────────────────────────────────────────────────

  /** Зарегистрировать меш-источник как кастера теней (башни/враги/юниты). */
  addShadowCaster(mesh: Mesh): void {
    this.shadowGen.addShadowCaster(mesh, false);
    const mat = mesh.material as { receiveShadows?: boolean } | null;
    if (mat) mat.receiveShadows = true;
  }

  /** Прицепить свечение к маркеру базы (алтарь). Вызывается после построения LevelOverlay. */
  attachBaseMarker(baseMarker: { position: Vector3 }, cellSize: number): void {
    this.baseLight.position.copyFrom(baseMarker.position);
    this.baseLight.position.y += cellSize * 0.6;
    this.baseLight.intensity = 1.4;
    this.baseAttached = true;
  }

  /** Синхронизация атмосферы с состоянием сима каждый кадр.
   *  timeOfDay намеренно игнорируется — в режиме TD всегда день. */
  sync(state: GameSnapshot, dt: number): void {
    this.updateWeather(state.weather, dt);
    this.updateBossLights(state.enemies, state.tick);
    if (this.baseAttached) {
      // лёгкое пульсирование алтаря
      const pulse = 1.4 + Math.sin(state.tick * 0.18) * 0.25;
      this.baseLight.intensity = pulse;
    }
  }

  dispose(): void {
    this.rain.stop(true);
    this.rain.dispose();
    this.rainTexture.dispose();
    for (const l of this.bossLights) l.dispose();
    this.bossLights.length = 0;
    this.baseLight.dispose();
    this.focalLight.dispose();
    this.lightning.dispose();
    this.shadowGen.dispose();
    this.ssao.dispose();
    this.pipeline.dispose();
    this.sun.dispose();
    // hemispheric принадлежит сцене (создан в createScene) — не утилизируем тут.
  }

  // ── внутренние ─────────────────────────────────────────────────────

  private updateWeather(weather: Weather, dt: number): void {
    if (weather !== this.weather) {
      this.weather = weather;
    }
    // целевая «мощность» погоды
    const target = weather === 'storm' ? 1 : weather === 'rain' ? 0.6 : 0;
    // плавный нагон/спад (~0.8с)
    this.weatherTransition += (target - this.weatherTransition) * Math.min(1, dt * 1.2);
    if (Math.abs(target - this.weatherTransition) < 0.01) this.weatherTransition = target;

    // дождь густит fog (цвет неба остаётся светлым — меняется только плотность)
    this.scene.fogDensity = BASE_FOG_DENSITY * (1 + this.weatherTransition * 0.9);

    // дождь: rate по мощности
    const rate = this.weatherTransition * (weather === 'storm' ? 2400 : 1400);
    this.rain.emitRate = rate;
    this.rain.minEmitPower = weather === 'storm' ? 6 : 3;
    this.rain.maxEmitPower = weather === 'storm' ? 12 : 6;

    // молнии — только в storm, чисто визуально (не в snapshot)
    if (weather === 'storm') {
      this.lightningTimer -= dt;
      if (this.lightningTimer <= 0 && this.lightningFlash <= 0) {
        // запустить вспышку
        this.lightningFlash = 1;
        this.lightningTimer = 3 + Math.random() * 5; // редкие
        this.lightning.position.set(
          (Math.random() - 0.5) * this.boardHalf.x * 1.6,
          this.skyHeight,
          (Math.random() - 0.5) * this.boardHalf.z * 1.6
        );
      }
    }
    if (this.lightningFlash > 0) {
      this.lightningFlash -= dt * 8; // ~120мс вспышка
      if (this.lightningFlash < 0) this.lightningFlash = 0;
      this.lightning.intensity = this.lightningFlash * 3.5;
    } else {
      this.lightning.intensity = 0;
    }
  }

  private updateBossLights(enemies: Enemy[], tick: number): void {
    let idx = 0;
    for (const e of enemies) {
      if (!this.bossTypeIds.has(e.typeId)) continue;
      const l = this.bossLights[idx];
      if (!l) break;
      l.position.set(e.position.x, e.position.y + 1.2, e.position.z);
      l.intensity = 1.6 + Math.sin(tick * 0.4 + idx) * 0.4;
      idx += 1;
    }
    for (let i = idx; i < this.bossLights.length; i++) {
      this.bossLights[i].intensity = 0;
    }
  }
}

/** Тонкая вертикальная полоска для дождя (без внешних ассетов). */
function makeRainTexture(scene: Scene): RawTexture {
  const w = 4;
  const h = 32;
  const data = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) {
    const a = Math.round(255 * (1 - Math.abs(y - h / 2) / (h / 2)));
    for (let x = 0; x < w; x++) {
      const o = (y * w + x) * 4;
      data[o] = 200;
      data[o + 1] = 210;
      data[o + 2] = 230;
      data[o + 3] = a;
    }
  }
  const tex = new RawTexture(data, w, h, Constants.TEXTUREFORMAT_RGBA, scene, false, false, Texture.BILINEAR_SAMPLINGMODE);
  tex.name = 'rain-texture';
  tex.hasAlpha = true;
  return tex;
}
