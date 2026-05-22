export interface Vector3Data {
  x: number;
  y: number;
  z: number;
}

export interface WorldTransform {
  position: Vector3Data;
  rotation: Vector3Data;
  scale: Vector3Data;
}

export interface TerrainData {
  heightmap: number[][];
  materialLayers?: unknown[];
}

export interface PlacedObject {
  id: string;
  type: string;
  assetId?: string;
  transform: WorldTransform;
  tags?: string[];
  properties?: Record<string, unknown>;
}

export interface GridData {
  cols: number;
  rows: number;
  cellSize: number;
}

export interface MapDocument {
  version: number;
  grid: GridData;
  heightmap: number[][];
  terrain?: TerrainData;
  objects?: PlacedObject[];
  towers: unknown[];
  path: { waypoints: Array<{ col: number; row: number }> };
  base: { hp: number };
  waves: unknown[];
}
