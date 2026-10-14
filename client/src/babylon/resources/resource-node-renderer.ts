import { Color3 } from '@babylonjs/core/Maths/math.color.js';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial.js';
import { InstancedMesh } from '@babylonjs/core/Meshes/instancedMesh.js';
import { Mesh } from '@babylonjs/core/Meshes/mesh.js';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder.js';
import { TransformNode } from '@babylonjs/core/Meshes/transformNode.js';
import { type Scene } from '@babylonjs/core/scene.js';
import type { GridData, ResourceKind, ResourceNode } from '@tower/shared';
import { sampleHeight } from '../terrain/terrain-math';

interface ResourcePart {
  source: Mesh;
  position: readonly [number, number, number];
  scaling: readonly [number, number, number];
  rotationY?: number;
}

interface ResourceVisual {
  root: TransformNode;
  parts: InstancedMesh[];
  pickProxy: Mesh;
}

const PALETTE: Record<ResourceKind, { base: Color3; accent: Color3 }> = {
  wood: { base: new Color3(0.30, 0.16, 0.075), accent: new Color3(0.16, 0.29, 0.20) },
  stone: { base: new Color3(0.36, 0.39, 0.42), accent: new Color3(0.58, 0.61, 0.63) },
  ore: { base: new Color3(0.25, 0.29, 0.34), accent: new Color3(0.35, 0.65, 0.78) },
  gold: { base: new Color3(0.34, 0.27, 0.10), accent: new Color3(1.0, 0.70, 0.12) }
};

/** Procedural resource clusters with readable silhouettes at RTS distance. */
export class ResourceNodeRenderer {
  private readonly halfW: number;
  private readonly halfH: number;
  private readonly masters = new Map<ResourceKind, ResourcePart[]>();
  private readonly instances = new Map<string, ResourceVisual>();
  private readonly pickMaterial: StandardMaterial;

  constructor(
    private readonly scene: Scene,
    private readonly grid: GridData,
    private readonly heightmap: number[][]
  ) {
    this.halfW = grid.cols * grid.cellSize * 0.5;
    this.halfH = grid.rows * grid.cellSize * 0.5;
    this.pickMaterial = new StandardMaterial('resource-pick-material', scene);
    this.pickMaterial.alpha = 0;
    this.pickMaterial.disableColorWrite = true;
    this.pickMaterial.disableDepthWrite = true;
    for (const kind of ['wood', 'stone', 'ore', 'gold'] as ResourceKind[]) {
      this.masters.set(kind, this.buildMaster(kind));
    }
  }

  sync(nodes: ResourceNode[]): void {
    const seen = new Set<string>();
    const cs = this.grid.cellSize;
    for (const node of nodes) {
      if (node.amount <= 0) continue;
      seen.add(node.id);
      let visual = this.instances.get(node.id);
      if (!visual) {
        visual = this.createVisual(node);
        this.instances.set(node.id, visual);
      }

      const y = sampleHeight(this.heightmap, this.grid, node.col, node.row, true);
      visual.root.position.set(
        (node.col + 0.5) * cs - this.halfW,
        y,
        (node.row + 0.5) * cs - this.halfH
      );
      const scale = cs * (0.82 + Math.min(0.16, node.amount / 6000));
      visual.root.scaling.setAll(scale);
      visual.root.rotation.y = hash01(node.col, node.row) * Math.PI * 2;
    }

    for (const [id, visual] of this.instances) {
      if (seen.has(id)) continue;
      visual.root.dispose();
      this.instances.delete(id);
    }
  }

  pickNodeId(mesh: { name?: string; metadata?: unknown } | null | undefined): string | null {
    if (!mesh) return null;
    const metadata = mesh.metadata as { resourceNodeId?: unknown } | null;
    if (typeof metadata?.resourceNodeId === 'string') return metadata.resourceNodeId;
    const prefix = 'rn-inst-';
    if (typeof mesh.name === 'string' && mesh.name.startsWith(prefix)) {
      const tail = mesh.name.slice(prefix.length);
      return tail.replace(/-\d+$/, '');
    }
    return null;
  }

  private createVisual(node: ResourceNode): ResourceVisual {
    const root = new TransformNode(`rn-root-${node.id}`, this.scene);
    root.metadata = { resourceNodeId: node.id, resourceKind: node.kind };
    const parts = (this.masters.get(node.kind) ?? []).map((part, index) => {
      const instance = part.source.createInstance(`rn-inst-${node.id}-${index}`);
      instance.parent = root;
      instance.position.set(...part.position);
      instance.scaling.set(...part.scaling);
      instance.rotation.y = part.rotationY ?? 0;
      instance.isPickable = true;
      instance.metadata = { resourceNodeId: node.id, resourceKind: node.kind };
      return instance;
    });
    // Instanced decorative parts can be unreliable ray targets after parent
    // scaling. A single normalized volume makes right-click gather orders
    // dependable without changing the visible resource silhouette.
    const pickProxy = MeshBuilder.CreateBox(`rn-inst-${node.id}-pick`, {
      width: 1.55,
      height: node.kind === 'wood' ? 2.35 : 1.45,
      depth: 1.55
    }, this.scene);
    pickProxy.parent = root;
    pickProxy.position.y = node.kind === 'wood' ? 0.95 : 0.55;
    pickProxy.material = this.pickMaterial;
    pickProxy.visibility = 1;
    pickProxy.isPickable = true;
    pickProxy.metadata = { resourceNodeId: node.id, resourceKind: node.kind, pickProxy: true };
    return { root, parts, pickProxy };
  }

  private buildMaster(kind: ResourceKind): ResourcePart[] {
    const colors = PALETTE[kind];
    const baseMat = this.makeMaterial(`rn-${kind}-base`, colors.base, false);
    const accentMat = this.makeMaterial(`rn-${kind}-accent`, colors.accent, kind === 'ore' || kind === 'gold');
    const part = (
      suffix: string,
      position: ResourcePart['position'],
      scaling: ResourcePart['scaling'],
      accent = false,
      rotationY = 0
    ): ResourcePart => {
      const source = MeshBuilder.CreateBox(`rn-master-${kind}-${suffix}`, { size: 1 }, this.scene);
      source.material = accent ? accentMat : baseMat;
      source.isVisible = false;
      source.isPickable = false;
      source.doNotSyncBoundingInfo = true;
      return { source, position, scaling, rotationY };
    };

    if (kind === 'wood') {
      return [
        // A small harvestable grove rather than a pile of anonymous brown boxes.
        part('trunk-a', [-0.22, 0.54, 0.05], [0.18, 1.08, 0.18]),
        part('root-a', [-0.22, 0.10, 0.05], [0.52, 0.12, 0.42]),
        part('crown-a0', [-0.22, 1.00, 0.05], [0.82, 0.34, 0.70], true, 0.12),
        part('crown-a1', [-0.22, 1.28, 0.05], [0.62, 0.30, 0.54], true, -0.10),
        part('crown-a2', [-0.22, 1.52, 0.05], [0.38, 0.28, 0.34], true, 0.08),
        part('trunk-b', [0.42, 0.38, 0.24], [0.14, 0.76, 0.14]),
        part('crown-b0', [0.42, 0.76, 0.24], [0.58, 0.28, 0.50], true, -0.18),
        part('crown-b1', [0.42, 0.98, 0.24], [0.38, 0.24, 0.34], true, 0.14),
        part('stump', [0.34, 0.12, -0.38], [0.26, 0.24, 0.26], false, 0.22)
      ];
    }
    if (kind === 'stone') {
      return [
        part('foot-a', [-0.20, 0.13, 0.04], [0.90, 0.26, 0.72], false, 0.10),
        part('foot-b', [0.35, 0.12, 0.22], [0.48, 0.22, 0.42], false, -0.28),
        part('pillar-a0', [-0.26, 0.42, -0.02], [0.48, 0.52, 0.50], false, 0.08),
        part('pillar-a1', [-0.22, 0.73, -0.04], [0.42, 0.22, 0.44], true, -0.06),
        part('pillar-b0', [0.25, 0.38, 0.12], [0.36, 0.46, 0.38], false, -0.18),
        part('pillar-b1', [0.28, 0.66, 0.10], [0.30, 0.18, 0.32], true, 0.12),
        part('chip-a', [-0.52, 0.11, -0.32], [0.20, 0.16, 0.18], true, 0.30),
        part('chip-b', [0.56, 0.09, -0.18], [0.14, 0.12, 0.16], true, -0.12)
      ];
    }
    if (kind === 'ore') {
      return [
        part('matrix-a', [-0.12, 0.24, 0], [0.62, 0.46, 0.56], false, 0.22),
        part('matrix-b', [0.28, 0.20, 0.16], [0.36, 0.34, 0.36], false, -0.28),
        part('vein-a', [-0.10, 0.48, 0.04], [0.13, 0.38, 0.13], true, 0.28),
        part('vein-b', [0.18, 0.42, -0.12], [0.11, 0.31, 0.11], true, -0.22),
        part('vein-c', [-0.31, 0.31, 0.12], [0.10, 0.24, 0.10], true, 0.45)
      ];
    }
    return [
      part('bed-a', [0, 0.13, 0], [0.66, 0.22, 0.56], false, 0.12),
      part('crystal-a', [0, 0.49, 0], [0.17, 0.72, 0.17], true, 0.18),
      part('crystal-b', [-0.25, 0.35, 0.10], [0.14, 0.48, 0.14], true, -0.28),
      part('crystal-c', [0.25, 0.31, -0.08], [0.13, 0.39, 0.13], true, 0.36)
    ];
  }

  private makeMaterial(name: string, color: Color3, emissive: boolean): StandardMaterial {
    const material = new StandardMaterial(name, this.scene);
    material.diffuseColor = color;
    material.specularColor = emissive ? color.scale(0.18) : new Color3(0.025, 0.025, 0.025);
    material.emissiveColor = emissive ? color.scale(0.28) : color.scale(0.035);
    material.roughness = emissive ? 0.62 : 0.94;
    return material;
  }

  dispose(): void {
    for (const visual of this.instances.values()) visual.root.dispose();
    this.instances.clear();
    for (const parts of this.masters.values()) {
      for (const part of parts) part.source.dispose(false, true);
    }
    this.masters.clear();
    this.pickMaterial.dispose();
  }
}

function hash01(x: number, z: number): number {
  const value = Math.sin((x + 11) * 12.9898 + (z + 7) * 78.233) * 43758.5453;
  return value - Math.floor(value);
}
