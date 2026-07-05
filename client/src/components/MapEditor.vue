<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, shallowRef } from 'vue';
import { PointerEventTypes, type ArcRotateCamera, type Engine, type Mesh, type Scene } from 'babylonjs';
import { DEFAULT_ENEMY_TYPES, DEFAULT_WAVES } from '@tower/shared';
import type { Wave, WaveGroup } from '@tower/shared';
import type { AssetRecord } from '../services/api';
import type { GridData, MapDocument, PlacedObject, Vector3Data } from '../domain/map';
import type { BrushMode, EditorTool } from '../domain/editor';
import { createEngine, createScene, gridToWorld, makePreviewMesh, makeTerrainBrushMesh, sampleHeight, setGridVisible, updateFreePlacementPreview, updateHeightmapTexture } from '../babylon/createScene';
import { addPlacedObject } from '../babylon/object-renderer';
import { LevelOverlay } from '../babylon/level-renderer';
import { pickGrid, pickSceneObject, pickWorld } from '../babylon/picking';
import { canPlaceObject } from '../domain/placement';
import { useMapStore } from '../stores/map-store';
import AssetManager from './AssetManager.vue';

interface BabylonState {
  scene: Scene;
  camera: ArcRotateCamera;
  ground: Mesh;
}

interface CatalogItem {
  key: string;
  label: string;
  type: string;
  size: { w: number; h: number };
  height: number;
  color: { r: number; g: number; b: number };
}

const MIN_HEIGHT = -50;
const MAX_HEIGHT = 200;

const canvasRef = ref<HTMLCanvasElement | null>(null);
const engineRef = shallowRef<Engine | null>(null);
const babylonRef = shallowRef<BabylonState | null>(null);
const saving = ref(false);
const status = ref('');
const mapStore = useMapStore();
const selectedObjectId = ref<string | null>(null);
const selectedAsset = ref<AssetRecord | null>(null);
const mode = ref<EditorTool>('select');
const showGrid = ref(false);
const snapEnabled = ref(true);
const snapStep = ref(0.5);
const brushMode = ref<BrushMode>('raise');
const brushRadius = ref(1.2);
const brushStrength = ref(0.35);
const flattenTargetHeight = ref<number | null>(null);
const cursorHeight = ref(0);
const lastTerrainCell = ref<{ col: number; row: number } | null>(null);

let previewMesh: Mesh | null = null;
let terrainBrushMesh: Mesh | null = null;
let isPaintingTerrain = false;
let cameraDetachedForBrush = false;
let levelOverlay: LevelOverlay | null = null;

const modeOptions: EditorTool[] = ['select', 'place', 'move', 'rotate', 'scale', 'remove', 'terrain', 'path', 'spawn', 'base'];
const modeLabels: Record<EditorTool, string> = {
  select: 'Выбор',
  place: 'Разместить',
  move: 'Двигать',
  rotate: 'Вращать',
  scale: 'Масштаб',
  remove: 'Удалять',
  terrain: 'Рельеф',
  path: 'Путь',
  spawn: 'Спавн',
  base: 'База'
};

const enemyTypeOptions = DEFAULT_ENEMY_TYPES;

const catalog = ref<CatalogItem[]>([
  { key: 'house_1x1', label: 'Дом 1x1', type: 'house', size: { w: 1, h: 1 }, height: 4, color: { r: 0.6, g: 0.8, b: 0.6 } },
  { key: 'house_2x2', label: 'Дом 2x2', type: 'house', size: { w: 2, h: 2 }, height: 3, color: { r: 0.5, g: 0.7, b: 0.5 } },
  { key: 'tower_3x3', label: 'Башня 3x3', type: 'tower', size: { w: 3, h: 3 }, height: 6, color: { r: 0.4, g: 0.6, b: 0.9 } }
]);
const selectedKey = ref(catalog.value[0].key);

const map = ref<MapDocument>({
  version: 1,
  grid: { cols: 32, rows: 18, cellSize: 1.5 },
  heightmap: createDefaultHeightmap(18, 32, 11),
  terrain: { heightmap: createDefaultHeightmap(18, 32, 11), materialLayers: [], water: [], biome: 'temperate' },
  objects: [],
  lighting: { timeOfDay: 'day', fog: 0.02 },
  metadata: { name: 'Новая карта', setting: '', version: 1 },
  path: { waypoints: [] },
  spawnPoint: { col: 0, row: 0 },
  base: { col: 31, row: 17, hp: 20 },
  startingGold: 100,
  waves: []
});

function createDefaultHeightmap(rows: number, cols: number, seed = 11): number[][] {
  return Array.from({ length: rows }, (_, row) =>
    Array.from({ length: cols }, (_, col) => {
      const noise = Math.sin(seed + col * 0.71 + row * 1.37) * 0.5 + Math.cos(seed + col * 0.24 - row * 0.61) * 0.5;
      return noise * 3;
    })
  );
}

function normalizeHeightmap(grid: GridData, heightmap: unknown): number[][] {
  const rows = Math.max(1, Number(grid.rows) || 1);
  const cols = Math.max(1, Number(grid.cols) || 1);
  const source = Array.isArray(heightmap) ? heightmap : [];
  return Array.from({ length: rows }, (_, row) =>
    Array.from({ length: cols }, (_, col) => {
      const value = Number((source[row] as unknown[] | undefined)?.[col]);
      if (!Number.isFinite(value)) return 0;
      return Math.max(MIN_HEIGHT, Math.min(MAX_HEIGHT, value));
    })
  );
}

function snapValue(value: number): number {
  if (!snapEnabled.value) return value;
  const step = Math.max(0.01, Number(snapStep.value) || 0.5);
  return Math.round(value / step) * step;
}

function getSelectedCatalogItem(): CatalogItem {
  return catalog.value.find((item) => item.key === selectedKey.value) || catalog.value[0];
}

function getSelectedObject(): PlacedObject | null {
  return map.value.objects?.find((obj) => obj.id === selectedObjectId.value) || null;
}

function createObjectAtPoint(point: Vector3Data): PlacedObject {
  const cellSize = map.value.grid.cellSize;
  if (selectedAsset.value) {
    return {
      id: crypto.randomUUID(),
      type: 'asset',
      assetId: selectedAsset.value.id,
      primitiveType: 'box',
      transform: {
        position: { x: snapValue(point.x), y: Number(point.y || 0), z: snapValue(point.z) },
        rotation: { x: 0, y: 0, z: 0 },
        scale: { x: cellSize * 2, y: cellSize * 2, z: cellSize * 2 }
      },
      collision: { blocking: true, selectable: true },
      tags: ['asset'],
      properties: {
        assetName: selectedAsset.value.name,
        mime: selectedAsset.value.mime,
        color: { r: 0.45, g: 0.75, b: 0.9 }
      }
    };
  }
  const def = getSelectedCatalogItem();
  return {
    id: crypto.randomUUID(),
    type: def.type,
    primitiveType: 'box',
    transform: {
      position: { x: snapValue(point.x), y: Number(point.y || 0), z: snapValue(point.z) },
      rotation: { x: 0, y: 0, z: 0 },
      scale: {
        x: Math.max(0.2, def.size.w * cellSize),
        y: Math.max(0.2, def.height),
        z: Math.max(0.2, def.size.h * cellSize)
      }
    },
    collision: { blocking: true, selectable: true },
    tags: [def.type],
    properties: { color: def.color, catalogKey: def.key }
  };
}

function renderAll(): void {
  const state = babylonRef.value;
  if (!state) return;
  state.scene.meshes
    .filter((mesh) => mesh.name.startsWith('object-'))
    .forEach((mesh) => mesh.dispose(false, true));
  if (!Array.isArray(map.value.objects)) map.value.objects = [];
  for (const obj of map.value.objects) {
    addPlacedObject(state.scene, obj, map.value.heightmap, map.value.grid);
  }
}

function updatePlacementPreview(): void {
  const state = babylonRef.value;
  if (!state || !previewMesh) return;
  if (mode.value !== 'place') {
    previewMesh.setEnabled(false);
    return;
  }
  const point = pickWorld(state.scene);
  if (!point) {
    previewMesh.setEnabled(false);
    return;
  }
  const candidate = createObjectAtPoint(point);
  const valid = canPlaceObject(candidate, map.value.objects || []);
  updateFreePlacementPreview(previewMesh, candidate, valid, map.value.heightmap, map.value.grid);
}

function applyTerrainBrush(cell: { col: number; row: number }): void {
  const grid = map.value.grid;
  const heightmap = normalizeHeightmap(grid, map.value.heightmap);
  const radius = Math.max(0.1, Number(brushRadius.value) || 0.1);
  const strength = Math.max(0.01, Number(brushStrength.value) || 0.01);
  const targetHeight = brushMode.value === 'flatten'
    ? (Number.isFinite(flattenTargetHeight.value) ? flattenTargetHeight.value : heightmap[cell.row]?.[cell.col] || 0)
    : null;
  for (let row = Math.max(0, Math.floor(cell.row - radius)); row <= Math.min(grid.rows - 1, Math.ceil(cell.row + radius)); row++) {
    for (let col = Math.max(0, Math.floor(cell.col - radius)); col <= Math.min(grid.cols - 1, Math.ceil(cell.col + radius)); col++) {
      const dist = Math.hypot(col - cell.col, row - cell.row);
      if (dist > radius) continue;
      const weight = Math.max(0, 1 - dist / radius) ** 2;
      const current = Number(heightmap[row]?.[col]) || 0;
      let next = current;
      if (brushMode.value === 'raise') next = current + strength * weight;
      if (brushMode.value === 'lower') next = current - strength * weight;
      if (brushMode.value === 'flatten') next = current + ((targetHeight ?? current) - current) * Math.min(1, strength * weight);
      if (brushMode.value === 'smooth') {
        let total = 0;
        let count = 0;
        for (let nr = Math.max(0, row - 1); nr <= Math.min(grid.rows - 1, row + 1); nr++) {
          for (let nc = Math.max(0, col - 1); nc <= Math.min(grid.cols - 1, col + 1); nc++) {
            total += Number(heightmap[nr]?.[nc]) || 0;
            count += 1;
          }
        }
        const avg = count ? total / count : current;
        next = current + (avg - current) * Math.min(1, strength * weight);
      }
      heightmap[row][col] = Math.max(MIN_HEIGHT, Math.min(MAX_HEIGHT, next));
    }
  }
  map.value.heightmap = heightmap;
  map.value.terrain = { ...(map.value.terrain || {}), heightmap };
  updateHeightmapTexture(babylonRef.value?.ground, grid, heightmap);
  renderAll();
}

function updateTerrainPreview(cell: { col: number; row: number }): void {
  if (!terrainBrushMesh) return;
  const diameter = Math.max(0.4, brushRadius.value * 2 * map.value.grid.cellSize);
  const pos = gridToWorld(map.value.grid, cell.col, cell.row);
  const groundHeight = sampleHeight(map.value.heightmap, map.value.grid, cell.col, cell.row, true);
  cursorHeight.value = groundHeight;
  lastTerrainCell.value = cell;
  terrainBrushMesh.scaling.set(diameter, 1, diameter);
  terrainBrushMesh.position = pos;
  terrainBrushMesh.position.y = groundHeight + 0.09;
  terrainBrushMesh.setEnabled(true);
}

function detachCameraForBrush(): void {
  const state = babylonRef.value;
  const canvas = canvasRef.value;
  if (!state || !canvas || cameraDetachedForBrush) return;
  state.camera.detachControl();
  cameraDetachedForBrush = true;
}

function restoreCameraAfterBrush(): void {
  const state = babylonRef.value;
  const canvas = canvasRef.value;
  if (!state || !canvas || !cameraDetachedForBrush) return;
  state.camera.attachControl(canvas, true);
  cameraDetachedForBrush = false;
}

function redrawLevelOverlay(): void {
  const state = babylonRef.value;
  if (!state) return;
  levelOverlay?.dispose();
  levelOverlay = new LevelOverlay(state.scene, map.value);
}

function clearPath(): void {
  map.value.path = { waypoints: [] };
  redrawLevelOverlay();
}

function setSpawnAt(col: number, row: number): void {
  map.value.spawnPoint = { col, row };
  redrawLevelOverlay();
}

function setBaseAt(col: number, row: number): void {
  map.value.base = { ...map.value.base, col, row };
  redrawLevelOverlay();
}

function addWave(): void {
  const index = map.value.waves.length;
  map.value.waves = [...map.value.waves, { index, rewardBonus: 20, groups: [] }];
}

function removeWave(idx: number): void {
  map.value.waves = map.value.waves
    .filter((_, i) => i !== idx)
    .map((w, i) => ({ ...w, index: i }));
}

function addGroupToWave(waveIdx: number): void {
  const wave = map.value.waves[waveIdx];
  if (!wave) return;
  const group: WaveGroup = { enemyTypeId: enemyTypeOptions[0].id, count: 5, interval: 0.8, startDelay: 0 };
  map.value.waves[waveIdx] = { ...wave, groups: [...wave.groups, group] };
}

function removeGroupFromWave(waveIdx: number, groupIdx: number): void {
  const wave = map.value.waves[waveIdx];
  if (!wave) return;
  map.value.waves[waveIdx] = { ...wave, groups: wave.groups.filter((_, i) => i !== groupIdx) };
}

function updateGroup(waveIdx: number, groupIdx: number, patch: Partial<WaveGroup>): void {
  const wave = map.value.waves[waveIdx];
  if (!wave) return;
  const groups = wave.groups.slice();
  groups[groupIdx] = { ...groups[groupIdx], ...patch };
  map.value.waves[waveIdx] = { ...wave, groups };
}

function loadDefaultWaves(): void {
  map.value.waves = DEFAULT_WAVES.map((w) => ({ ...w, groups: w.groups.map((g) => ({ ...g })) }));
}

// ── Phase 6: RTS-режим на карте ──
function setRtsEnabled(enabled: boolean): void {
  if (enabled) {
    map.value.rts = {
      enabled: true,
      startingResources: map.value.rts?.startingResources ?? { wood: 60, stone: 30, ore: 0, gold: 0 }
    };
  } else {
    map.value.rts = { ...(map.value.rts ?? {}), enabled: false };
  }
}

function setRtsResource(key: 'wood' | 'stone' | 'ore' | 'gold', event: Event): void {
  const value = Math.max(0, Number((event.target as HTMLInputElement).value) || 0);
  if (!map.value.rts) map.value.rts = { enabled: true };
  if (!map.value.rts.startingResources) map.value.rts.startingResources = {};
  map.value.rts.startingResources[key] = value;
}

async function init(): Promise<void> {
  try {
    await mapStore.loadMap();
    const data = mapStore.document;
    const grid = data?.grid || map.value.grid;
    const heightmap = normalizeHeightmap(grid, data?.heightmap);
    map.value = {
      ...map.value,
      ...data,
      grid,
      heightmap,
      terrain: { ...(data?.terrain || {}), heightmap },
      objects: Array.isArray(data?.objects) ? data.objects : [],
      path: data?.path || { waypoints: [] },
      spawnPoint: data?.spawnPoint || { col: 0, row: 0 },
      base: data?.base || { col: 31, row: 17, hp: 20 },
      startingGold: Number(data?.startingGold) || 100,
      waves: Array.isArray(data?.waves) ? data.waves : [],
      rts: data?.rts ?? map.value.rts
    };
  } catch (error) {
    console.error(error);
    status.value = 'Не удалось загрузить карту, использую стандартную.';
  }
  if (!canvasRef.value) return;
  const engine = createEngine(canvasRef.value);
  engineRef.value = engine;
  const state = createScene(engine, map.value.grid, map.value.heightmap, { editor: true });
  babylonRef.value = state;
  setGridVisible(state.scene, showGrid.value);
  previewMesh = makePreviewMesh(state.scene);
  terrainBrushMesh = makeTerrainBrushMesh(state.scene);
  renderAll();
  redrawLevelOverlay();
  engine.runRenderLoop(() => state.scene.render());
  state.scene.onPointerObservable.add((pointerInfo) => {
    if (pointerInfo.type === PointerEventTypes.POINTERMOVE) {
      if (mode.value === 'place') {
        terrainBrushMesh?.setEnabled(false);
        updatePlacementPreview();
      } else if (mode.value === 'terrain') {
        previewMesh?.setEnabled(false);
        const cell = pickGrid(state.scene, map.value.grid);
        if (!cell) return;
        updateTerrainPreview(cell);
        if (isPaintingTerrain) applyTerrainBrush(cell);
      } else {
        previewMesh?.setEnabled(false);
        terrainBrushMesh?.setEnabled(false);
      }
    }
    if (pointerInfo.type === PointerEventTypes.POINTERDOWN) {
      if (mode.value === 'place') {
        const point = pickWorld(state.scene);
        if (!point) return;
        const obj = createObjectAtPoint(point);
        if (!canPlaceObject(obj, map.value.objects || [])) {
          status.value = 'Место занято';
          setTimeout(() => (status.value = ''), 1200);
          return;
        }
        map.value.objects = [...(map.value.objects || []), obj];
        selectedObjectId.value = obj.id;
        renderAll();
      } else if (mode.value === 'select') {
        selectedObjectId.value = pickSceneObject(state.scene)?.objectId || null;
        renderAll();
      } else if (mode.value === 'move') {
        const selected = getSelectedObject();
        const point = pickWorld(state.scene);
        if (!selected || !point) return;
        const next = {
          ...selected,
          transform: {
            ...selected.transform,
            position: { x: snapValue(point.x), y: Number(point.y || 0), z: snapValue(point.z) }
          }
        };
        if (!canPlaceObject(next, map.value.objects || [], selected.id)) {
          status.value = 'Место занято';
          setTimeout(() => (status.value = ''), 1200);
          return;
        }
        selected.transform = next.transform;
        renderAll();
      } else if (mode.value === 'rotate') {
        const selected = getSelectedObject();
        if (!selected) return;
        selected.transform.rotation.y = (Number(selected.transform.rotation.y) || 0) + Math.PI / 8;
        renderAll();
      } else if (mode.value === 'scale') {
        const selected = getSelectedObject();
        if (!selected) return;
        const next = {
          ...selected,
          transform: {
            ...selected.transform,
            scale: {
              x: Math.min(30, Number(selected.transform.scale.x || 1) * 1.1),
              y: Math.min(30, Number(selected.transform.scale.y || 1) * 1.1),
              z: Math.min(30, Number(selected.transform.scale.z || 1) * 1.1)
            }
          }
        };
        if (!canPlaceObject(next, map.value.objects || [], selected.id)) return;
        selected.transform = next.transform;
        renderAll();
      } else if (mode.value === 'remove') {
        const removeId = pickSceneObject(state.scene)?.objectId || selectedObjectId.value;
        if (!removeId) return;
        map.value.objects = (map.value.objects || []).filter((obj) => obj.id !== removeId);
        if (selectedObjectId.value === removeId) selectedObjectId.value = null;
        renderAll();
      } else if (mode.value === 'terrain') {
        const cell = pickGrid(state.scene, map.value.grid);
        if (!cell) return;
        detachCameraForBrush();
        flattenTargetHeight.value = sampleHeight(map.value.heightmap, map.value.grid, cell.col, cell.row, true);
        applyTerrainBrush(cell);
        isPaintingTerrain = true;
      } else if (mode.value === 'path') {
        const cell = pickGrid(state.scene, map.value.grid);
        if (!cell) return;
        map.value.path = { waypoints: [...map.value.path.waypoints, { col: cell.col, row: cell.row }] };
        redrawLevelOverlay();
      } else if (mode.value === 'spawn') {
        const cell = pickGrid(state.scene, map.value.grid);
        if (!cell) return;
        setSpawnAt(cell.col, cell.row);
      } else if (mode.value === 'base') {
        const cell = pickGrid(state.scene, map.value.grid);
        if (!cell) return;
        setBaseAt(cell.col, cell.row);
      }
    }
    if (pointerInfo.type === PointerEventTypes.POINTERUP) {
      isPaintingTerrain = false;
      restoreCameraAfterBrush();
    }
  });
}

function selectAsset(asset: AssetRecord): void {
  selectedAsset.value = asset;
  mode.value = 'place';
}

function toggleGrid(): void {
  const state = babylonRef.value;
  if (state) setGridVisible(state.scene, showGrid.value);
}

function pickFlattenHeightFromLast(): void {
  if (!lastTerrainCell.value) return;
  flattenTargetHeight.value = sampleHeight(map.value.heightmap, map.value.grid, lastTerrainCell.value.col, lastTerrainCell.value.row, true);
}

async function doSave(): Promise<void> {
  saving.value = true;
  status.value = '';
  try {
    map.value.heightmap = normalizeHeightmap(map.value.grid, map.value.heightmap);
    map.value.terrain = { ...(map.value.terrain || {}), heightmap: map.value.heightmap };
    map.value.objects = Array.isArray(map.value.objects) ? map.value.objects : [];
    map.value.version = Number(map.value.version || 1) + 1;
    await mapStore.saveCurrentMap(map.value);
    status.value = 'Сохранено';
  } catch (error) {
    console.error(error);
    status.value = 'Ошибка сохранения';
  } finally {
    saving.value = false;
    setTimeout(() => (status.value = ''), 1400);
  }
}

onMounted(() => init());

onBeforeUnmount(() => {
  restoreCameraAfterBrush();
  levelOverlay?.dispose();
  levelOverlay = null;
  engineRef.value?.dispose();
});
</script>

<template>
  <div class="map-editor">
    <header class="toolbar">
      <div class="toolbar-left">
        <div class="brand">Редактор карты</div>
        <div class="grid-pill">Колонки {{ map.grid.cols }} · Ряды {{ map.grid.rows }} · Размер {{ map.grid.cellSize }}</div>
      </div>
      <div class="toolbar-right">
        <button class="btn primary" :disabled="saving" @click="doSave">Сохранить</button>
        <span class="status" :class="{ success: status === 'Сохранено' }">{{ status }}</span>
      </div>
    </header>

    <div class="workspace">
      <aside class="side-panel" @pointerdown.stop>
        <section class="panel-block">
          <div class="section-title">Инструменты</div>
          <div class="tool-grid">
            <label v-for="opt in modeOptions" :key="opt" :class="['tool-button', mode === opt ? 'active' : '']">
              <input v-model="mode" type="radio" :value="opt" />
              <span>{{ modeLabels[opt] }}</span>
            </label>
          </div>

          <div class="tool-section">
            <div class="section-subtitle">Размещение</div>
            <label class="inline-check">
              <input v-model="snapEnabled" type="checkbox" />
              <span>Snap к шагу</span>
            </label>
            <label class="inline-check">
              <input v-model="showGrid" type="checkbox" @change="toggleGrid" />
              <span>Показывать debug-сетку</span>
            </label>
            <label class="field">
              <span>Шаг snap</span>
              <input v-model.number="snapStep" type="number" min="0.1" step="0.1" />
            </label>
            <div class="pill muted">Выбрано: {{ selectedObjectId || 'нет объекта' }}</div>
            <div class="pill muted">Ассет: {{ selectedAsset?.name || 'не выбран' }}</div>
            <p class="hint">Выберите шаблон или загруженный ассет, затем инструмент “Разместить”. Красный preview означает пересечение.</p>
          </div>

          <div v-if="mode === 'terrain'" class="tool-section">
            <div class="section-subtitle">Кисть рельефа</div>
            <label class="field">
              <span>Инструмент</span>
              <select v-model="brushMode">
                <option value="raise">Поднять</option>
                <option value="lower">Опустить</option>
                <option value="smooth">Сгладить</option>
                <option value="flatten">Выровнять</option>
              </select>
            </label>
            <label class="field slider">
              <span>Радиус: {{ brushRadius.toFixed(1) }} яч.</span>
              <input v-model.number="brushRadius" type="range" min="0.5" max="5" step="0.5" />
            </label>
            <label class="field slider">
              <span>Сила: {{ brushStrength.toFixed(2) }}</span>
              <input v-model.number="brushStrength" type="range" min="0.05" max="1.2" step="0.05" />
            </label>
            <p class="hint">При рисовании камера временно отключается, чтобы площадка не вращалась.</p>
            <div class="pill muted">Высота: {{ cursorHeight.toFixed(2) }}</div>
            <div class="button-row">
              <button class="btn ghost" :disabled="!lastTerrainCell" @click="pickFlattenHeightFromLast">Взять высоту</button>
              <button class="btn ghost" @click="flattenTargetHeight = null">Сбросить</button>
            </div>
          </div>
        </section>

        <section class="panel-block">
          <div class="section-title">Поле боя (TD)</div>

          <div class="tool-section">
            <div class="section-subtitle">Путь и точки</div>
            <p class="hint">Выберите инструмент «Путь» и кликайте клетки по порядку — это маршрут врагов. «Спавн»/«База» ставят старт и финиш одной точкой.</p>
            <div class="pill muted">Waypoints: {{ map.path.waypoints.length }}</div>
            <div class="pill muted">Спавн: {{ map.spawnPoint.col }},{{ map.spawnPoint.row }}</div>
            <div class="pill muted">База: {{ map.base.col }},{{ map.base.row }} (HP {{ map.base.hp }})</div>
            <div class="button-row">
              <button class="btn ghost" @click="clearPath">Очистить путь</button>
            </div>
          </div>

          <div class="tool-section">
            <div class="section-subtitle">Стартовые ресурсы</div>
            <label class="field">
              <span>Стартовое золото</span>
              <input v-model.number="map.startingGold" type="number" min="0" step="10" />
            </label>
            <label class="field">
              <span>HP базы (жизни)</span>
              <input v-model.number="map.base.hp" type="number" min="1" step="1" />
            </label>
          </div>

          <div class="tool-section">
            <div class="section-subtitle">RTS «Тёмная крепость»</div>
            <label class="inline-check">
              <input type="checkbox" :checked="!!map.rts?.enabled" @change="setRtsEnabled(($event.target as HTMLInputElement).checked)" />
              <span>включить RTS-режим (экономика + юниты + командир)</span>
            </label>
            <template v-if="map.rts?.enabled">
              <p class="hint">Дополнительные стартовые ресурсы RTS (wood/stone/ore). Gold прибавится к стартовому золоту карты.</p>
              <label class="field">
                <span>Дерево</span>
                <input :value="map.rts.startingResources?.wood ?? 60" type="number" min="0" step="10" @input="setRtsResource('wood', $event)" />
              </label>
              <label class="field">
                <span>Камень</span>
                <input :value="map.rts.startingResources?.stone ?? 30" type="number" min="0" step="10" @input="setRtsResource('stone', $event)" />
              </label>
              <label class="field">
                <span>Руда</span>
                <input :value="map.rts.startingResources?.ore ?? 0" type="number" min="0" step="10" @input="setRtsResource('ore', $event)" />
              </label>
              <label class="field">
                <span>Доп. золото</span>
                <input :value="map.rts.startingResources?.gold ?? 0" type="number" min="0" step="10" @input="setRtsResource('gold', $event)" />
              </label>
            </template>
          </div>

          <div class="tool-section">
            <div class="section-subtitle">Волны</div>
            <div class="button-row">
              <button class="btn ghost" @click="addWave">Добавить волну</button>
              <button class="btn ghost" @click="loadDefaultWaves">Дефолт (10)</button>
            </div>
            <div v-for="(wave, wi) in map.waves" :key="wi" class="wave-card">
              <div class="wave-head">
                <span class="wave-title">Волна {{ wi + 1 }}</span>
                <label class="inline-check">
                  <input type="checkbox" :checked="!!wave.isBoss" @change="map.waves[wi] = { ...wave, isBoss: ($event.target as HTMLInputElement).checked }" />
                  <span>босс</span>
                </label>
                <button class="btn danger tiny" @click="removeWave(wi)">×</button>
              </div>
              <label class="field">
                <span>Бонус золота</span>
                <input :value="wave.rewardBonus" type="number" min="0" step="5" @input="map.waves[wi] = { ...wave, rewardBonus: Number(($event.target as HTMLInputElement).value) || 0 }" />
              </label>
              <div v-for="(g, gi) in wave.groups" :key="gi" class="group-row">
                <select :value="g.enemyTypeId" @change="updateGroup(wi, gi, { enemyTypeId: ($event.target as HTMLSelectElement).value })">
                  <option v-for="et in enemyTypeOptions" :key="et.id" :value="et.id">{{ et.name }}</option>
                </select>
                <input :value="g.count" type="number" min="1" title="кол-во" @input="updateGroup(wi, gi, { count: Math.max(1, Number(($event.target as HTMLInputElement).value) || 1) })" />
                <input :value="g.interval" type="number" min="0.01" step="0.1" title="интервал, с" @input="updateGroup(wi, gi, { interval: Math.max(0.01, Number(($event.target as HTMLInputElement).value) || 0.01) })" />
                <input :value="g.startDelay" type="number" min="0" step="0.5" title="задержка, с" @input="updateGroup(wi, gi, { startDelay: Math.max(0, Number(($event.target as HTMLInputElement).value) || 0) })" />
                <button class="btn danger tiny" @click="removeGroupFromWave(wi, gi)">×</button>
              </div>
              <button class="btn ghost small" @click="addGroupToWave(wi)">+ группа</button>
            </div>
          </div>
        </section>

        <section class="panel-block">
          <div class="section-title">Загруженные модели</div>
          <AssetManager :selected-asset-id="selectedAsset?.id" @asset-selected="selectAsset" />
        </section>
      </aside>

      <main class="stage">
        <div class="canvas-wrap">
          <canvas ref="canvasRef"></canvas>
        </div>
        <div class="catalog">
          <button
            v-for="item in catalog"
            :key="item.key"
            class="catalog-card"
            :class="{ active: !selectedAsset && selectedKey === item.key }"
            @click="selectedAsset = null; selectedKey = item.key; mode = 'place'"
          >
            <div class="card-title">{{ item.label }}</div>
            <div class="card-meta">{{ item.size.w }}x{{ item.size.h }} · высота {{ item.height }}</div>
            <div class="swatch" :style="{ background: `rgb(${Math.floor(item.color.r*255)}, ${Math.floor(item.color.g*255)}, ${Math.floor(item.color.b*255)})` }"></div>
          </button>
        </div>
      </main>
    </div>
  </div>
</template>

<style scoped>
.map-editor {
  display: flex;
  flex-direction: column;
  height: 100%;
  background: #0b1021;
  color: #e5e7eb;
  font-family: Inter, system-ui, -apple-system, sans-serif;
}
.toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 12px 16px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.08);
  background: rgba(15, 23, 42, 0.96);
}
.toolbar-left,
.toolbar-right {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}
.brand {
  font-weight: 800;
  color: #f8fafc;
}
.grid-pill,
.pill {
  padding: 7px 10px;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.06);
  color: #cbd5e1;
  font-size: 13px;
}
.workspace {
  flex: 1;
  display: grid;
  grid-template-columns: 300px 1fr;
  min-height: 0;
  gap: 12px;
  padding: 12px;
}
.side-panel {
  display: flex;
  flex-direction: column;
  gap: 12px;
  overflow: auto;
}
.panel-block,
.stage {
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 14px;
  background: rgba(255, 255, 255, 0.035);
}
.panel-block {
  padding: 12px;
}
.section-title {
  margin-bottom: 10px;
  font-weight: 800;
}
.section-subtitle {
  margin: 14px 0 10px;
  font-size: 13px;
  font-weight: 800;
  color: #cbd5e1;
}
.tool-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px;
}
.tool-button {
  display: flex;
  justify-content: center;
  align-items: center;
  min-height: 38px;
  border: 1px solid rgba(148, 163, 184, 0.16);
  border-radius: 10px;
  background: rgba(255, 255, 255, 0.04);
  color: #cbd5e1;
  cursor: pointer;
  font-size: 13px;
  font-weight: 750;
}
.tool-button input {
  display: none;
}
.tool-button.active {
  border-color: rgba(96, 165, 250, 0.9);
  background: rgba(59, 130, 246, 0.25);
  color: #fff;
}
.field,
.inline-check {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-bottom: 10px;
  color: #cbd5e1;
}
.inline-check {
  flex-direction: row;
  align-items: center;
}
.field input,
.field select {
  padding: 8px;
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.06);
  color: #e5e7eb;
}
.hint {
  color: #94a3b8;
  font-size: 12px;
  line-height: 1.4;
}
.button-row {
  display: flex;
  gap: 8px;
  margin-top: 8px;
  flex-wrap: wrap;
}
.stage {
  display: flex;
  flex-direction: column;
  min-width: 0;
  overflow: hidden;
}
.canvas-wrap {
  flex: 1;
  min-height: 360px;
  background: #15162a;
}
.canvas-wrap canvas {
  display: block;
  width: 100%;
  height: 100%;
}
.catalog {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
  gap: 10px;
  padding: 12px;
  border-top: 1px solid rgba(255, 255, 255, 0.08);
}
.catalog-card {
  padding: 10px;
  border: 1px solid rgba(148, 163, 184, 0.16);
  border-radius: 12px;
  background: rgba(255, 255, 255, 0.04);
  color: #e5e7eb;
  text-align: left;
}
.catalog-card.active {
  border-color: #3b82f6;
  background: rgba(59, 130, 246, 0.14);
}
.card-title {
  font-weight: 800;
}
.card-meta {
  margin-top: 4px;
  color: #94a3b8;
  font-size: 12px;
}
.swatch {
  margin-top: 8px;
  height: 8px;
  border-radius: 999px;
}
.btn {
  border: none;
  border-radius: 8px;
  padding: 8px 12px;
  font-weight: 750;
}
.btn.primary {
  background: #2563eb;
  color: #fff;
}
.btn.ghost {
  border: 1px solid rgba(255, 255, 255, 0.12);
  background: rgba(255, 255, 255, 0.07);
  color: #e5e7eb;
}
.btn:disabled {
  opacity: 0.55;
}
.status {
  min-width: 96px;
  color: #cbd5e1;
  font-size: 13px;
}
.status.success {
  color: #22c55e;
}
.wave-card {
  margin-top: 10px;
  padding: 10px;
  border: 1px solid rgba(148, 163, 184, 0.18);
  border-radius: 10px;
  background: rgba(255, 255, 255, 0.03);
}
.wave-head {
  display: flex;
  align-items: center;
  gap: 8px;
}
.wave-title {
  font-weight: 800;
  color: #f8fafc;
  flex: 1;
}
.group-row {
  display: grid;
  grid-template-columns: 1fr 56px 64px 64px 28px;
  gap: 6px;
  margin: 6px 0;
  align-items: center;
}
.group-row select,
.group-row input {
  padding: 5px 6px;
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 6px;
  background: rgba(255, 255, 255, 0.06);
  color: #e5e7eb;
  font-size: 12px;
  width: 100%;
}
.btn.tiny {
  padding: 2px 7px;
  font-size: 14px;
  line-height: 1;
  min-width: 26px;
}
.btn.small {
  padding: 5px 9px;
  font-size: 12px;
}
@media (max-width: 980px) {
  .workspace {
    grid-template-columns: 1fr;
  }
}
</style>
