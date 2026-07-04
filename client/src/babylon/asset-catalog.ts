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
import {
  VOXEL_BUILDERS,
  builderEmissive,
  buildVoxelMesh,
  normalizeMesh,
  type Voxel,
  type VoxelMeshOptions
} from './voxel/voxel-builder';

const DEFAULT_MANIFEST_URL = '/catalog/manifest.json';
const DEFAULT_GLB_BASE = '/catalog/';

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
  /** Свои воксель-билдеры (расширение каталога). */
  builders?: Record<string, () => Voxel[]>;
}

export class AssetCatalog {
  private readonly entries = new Map<string, CatalogEntry>();
  private readonly templates = new Map<string, Mesh>();
  private readonly builders: Record<string, () => Voxel[]>;

  private constructor(
    private readonly scene: Scene,
    private readonly glbBase: string
  ) {
    this.builders = { ...VOXEL_BUILDERS };
  }

  static async create(scene: Scene, config: AssetCatalogConfig = {}): Promise<AssetCatalog> {
    const cat = new AssetCatalog(scene, config.glbBase ?? DEFAULT_GLB_BASE);
    if (config.builders) Object.assign(cat.builders, config.builders);

    // 1. Загрузить манифест (если есть)
    let manifest: CatalogManifest | undefined = config.manifest;
    if (!manifest) {
      manifest = await cat.fetchManifest(config.manifestUrl ?? DEFAULT_MANIFEST_URL);
    }
    if (manifest) {
      for (const e of manifest.entries) cat.entries.set(e.catalogId, e);
    }

    // 2. Предзагрузить GLB-шаблоны для записей с glbPath
    await cat.preloadGlbTemplates();
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

  private async loadGlbTemplate(catalogId: string, entry: CatalogEntry): Promise<void> {
    try {
      const result = await SceneLoader.ImportMeshAsync('', this.glbBase, entry.glbPath, this.scene);
      const meshes = result.meshes.filter((m) => m instanceof Mesh) as Mesh[];
      if (meshes.length === 0) return;
      const merged = Mesh.MergeMeshes(meshes, true, false) ?? meshes[0];
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
        return clone;
      }
    }

    // 2. Процедурный воксель-билдер
    const builder = this.builders[id];
    if (builder) {
      const voxels = builder();
      const entry = this.entries.get(id);
      const emissive = options.emissive ?? builderEmissive(id) ?? entry?.emissive;
      return buildVoxelMesh(this.scene, voxels, {
        name,
        emissive,
        emissiveStrength: options.emissiveStrength ?? 0.18,
        alpha: options.alpha,
        matte: options.matte
      });
    }

    // 3. Фолбэк — простой бокс (не должен срабатывать для дефолтных каталогов)
    console.warn(`[AssetCatalog] unknown catalogId '${catalogId}' (resolved '${id}'); fallback to box`);
    const fb = MeshBuilder.CreateBox(name, { size: 0.4 }, this.scene);
    fb.isPickable = false;
    return fb;
  }

  dispose(): void {
    for (const m of this.templates.values()) m.dispose();
    this.templates.clear();
    this.entries.clear();
  }
}
