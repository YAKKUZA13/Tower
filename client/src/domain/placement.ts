import type { PlacedObject, WorldTransform } from './map';

export interface PlacementBounds {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

export interface PlacementCandidate {
  id?: string;
  transform: WorldTransform;
  collision?: {
    blocking?: boolean;
    selectable?: boolean;
  };
}

export function getPlacementBounds(candidate: PlacementCandidate): PlacementBounds {
  const position = candidate.transform.position;
  const scale = candidate.transform.scale;
  const rotationY = Number(candidate.transform.rotation?.y || 0);
  const width = Math.max(0.1, Math.abs(Number(scale.x || 1)));
  const depth = Math.max(0.1, Math.abs(Number(scale.z || 1)));
  const cos = Math.abs(Math.cos(rotationY));
  const sin = Math.abs(Math.sin(rotationY));
  const rotatedWidth = width * cos + depth * sin;
  const rotatedDepth = width * sin + depth * cos;
  return {
    minX: position.x - rotatedWidth / 2,
    maxX: position.x + rotatedWidth / 2,
    minZ: position.z - rotatedDepth / 2,
    maxZ: position.z + rotatedDepth / 2
  };
}

export function boundsOverlap(a: PlacementBounds, b: PlacementBounds): boolean {
  return a.minX < b.maxX && a.maxX > b.minX && a.minZ < b.maxZ && a.maxZ > b.minZ;
}

export function isBlockingObject(obj: PlacedObject): boolean {
  return obj.collision?.blocking !== false;
}

export function canPlaceObject(candidate: PlacementCandidate, objects: PlacedObject[], ignoreId: string | null = null): boolean {
  if (candidate.collision?.blocking === false) return true;
  const candidateBounds = getPlacementBounds(candidate);
  return !objects.some((obj) => {
    if (ignoreId && obj.id === ignoreId) return false;
    if (!isBlockingObject(obj)) return false;
    return boundsOverlap(candidateBounds, getPlacementBounds(obj));
  });
}
