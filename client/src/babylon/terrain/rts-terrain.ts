import { Color3 } from '@babylonjs/core/Maths/math.color.js';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial.js';
import { Mesh } from '@babylonjs/core/Meshes/mesh.js';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder.js';
import { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData.js';
import { type Scene } from '@babylonjs/core/scene.js';
import type { GridData, TileType } from '@tower/shared';

type RGB = readonly [number, number, number];

const DEFAULT_APRON_RINGS = 16;
const DEFAULT_CHUNK_SIZE = 8;
const HEIGHT_EPSILON = 0.001;

const SURFACE_COLORS: Record<TileType, RGB> = {
  grass: [0.14, 0.27, 0.21],
  dirt: [0.27, 0.18, 0.13],
  road: [0.23, 0.24, 0.22],
  water: [0.07, 0.20, 0.30],
  rock: [0.29, 0.32, 0.33],
  sand: [0.37, 0.30, 0.19]
};

export interface RtsGroundOptions {
  apronRings?: number;
  chunkSize?: number;
}

/**
 * Builds independently culled terrain chunks. Every logical cell owns its
 * vertices, so material boundaries remain crisp instead of smearing through a
 * shared colour grid. Height differences get darker voxel-like side faces.
 */
export function createRtsGround(
  scene: Scene,
  grid: GridData,
  heightmap: number[][] | null | undefined,
  tiles: TileType[][] | null | undefined,
  options: RtsGroundOptions = {}
): Mesh {
  const root = new Mesh('ground', scene);
  root.isPickable = false;
  root.receiveShadows = true;
  root.metadata = { terrainRoot: true, terrainHeightmap: heightmap };

  const chunkSize = Math.max(2, Math.floor(options.chunkSize ?? DEFAULT_CHUNK_SIZE));
  const material = createTerrainMaterial(scene);

  for (let row = 0; row < grid.rows; row += chunkSize) {
    for (let col = 0; col < grid.cols; col += chunkSize) {
      const chunk = buildChunk(
        scene,
        grid,
        heightmap,
        tiles,
        col,
        Math.min(grid.cols, col + chunkSize),
        row,
        Math.min(grid.rows, row + chunkSize)
      );
      chunk.parent = root;
      chunk.material = material;
      chunk.isPickable = true;
      chunk.receiveShadows = true;
      chunk.metadata = { playableGround: true, terrainChunk: { col, row, size: chunkSize } };
    }
  }

  const apronRings = Math.max(0, Math.floor(options.apronRings ?? DEFAULT_APRON_RINGS));
  if (apronRings > 0) createApron(scene, root, grid, apronRings);

  return root;
}

function buildChunk(
  scene: Scene,
  grid: GridData,
  heightmap: number[][] | null | undefined,
  tiles: TileType[][] | null | undefined,
  colStart: number,
  colEnd: number,
  rowStart: number,
  rowEnd: number
): Mesh {
  const positions: number[] = [];
  const indices: number[] = [];
  const colors: number[] = [];
  const cs = grid.cellSize;
  const halfW = grid.cols * cs * 0.5;
  const halfH = grid.rows * cs * 0.5;

  const heightAt = (col: number, row: number): number => {
    const c = Math.max(0, Math.min(grid.cols - 1, col));
    const r = Math.max(0, Math.min(grid.rows - 1, row));
    const value = heightmap?.[r]?.[c];
    return typeof value === 'number' && Number.isFinite(value) ? value : 0;
  };

  const addFace = (vertices: readonly number[], color: RGB): void => {
    const base = positions.length / 3;
    positions.push(...vertices);
    for (let i = 0; i < 4; i++) colors.push(color[0], color[1], color[2], 1);
    indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
  };

  for (let row = rowStart; row < rowEnd; row++) {
    for (let col = colStart; col < colEnd; col++) {
      const x0 = col * cs - halfW;
      const x1 = x0 + cs;
      const z0 = row * cs - halfH;
      const z1 = z0 + cs;
      const y = heightAt(col, row);
      const tile = tiles?.[row]?.[col] ?? 'grass';
      const top = terrainColor(tile, col, row);
      const side = shade(top, tile === 'water' ? 0.88 : 0.82);

      addFace([x0, y, z0, x0, y, z1, x1, y, z1, x1, y, z0], top);

      const north = row > 0 ? heightAt(col, row - 1) : 0;
      const south = row + 1 < grid.rows ? heightAt(col, row + 1) : 0;
      const west = col > 0 ? heightAt(col - 1, row) : 0;
      const east = col + 1 < grid.cols ? heightAt(col + 1, row) : 0;

      if (y > north + HEIGHT_EPSILON) addFace([x1, north, z0, x0, north, z0, x0, y, z0, x1, y, z0], side);
      if (y > south + HEIGHT_EPSILON) addFace([x0, south, z1, x1, south, z1, x1, y, z1, x0, y, z1], side);
      if (y > west + HEIGHT_EPSILON) addFace([x0, west, z0, x0, west, z1, x0, y, z1, x0, y, z0], side);
      if (y > east + HEIGHT_EPSILON) addFace([x1, east, z1, x1, east, z0, x1, y, z0, x1, y, z1], side);
    }
  }

  const normals = new Array<number>(positions.length).fill(0);
  VertexData.ComputeNormals(positions, indices, normals);
  const data = new VertexData();
  data.positions = positions;
  data.indices = indices;
  data.normals = normals;
  data.colors = colors;

  const mesh = new Mesh(`ground-chunk-${colStart}-${rowStart}`, scene);
  data.applyToMesh(mesh, false);
  return mesh;
}

function createTerrainMaterial(scene: Scene): StandardMaterial {
  const material = new StandardMaterial('rts-terrain-mat', scene);
  material.diffuseColor = Color3.White();
  material.ambientColor = new Color3(0.3, 0.3, 0.24);
  // Terrain uses authored vertex colours as its primary read. Unlit shading
  // keeps biomes legible across the whole orthographic view; cliffs already
  // carry their own darker colour and actors retain dynamic light/shadows.
  material.disableLighting = true;
  material.emissiveColor = Color3.White();
  material.specularColor = new Color3(0.025, 0.025, 0.02);
  material.roughness = 0.94;
  // Chunks contain independently authored top and cliff quads. Keeping both
  // sides visible avoids camera-angle cracks along terrace and chunk borders.
  material.backFaceCulling = false;
  return material;
}

function createApron(scene: Scene, root: Mesh, grid: GridData, rings: number): void {
  const width = (grid.cols + rings * 2) * grid.cellSize;
  const height = (grid.rows + rings * 2) * grid.cellSize;
  const apron = MeshBuilder.CreateGround('ground-apron', { width, height, subdivisions: 1 }, scene);
  apron.position.y = -0.035;
  apron.parent = root;
  apron.isPickable = false;
  apron.receiveShadows = true;
  const material = new StandardMaterial('rts-apron-mat', scene);
  material.diffuseColor = new Color3(0.08, 0.11, 0.13);
  material.specularColor = Color3.Black();
  material.roughness = 1;
  apron.material = material;
}

function terrainColor(tile: TileType, col: number, row: number): RGB {
  const base = SURFACE_COLORS[tile] ?? SURFACE_COLORS.grass;
  const macro = (hash01(Math.floor(col / 5), Math.floor(row / 5)) - 0.5) * 0.055;
  const micro = (hash01(col, row) - 0.5) * 0.025;
  const variation = macro + micro;
  return [
    clamp01(base[0] + variation * 0.75),
    clamp01(base[1] + variation),
    clamp01(base[2] + variation * 0.55)
  ];
}

function shade(color: RGB, factor: number): RGB {
  return [color[0] * factor, color[1] * factor, color[2] * factor];
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function hash01(x: number, z: number): number {
  let value = Math.imul(x + 0x632be5ab, 0x9e3779b1) ^ Math.imul(z + 0x85157af5, 0x85ebca77);
  value ^= value >>> 16;
  value = Math.imul(value, 0x7feb352d);
  value ^= value >>> 15;
  return (value >>> 0) / 4294967296;
}
