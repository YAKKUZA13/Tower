import type {
  NavCell,
  SceneColliderSpec,
  SceneGridSpec,
  SceneKitPlacement,
  SceneKitSpec,
  SceneNodeSpec
} from './types.js';

interface Transform2 {
  x: number;
  z: number;
  yaw: number;
  scaleX: number;
  scaleZ: number;
}

function compose(parent: Transform2, node: SceneNodeSpec): Transform2 {
  const position = node.transform?.position ?? [0, 0, 0];
  const scale = node.transform?.scale ?? [1, 1, 1];
  const localX = position[0] * parent.scaleX;
  const localZ = position[2] * parent.scaleZ;
  const cos = Math.cos(parent.yaw);
  const sin = Math.sin(parent.yaw);
  return {
    x: parent.x + localX * cos - localZ * sin,
    z: parent.z + localX * sin + localZ * cos,
    yaw: parent.yaw + (node.transform?.rotation?.[1] ?? 0),
    scaleX: parent.scaleX * scale[0],
    scaleZ: parent.scaleZ * scale[2]
  };
}

function rootTransform(placement: SceneKitPlacement): Transform2 {
  return {
    x: placement.position?.[0] ?? 0,
    z: placement.position?.[2] ?? 0,
    yaw: placement.rotation?.[1] ?? 0,
    scaleX: placement.scale?.[0] ?? 1,
    scaleZ: placement.scale?.[2] ?? 1
  };
}

function colliderExtents(collider: SceneColliderSpec, transform: Transform2): { halfX: number; halfZ: number; radius: number } {
  if (collider.kind === 'box') {
    const halfX = collider.size[0] * Math.abs(transform.scaleX) * 0.5;
    const halfZ = collider.size[2] * Math.abs(transform.scaleZ) * 0.5;
    return { halfX, halfZ, radius: Math.hypot(halfX, halfZ) };
  }
  const radius = collider.diameter * Math.max(Math.abs(transform.scaleX), Math.abs(transform.scaleZ)) * 0.5;
  return { halfX: radius, halfZ: radius, radius };
}

function overlapsCell(
  collider: SceneColliderSpec,
  transform: Transform2,
  cellX: number,
  cellZ: number,
  cellSize: number
): boolean {
  const dx = cellX - transform.x;
  const dz = cellZ - transform.z;
  const padding = cellSize * Math.SQRT2 * 0.5;
  const extents = colliderExtents(collider, transform);
  if (collider.kind !== 'box') return Math.hypot(dx, dz) <= extents.radius + padding;

  const cos = Math.cos(transform.yaw);
  const sin = Math.sin(transform.yaw);
  const localX = dx * cos + dz * sin;
  const localZ = -dx * sin + dz * cos;
  // Conservative cell-square overlap. It may reserve an adjacent cell, but never
  // lets a unit center clip through an oriented obstacle.
  return Math.abs(localX) <= extents.halfX + padding && Math.abs(localZ) <= extents.halfZ + padding;
}

/** Rasterizes every navBlocking scene collider into deterministic grid cells. */
export function rasterizeNavBlockers(
  spec: SceneKitSpec,
  grid: SceneGridSpec,
  placement: SceneKitPlacement = {}
): NavCell[] {
  const nodeById = new Map(spec.nodes.map((node) => [node.id, node]));
  const transforms = new Map<string, Transform2>();
  const resolving = new Set<string>();
  const root = rootTransform(placement);

  const resolve = (node: SceneNodeSpec): Transform2 => {
    const cached = transforms.get(node.id);
    if (cached) return cached;
    if (resolving.has(node.id)) throw new Error(`Cannot rasterize cyclic scene hierarchy at '${node.id}'`);
    resolving.add(node.id);
    const parent = node.parent ? resolve(nodeById.get(node.parent)!) : root;
    const result = compose(parent, node);
    resolving.delete(node.id);
    transforms.set(node.id, result);
    return result;
  };

  const halfW = grid.cols * grid.cellSize * 0.5;
  const halfH = grid.rows * grid.cellSize * 0.5;
  const blocked = new Set<number>();
  for (const node of spec.nodes) {
    if (!node.collider?.navBlocking) continue;
    const transform = resolve(node);
    const extents = colliderExtents(node.collider, transform);
    const reach = extents.radius + grid.cellSize;
    const minCol = Math.max(0, Math.floor((transform.x - reach + halfW) / grid.cellSize));
    const maxCol = Math.min(grid.cols - 1, Math.floor((transform.x + reach + halfW) / grid.cellSize));
    const minRow = Math.max(0, Math.floor((transform.z - reach + halfH) / grid.cellSize));
    const maxRow = Math.min(grid.rows - 1, Math.floor((transform.z + reach + halfH) / grid.cellSize));
    for (let row = minRow; row <= maxRow; row++) {
      for (let col = minCol; col <= maxCol; col++) {
        const cellX = (col + 0.5) * grid.cellSize - halfW;
        const cellZ = (row + 0.5) * grid.cellSize - halfH;
        if (overlapsCell(node.collider, transform, cellX, cellZ, grid.cellSize)) blocked.add(row * grid.cols + col);
      }
    }
  }
  return [...blocked].sort((a, b) => a - b).map((index) => ({ col: index % grid.cols, row: Math.floor(index / grid.cols) }));
}
