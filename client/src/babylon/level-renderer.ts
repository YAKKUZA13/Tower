/**
 * Оверлей уровня: маркер спавна, маркер базы.
 * Phase 2: база/спавн — воксельные модели из каталога (если передан); иначе простые боксы.
 * Чистая визуализация состояния карты; обновляется при смене карты.
 *
 * Пост-MVP: ЖЁЛТАЯ ТРУБА ПУТИ УБРАНА. Путь теперь = tile:road-разметка
 * (см. shared/src/maps/index.ts → markRoadAlong), как в эталонных TD
 * (Kingdom Rush/Bloons — дорога интегрирована в террейн). updateRoute()
 * сохранён как no-op для back-compat (Game.vue + game-loop onRouteChange).
 */
import { Color3 } from '@babylonjs/core/Maths/math.color.js';
import { Mesh } from '@babylonjs/core/Meshes/mesh.js';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder.js';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial.js';
import { type Scene } from '@babylonjs/core/scene.js';
import type { GridData, MapDocument } from '@tower/shared';
import { sampleHeight } from './terrain/terrain-math';
import { BASE_COLOR, SPAWN_COLOR } from './colors';
import type { AssetCatalog } from './asset-catalog';

function cellCenter(grid: GridData, heightmap: number[][], col: number, row: number) {
  const x = (col + 0.5) * grid.cellSize - (grid.cols * grid.cellSize) / 2;
  const z = (row + 0.5) * grid.cellSize - (grid.rows * grid.cellSize) / 2;
  const y = sampleHeight(heightmap, grid, col, row, true);
  return { x, y, z };
}

export class LevelOverlay {
  private readonly meshes: Mesh[] = [];
  readonly baseMarker: Mesh;

  constructor(private scene: Scene, map: MapDocument, catalog?: AssetCatalog) {
    const { grid, heightmap } = map;
    // M8: TD-поля опциональны в типе; defaults для back-compat с RTS-only картами.
    const tdSpawn = map.spawnPoint ?? { col: 0, row: 0 };
    const tdBase = map.base ?? { col: Math.max(0, grid.cols - 1), row: Math.max(0, grid.rows - 1), hp: 20 };

    // ── спавн (портал) — TD-only; в RTS не показываем ──
    if (map.gameMode !== 'rts') {
      const spawnCenter = cellCenter(grid, heightmap, tdSpawn.col, tdSpawn.row);
      const spawn = catalog
        ? this.buildCatalogMarker(catalog, 'spawn:portal', 'level-spawn', grid.cellSize * 1.0)
        : this.buildBoxMarker('level-spawn', SPAWN_COLOR, Math.max(0.4, grid.cellSize * 0.6), scene);
      spawn.position.set(spawnCenter.x, spawnCenter.y, spawnCenter.z);
      spawn.position.y += grid.cellSize / 2;
      spawn.isPickable = false;
      this.meshes.push(spawn);
    }

    // ── база (алтарь с кристаллом) — TD-only; в RTS заменяем на town-hall у каждого игрока ──
    if (map.gameMode !== 'rts') {
      const baseCenter = cellCenter(grid, heightmap, tdBase.col, tdBase.row);
      const base = catalog
        ? this.buildCatalogMarker(catalog, 'base:altar', 'level-base', grid.cellSize * 1.15)
        : this.buildBoxMarker('level-base', BASE_COLOR, Math.max(0.6, grid.cellSize * 1.0), scene);
      base.position.set(baseCenter.x, baseCenter.y, baseCenter.z);
      base.position.y += grid.cellSize / 2;
      base.isPickable = false;
      this.meshes.push(base);
      this.baseMarker = base;
    } else {
      // В RTS — пустой placeholder marker (Game.vue всё равно заменит на town-hall instance).
      this.baseMarker = this.buildBoxMarker('rts-base-stub', BASE_COLOR, 0.1, scene);
      this.baseMarker.isVisible = false;
      this.meshes.push(this.baseMarker);
    }
  }

  /**
   * No-op (post-MVP): труба пути убрана. Маршрут врагов рисуется через
   * tile:road-разметку (см. maps/index.ts → markRoadAlong). Метод оставлен
   * для back-compat с game-loop onRouteChange и Game.vue restart.
   */
  updateRoute(_waypoints: { col: number; row: number }[]): void {
    /* intentionally no-op — путь = тайлы дороги */
  }

  private buildCatalogMarker(catalog: AssetCatalog, catalogId: string, name: string, scale: number): Mesh {
    const mesh = catalog.buildMaster(catalogId, name, { emissiveStrength: 0.28 });
    mesh.scaling.set(scale, scale, scale);
    return mesh;
  }

  private buildBoxMarker(name: string, color: [number, number, number], size: number, scene: Scene): Mesh {
    const mesh = MeshBuilder.CreateBox(name, { size }, scene);
    const mat = new StandardMaterial(`${name}Mat`, scene);
    mat.diffuseColor = new Color3(...color);
    mat.emissiveColor = new Color3(color[0] * 0.3, color[1] * 0.3, color[2] * 0.3);
    mesh.material = mat;
    return mesh;
  }

  dispose(): void {
    for (const m of this.meshes) m.dispose();
    this.meshes.length = 0;
  }
}
