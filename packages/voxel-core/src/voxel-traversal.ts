/** Amanatides-Woo traversal for the engine's unit, cell-centred voxel grid. */

export type VoxelGridPoint = [number, number, number];
export type VoxelTraversalTiePolicy = 'diagonal' | 'supercover';

export interface VoxelGridBounds {
  /** Inclusive integer cell coordinates. */
  min: VoxelGridPoint;
  /** Inclusive integer cell coordinates. */
  max: VoxelGridPoint;
}

export interface VoxelRay {
  origin: VoxelGridPoint;
  /** Need not be normalized, but must not be the zero vector. */
  direction: VoxelGridPoint;
}

export interface VoxelTraversalOptions {
  /**
   * diagonal visits cells with a non-zero ray interval. supercover also emits
   * every cell touched only at an edge or corner.
   */
  tiePolicy: VoxelTraversalTiePolicy;
  epsilon?: number;
  maxVisitedCells?: number;
}

export interface VoxelRayCell {
  x: number;
  y: number;
  z: number;
  /** Ray parameter at which the cell is entered or touched. */
  t: number;
}

function validatePoint(name: string, value: VoxelGridPoint, integer: boolean): void {
  if (value.length !== 3 || value.some((component) => !Number.isFinite(component) || (integer && !Number.isInteger(component)))) {
    throw new Error(`${name} must contain three finite${integer ? ' integer' : ''} components`);
  }
}

function inside(cell: VoxelGridPoint, bounds: VoxelGridBounds): boolean {
  return cell[0] >= bounds.min[0] && cell[0] <= bounds.max[0]
    && cell[1] >= bounds.min[1] && cell[1] <= bounds.max[1]
    && cell[2] >= bounds.min[2] && cell[2] <= bounds.max[2];
}

function rayBoundsInterval(ray: VoxelRay, bounds: VoxelGridBounds): [number, number] | null {
  let enter = -Infinity;
  let exit = Infinity;
  for (let axis = 0; axis < 3; axis++) {
    const origin = ray.origin[axis]!;
    const direction = ray.direction[axis]!;
    const lower = bounds.min[axis]! - 0.5;
    const upper = bounds.max[axis]! + 0.5;
    if (direction === 0) {
      if (origin < lower || origin > upper) return null;
      continue;
    }
    let first = (lower - origin) / direction;
    let second = (upper - origin) / direction;
    if (first > second) [first, second] = [second, first];
    enter = Math.max(enter, first);
    exit = Math.min(exit, second);
    if (enter > exit) return null;
  }
  if (exit < 0) return null;
  return [Math.max(0, enter), exit];
}

/**
 * Enumerates cells intersected by a ray inside inclusive bounds. Voxel `(i,j,k)`
 * occupies `[i-.5,i+.5] x [j-.5,j+.5] x [k-.5,k+.5]`.
 */
export function traverseVoxelGrid(
  ray: VoxelRay,
  bounds: VoxelGridBounds,
  options: VoxelTraversalOptions
): VoxelRayCell[] {
  validatePoint('ray.origin', ray.origin, false);
  validatePoint('ray.direction', ray.direction, false);
  validatePoint('bounds.min', bounds.min, true);
  validatePoint('bounds.max', bounds.max, true);
  if (bounds.min.some((value, axis) => value > bounds.max[axis]!)) throw new Error('bounds.min must be <= bounds.max');
  if (ray.direction.every((component) => component === 0)) throw new Error('ray.direction must not be zero');
  if (options.tiePolicy !== 'diagonal' && options.tiePolicy !== 'supercover') throw new Error('A valid tiePolicy is required');
  const epsilon = options.epsilon ?? 1e-10;
  if (!Number.isFinite(epsilon) || epsilon < 0) throw new Error('epsilon must be a non-negative finite number');
  const maxVisitedCells = options.maxVisitedCells ?? 1_000_000;
  if (!Number.isInteger(maxVisitedCells) || maxVisitedCells < 1) throw new Error('maxVisitedCells must be a positive integer');

  const interval = rayBoundsInterval(ray, bounds);
  if (!interval) return [];
  const [startT, endT] = interval;
  const start: VoxelGridPoint = [0, 0, 0];
  const step: VoxelGridPoint = [0, 0, 0];
  const tMax: VoxelGridPoint = [Infinity, Infinity, Infinity];
  const tDelta: VoxelGridPoint = [Infinity, Infinity, Infinity];

  for (let axis = 0; axis < 3; axis++) {
    const direction = ray.direction[axis]!;
    const coordinate = ray.origin[axis]! + startT * direction;
    step[axis] = Math.sign(direction);
    // Select the cell immediately inside the traversal interval when the entry
    // point lies exactly on a cell boundary.
    start[axis] = Math.floor(coordinate + 0.5 + Math.sign(direction) * epsilon);
    if (direction !== 0) {
      const boundary = start[axis]! + (direction > 0 ? 0.5 : -0.5);
      tMax[axis] = (boundary - ray.origin[axis]!) / direction;
      tDelta[axis] = 1 / Math.abs(direction);
    }
  }

  const current: VoxelGridPoint = [...start];
  const cells: VoxelRayCell[] = [];
  const seen = new Set<string>();
  const emit = (cell: VoxelGridPoint, t: number): void => {
    if (!inside(cell, bounds)) return;
    const key = `${cell[0]},${cell[1]},${cell[2]}`;
    if (seen.has(key)) return;
    if (cells.length >= maxVisitedCells) throw new Error(`voxel traversal exceeded ${maxVisitedCells} cells`);
    seen.add(key);
    cells.push({ x: cell[0], y: cell[1], z: cell[2], t });
  };
  emit(current, startT);

  const maxEvents = (bounds.max[0] - bounds.min[0] + 1)
    + (bounds.max[1] - bounds.min[1] + 1)
    + (bounds.max[2] - bounds.min[2] + 1) + 3;
  for (let event = 0; event < maxEvents; event++) {
    const nextT = Math.min(...tMax);
    if (!Number.isFinite(nextT) || nextT > endT + epsilon) break;
    const tied: number[] = [];
    for (let axis = 0; axis < 3; axis++) {
      if (Math.abs(tMax[axis]! - nextT) <= epsilon) tied.push(axis);
    }

    if (options.tiePolicy === 'supercover') {
      for (let mask = 1; mask < 1 << tied.length; mask++) {
        const touched: VoxelGridPoint = [...current];
        tied.forEach((axis, bit) => {
          if ((mask & 1 << bit) !== 0) touched[axis] += step[axis]!;
        });
        emit(touched, nextT);
      }
    }

    for (const axis of tied) {
      current[axis] += step[axis]!;
      tMax[axis] += tDelta[axis]!;
    }
    if (options.tiePolicy === 'diagonal') emit(current, nextT);
    if (!inside(current, bounds)) break;
  }
  return cells;
}
