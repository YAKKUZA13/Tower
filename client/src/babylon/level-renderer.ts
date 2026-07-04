/**
 * Оверлей уровня: путь (tube), маркер спавна, маркер базы.
 * Phase 2: база/спавн — воксельные модели из каталога (если передан); иначе простые боксы.
 * Чистая визуализация состояния карты; обновляется при смене карты.
 */
import { Color3, Mesh, MeshBuilder, StandardMaterial, Vector3, type Scene } from 'babylonjs';
import type { GridData, MapDocument } from '@tower/shared';
import { sampleHeight } from './terrain/terrain-math';
import { BASE_COLOR, PATH_COLOR, SPAWN_COLOR } from './colors';
import type { AssetCatalog } from './asset-catalog';

function cellCenter(grid: GridData, heightmap: number[][], col: number, row: number): Vector3 {
  const x = (col + 0.5) * grid.cellSize - (grid.cols * grid.cellSize) / 2;
  const z = (row + 0.5) * grid.cellSize - (grid.rows * grid.cellSize) / 2;
  const y = sampleHeight(heightmap, grid, col, row, true);
  return new Vector3(x, y, z);
}

export class LevelOverlay {
  private readonly meshes: Mesh[] = [];
  readonly baseMarker: Mesh;

  constructor(private scene: Scene, map: MapDocument, catalog?: AssetCatalog) {
    const { grid, heightmap } = map;
    // ── путь (tube) ──
    const wps = map.path.waypoints;
    if (wps.length >= 2) {
      const path = wps.map((wp) => cellCenter(grid, heightmap, wp.col, wp.row));
      for (const p of path) p.y += 0.12;
      const tube = MeshBuilder.CreateTube('level-path', {
        path,
        radius: Math.max(0.18, grid.cellSize * 0.22),
        tessellation: 8,
        cap: Mesh.CAP_ALL
      }, scene);
      const mat = new StandardMaterial('levelPathMat', scene);
      const [r, g, b] = PATH_COLOR;
      mat.diffuseColor = new Color3(r, g, b);
      mat.emissiveColor = new Color3(r * 0.25, g * 0.25, b * 0.25);
      mat.alpha = 0.85;
      mat.specularColor = new Color3(0.05, 0.05, 0.05);
      tube.material = mat;
      tube.isPickable = false;
      this.meshes.push(tube);
    }

    // ── спавн (портал) ──
    const spawnCenter = cellCenter(grid, heightmap, map.spawnPoint.col, map.spawnPoint.row);
    const spawn = catalog
      ? this.buildCatalogMarker(catalog, 'spawn:portal', 'level-spawn', grid.cellSize * 1.0)
      : this.buildBoxMarker('level-spawn', SPAWN_COLOR, Math.max(0.4, grid.cellSize * 0.6), scene);
    spawn.position = spawnCenter;
    spawn.position.y += grid.cellSize / 2;
    spawn.isPickable = false;
    this.meshes.push(spawn);

    // ── база (алтарь с кристаллом) ──
    const baseCenter = cellCenter(grid, heightmap, map.base.col, map.base.row);
    const base = catalog
      ? this.buildCatalogMarker(catalog, 'base:altar', 'level-base', grid.cellSize * 1.15)
      : this.buildBoxMarker('level-base', BASE_COLOR, Math.max(0.6, grid.cellSize * 1.0), scene);
    base.position = baseCenter;
    base.position.y += grid.cellSize / 2;
    base.isPickable = false;
    this.meshes.push(base);
    this.baseMarker = base;
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
