/**
 * Рендер реликвий (Phase 5 задача 5.4, концепция 1).
 *
 *  - InstancedMesh на тип тотема (реликвий мало и они статичны — как башни, ADR-4).
 *  - Source-меши — воксельные тотемы из каталога (master нормализован, unit-размер);
 *    cellSize задаётся на каждом инстансе (контракт Ф2.b/c).
 *  - Пул PointLight (RELIC_LIGHT_POOL): светится «лучший» подмножество размещённых
 *    реликвий (epic > rare > common). Цвет света = emissive-акцент тотема.
 *    Интенсивность пульсирует (магия). Остальные реликвии видны за счёт emissive + bloom.
 *  - Инстансы медленно вращаются (магический эффект); pickable по имени 'relic-inst-<id>'.
 *
 * Сим/domain не тронуты — рендер только читает state.relics (детерминизм ADR-2 сохранён).
 */
import { Color3, InstancedMesh, Mesh, PointLight, Vector3, type Scene } from 'babylonjs';
import type { GameSnapshot, GridData, PlacedRelic, RelicRarity, RelicType } from '@tower/shared';
import type { AssetCatalog } from '../asset-catalog';
import { sampleHeight } from '../terrain/terrain-math';
import { relicAccent } from '../voxel/dark-palette';

const RELIC_LIGHT_POOL = 4;
const RARITY_RANK: Record<RelicRarity, number> = { epic: 3, rare: 2, common: 1 };

interface SourceEntry {
  source: Mesh;
  cellSize: number;
  /** Кешированный цвет свечения (для PointLight без аллокаций в кадре). */
  lightColor: Color3;
  spinSeed: number;
}

export class RelicRenderer {
  private readonly sources = new Map<string, SourceEntry>();
  private readonly instances = new Map<string, InstancedMesh>();
  private readonly relicTypes: Map<string, RelicType>;
  private readonly grid: GridData;
  private readonly heightmap: number[][];
  private readonly lights: PointLight[] = [];
  private readonly halfW: number;
  private readonly halfH: number;

  constructor(scene: Scene, relicTypes: RelicType[], grid: GridData, heightmap: number[][], catalog: AssetCatalog) {
    this.grid = grid;
    this.heightmap = heightmap;
    this.halfW = (grid.cols * grid.cellSize) / 2;
    this.halfH = (grid.rows * grid.cellSize) / 2;
    this.relicTypes = new Map(relicTypes.map((r) => [r.id, r]));

    // построить source-меши для каждого типа реликвии
    for (const rt of relicTypes) {
      const source = catalog.buildMaster(rt.modelRef.catalogId, `relic-src-${rt.id}`, { emissiveStrength: 0.4 });
      source.isVisible = false; // рендерятся только инстансы
      source.isPickable = false;
      source.doNotSyncBoundingInfo = true;
      const accent = relicAccent(rt.modelRef.catalogId);
      this.sources.set(rt.id, {
        source,
        cellSize: grid.cellSize,
        lightColor: new Color3(accent[0], accent[1], accent[2]),
        spinSeed: hashSeed(rt.id)
      });
    }

    // пул магических огней
    for (let i = 0; i < RELIC_LIGHT_POOL; i++) {
      const l = new PointLight(`relic-light-${i}`, new Vector3(0, 0, 0), scene);
      l.diffuse = new Color3(0.5, 0.4, 0.9);
      l.specular = new Color3(0.05, 0.05, 0.1);
      l.intensity = 0;
      l.range = grid.cellSize * 3.2;
      this.lights.push(l);
    }
  }

  /** Клик-пикинг по инстансам реликвий: возвращает relicId или null. */
  pickRelicId(mesh: { name: string } | null | undefined): string | null {
    if (!mesh) return null;
    if (mesh.name.startsWith('relic-inst-')) return mesh.name.slice('relic-inst-'.length);
    return null;
  }

  /** Source-меши (по типу) — для регистрации теней. Инстансы наследуют тень от source. */
  getShadowCasterMeshes(): Mesh[] {
    return Array.from(this.sources.values()).map((s) => s.source);
  }

  sync(state: GameSnapshot): void {
    const seen = new Set<string>();
    const cellSize = this.grid.cellSize;

    for (const relic of state.relics) {
      seen.add(relic.id);
      const entry = this.sources.get(relic.typeId);
      if (!entry) continue;
      let inst = this.instances.get(relic.id);
      if (!inst) {
        inst = entry.source.createInstance(`relic-inst-${relic.id}`);
        inst.isPickable = true;
        inst.scaling.set(entry.cellSize, entry.cellSize, entry.cellSize);
        this.instances.set(relic.id, inst);
      }
      const groundY = sampleHeight(this.heightmap, this.grid, relic.col, relic.row, true);
      const x = (relic.col + 0.5) * cellSize - this.halfW;
      const z = (relic.row + 0.5) * cellSize - this.halfH;
      // модель base @ y=-0.5 → центр на groundY + cellSize/2 (тотем чуть выше — «парит»)
      inst.position.set(x, groundY + cellSize * 0.55, z);
      inst.rotation.y = state.tick * 0.02 + entry.spinSeed;
    }

    // удалить исчезнувшие реликвии
    for (const [id, inst] of this.instances) {
      if (!seen.has(id)) {
        inst.dispose();
        this.instances.delete(id);
      }
    }

    // назначить PointLight на «лучшие» реликвии (epic > rare > common), пульсация
    const ranked = [...state.relics]
      .map((r) => ({ relic: r, rank: this.relicTypes.get(r.typeId)?.rarity ? RARITY_RANK[this.relicTypes.get(r.typeId)!.rarity] : 0 }))
      .sort((a, b) => b.rank - a.rank);

    for (let i = 0; i < this.lights.length; i++) {
      const light = this.lights[i];
      const entry = ranked[i];
      if (!entry) {
        light.intensity = 0;
        continue;
      }
      const src = this.sources.get(entry.relic.typeId);
      if (!src) {
        light.intensity = 0;
        continue;
      }
      const groundY = sampleHeight(this.heightmap, this.grid, entry.relic.col, entry.relic.row, true);
      const x = (entry.relic.col + 0.5) * cellSize - this.halfW;
      const z = (entry.relic.row + 0.5) * cellSize - this.halfH;
      light.position.set(x, groundY + cellSize * 0.9, z);
      light.diffuse = src.lightColor;
      // пульсация магии (косметика — не в snapshot, рассинк визуала на клиентах не ломает геймплей)
      light.intensity = 1.0 + Math.sin(state.tick * 0.2 + i * 1.7) * 0.35;
    }
  }

  dispose(): void {
    for (const inst of this.instances.values()) inst.dispose();
    this.instances.clear();
    for (const s of this.sources.values()) s.source.dispose();
    this.sources.clear();
    for (const l of this.lights) l.dispose();
    this.lights.length = 0;
  }
}

/** Детерминированный «зерно» поворота по id реликвии (стабильный визуальный разброс). */
function hashSeed(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) {
    h = (h * 31 + id.charCodeAt(i)) | 0;
  }
  return (h & 0xffff) * 0.0001;
}
