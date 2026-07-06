import 'babylonjs-loaders';
import {
  ArcRotateCamera,
  Color3,
  Engine,
  HemisphericLight,
  Mesh,
  MeshBuilder,
  Scene,
  StandardMaterial,
  TransformNode,
  Vector3
} from 'babylonjs';
import type { GridData } from '../domain/map';
import { gridToWorld, worldToGrid, sampleHeight } from './terrain/terrain-math';
import { createVoxelBoard } from './voxel/voxel-floor';
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
 * Создание сцены TD (Phase D новая концепция).
 *
 * Поле боя: воксельная плита cols×rows клеток + каменный бордюр крепости по
 * краям + тёмная подложка под плитой (пол не висит в воздухе). Камера —
 * стандартный TD-ракурс (изометрия ~35° над горизонтом), вращаемая мышью.
 *
 * heightmap игнорируется: всё поле плоское (sampleHeight = 0). Контракт
 * sampleHeight сохранён для всех рендереров и sim’а.
 */
export function createScene(engine: Engine, grid: GridData, _heightmap: number[][] = [], options: { editor?: boolean } = {}) {
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
  // alpha = -Math.PI/4 → северо-восточный угол (привычная «верх-право» перспектива).
  // beta = Math.PI/3.2 → ~58° от вертикали ≈ 32° над горизонтом (читаемый TD-вид).
  // radius = maxSpan * 1.25 → плотный кадр, плита занимает почти весь канвас.
  const cameraDistance = Math.max(20, maxSpan * 1.25);
  const camera = new ArcRotateCamera('cam', -Math.PI / 4, Math.PI / 3.2, cameraDistance, new Vector3(0, 0, 0), scene);
  camera.lowerRadiusLimit = Math.max(8, maxSpan * 0.4);
  camera.upperRadiusLimit = Math.max(40, maxSpan * 2.4);
  camera.lowerBetaLimit = 0.2;            // нельзя уйти в чистый top-down (визуал ломается)
  camera.upperBetaLimit = Math.PI / 2.15; // нельзя упасть до горизонта (плита становится линией)
  camera.wheelPrecision = 18;
  camera.panningSensibility = 0;          // запретить панорамирование — поле всегда по центру
  camera.minZ = 0.1;
  camera.attachControl(engine.getRenderingCanvas(), true);

  // ── Свет: hemispheric ambient-fill (атмосфера добавит DirectionalLight + тени) ──
  const light = new HemisphericLight('light', new Vector3(0.3, 1, 0.4), scene);
  light.intensity = 0.95;
  light.groundColor = new Color3(0.25, 0.28, 0.24);

  // ── Воксельная плита + бордюр + подложка ──
  const { ground, decorations } = createVoxelBoard(scene, grid);

  // ── Сетка редактора (по умолчанию скрыта; включается только в режиме debug) ──
  const gridLines = createGridLines(scene, grid, boardWidth, boardDepth);
  gridLines.setEnabled(Boolean(options.editor));

  const towersParent = new TransformNode('objects', scene);
  // decorations добавлен в сцену внутри createVoxelBoard; возвращаем для полноты API.
  void decorations;
  return { scene, camera, light, ground, towersParent };
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

export function makePreviewMesh(scene: Scene): Mesh {
  const mesh = MeshBuilder.CreateBox('preview', { width: 1, height: 1, depth: 1 }, scene);
  mesh.material = makeMaterial(scene, 'previewMat', new Color3(0.2, 0.8, 0.25), 0.4);
  mesh.isPickable = false;
  mesh.setEnabled(false);
  return mesh;
}
