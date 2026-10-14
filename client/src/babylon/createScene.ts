import { ArcRotateCamera } from '@babylonjs/core/Cameras/arcRotateCamera.js';
import { Color3 } from '@babylonjs/core/Maths/math.color.js';
import { Engine } from '@babylonjs/core/Engines/engine.js';
import { HemisphericLight } from '@babylonjs/core/Lights/hemisphericLight.js';
import { Mesh } from '@babylonjs/core/Meshes/mesh.js';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder.js';
import { Scene } from '@babylonjs/core/scene.js';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial.js';
import { TransformNode } from '@babylonjs/core/Meshes/transformNode.js';
import { VertexBuffer } from '@babylonjs/core/Buffers/buffer.js';
import { Matrix, Vector3 } from '@babylonjs/core/Maths/math.vector.js';
import '@babylonjs/core/Culling/ray.js';
import type { GridData, TileType } from '../domain/map';
import { gridToWorld, worldToGrid, sampleHeight } from './terrain/terrain-math';
import { createVoxelBoard } from './voxel/voxel-floor';
import { createRtsGround } from './terrain/rts-terrain';
// re-export pure geometry helpers for consumers
export { gridToWorld, worldToGrid, sampleHeight } from './terrain/terrain-math';

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

/**
 * Создание сцены TD (Phase D новая концепция + Phase T тайловый рендер).
 *
 * Поле боя:
 *  - ЕСЛИ задан `options.tiles` (Phase T): invisible ground-plane (для pick) +
 *    каменный бордюр + тёмная подложка. Сами тайлы рисует TileRenderer отдельно
 *    (после загрузки AssetCatalog, через thin instances).
 *  - ИНАЧЕ (back-compat): воксельная плита cols×rows + каменный бордюр + подложка.
 *
 * Камера — стандартный TD-ракурс (изометрия ~35° над горизонтом), вращаемая мышью.
 * heightmap игнорируется: всё поле плоское (sampleHeight = 0). Контракт
 * sampleHeight сохранён для всех рендереров и sim'а.
 */
export function createScene(
  engine: Engine,
  grid: GridData,
  _heightmap: number[][] = [],
  options: { editor?: boolean; tiles?: TileType[][] } = {}
) {
  const scene = new Scene(engine);
  // Ястрый «день» (TD: смены дня/ночи нет). AtmosphereRenderer в своём конструкторе
  // зафиксирует эти значения под яркий день; здесь — светлый стартовый кадр, чтобы
  // первый рендер не мелькал тёмным clearColor-ом.
  scene.clearColor.set(0.05, 0.06, 0.09, 1);
  scene.fogMode = Scene.FOGMODE_EXP2;
  scene.fogDensity = 0.006;
  scene.fogColor = new Color3(0.05, 0.06, 0.09);

  const boardWidth = grid.cols * grid.cellSize;
  const boardDepth = grid.rows * grid.cellSize;
  const maxSpan = Math.max(boardWidth, boardDepth);

  // ── Камера: стандартный TD-ракурс (изометрия, ~35° над горизонтом) ──
  const cameraDistance = Math.max(20, maxSpan * 1.25);
  const camera = new ArcRotateCamera('cam', -Math.PI / 4, Math.PI / 3.2, cameraDistance, new Vector3(0, 0, 0), scene);
  camera.lowerRadiusLimit = Math.max(8, maxSpan * 0.4);
  camera.upperRadiusLimit = Math.max(40, maxSpan * 2.4);
  camera.lowerBetaLimit = 0.2;
  camera.upperBetaLimit = Math.PI / 2.15;
  camera.wheelPrecision = 18;
  camera.panningSensibility = 0;
  camera.minZ = 0.1;
  camera.attachControl(engine.getRenderingCanvas(), true);

  // ── Свет: hemispheric ambient-fill (атмосфера добавит DirectionalLight + тени) ──
  const light = new HemisphericLight('light', new Vector3(0.3, 1, 0.4), scene);
  light.intensity = 0.95;
  light.groundColor = new Color3(0.25, 0.28, 0.24);

  // ── Поле боя: tile-board (если есть tiles) или voxel-board (back-compat) ──
  const { ground, decorations } = options.tiles
    ? createTileBoard(scene, grid)
    : createVoxelBoard(scene, grid);

  // ── Сетка редактора (по умолчанию скрыта; включается только в режиме debug) ──
  const gridLines = createGridLines(scene, grid, boardWidth, boardDepth);
  gridLines.setEnabled(Boolean(options.editor));

  const towersParent = new TransformNode('objects', scene);
  void decorations;
  return { scene, camera, light, ground, towersParent };
}

/**
 * Tile-board (Phase T): invisible ground-plane для pick + каменный бордюр +
 * тёмная подложка. Сами тайлы рисует TileRenderer после загрузки каталога.
 *
 * Контракт идентичен createVoxelBoard: возвращает { ground, decorations },
 * где ground имеет name='ground' (важно для pickWorld) и pickable=true.
 */
function createTileBoard(scene: Scene, grid: GridData): { ground: Mesh; decorations: Mesh } {
  const cs = grid.cellSize;
  const boardW = grid.cols * cs;
  const boardD = grid.rows * cs;

  // Invisible ground-plane для pick (имя 'ground' важно для pickWorld).
  // receiveShadows=false: тени ложатся на тайлы (TileRenderer), не на плейн.
  const ground = MeshBuilder.CreateGround(
    'ground',
    { width: boardW, height: boardD, subdivisionsX: 1, subdivisionsY: 1 },
    scene
  );
  const groundMat = new StandardMaterial('tile-ground-mat', scene);
  groundMat.diffuseColor = new Color3(0, 0, 0);
  groundMat.alpha = 0;
  ground.material = groundMat;
  ground.receiveShadows = false;
  ground.isPickable = true;
  ground.isVisible = true; // видимый, но полностью прозрачный (alpha=0) — для pick
  ground.metadata = { playableGround: true };

  // Подложка под плитой (тёмная бездна) + бордюр — переиспользуем из voxel-floor.
  // Для этого делегируем в createVoxelBoard и берём только decorations
  // (ground от туда выбрасываем — у нас свой).
  const board = createVoxelBoard(scene, grid);
  // Освободить «лишний» ground от voxel-board — он не нужен (наш invisible выше).
  board.ground.dispose();
  return { ground, decorations: board.decorations };
}

function createGridLines(scene: Scene, grid: GridData, boardWidth: number, boardDepth: number): Mesh {
  const lines: Vector3[][] = [];
  const halfW = boardWidth / 2;
  const halfD = boardDepth / 2;
  for (let c = 0; c <= grid.cols; c++) {
    const x = c * grid.cellSize - halfW;
    lines.push([new Vector3(x, 0.02, -halfD), new Vector3(x, 0.02, halfD)]);
  }
  for (let r = 0; r <= grid.rows; r++) {
    const z = r * grid.cellSize - halfD;
    lines.push([new Vector3(-halfW, 0.02, z), new Vector3(halfW, 0.02, z)]);
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
  const pick = scene.pick(
    scene.pointerX,
    scene.pointerY,
    (mesh) => mesh.name === 'ground' || (mesh.metadata as { playableGround?: boolean } | null)?.playableGround === true
  );
  return pick?.pickedPoint || null;
}

export function pickGrid(scene: Scene, grid: GridData): { col: number; row: number } | null {
  const point = pickWorld(scene) ?? pickTerrainByRay(scene, grid);
  if (!point) return null;
  const { col, row } = worldToGrid(grid, point);
  const cell = { col: Math.floor(col), row: Math.floor(row) };
  if (cell.col < 0 || cell.row < 0 || cell.col >= grid.cols || cell.row >= grid.rows) return null;
  return cell;
}

/**
 * Chunked terrain can be visible before Babylon has synchronized every chunk's
 * triangle-picking data. Intersect the camera ray with the authored heightmap
 * so ground orders and building placement remain deterministic.
 */
function pickTerrainByRay(scene: Scene, grid: GridData): Vector3 | null {
  const camera = scene.activeCamera;
  if (!camera) return null;
  const ray = scene.createPickingRay(scene.pointerX, scene.pointerY, Matrix.Identity(), camera);
  if (Math.abs(ray.direction.y) < 1e-6) return null;
  const root = scene.getMeshByName('ground');
  const metadata = root?.metadata as { terrainHeightmap?: number[][] | null } | null;
  const heightmap = metadata?.terrainHeightmap;
  let surfaceY = 0;
  let point = Vector3.Zero();
  for (let i = 0; i < 4; i++) {
    const distance = (surfaceY - ray.origin.y) / ray.direction.y;
    if (!Number.isFinite(distance) || distance < 0) return null;
    point = ray.origin.add(ray.direction.scale(distance));
    const cell = worldToGrid(grid, point);
    const col = Math.floor(cell.col);
    const row = Math.floor(cell.row);
    if (col < 0 || row < 0 || col >= grid.cols || row >= grid.rows) return null;
    surfaceY = sampleHeight(heightmap, grid, col, row, true);
  }
  return point;
}

export function makePreviewMesh(scene: Scene): Mesh {
  const mesh = MeshBuilder.CreateBox('preview', { width: 1, height: 1, depth: 1 }, scene);
  mesh.material = makeMaterial(scene, 'previewMat', new Color3(0.2, 0.8, 0.25), 0.4);
  mesh.isPickable = false;
  mesh.setEnabled(false);
  return mesh;
}

/**
 * M8-fix — Сцена для RTS-режима (большая открытая карта).
 *
 * Отличия от TD `createScene`:
 *  - НЕТ «доски в космосе»: нет каменного бордюра / зубцов / рун / черепов /
 *    тёмной подложки-бездны. Вместо этого — сплошной террейн (createRtsGround),
 *    следующий heightmap, с tile-цветами и плавным фадом в fog (aprоn).
 *  - heightmap НЕ игнорируется (как в TD): вершины террейна смещаются по heightmap,
 *    так что top-surface в клетке = sampleHeight → юниты/здания/ресурсы стоят на
 *    поверхности, а не парят над ней (тот самый баг после заимствования из Magnum-Opus).
 *  - Камера та же (ArcRotate, будет переключена в ORTHO + RTS-controls снаружи),
 *    но初始ная дистанция/position адаптирована под большую карту.
 *
 * Возвращает { scene, camera, light, ground }. Ground имеет name='ground'
 * (контракт pickGrid/pickWorld сохранён), receiveShadows=true, isPickable=true.
 */
export function createRtsScene(
  engine: Engine,
  grid: GridData,
  heightmap: number[][] = [],
  options: { tiles?: TileType[][]; apronRings?: number } = {}
) {
  const scene = new Scene(engine);
  // Тёмный «воздух» как fog — террейн растворяется в нём апроном.
  scene.clearColor.set(0.05, 0.06, 0.09, 1);
  scene.fogMode = Scene.FOGMODE_EXP2;
  scene.fogDensity = 0.006;
  scene.fogColor = new Color3(0.05, 0.06, 0.09);

  const boardWidth = grid.cols * grid.cellSize;
  const boardDepth = grid.rows * grid.cellSize;
  const maxSpan = Math.max(boardWidth, boardDepth);

  // Камера: ArcRotate-обёртка; RTS-controls (ORTHO + pan/zoom/rotate) навешиваются
  // снаружи через attachRtsCamera. Начальная дистанция — чтобы видеть центр карты.
  const cameraDistance = Math.max(20, maxSpan * 0.8);
  const camera = new ArcRotateCamera('cam', -Math.PI / 4, Math.PI / 3.2, cameraDistance, new Vector3(0, 0, 0), scene);
  camera.lowerRadiusLimit = Math.max(8, maxSpan * 0.4);
  camera.upperRadiusLimit = Math.max(40, maxSpan * 2.4);
  camera.lowerBetaLimit = 0.2;
  camera.upperBetaLimit = Math.PI / 2.15;
  camera.wheelPrecision = 18;
  camera.panningSensibility = 0;
  camera.minZ = 0.1;
  // НЕ вызываем attachControl — RTS-controls снаружи (attachRtsCamera сбрасывает inputs).

  // Свет: hemispheric ambient-fill (атмосфера добавит DirectionalLight + тени).
  const light = new HemisphericLight('light', new Vector3(0.3, 1, 0.4), scene);
  light.intensity = 0.95;
  light.groundColor = new Color3(0.25, 0.28, 0.24);

  // RTS-террейн: сплошной, по heightmap, с apron-фадом в fog.
  const ground = createRtsGround(scene, grid, heightmap, options.tiles ?? null, {
    apronRings: options.apronRings ?? 18
  });

  const towersParent = new TransformNode('objects', scene);
  return { scene, camera, light, ground, towersParent };
}
