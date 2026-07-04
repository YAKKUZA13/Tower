import 'babylonjs-loaders';
import {
  ArcRotateCamera,
  Color3,
  Engine,
  HemisphericLight,
  Constants,
  Mesh,
  MeshBuilder,
  RawTexture,
  Scene,
  SceneLoader,
  ShaderMaterial,
  StandardMaterial,
  Texture,
  TransformNode,
  Vector2,
  Vector3,
  VertexBuffer,
  VertexData
} from 'babylonjs';
import type { GridData, MapDocument, PlacedObject } from '../domain/map';
import { gridToWorld, worldToGrid, sampleHeight, computeHeightRange } from './terrain/terrain-math';
import { ensureTerrainShaders } from './terrain/terrain-shaders';
// re-export pure geometry helpers for consumers (MapEditor etc.)
export { gridToWorld, worldToGrid, sampleHeight } from './terrain/terrain-math';

const API_BASE = import.meta.env.VITE_API_BASE || 'http://localhost:3000';

function valueNoise(x: number, y: number, seed = 17): number {
  const h = Math.sin(seed + x * 127.1 + y * 311.7) * 43758.5453;
  return h - Math.floor(h);
}

function makeMaterial(scene: Scene, name: string, color: Color3, alpha = 1): StandardMaterial {
  const mat = new StandardMaterial(name, scene);
  mat.diffuseColor = color;
  mat.specularColor = new Color3(0.03, 0.03, 0.03);
  mat.alpha = alpha;
  return mat;
}

export function createEngine(canvas: HTMLCanvasElement): Engine {
  const engine = new Engine(canvas, true);
  window.addEventListener('resize', () => engine.resize());
  return engine;
}

// gridToWorld / worldToGrid / sampleHeight / computeHeightRange РІС‹РЅРµСЃРµРЅС‹ РІ ./terrain/terrain-math

function heightToColor(height: number, minH: number, maxH: number): Color3 {
  const range = Math.max(1e-3, maxH - minH);
  const t = Math.max(0, Math.min(1, (height - minH) / range));
  if (t < 0.25) return new Color3(0.12, 0.18, 0.10);
  if (t < 0.62) return new Color3(0.20, 0.48, 0.20);
  if (t < 0.82) return new Color3(0.43, 0.45, 0.35);
  return new Color3(0.72, 0.74, 0.72);
}

// computeHeightRange РІС‹РЅРµСЃРµРЅ РІ ./terrain/terrain-math

function applyHeightmapToGroundCpu(ground: Mesh, grid: GridData, heightmap: number[][] = []): void {
  const positions = ground.getVerticesData(VertexBuffer.PositionKind);
  const indices = ground.getIndices();
  if (!positions || !indices) return;
  const subdivisionsX = Number(ground.metadata?.subdivisionsX || grid.cols);
  const subdivisionsY = Number(ground.metadata?.subdivisionsY || grid.rows);
  const stride = subdivisionsX + 1;
  const colors = new Float32Array(stride * (subdivisionsY + 1) * 4);
  const { minH, maxH } = computeHeightRange(heightmap);
  for (let r = 0; r <= subdivisionsY; r++) {
    for (let c = 0; c <= subdivisionsX; c++) {
      const idx = (r * stride + c) * 3;
      const col = (c / subdivisionsX) * (grid.cols - 1);
      const row = (r / subdivisionsY) * (grid.rows - 1);
      const h = sampleHeight(heightmap, grid, col, row, true);
      positions[idx + 1] = h;
      const color = heightToColor(h, minH, maxH);
      const ci = (r * stride + c) * 4;
      colors[ci] = color.r;
      colors[ci + 1] = color.g;
      colors[ci + 2] = color.b;
      colors[ci + 3] = 1;
    }
  }
  ground.updateVerticesData(VertexBuffer.PositionKind, positions);
  ground.setVerticesData(VertexBuffer.ColorKind, colors, false);
  const normals: number[] = [];
  VertexData.ComputeNormals(Array.from(positions), indices, normals);
  ground.updateVerticesData(VertexBuffer.NormalKind, normals);
  ground.refreshBoundingInfo();
}

// ensureTerrainShaders moved to ./terrain/terrain-shaders


function buildHeightmapTextureData(heightmap: number[][], grid: GridData, type: number) {
  const rows = Math.min(512, Math.max(1, grid.rows * 2));
  const cols = Math.min(512, Math.max(1, grid.cols * 2));
  const { minH, maxH } = computeHeightRange(heightmap);
  const range = Math.max(1e-6, maxH - minH);
  const isFloat = type === Constants.TEXTURETYPE_FLOAT;
  const data = isFloat ? new Float32Array(rows * cols * 4) : new Uint8Array(rows * cols * 4);
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const srcRow = rows > 1 ? (r / (rows - 1)) * (grid.rows - 1) : 0;
      const srcCol = cols > 1 ? (c / (cols - 1)) * (grid.cols - 1) : 0;
      const h = sampleHeight(heightmap, grid, srcCol, srcRow, true);
      const t = Math.max(0, Math.min(1, (h - minH) / range));
      const idx = (r * cols + c) * 4;
      if (isFloat) {
        data[idx] = t;
        data[idx + 1] = 0;
        data[idx + 2] = 0;
        data[idx + 3] = 1;
      } else {
        data[idx] = Math.round(t * 255);
        data[idx + 1] = 0;
        data[idx + 2] = 0;
        data[idx + 3] = 255;
      }
    }
  }
  return { data, rows, cols, minH, maxH, type };
}

function pickHeightmapTextureType(scene: Scene): number {
  const caps = scene.getEngine().getCaps?.() || {};
  return caps.textureFloat && caps.textureFloatLinearFiltering ? Constants.TEXTURETYPE_FLOAT : Constants.TEXTURETYPE_UNSIGNED_BYTE;
}

function createHeightmapTexture(scene: Scene, grid: GridData, heightmap: number[][]) {
  const type = pickHeightmapTextureType(scene);
  const info = buildHeightmapTextureData(heightmap, grid, type);
  const texture = new RawTexture(
    info.data,
    info.cols,
    info.rows,
    Constants.TEXTUREFORMAT_RGBA,
    scene,
    false,
    false,
    Constants.TEXTURE_BILINEAR_SAMPLINGMODE,
    type
  );
  texture.wrapU = Texture.CLAMP_ADDRESSMODE;
  texture.wrapV = Texture.CLAMP_ADDRESSMODE;
  return { texture, info };
}

function bindTerrainUniforms(material: ShaderMaterial, texture: RawTexture, info: ReturnType<typeof buildHeightmapTextureData>, grid: GridData, light: HemisphericLight): void {
  const boardWidth = grid.cols * grid.cellSize;
  const boardHeight = grid.rows * grid.cellSize;
  material.setTexture('heightmapSampler', texture);
  material.setVector2('groundSize', new Vector2(boardWidth, boardHeight));
  material.setVector2('heightmapSize', new Vector2(info.cols, info.rows));
  material.setVector2('heightStep', new Vector2(boardWidth / Math.max(1, info.cols - 1), boardHeight / Math.max(1, info.rows - 1)));
  material.setFloat('heightMin', info.minH);
  material.setFloat('heightMax', info.maxH);
  material.setVector3('lightDir', light.direction);
  material.setVector3('lightSky', new Vector3(light.diffuse.r, light.diffuse.g, light.diffuse.b));
  material.setVector3('lightGround', new Vector3(light.groundColor.r, light.groundColor.g, light.groundColor.b));
  material.setFloat('lightIntensity', light.intensity);
}

function createTerrainMaterial(scene: Scene, grid: GridData, heightmap: number[][], light: HemisphericLight) {
  ensureTerrainShaders();
  const material = new ShaderMaterial(
    'terrainMat',
    scene,
    { vertex: 'terrain', fragment: 'terrain' },
    {
      attributes: ['position'],
      uniforms: ['worldViewProjection', 'groundSize', 'heightmapSize', 'heightStep', 'heightMin', 'heightMax', 'lightDir', 'lightSky', 'lightGround', 'lightIntensity'],
      samplers: ['heightmapSampler']
    }
  );
  const { texture, info } = createHeightmapTexture(scene, grid, heightmap);
  bindTerrainUniforms(material, texture, info, grid, light);
  return { material, texture, info, light };
}

export function updateHeightmapTexture(ground: Mesh | undefined, grid: GridData, heightmap: number[][]): boolean {
  if (!ground) return false;
  const terrain = ground.metadata?.terrain as { material: ShaderMaterial; texture: RawTexture; info: ReturnType<typeof buildHeightmapTextureData>; light: HemisphericLight } | undefined;
  if (!terrain) {
    applyHeightmapToGroundCpu(ground, grid, heightmap);
    return true;
  }
  const info = buildHeightmapTextureData(heightmap, grid, terrain.info.type);
  if (info.rows !== terrain.info.rows || info.cols !== terrain.info.cols) {
    terrain.texture.dispose();
    terrain.texture = new RawTexture(info.data, info.cols, info.rows, Constants.TEXTUREFORMAT_RGBA, ground.getScene(), false, false, Constants.TEXTURE_BILINEAR_SAMPLINGMODE, info.type);
    terrain.texture.wrapU = Texture.CLAMP_ADDRESSMODE;
    terrain.texture.wrapV = Texture.CLAMP_ADDRESSMODE;
  } else {
    terrain.texture.update(info.data);
  }
  terrain.info = info;
  bindTerrainUniforms(terrain.material, terrain.texture, info, grid, terrain.light);
  return true;
}

function createPlayableGround(scene: Scene, grid: GridData, heightmap: number[][], light: HemisphericLight): Mesh {
  const boardWidth = grid.cols * grid.cellSize;
  const boardHeight = grid.rows * grid.cellSize;
  const subdivisionsX = Math.min(256, Math.max(grid.cols, Math.round(boardWidth / 0.55)));
  const subdivisionsY = Math.min(256, Math.max(grid.rows, Math.round(boardHeight / 0.55)));
  const ground = MeshBuilder.CreateGround('ground', { width: boardWidth, height: boardHeight, subdivisionsX, subdivisionsY }, scene);
  const terrain = createTerrainMaterial(scene, grid, heightmap, light);
  ground.metadata = { subdivisionsX, subdivisionsY, playableGround: true, terrain };
  ground.material = terrain.material;
  ground.isPickable = true;
  return ground;
}

function createOuterTerrain(scene: Scene, grid: GridData, heightmap: number[][]): Mesh {
  const boardWidth = grid.cols * grid.cellSize;
  const boardHeight = grid.rows * grid.cellSize;
  const margin = Math.max(boardWidth, boardHeight) * 1.3;
  const width = boardWidth + margin * 2;
  const height = boardHeight + margin * 2;
  const subdivisionsX = 96;
  const subdivisionsY = 96;
  const mesh = MeshBuilder.CreateGround('outer-terrain', { width, height, subdivisionsX, subdivisionsY }, scene);
  mesh.isPickable = false;
  mesh.metadata = { decorative: true };
  mesh.material = makeMaterial(scene, 'outerTerrainMat', new Color3(0.19, 0.38, 0.19));
  const positions = mesh.getVerticesData(VertexBuffer.PositionKind);
  const indices = mesh.getIndices();
  if (positions && indices) {
    const stride = subdivisionsX + 1;
    const colors = new Float32Array(stride * (subdivisionsY + 1) * 4);
    for (let r = 0; r <= subdivisionsY; r++) {
      for (let c = 0; c <= subdivisionsX; c++) {
        const idx = (r * stride + c) * 3;
        const x = positions[idx];
        const z = positions[idx + 2];
        const innerCol = (x + boardWidth / 2) / grid.cellSize;
        const innerRow = (z + boardHeight / 2) / grid.cellSize;
        const edgeCol = Math.max(0, Math.min(grid.cols - 1, innerCol));
        const edgeRow = Math.max(0, Math.min(grid.rows - 1, innerRow));
        const edgeHeight = sampleHeight(heightmap, grid, edgeCol, edgeRow, true);
        const dx = Math.max(0, Math.abs(x) - boardWidth / 2);
        const dz = Math.max(0, Math.abs(z) - boardHeight / 2);
        const dist = Math.sqrt(dx * dx + dz * dz);
        const t = Math.min(1, dist / Math.max(1, margin));
        const noise = (valueNoise(x * 0.05, z * 0.05) - 0.5) * 7 + Math.sin(x * 0.06) * 2 + Math.cos(z * 0.04) * 2;
        positions[idx + 1] = edgeHeight * (1 - t) + noise * t - t * 1.5;
        const ci = (r * stride + c) * 4;
        colors[ci] = 0.14 + t * 0.08;
        colors[ci + 1] = 0.28 + t * 0.14;
        colors[ci + 2] = 0.13 + t * 0.05;
        colors[ci + 3] = 1;
      }
    }
    mesh.updateVerticesData(VertexBuffer.PositionKind, positions);
    mesh.setVerticesData(VertexBuffer.ColorKind, colors, false);
    const normals: number[] = [];
    VertexData.ComputeNormals(Array.from(positions), indices, normals);
    mesh.updateVerticesData(VertexBuffer.NormalKind, normals);
  }
  return mesh;
}

export function createScene(engine: Engine, grid: GridData, heightmap: number[][] = [], options: { editor?: boolean } = {}) {
  const scene = new Scene(engine);
  scene.clearColor.set(0.10, 0.10, 0.18, 1);
  scene.fogMode = Scene.FOGMODE_EXP2;
  scene.fogDensity = 0.008;
  scene.fogColor = new Color3(0.10, 0.10, 0.18);
  const boardWidth = grid.cols * grid.cellSize;
  const boardHeight = grid.rows * grid.cellSize;
  const maxSpan = Math.max(boardWidth, boardHeight);
  const cameraDistance = Math.max(40, maxSpan * 1.7);
  const camera = new ArcRotateCamera('cam', Math.PI / 4, Math.PI / 3, cameraDistance, new Vector3(0, 0, 0), scene);
  camera.lowerRadiusLimit = Math.max(8, maxSpan * 0.25);
  camera.upperRadiusLimit = Math.max(80, maxSpan * 3.2);
  camera.wheelPrecision = 35;
  camera.panningSensibility = 80;
  camera.attachControl(engine.getRenderingCanvas(), true);
  const light = new HemisphericLight('light', new Vector3(0.3, 1, 0.4), scene);
  light.intensity = 0.95;
  light.groundColor = new Color3(0.25, 0.28, 0.24);
  createOuterTerrain(scene, grid, heightmap);
  const ground = createPlayableGround(scene, grid, heightmap, light);
  const gridLines = createGridLines(scene, grid, boardWidth, boardHeight);
  gridLines.setEnabled(Boolean(options.editor));
  const towersParent = new TransformNode('objects', scene);
  return { scene, camera, light, ground, towersParent };
}

function createGridLines(scene: Scene, grid: GridData, boardWidth: number, boardHeight: number): Mesh {
  const lines: Vector3[][] = [];
  const halfW = boardWidth / 2;
  const halfH = boardHeight / 2;
  for (let c = 0; c <= grid.cols; c++) {
    const x = c * grid.cellSize - halfW;
    lines.push([new Vector3(x, 0.04, -halfH), new Vector3(x, 0.04, halfH)]);
  }
  for (let r = 0; r <= grid.rows; r++) {
    const z = r * grid.cellSize - halfH;
    lines.push([new Vector3(-halfW, 0.04, z), new Vector3(halfW, 0.04, z)]);
  }
  const gridLines = MeshBuilder.CreateLineSystem('grid-lines', { lines }, scene);
  gridLines.color = new Color3(0.84, 0.68, 0.22);
  gridLines.isPickable = false;
  return gridLines as Mesh;
}

export function setGridVisible(scene: Scene, visible: boolean): void {
  scene.getMeshByName('grid-lines')?.setEnabled(visible);
}

export function pickWorld(scene: Scene): Vector3 | null {
  const pick = scene.pick(scene.pointerX, scene.pointerY, (mesh) => mesh.name === 'ground');
  return pick?.pickedPoint || null;
}

export function pickGrid(scene: Scene, grid: GridData): { col: number; row: number } | null {
  const point = pickWorld(scene);
  if (!point) return null;
  const { col, row } = worldToGrid(grid, point);
  const cell = { col: Math.floor(col), row: Math.floor(row) };
  if (cell.col < 0 || cell.row < 0 || cell.col >= grid.cols || cell.row >= grid.rows) return null;
  return cell;
}

export function pickSceneObject(scene: Scene): { objectId: string; mesh: Mesh; point: Vector3 | null } | null {
  const pick = scene.pick(scene.pointerX, scene.pointerY, (mesh) => Boolean(mesh?.metadata?.objectId));
  const objectId = pick?.pickedMesh?.metadata?.objectId;
  if (!objectId || !(pick.pickedMesh instanceof Mesh)) return null;
  return { objectId, mesh: pick.pickedMesh, point: pick.pickedPoint || null };
}

function applyTransform(node: TransformNode, obj: PlacedObject, heightmap: number[][] | null, grid: GridData | null): void {
  const transform = obj.transform;
  const scale = transform.scale || { x: 1, y: 1, z: 1 };
  const position = transform.position || { x: 0, y: 0, z: 0 };
  const rotation = transform.rotation || { x: 0, y: 0, z: 0 };
  let groundHeight = Number(position.y || 0);
  if (heightmap && grid) {
    const { col, row } = worldToGrid(grid, position);
    groundHeight = sampleHeight(heightmap, grid, col, row, true);
  }
  node.position = new Vector3(Number(position.x || 0), groundHeight + Math.max(0.1, Number(scale.y || 1)) / 2, Number(position.z || 0));
  node.rotation = new Vector3(Number(rotation.x || 0), Number(rotation.y || 0), Number(rotation.z || 0));
}

function colorFromObject(obj: PlacedObject): Color3 {
  const color = obj.properties?.color as { r?: number; g?: number; b?: number } | undefined;
  return new Color3(color?.r ?? 0.62, color?.g ?? 0.72, color?.b ?? 0.64);
}

function markObject(node: TransformNode | Mesh, obj: PlacedObject): void {
  node.metadata = { ...(node.metadata || {}), objectId: obj.id, placedObject: obj };
}

export function addPlacedObject(scene: Scene, obj: PlacedObject, heightmap: number[][] | null = null, grid: GridData | null = null): TransformNode | Mesh {
  const transform = obj.transform || {};
  const scale = transform.scale || { x: 1, y: 1, z: 1 };
  if (obj.assetId) {
    const root = new TransformNode(`object-${obj.id}`, scene);
    markObject(root, obj);
    const placeholder = MeshBuilder.CreateBox(`object-${obj.id}-placeholder`, {
      width: Math.max(0.1, Number(scale.x || 1)),
      height: Math.max(0.1, Number(scale.y || 1)),
      depth: Math.max(0.1, Number(scale.z || 1))
    }, scene);
    placeholder.parent = root;
    placeholder.material = makeMaterial(scene, `objectMat-${obj.id}`, colorFromObject(obj), 0.82);
    markObject(placeholder, obj);
    applyTransform(root, obj, heightmap, grid);
    const filename = encodeURIComponent(String(obj.properties?.assetName || `${obj.assetId}.glb`));
    SceneLoader.ImportMeshAsync('', `${API_BASE}/assets/${obj.assetId}/`, filename, scene)
      .then((result) => {
        placeholder.dispose();
        for (const mesh of result.meshes) {
          mesh.parent = root;
          mesh.isPickable = true;
          markObject(mesh, obj);
        }
        const bounds = root.getHierarchyBoundingVectors(true);
        const size = bounds.max.subtract(bounds.min);
        const target = new Vector3(Math.max(0.1, Number(scale.x || 1)), Math.max(0.1, Number(scale.y || 1)), Math.max(0.1, Number(scale.z || 1)));
        root.scaling = new Vector3(
          target.x / Math.max(0.001, size.x),
          target.y / Math.max(0.001, size.y),
          target.z / Math.max(0.001, size.z)
        );
      })
      .catch(() => {
        // Keep the placeholder selectable and persistent when a model loader fails.
      });
    return root;
  }
  const width = Math.max(0.1, Number(scale.x || 1));
  const height = Math.max(0.1, Number(scale.y || 1));
  const depth = Math.max(0.1, Number(scale.z || 1));
  const primitive = obj.primitiveType || 'box';
  const mesh = primitive === 'cylinder'
    ? MeshBuilder.CreateCylinder(`object-${obj.id}`, { diameter: width, height, tessellation: 24 }, scene)
    : primitive === 'sphere'
      ? MeshBuilder.CreateSphere(`object-${obj.id}`, { diameter: Math.max(width, depth) }, scene)
      : MeshBuilder.CreateBox(`object-${obj.id}`, { width, height, depth }, scene);
  if (primitive === 'sphere') mesh.scaling.y = height / Math.max(width, depth);
  mesh.material = makeMaterial(scene, `objectMat-${obj.id}`, colorFromObject(obj));
  markObject(mesh, obj);
  applyTransform(mesh, obj, heightmap, grid);
  return mesh;
}

export function updateFreePlacementPreview(previewMesh: Mesh | null, obj: PlacedObject, valid = true, heightmap: number[][] | null = null, grid: GridData | null = null): void {
  if (!previewMesh || !obj?.transform) return;
  const scale = obj.transform.scale || { x: 1, y: 1, z: 1 };
  previewMesh.scaling = new Vector3(Math.max(0.1, scale.x || 1), Math.max(0.1, scale.y || 1), Math.max(0.1, scale.z || 1));
  applyTransform(previewMesh, obj, heightmap, grid);
  const mat = previewMesh.material as StandardMaterial | null;
  if (mat?.diffuseColor) {
    mat.diffuseColor = valid ? new Color3(0.2, 0.8, 0.25) : new Color3(0.9, 0.18, 0.18);
  }
  previewMesh.setEnabled(true);
}

export function makePreviewMesh(scene: Scene): Mesh {
  const mesh = MeshBuilder.CreateBox('preview', { width: 1, height: 1, depth: 1 }, scene);
  mesh.material = makeMaterial(scene, 'previewMat', new Color3(0.2, 0.8, 0.25), 0.4);
  mesh.isPickable = false;
  mesh.setEnabled(false);
  return mesh;
}

export function makeTerrainBrushMesh(scene: Scene): Mesh {
  const mesh = MeshBuilder.CreateCylinder('terrain-brush-preview', { diameter: 1, height: 0.08, tessellation: 72 }, scene);
  mesh.material = makeMaterial(scene, 'terrainBrushPreviewMat', new Color3(0.16, 0.64, 1), 0.28);
  mesh.isPickable = false;
  mesh.setEnabled(false);
  return mesh;
}

export function getMapObjects(map: MapDocument | null): PlacedObject[] {
  return Array.isArray(map?.objects) ? map.objects : [];
}
