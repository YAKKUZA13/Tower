/**
 * AssetCatalog (Phase 2 задача 2.2).
 *
 * Резолвит catalogId → master-меш для рендереров (enemy/tower/projectile/base).
 * Два источника (ADR-5):
 *  1. GLB из /catalog/** (реальные CC0 ассеты) — грузится через SceneLoader.ImportMeshAsync,
 *     кешируется как скрытый template-меш; buildMaster() возвращает клон.
 *  2. Процедурная воксель-модель (наш код, voxel-builder) — buildMaster() строит свежий меш.
 *
 * По умолчанию (без manifest.json / без glbPath) используется процедурный путь — это даёт
 * рабочий «тёмный» воксельный вид без сетевых зависимостей. Когда в public/catalog/
 * кладутся реальные GLB и прописываются в manifest.json — они подхватываются автоматически.
 */
import 'babylonjs-loaders';
import { Mesh, MeshBuilder, SceneLoader, type Scene } from 'babylonjs';
import type { CatalogEntry, CatalogManifest } from '@tower/shared';
import { compile, loadRecipe } from '@tower/shared';
import {
  VOXEL_BUILDERS,
  builderEmissive,
  buildVoxelMesh,
  buildVoxelMeshGreedy,
  GREEDY_VOXEL_THRESHOLD,
  normalizeMesh,
  type Voxel,
  type VoxelMeshOptions
} from './voxel/voxel-builder';
import { importVox } from './voxel/importers/vox-importer';
import { importGltfParts } from './voxel/importers/gltf-parts';
import { RIGGED_DEFS } from './voxel/importers/manual-parts';
import type { CharacterDef, PartNode } from './voxel/voxel-parts';
import { VoxelStampRegistry, assembleRecipe } from './voxel/primitives/voxel-stamps';

const DEFAULT_MANIFEST_URL = '/catalog/manifest.json';
const DEFAULT_GLB_BASE = '/catalog/';

/** Имена walk-нод для авто-детекта animKind импортированного gltf-рига. */
const WALK_NODE_NAMES = new Set(['spine', 'thighL', 'shinL', 'thighR', 'shinR', 'upperArmL', 'forearmL', 'upperArmR', 'forearmR', 'hips', 'head']);
/** Базовый URL для recipe JSON (M3). */
const DEFAULT_RECIPE_BASE = '/recipes/';

/** Легаси-каталоги ('primitive:arrow' из Phase 1) → канонические воксель-id. */
function resolveLegacy(id: string): string {
  if (id.startsWith('primitive:')) {
    const name = id.slice('primitive:'.length);
    // стрелок/пушка/аркан/лёд — башни; скелет/гоблин/зомби/демон/босс — враги
    const enemySet = new Set(['skeleton', 'goblin', 'zombie', 'demon', 'boss']);
    return enemySet.has(name) ? `enemy:${name}` : `tower:${name}`;
  }
  return id;
}

export interface AssetCatalogConfig {
  /** Явный манифест (тесты/override). Если задан — fetch не выполняется. */
  manifest?: CatalogManifest;
  /** URL манифеста (по умолчанию '/catalog/manifest.json'). */
  manifestUrl?: string;
  /** Базовый путь для GLB (по умолчанию '/catalog/'). */
  glbBase?: string;
  /** Базовый путь для recipe JSON (по умолчанию '/recipes/'). */
  recipeBase?: string;
  /** Свои воксель-билдеры (расширение каталога). */
  builders?: Record<string, () => Voxel[]>;
  /**
   * Пропустить загрузку glTF (.gltf/.glb) — preloadGlbTemplates И preloadRiggedGltf.
   * RTS-режим использует только процедурные воксель-риги/билдеры ( UNIT_RIGS /
   * RIGGED_DEFS / VOXEL_BUILDERS ) — это убирает «мусорные» подсетки glTF в
   * origin (утечка из MergeMeshes/importGltfParts), merge-предупреждения и
   * резко ускоряет init. TD/co-op оставляют false (там glTF ещё может
   * использоваться).
   */
  skipGltf?: boolean;
}

export class AssetCatalog {
  private readonly entries = new Map<string, CatalogEntry>();
  private readonly templates = new Map<string, Mesh>();
  private readonly builders: Record<string, () => Voxel[]>;
  /** Кеш импортированных CharacterDef (Фаза P3) по catalogId. */
  private readonly riggedDefs = new Map<string, CharacterDef>();
  /** Recipe-воксели (compile + assembleRecipe) по catalogId (M3). */
  private readonly recipeVoxels = new Map<string, Voxel[]>();
  /** Stamp-реестр для compile/assembleRecipe (M3). */
  private readonly stampRegistry = new VoxelStampRegistry();
  private readonly recipeBase: string;

  private constructor(
    private readonly scene: Scene,
    private readonly glbBase: string,
    recipeBase: string
  ) {
    this.builders = { ...VOXEL_BUILDERS };
    this.recipeBase = recipeBase;
  }

  static async create(scene: Scene, config: AssetCatalogConfig = {}): Promise<AssetCatalog> {
    const cat = new AssetCatalog(scene, config.glbBase ?? DEFAULT_GLB_BASE, config.recipeBase ?? DEFAULT_RECIPE_BASE);
    if (config.builders) Object.assign(cat.builders, config.builders);

    // 1. Загрузить манифест (если есть)
    let manifest: CatalogManifest | undefined = config.manifest;
    if (!manifest) {
      manifest = await cat.fetchManifest(config.manifestUrl ?? DEFAULT_MANIFEST_URL);
    }
    if (manifest) {
      for (const e of manifest.entries) cat.entries.set(e.catalogId, e);
    }

    // 2. Предзагрузить GLB-шаблоны, recipe-воксели и glTF-rigged-дефы (параллельно).
    // skipGltf (RTS): обход glTF целиком — процедурные риги/билдеры достаточны и
    // не дают утечек meшей в сцену.
    const skipGltf = config.skipGltf === true;
    await Promise.all([
      skipGltf ? Promise.resolve() : cat.preloadGlbTemplates(),
      cat.preloadRecipes(),
      skipGltf ? Promise.resolve() : cat.preloadRiggedGltf()
    ]);
    return cat;
  }

  private async fetchManifest(url: string): Promise<CatalogManifest | undefined> {
    try {
      const res = await fetch(url, { headers: { Accept: 'application/json' } });
      if (!res.ok) return undefined;
      const data = (await res.json()) as CatalogManifest;
      if (!data || !Array.isArray(data.entries)) return undefined;
      return data;
    } catch {
      // офлайн / нет файла — используем процедурные дефолты
      return undefined;
    }
  }

  private async preloadGlbTemplates(): Promise<void> {
    const tasks: Promise<void>[] = [];
    for (const [id, entry] of this.entries) {
      if (!entry.glbPath) continue;
      tasks.push(this.loadGlbTemplate(id, entry));
    }
    await Promise.all(tasks);
  }

  /**
   * Предзагрузка recipe JSON → compile + assembleRecipe → кеш Voxel[] (M3).
   * Recipe (Volume/Part/Group/Mirror/Row/Scatter) компилируется в плоский IR,
   * затем собирается в master Voxel[] через stamp-реестр. buildMaster берёт
   * кешированные воксели и строит greedy-меш (с normalizeMesh).
   */
  private async preloadRecipes(): Promise<void> {
    const tasks: Promise<void>[] = [];
    for (const [id, entry] of this.entries) {
      if (!entry.recipePath) continue;
      tasks.push(this.loadRecipe(id, entry.recipePath));
    }
    await Promise.all(tasks);
  }

  private async loadRecipe(catalogId: string, recipePath: string): Promise<void> {
    try {
      const res = await fetch(`${this.recipeBase}${recipePath}`, { headers: { Accept: 'application/json' } });
      if (!res.ok) return;
      const json = await res.text();
      const recipe = loadRecipe(json);
      const result = compile(recipe, this.stampRegistry);
      if (!result.ok) {
        console.warn(`[AssetCatalog] recipe '${catalogId}' (${recipePath}) compile errors:`,
          result.errors.map((e) => e.kind));
        return;
      }
      const voxels = assembleRecipe(result.recipe.parts, this.stampRegistry);
      if (voxels.length > 0) this.recipeVoxels.set(catalogId, voxels);
    } catch (err) {
      console.warn(`[AssetCatalog] recipe load failed for ${catalogId} (${recipePath}); procedural fallback`, err);
    }
  }

  /**
   * Hot-reload (dev, M3): инвалидирует кеш recipe и перезагружает указанный
   * (или все) recipe. Возвращает catalogId'ы, которые обновились. buildMaster
   * возьмёт свежие воксели при следующем вызове (для живого обновления исходного
   * меша нужно перестроить источник у рендерера).
   */
  async reloadRecipes(catalogIds?: string[]): Promise<string[]> {
    const ids = catalogIds ?? Array.from(this.entries.entries()).filter(([, e]) => e.recipePath).map(([id]) => id);
    await Promise.all(ids.map(async (id) => {
      const entry = this.entries.get(id);
      if (!entry?.recipePath) return;
      this.recipeVoxels.delete(id);
      await this.loadRecipe(id, entry.recipePath);
    }));
    return ids;
  }

  private async loadGlbTemplate(catalogId: string, entry: CatalogEntry): Promise<void> {
    try {
      const result = await SceneLoader.ImportMeshAsync('', this.glbBase, entry.glbPath, this.scene);
      const meshes = result.meshes.filter((m) => m instanceof Mesh) as Mesh[];
      if (meshes.length === 0) return;
      // MergeMeshes падает («different sideOrientation»), если у подсеток разные
      // sideOrientation/material-флаги → возвращает null. Раньше в этом случае мы
      // брали только meshes[0], а остальные подсетки (body/eyes/weapon...) leak'али
      // в сцену видимыми в origin («мусор» из glTF). Теперь: берём meshes[0] как
      // шаблон и гарантированно dispose'им все остальные, чтобы в сцене ничего не
      // осталось, кроме единственного скрытого template-меша.
      let merged: Mesh | null = Mesh.MergeMeshes(meshes, true, false);
      if (!merged) {
        merged = meshes[0]!;
        for (let i = 1; i < meshes.length; i++) {
          meshes[i]!.dispose(false, true);
        }
      }
      merged.name = `catalog-tpl-${catalogId}`;
      merged.id = merged.name;
      // нормализация к каноническому виду (base @ -0.5, height 1.0, XZ по центру)
      normalizeMesh(merged);
      // доп. масштаб/поворот из записи каталога (поверх нормализации)
      if (entry.rotationY) merged.rotation.y = entry.rotationY;
      if (entry.scale && entry.scale !== 1) merged.scaling.scaleInPlace(entry.scale);
      merged.isVisible = false;
      merged.isPickable = false;
      merged.setEnabled(false);
      this.templates.set(catalogId, merged);
    } catch (err) {
      console.warn(`[AssetCatalog] GLB load failed for ${catalogId} (${entry.glbPath}); using procedural fallback`, err);
    }
  }

  // ── публичный API ──────────────────────────────────────────────────

  has(catalogId: string): boolean {
    const id = resolveLegacy(catalogId);
    return this.templates.has(id) || this.entries.has(id) || id in this.builders;
  }

  getEntry(catalogId: string): CatalogEntry | undefined {
    return this.entries.get(resolveLegacy(catalogId));
  }

  /**
   * Возвращает свежий master-меш, принадлежащий вызывающему рендереру (dispose — на нём).
   * Меш отцентрирован в начале координат, высота ≈ 1.0 (воксели) или нормализованный GLB.
   *
   * Phase 8.5: материал мастера замораживается (material.freeze()) — кеш uniforms
   * для hot-path инстансинга (thin/InstancedMesh). День/ночь (atmosphere) меняет
   * свет СЦЕНЫ, а не материал-униформы → freeze безопасен. Террейн-ShaderMaterial
   * здесь не участвует и НЕ замораживается (ему нужны per-frame uniform-апдейты).
   */
  buildMaster(catalogId: string, name: string, options: Partial<VoxelMeshOptions> = {}): Mesh {
    const id = resolveLegacy(catalogId);

    // 1. GLB-шаблон
    const tpl = this.templates.get(id);
    if (tpl) {
      const clone = tpl.clone(name, null);
      if (clone) {
        clone.isVisible = true;
        clone.setEnabled(true);
        clone.isPickable = false;
        this.freezeMaterialOf(clone);
        return clone;
      }
    }

    // 1b. Recipe-воксели (M3): compile+assemble→greedy-меш (с normalizeMesh).
    const recipeVoxels = this.recipeVoxels.get(id);
    if (recipeVoxels && recipeVoxels.length > 0) {
      const entry = this.entries.get(id);
      const emissive = options.emissive ?? builderEmissive(id) ?? entry?.emissive;
      const mesh = buildVoxelMeshGreedy(this.scene, recipeVoxels, {
        name,
        emissive,
        emissiveStrength: options.emissiveStrength ?? 0.18,
        alpha: options.alpha ?? entry?.alpha,
        matte: options.matte,
        flat: options.flat
      });
      this.freezeMaterialOf(mesh);
      return mesh;
    }

    // 2. Процедурный воксель-билдер
    const builder = this.builders[id];
    if (builder) {
      const voxels = builder();
      const entry = this.entries.get(id);
      const emissive = options.emissive ?? builderEmissive(id) ?? entry?.emissive;
      // Тайлы пола строятся в flat-режиме (без baked AO): пол должен оставаться
      // ровно-ярким как baseline. AO/jitter применяются только к персонажам/башням.
      const flat = options.flat ?? id.startsWith('tile:');
      // Стратегия мешинга (research §12.2): greedy для крупных моделей (>порога
      // вокселей) — резко меньше треугольников; naive для tiny (projectile/bolt).
      // Явный options.meshing перекрывает авто-выбор.
      const meshing = options.meshing ?? (voxels.length > GREEDY_VOXEL_THRESHOLD ? 'greedy' : 'naive');
      const mesh = meshing === 'greedy'
        ? buildVoxelMeshGreedy(this.scene, voxels, {
            name,
            emissive,
            emissiveStrength: options.emissiveStrength ?? 0.18,
            alpha: options.alpha ?? entry?.alpha,
            matte: options.matte,
            flat
          })
        : buildVoxelMesh(this.scene, voxels, {
            name,
            emissive,
            emissiveStrength: options.emissiveStrength ?? 0.18,
            alpha: options.alpha ?? entry?.alpha,
            matte: options.matte,
            flat
          });
      this.freezeMaterialOf(mesh);
      return mesh;
    }

    // 3. Фолбэк — простой бокс (не должен срабатывать для дефолтных каталогов)
    console.warn(`[AssetCatalog] unknown catalogId '${catalogId}' (resolved '${id}'); fallback to box`);
    const fb = MeshBuilder.CreateBox(name, { size: 0.4 }, this.scene);
    fb.isPickable = false;
    return fb;
  }

  /** Замораживает material меша (если есть) — оптимизация uniform-кеша Babylon. */
  private freezeMaterialOf(mesh: Mesh): void {
    const mat = mesh.material;
    if (mat && typeof (mat as { freeze?: () => void }).freeze === 'function') {
      (mat as { freeze: () => void }).freeze();
    }
  }

  /**
   * Возвращает CharacterDef для part-graph рига (Фаза P3, research §5.3).
   *  - Если в manifest есть voxPath → fetch + importVox (scene-graph → PartNode-дерево).
   *  - Иначе если есть процедурный rigged-деф (RIGGED_DEFS) → он.
   *  - Иначе single-part деф из процедурного билдера (статичный риг).
   * Кешируется per catalogId (импорт детерминирован).
   */
  async buildRiggedMaster(catalogId: string): Promise<CharacterDef> {
    const id = resolveLegacy(catalogId);
    const cached = this.riggedDefs.get(id);
    if (cached) return cached;

    // 1. .vox из manifest
    const entry = this.entries.get(id);
    if (entry?.voxPath) {
      try {
        const res = await fetch(`${this.glbBase}${entry.voxPath}`, { headers: { Accept: 'application/octet-stream' } });
        if (res.ok) {
          const buf = await res.arrayBuffer();
          const def = importVox(buf);
          this.riggedDefs.set(id, def);
          return def;
        }
      } catch (err) {
        console.warn(`[AssetCatalog] .vox import failed for ${id} (${entry.voxPath}); procedural fallback`, err);
      }
    }

    // 1b. .glTF из manifest (G2, M6 solid voxelization): импорт → CharacterDef с walk-cycle.
    if (entry?.glbPath) {
      try {
        const def = await importGltfParts(`${this.glbBase}${entry.glbPath}`, this.scene);
        if (def && countPartVoxels(def) > 0) {
          def.animKind = detectAnimKind(def);
          def.name = `gltf:${id}`;
          this.riggedDefs.set(id, def);
          return def;
        }
      } catch (err) {
        console.warn(`[AssetCatalog] .glTF rigged import failed for ${id} (${entry.glbPath}); procedural fallback`, err);
      }
    }

    // 2. Процедурный rigged-деф
    const defFn = RIGGED_DEFS[id];
    if (defFn) {
      const def = defFn();
      this.riggedDefs.set(id, def);
      return def;
    }

    // 3. Single-part фолбэк из билдера
    const builder = this.builders[id];
    const voxels = builder ? builder() : [];
    const def: CharacterDef = {
      name: `rigged-${id}`,
      root: { name: 'body', pivot: [0, 0, 0], voxels, children: [] }
    };
    this.riggedDefs.set(id, def);
    return def;
  }

  /**
   * Предзагрузка glTF → rigged CharacterDef (G2): для записей с glbPath импортирует
   * gltf (через gltf-parts + solid voxelization M6) → кеш riggedDefs. RiggedEnemyRenderer/
   * RiggedUnitRenderer берут деф синхронно через getRiggedDef(). Процедурные риги = fallback.
   */
  private async preloadRiggedGltf(): Promise<void> {
    const tasks: Promise<void>[] = [];
    for (const [id, entry] of this.entries) {
      if (!entry.glbPath) continue;
      tasks.push(this.buildRiggedMaster(id).then((def) => {
        if (def && countPartVoxels(def) > 0) {
          def.animKind = detectAnimKind(def);
        }
      }).catch(() => { /* предупреждение уже залогировано в buildRiggedMaster */ }));
    }
    await Promise.all(tasks);
  }

  /** Sync-доступ к предзагруженному rigged-дефу (для рендереров; undefined = нет). */
  getRiggedDef(catalogId: string): CharacterDef | undefined {
    return this.riggedDefs.get(resolveLegacy(catalogId));
  }

  dispose(): void {
    for (const m of this.templates.values()) m.dispose();
    this.templates.clear();
    this.entries.clear();
    this.riggedDefs.clear();
  }
}

/** Сумма вокселей всех партов CharacterDef. */
function countPartVoxels(def: CharacterDef): number {
  let n = 0;
  const walk = (p: PartNode): void => {
    n += p.voxels.length;
    for (const c of p.children) walk(c);
  };
  walk(def.root);
  return n;
}

/** Авто-детект animKind импортированного рига по именам суставов (walk-cycle). */
function detectAnimKind(def: CharacterDef): CharacterDef['animKind'] {
  const names = new Set<string>();
  const collect = (p: PartNode): void => {
    names.add(p.name.toLowerCase());
    for (const c of p.children) collect(c);
  };
  collect(def.root);
  let walkHits = 0;
  for (const n of WALK_NODE_NAMES) if (names.has(n)) walkHits++;
  // если ≥4 walk-нод из 11 — считаем гуманоидным (walk-cycle покроет доступные).
  return walkHits >= 4 ? 'humanoid' : 'static';
}
