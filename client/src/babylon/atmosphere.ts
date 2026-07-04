/**
 * Тёмная атмосфера дарк-фэнтези (Phase 3, концепция 5).
 * См. TD-MVP-PLAN.md §3 (задачи 3.1–3.6) и §4.5.
 *
 * Состав:
 *  - DefaultRenderingPipeline: ACES tonemap, bloom, grain, vignette, chromatic aberration, FXAA/MSAA.
 *  - DirectionalLight (луна/тусклое солнце) + ShadowGenerator (PCF; только акторы).
 *  - HemisphericLight понижен до ambient-fill (дешёвый sky/ground fill).
 *  - DayNightController: по snapshot.timeOfDay считает угол/цвет/интенсивность света,
 *    ambient, fog-цвет, clearColor И обновляет uniform-ы кастомного terrain-шейдера.
 *  - WeatherController: rain/storm → particle system + fog density↑; storm → редкие молнии.
 *  - Цветные PointLight: свечение базы (алтарь) + «глаза» боссов.
 *
 * ADR (Фаза 3): тени рендерятся ТОЛЬКО между акторами (receiveShadows=false на террейне,
 * т.к. у него собственный ShaderMaterial без shadow-pass) — это литеральная трактовка
 * плана (§3.2/§8) и самый дешёвый стабильный вариант без правки GLSL террейна.
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
  ShadowGenerator,
  Texture,
  Vector3,
  type Camera
} from 'babylonjs';
import type { Enemy, GameSnapshot, Weather } from '@tower/shared';

// ── палитра дарк-фэнтези (день = сумрачный, ночь = глубоко-синяя) ────────────────
const DAY_SUN = new Color3(0.55, 0.56, 0.64); // холодное тусклое солнце
const NIGHT_MOON = new Color3(0.20, 0.24, 0.40); // холодная луна
const SUNSET = new Color3(0.78, 0.36, 0.18); // кровавый закат/рассвет (короткая полоса)

const DAY_SKY = new Color3(0.30, 0.32, 0.40); // ambient sky днём
const NIGHT_SKY = new Color3(0.05, 0.06, 0.13);
const DAY_GROUND = new Color3(0.18, 0.16, 0.14);
const NIGHT_GROUND = new Color3(0.02, 0.02, 0.04);

const DAY_FOG = new Color3(0.17, 0.18, 0.22); // пепельно-серый
const NIGHT_FOG = new Color3(0.02, 0.03, 0.07); // чёрно-синий

const BOSS_LIGHT_COLOR = new Color3(0.85, 0.22, 0.18); // кровавые «глаза» босса
const BASE_LIGHT_COLOR = new Color3(0.25, 0.70, 0.58); // холодное свечение алтаря

interface TerrainUniformProxy {
  material: {
    setVector3: (name: string, v: Vector3) => void;
    setFloat: (name: string, v: number) => void;
  };
}

export interface AtmosphereOptions {
  /** Существующий HemisphericLight (используется как ambient-fill + источник для terrain-шейдера). */
  hemispheric: HemisphericLight;
  /** Игровой ground-меш (для апдейта uniform-ов террейн-шейдера). Опционально. */
  ground?: Mesh;
  /** Размеры поля (для области эмиссии дождя). */
  board?: { width: number; height: number };
  /** TypeId врагов, которые несут «глазной» PointLight (обычно boss-категория). */
  bossTypeIds?: Set<string>;
}

const SCRATCH_V3 = new Vector3();

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}
function lerpColor(out: Color3, a: Color3, b: Color3, t: number): void {
  out.r = lerp(a.r, b.r, t);
  out.g = lerp(a.g, b.g, t);
  out.b = lerp(a.b, b.b, t);
}
function clamp01(x: number): number {
  return x < 0 ? 0 : x > 1 ? 1 : x;
}

/** Чистая геометрия солнца по timeOfDay ∈ [0,1). 0=полночь, 0.5=полдень. */
function computeSunArc(timeOfDay: number): { elevation: number; sunUp: number; twilight: number } {
  // ang: 0 на рассвете (0.25), π/2 в полдень (0.5), π на закате (0.75), -π/2 в полночь (0).
  const ang = (timeOfDay - 0.25) * Math.PI * 2;
  const elevation = Math.sin(ang); // -1..1
  const sunUp = clamp01(elevation); // 0 ночью, 1 в полдень
  // узкая полоса «на горизонте» — для тёплого отсвета на рассвете/закате
  const twilight = clamp01(1 - Math.abs(elevation) * 3);
  return { elevation, sunUp, twilight };
}

export class AtmosphereRenderer {
  private readonly scene: Scene;
  private readonly hemispheric: HemisphericLight;
  private readonly sun: DirectionalLight;
  private readonly shadowGen: ShadowGenerator;
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

  // переиспользуемые scratch-цвета/векторы (без GC в кадре)
  private readonly cDir = new Color3();
  private readonly cSky = new Color3();
  private readonly cGround = new Color3();
  private readonly cFog = new Color3();
  private readonly vSky = new Vector3();
  private readonly vGround = new Vector3();

  constructor(scene: Scene, camera: Camera, grid: { cols: number; rows: number; cellSize: number }, options: AtmosphereOptions) {
    this.scene = scene;
    this.hemispheric = options.hemispheric;
    this.ground = options.ground;
    const boardW = options.board?.width ?? grid.cols * grid.cellSize;
    const boardH = options.board?.height ?? grid.rows * grid.cellSize;
    this.boardHalf = { x: boardW / 2, z: boardH / 2 };
    this.skyHeight = Math.max(boardW, boardH) * 1.0;
    this.bossTypeIds = options.bossTypeIds ?? new Set();

    // ── DirectionalLight (луна/солнце) ──
    this.sun = new DirectionalLight('sun', new Vector3(0.4, -0.8, 0.45).normalize(), scene);
    this.sun.position = new Vector3(0, this.skyHeight, 0);
    this.sun.intensity = 0.7;
    this.sun.diffuse = DAY_SUN.clone();

    // ── Тени (PCF, low-med map). Только акторы — регистрируются через addShadowCaster. ──
    this.shadowGen = new ShadowGenerator(1024, this.sun);
    this.shadowGen.usePercentageCloserFiltering = true;
    this.shadowGen.filteringQuality = ShadowGenerator.QUALITY_MEDIUM;
    this.shadowGen.bias = 0.0012;
    this.shadowGen.normalBias = 0.02;
    this.shadowGen.darkness = 0.45;
    this.shadowGen.transparencyShadow = false;

    // Террейн НЕ получает тени (ShaderMaterial без shadow-pass; §3.2).
    if (this.ground) this.ground.receiveShadows = false;

    // ── HemisphericLight → ambient-fill низкого уровня ──
    this.hemispheric.intensity = 0.6;
    this.hemispheric.diffuse = DAY_SKY.clone();
    this.hemispheric.groundColor = DAY_GROUND.clone();

    // ── Пост-процесс ──
    this.pipeline = new DefaultRenderingPipeline('atmosphere-pipeline', true, scene, [camera]);
    this.pipeline.samples = 2; // MSAA
    this.pipeline.fxaaEnabled = true;

    this.pipeline.bloomEnabled = true;
    this.pipeline.bloomThreshold = 0.72;
    this.pipeline.bloomWeight = 0.45;
    this.pipeline.bloomKernel = 64;
    this.pipeline.bloomScale = 0.5;

    this.pipeline.imageProcessingEnabled = true;
    this.pipeline.imageProcessing.toneMappingEnabled = true;
    this.pipeline.imageProcessing.toneMappingType = ImageProcessingConfiguration.TONEMAPPING_ACES;
    this.pipeline.imageProcessing.exposure = 1.1;
    this.pipeline.imageProcessing.contrast = 1.18;
    this.pipeline.imageProcessing.vignetteEnabled = true;
    this.pipeline.imageProcessing.vignetteWeight = 3.2;
    this.pipeline.imageProcessing.vignetteStretch = 0.35;
    this.pipeline.imageProcessing.vignetteColor = new Color4(0, 0, 0, 1);

    this.pipeline.grainEnabled = true;
    this.pipeline.grain.intensity = 0.08;
    this.pipeline.grain.animated = true;

    this.pipeline.chromaticAberrationEnabled = true;
    this.pipeline.chromaticAberration.aberrationAmount = 14; // «пиксели» экрана
    this.pipeline.chromaticAberration.radialIntensity = 0.6;

    scene.fogMode = Scene.FOGMODE_EXP2;

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

  /** Синхронизация атмосферы с состоянием сима каждый кадр. */
  sync(state: GameSnapshot, dt: number): void {
    this.updateDayNight(state.timeOfDay);
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
    this.lightning.dispose();
    this.shadowGen.dispose();
    this.pipeline.dispose();
    this.sun.dispose();
    // hemispheric принадлежит сцене (создан в createScene) — не утилизируем тут.
  }

  // ── внутренние ─────────────────────────────────────────────────────

  private updateDayNight(timeOfDay: number): void {
    const { elevation, sunUp, twilight } = computeSunArc(timeOfDay);

    // DirectionalLight: направление (по дуге), цвет, интенсивность
    const ang = (timeOfDay - 0.25) * Math.PI * 2;
    const sx = Math.cos(ang);
    SCRATCH_V3.set(sx * 0.6, -Math.max(0.15, elevation), 0.45);
    this.sun.direction = SCRATCH_V3.normalize();
    // позиция — «над» центром поля, против направления (для фрустума теней)
    this.sun.position.set(-this.sun.direction.x * this.skyHeight * 1.4, this.skyHeight * 1.3, -this.sun.direction.z * this.skyHeight * 1.4);

    lerpColor(this.cDir, NIGHT_MOON, DAY_SUN, sunUp);
    lerpColor(this.cDir, this.cDir, SUNSET, twilight * 0.55);
    this.sun.diffuse = this.cDir;
    this.sun.intensity = lerp(0.18, 0.75, sunUp) + twilight * 0.12;

    // Hemispheric ambient-fill
    lerpColor(this.cSky, NIGHT_SKY, DAY_SKY, sunUp);
    lerpColor(this.cGround, NIGHT_GROUND, DAY_GROUND, sunUp);
    this.hemispheric.diffuse = this.cSky;
    this.hemispheric.groundColor = this.cGround;
    this.hemispheric.intensity = lerp(0.32, 0.85, sunUp);

    // Fog / clearColor — холоднее ночью, кровавый акцент на twilight
    lerpColor(this.cFog, NIGHT_FOG, DAY_FOG, sunUp);
    lerpColor(this.cFog, this.cFog, SUNSET, twilight * 0.22);
    const baseFog = lerp(0.006, 0.013, 1 - sunUp); // ночью гуще
    this.scene.fogColor = this.cFog;
    this.scene.fogDensity = baseFog * (1 + this.weatherTransition * 0.9);
    const cc = this.scene.clearColor;
    cc.r = this.cFog.r; cc.g = this.cFog.g; cc.b = this.cFog.b; cc.a = 1;

    // апдейт uniform-ов террейн-шейдера (день/ночь окраска земли)
    const terrain = this.ground?.metadata?.terrain as TerrainUniformProxy | undefined;
    if (terrain) {
      terrain.material.setVector3('lightDir', this.sun.direction);
      this.vSky.set(this.cSky.r, this.cSky.g, this.cSky.b);
      this.vGround.set(this.cGround.r, this.cGround.g, this.cGround.b);
      terrain.material.setVector3('lightSky', this.vSky);
      terrain.material.setVector3('lightGround', this.vGround);
      terrain.material.setFloat('lightIntensity', this.hemispheric.intensity);
    }
  }

  private updateWeather(weather: Weather, dt: number): void {
    if (weather !== this.weather) {
      this.weather = weather;
    }
    // целевая «мощность» погоды
    const target = weather === 'storm' ? 1 : weather === 'rain' ? 0.6 : 0;
    // плавный нагон/спад (~0.8с)
    this.weatherTransition += (target - this.weatherTransition) * Math.min(1, dt * 1.2);
    if (Math.abs(target - this.weatherTransition) < 0.01) this.weatherTransition = target;

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
