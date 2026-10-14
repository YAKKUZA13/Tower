import { Color3 } from '@babylonjs/core/Maths/math.color.js';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial.js';
import { InstancedMesh } from '@babylonjs/core/Meshes/instancedMesh.js';
import { Mesh } from '@babylonjs/core/Meshes/mesh.js';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder.js';
import { TransformNode } from '@babylonjs/core/Meshes/transformNode.js';
import { type Scene } from '@babylonjs/core/scene.js';
import type { MapDocument, TileType } from '@tower/shared';
import { sampleHeight } from './terrain-math';

type SceneryKind = 'pine' | 'rock' | 'stump';

interface Part {
  source: Mesh;
  position: readonly [number, number, number];
  scaling: readonly [number, number, number];
  rotationY?: number;
}

interface SceneryItem {
  kind: SceneryKind;
  col: number;
  row: number;
  scale: number;
  rotation: number;
}

/**
 * Sparse deterministic biome props. They remain render-only: gameplay blockers
 * are shared with navigation before the simulation starts.
 */
export class RtsSceneryRenderer {
  private readonly roots: TransformNode[] = [];
  private readonly masters = new Map<SceneryKind, Part[]>();
  private readonly blockedCells: { col:number; row:number }[] = [];

  constructor(private readonly scene: Scene, private readonly map: MapDocument) {
    this.masters.set('pine', this.buildPine());
    this.masters.set('rock', this.buildRock());
    this.masters.set('stump', this.buildStump());
    for (const item of createSceneryPlan(map)) {
      this.instantiate(item);
      if(item.kind !== 'stump') this.blockedCells.push({col:item.col,row:item.row});
    }
  }

  getNavigationBlockedCells(): readonly { col:number; row:number }[] {return this.blockedCells;}

  getShadowCasterMeshes(): Mesh[] {
    const out: Mesh[] = [];
    for (const parts of this.masters.values()) for (const part of parts) out.push(part.source);
    return out;
  }

  private instantiate(item: SceneryItem): void {
    const grid = this.map.grid;
    const root = new TransformNode(`scenery-${item.kind}-${item.col}-${item.row}`, this.scene);
    const x = (item.col + 0.5) * grid.cellSize - grid.cols * grid.cellSize * 0.5;
    const z = (item.row + 0.5) * grid.cellSize - grid.rows * grid.cellSize * 0.5;
    const y = sampleHeight(this.map.heightmap, grid, item.col, item.row, true);
    root.position.set(x, y, z);
    root.rotation.y = item.rotation;
    root.scaling.setAll(grid.cellSize * item.scale);
    root.metadata = { sceneryKind: item.kind, biomeDecoration: true };
    const parts = this.masters.get(item.kind) ?? [];
    parts.forEach((part, index) => {
      const instance = part.source.createInstance(`${root.name}-part-${index}`);
      instance.parent = root;
      instance.position.set(...part.position);
      instance.scaling.set(...part.scaling);
      instance.rotation.y = part.rotationY ?? 0;
      instance.isPickable = false;
      instance.receiveShadows = true;
    });
    this.roots.push(root);
  }

  private buildPine(): Part[] {
    const bark = material(this.scene, 'scenery-bark', new Color3(0.25, 0.14, 0.09));
    const needles = material(this.scene, 'scenery-needles', new Color3(0.10, 0.24, 0.20));
    const needlesLight = material(this.scene, 'scenery-needles-light', new Color3(0.16, 0.34, 0.27));
    return [
      source(this.scene, 'pine-root', bark, [0, 0.08, 0], [0.62, 0.12, 0.52]),
      source(this.scene, 'pine-trunk', bark, [0, 0.62, 0], [0.18, 1.22, 0.18]),
      source(this.scene, 'pine-branch', bark, [0.18, 0.72, 0], [0.42, 0.10, 0.12], 0.32),
      source(this.scene, 'pine-crown-low', needles, [0, 1.00, 0], [0.94, 0.34, 0.82], 0.10),
      source(this.scene, 'pine-crown-mid', needlesLight, [0, 1.28, 0], [0.72, 0.32, 0.64], -0.08),
      source(this.scene, 'pine-crown-high', needles, [0, 1.54, 0], [0.48, 0.30, 0.44], 0.12),
      source(this.scene, 'pine-tip', needlesLight, [0, 1.76, 0], [0.22, 0.25, 0.22])
    ];
  }

  private buildRock(): Part[] {
    const deep = material(this.scene, 'scenery-rock-deep', new Color3(0.25, 0.28, 0.29));
    const face = material(this.scene, 'scenery-rock-face', new Color3(0.39, 0.40, 0.39));
    const cap = material(this.scene, 'scenery-rock-cap', new Color3(0.48, 0.46, 0.42));
    const moss = material(this.scene, 'scenery-rock-moss', new Color3(0.17, 0.28, 0.18));
    return [
      source(this.scene, 'rock-foot', deep, [0, 0.12, 0], [1.10, 0.24, 0.82], 0.06),
      source(this.scene, 'rock-left', face, [-0.28, 0.42, 0.02], [0.55, 0.56, 0.62], -0.08),
      source(this.scene, 'rock-right', deep, [0.30, 0.34, 0.12], [0.48, 0.42, 0.48], 0.16),
      source(this.scene, 'rock-high', face, [-0.12, 0.76, -0.05], [0.50, 0.42, 0.54], 0.04),
      source(this.scene, 'rock-cap', cap, [-0.10, 1.00, -0.05], [0.54, 0.14, 0.58], -0.04),
      source(this.scene, 'rock-moss', moss, [-0.18, 1.09, -0.02], [0.32, 0.05, 0.34], 0.10),
      source(this.scene, 'rock-chip-a', cap, [-0.58, 0.10, -0.28], [0.20, 0.16, 0.18], 0.30),
      source(this.scene, 'rock-chip-b', face, [0.58, 0.09, -0.12], [0.15, 0.12, 0.16], -0.20)
    ];
  }

  private buildStump(): Part[] {
    const bark = material(this.scene, 'scenery-stump-bark', new Color3(0.27, 0.15, 0.08));
    const cut = material(this.scene, 'scenery-stump-cut', new Color3(0.48, 0.32, 0.18));
    return [
      source(this.scene, 'stump-root', bark, [0, 0.06, 0], [0.72, 0.12, 0.56]),
      source(this.scene, 'stump-body', bark, [0, 0.26, 0], [0.34, 0.44, 0.34], 0.10),
      source(this.scene, 'stump-cut', cut, [0, 0.50, 0], [0.37, 0.06, 0.37], -0.08)
    ];
  }

  dispose(): void {
    for (const root of this.roots) root.dispose();
    this.roots.length = 0;
    for (const parts of this.masters.values()) for (const part of parts) part.source.dispose(false, true);
    this.masters.clear();
  }
}

function createSceneryPlan(map: MapDocument): SceneryItem[] {
  const out: SceneryItem[] = [];
  const starts = map.playerStarts ?? [];
  const nodes = map.resourceNodes ?? [];
  const tileAt = (col: number, row: number): TileType => map.tiles?.[row]?.[col] ?? 'grass';
  const protectedCell = (col: number, row: number): boolean =>
    starts.some((start) => Math.hypot(start.townHall.col - col, start.townHall.row - row) < 5) ||
    nodes.some((node) => Math.hypot(node.col - col, node.row - row) < 2.2);

  for (let row = 1; row < map.grid.rows - 1; row++) {
    for (let col = 1; col < map.grid.cols - 1; col++) {
      if (protectedCell(col, row)) continue;
      const tile = tileAt(col, row);
      const h = hash01(col, row);
      if (tile === 'rock' && h > 0.50) {
        out.push({ kind: 'rock', col, row, scale: 0.72 + h * 0.24, rotation: h * Math.PI * 2 });
      } else if (tile === 'grass' && h > 0.986) {
        out.push({ kind: 'pine', col, row, scale: 0.72 + h * 0.18, rotation: h * Math.PI * 2 });
      } else if (tile === 'dirt' && h > 0.993) {
        out.push({ kind: 'stump', col, row, scale: 0.68 + h * 0.16, rotation: h * Math.PI * 2 });
      }
    }
  }
  return out;
}

function source(
  scene: Scene,
  name: string,
  mat: StandardMaterial,
  position: Part['position'],
  scaling: Part['scaling'],
  rotationY = 0
): Part {
  const mesh = MeshBuilder.CreateBox(`scenery-master-${name}`, { size: 1 }, scene);
  mesh.material = mat;
  mesh.isVisible = false;
  mesh.isPickable = false;
  return { source: mesh, position, scaling, rotationY };
}

function material(scene: Scene, name: string, color: Color3): StandardMaterial {
  const mat = new StandardMaterial(name, scene);
  mat.diffuseColor = color;
  mat.emissiveColor = color.scale(0.045);
  mat.specularColor = new Color3(0.025, 0.025, 0.025);
  mat.roughness = 0.96;
  return mat;
}

function hash01(x: number, z: number): number {
  let value = Math.imul(x + 0x632be5ab, 0x9e3779b1) ^ Math.imul(z + 0x85157af5, 0x85ebca77);
  value ^= value >>> 16;
  value = Math.imul(value, 0x7feb352d);
  value ^= value >>> 15;
  return (value >>> 0) / 4294967296;
}
