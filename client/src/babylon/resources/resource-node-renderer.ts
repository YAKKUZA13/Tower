/**
 * M8.3/RTS-solo — Resource node markers (wood/stone/ore/gold piles).
 *
 * Простой инстанс-рендер: один мастер-бокс на kind, тонко масштабированный
 * (cross-stack: 3 яруса, смещение по XZ для «кучки»). Цвет — по палитре ресурса.
 *
 * Сим не хранит resource-node-state в снапшоте; nodes живут в map.resourceNodes.
 * depletion (amount → 0) мутирует map прямо в game-sim (pruneDepletedNodes),
 * поэтому RtsGame.vue после каждого кадра передаёт сюда актуальный массив.
 */
import { Color3 } from '@babylonjs/core/Maths/math.color.js';
import { InstancedMesh } from '@babylonjs/core/Meshes/instancedMesh.js';
import { Mesh } from '@babylonjs/core/Meshes/mesh.js';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder.js';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial.js';
import { type Scene } from '@babylonjs/core/scene.js';
import type { GridData, ResourceKind, ResourceNode } from '@tower/shared';
import { sampleHeight } from '../terrain/terrain-math';

const COLORS: Record<ResourceKind, [number, number, number]> = {
  wood: [0.42, 0.26, 0.13],
  stone: [0.65, 0.66, 0.70],
  ore: [0.42, 0.50, 0.58],
  gold: [0.95, 0.78, 0.25]
};

export class ResourceNodeRenderer {
  private readonly scene: Scene;
  private readonly grid: GridData;
  private readonly heightmap: number[][];
  private readonly halfW: number;
  private readonly halfH: number;
  private readonly masters = new Map<ResourceKind, Mesh>();
  private readonly instances = new Map<string, InstancedMesh>();

  constructor(scene: Scene, grid: GridData, heightmap: number[][]) {
    this.scene = scene;
    this.grid = grid;
    this.heightmap = heightmap;
    this.halfW = (grid.cols * grid.cellSize) / 2;
    this.halfH = (grid.rows * grid.cellSize) / 2;

    for (const kind of ['wood', 'stone', 'ore', 'gold'] as ResourceKind[]) {
      const master = MeshBuilder.CreateBox(`rn-master-${kind}`, { size: 1 }, scene);
      const mat = new StandardMaterial(`rn-mat-${kind}`, scene);
      const [r, g, b] = COLORS[kind];
      mat.diffuseColor = new Color3(r, g, b);
      mat.emissiveColor = new Color3(r * 0.18, g * 0.18, b * 0.18);
      mat.specularColor = new Color3(0.1, 0.1, 0.1);
      master.material = mat;
      master.isVisible = false;
      master.isPickable = false;
      master.doNotSyncBoundingInfo = true;
      this.masters.set(kind, master);
    }
  }

  sync(nodes: ResourceNode[]): void {
    const seen = new Set<string>();
    const cs = this.grid.cellSize;
    for (const n of nodes) {
      if (n.amount <= 0) continue;
      seen.add(n.id);
      const master = this.masters.get(n.kind);
      if (!master) continue;
      let inst = this.instances.get(n.id);
      if (!inst) {
        inst = master.createInstance(`rn-inst-${n.id}`);
        inst.isPickable = true; // для order-unit-gather (правый клик)
        this.instances.set(n.id, inst);
      }
      const groundY = sampleHeight(this.heightmap, this.grid, n.col, n.row, true);
      const x = (n.col + 0.5) * cs - this.halfW;
      const z = (n.row + 0.5) * cs - this.halfH;
      inst.position.set(x, groundY + cs * 0.25, z);
      // размер зависит от остатка (визуальная индикация истощения)
      const fillRatio = Math.max(0.3, Math.min(1, n.amount / 800));
      const s = cs * 0.55 * fillRatio;
      inst.scaling.set(s, cs * 0.5 * fillRatio, s);
    }
    for (const [id, inst] of this.instances) {
      if (!seen.has(id)) {
        inst.dispose();
        this.instances.delete(id);
      }
    }
  }

  /** Id ресурсного узла по кликнутому mesh (для order-unit-gather). */
  pickNodeId(mesh: { name: string } | null | undefined): string | null {
    if (!mesh) return null;
    if (mesh.name.startsWith('rn-inst-')) return mesh.name.slice('rn-inst-'.length);
    return null;
  }

  dispose(): void {
    for (const inst of this.instances.values()) inst.dispose();
    this.instances.clear();
    for (const m of this.masters.values()) m.dispose();
    this.masters.clear();
  }
}
