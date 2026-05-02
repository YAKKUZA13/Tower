<script setup>
import { ref, onMounted, onBeforeUnmount } from 'vue';
import { getMap, saveMap } from '../services/api.js';
import { createEngine, createScene, addBuilding, pickGrid, makePreviewMesh, updatePreviewMesh, drawPath, updateHeightmapTexture, sampleHeight, gridToWorld } from '../babylon/createScene.js';
import { PointerEventTypes } from 'babylonjs';
import AssetManager from './AssetManager.vue';

const canvasRef = ref(null);
const engineRef = ref(null);
const babylonRef = ref(null);

const MIN_HEIGHT = -50;
const MAX_HEIGHT = 200;
const MAX_SLOPE_DELTA = 1.5;

function createFlatHeightmap(rows, cols, fill = 0) {
  const safeRows = Math.max(1, Number(rows) || 1);
  const safeCols = Math.max(1, Number(cols) || 1);
  return Array.from({ length: safeRows }, () => Array.from({ length: safeCols }, () => fill));
}

function clampHeight(v) {
  const num = Number(v);
  if (!Number.isFinite(num)) return 0;
  return Math.max(MIN_HEIGHT, Math.min(MAX_HEIGHT, num));
}

function normalizeHeightmap(grid, hm) {
  const rows = Math.max(1, Number(grid?.rows) || 1);
  const cols = Math.max(1, Number(grid?.cols) || 1);
  const result = createFlatHeightmap(rows, cols, 0);
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const val = hm && Array.isArray(hm[r]) ? hm[r][c] : null;
      result[r][c] = clampHeight(val);
    }
  }
  return result;
}

function valueNoise(x, y, seed = 1) {
  const h = Math.sin(seed + x * 127.1 + y * 311.7) * 43758.5453;
  return h - Math.floor(h);
}

function fbmNoise(x, y, seed = 1, octaves = 4, persistence = 0.5, lacunarity = 2) {
  let amp = 1;
  let freq = 1;
  let sum = 0;
  let norm = 0;
  for (let i = 0; i < octaves; i++) {
    const xf = x * freq;
    const yf = y * freq;
    const x0 = Math.floor(xf);
    const y0 = Math.floor(yf);
    const tx = xf - x0;
    const ty = yf - y0;
    const v00 = valueNoise(x0, y0, seed);
    const v10 = valueNoise(x0 + 1, y0, seed);
    const v01 = valueNoise(x0, y0 + 1, seed);
    const v11 = valueNoise(x0 + 1, y0 + 1, seed);
    const vx0 = v00 * (1 - tx) + v10 * tx;
    const vx1 = v01 * (1 - tx) + v11 * tx;
    const blended = vx0 * (1 - ty) + vx1 * ty;

    sum += blended * amp;
    norm += amp;
    amp *= persistence;
    freq *= lacunarity;
  }
  return norm > 0 ? sum / norm : 0;
}

function generateDefaultHeightmap(rows, cols, seed = 11) {
  const safeRows = Math.max(1, Number(rows) || 1);
  const safeCols = Math.max(1, Number(cols) || 1);
  const hm = [];
  const scale = 0.08;
  const amplitude = 8;
  for (let r = 0; r < safeRows; r++) {
    const row = [];
    for (let c = 0; c < safeCols; c++) {
      const nx = c * scale;
      const ny = r * scale;
      row.push(fbmNoise(nx, ny, seed, 4, 0.55, 2.1) * amplitude);
    }
    hm.push(row);
  }
  return hm;
}

function isFlatHeightmap(hm) {
  if (!Array.isArray(hm) || !hm.length || !Array.isArray(hm[0])) return true;
  let min = Infinity;
  let max = -Infinity;
  for (let r = 0; r < hm.length; r++) {
    const row = hm[r];
    for (let c = 0; c < (row?.length || 0); c++) {
      const v = Number(row[c]);
      if (!Number.isFinite(v)) continue;
      if (v < min) min = v;
      if (v > max) max = v;
    }
  }
  if (min === Infinity || max === -Infinity) return true;
  return Math.abs(max - min) < 0.05;
}

const map = ref({
  version: 1,
  grid: { cols: 32, rows: 18, cellSize: 1.5 },
  heightmap: generateDefaultHeightmap(18, 32, 11),
  towers: [],
  path: { waypoints: [] },
  base: { hp: 20 },
  waves: []
});
const mode = ref('place'); // place | remove | path | terrain
const saving = ref(false);
const status = ref('');

const brushMode = ref('raise'); // raise | lower | smooth | flatten
const brushRadius = ref(1.2);
const brushStrength = ref(0.35);
const flattenTargetHeight = ref(null);
const cursorHeight = ref(0);
const lastTerrainCell = ref(null);
let isPaintingTerrain = false;
const modeOptions = ['place', 'remove', 'path', 'terrain'];
const modeLabels = {
  place: 'Строить',
  remove: 'Удалять',
  path: 'Путь',
  terrain: 'Рельеф'
};

// Catalog at bottom menu
const catalog = ref([
  { key: 'house_1x1', label: 'Дом 1x1', type: 'house', size: { w: 1, h: 1 }, height: 4, color: { r: 0.6, g: 0.8, b: 0.6 }, props: {} },
  { key: 'house_2x2', label: 'Дом 2x2', type: 'house', size: { w: 2, h: 2 }, height: 3, color: { r: 0.5, g: 0.7, b: 0.5 }, props: {} },
  { key: 'tower_3x3', label: 'Башня 3x3', type: 'tower', size: { w: 3, h: 3 }, height: 6, color: { r: 0.4, g: 0.6, b: 0.9 }, props: {} },
]);
const selectedKey = ref(catalog.value[0].key);

function getSelectedDef() {
  return catalog.value.find(c => c.key === selectedKey.value) || catalog.value[0];
}

function rectanglesOverlap(a, b) {
  return !(a.col + a.size.w <= b.col || b.col + b.size.w <= a.col || a.row + a.size.h <= b.row || b.row + b.size.h <= a.row);
}

function isTerrainFlatEnough(col, row, size) {
  const hm = map.value.heightmap;
  if (!hm || !Array.isArray(hm)) return true;
  let minH = Infinity;
  let maxH = -Infinity;
  for (let r = row; r < row + size.h; r++) {
    for (let c = col; c < col + size.w; c++) {
      const val = hm?.[r]?.[c];
      if (!Number.isFinite(val)) continue;
      if (val < minH) minH = val;
      if (val > maxH) maxH = val;
    }
  }
  if (minH === Infinity || maxH === -Infinity) return true;
  return (maxH - minH) <= MAX_SLOPE_DELTA;
}

function canPlace(col, row, size) {
  // Bounds
  if (col < 0 || row < 0) return false;
  if (col + size.w > map.value.grid.cols) return false;
  if (row + size.h > map.value.grid.rows) return false;
  // Forbid path cells
  const pathCells = new Set();
  const wps = map.value?.path?.waypoints || [];
  for (let i = 0; i < wps.length; i++) {
    const a = wps[i];
    const b = wps[i + 1];
    if (!a) continue;
    pathCells.add(`${a.col}:${a.row}`);
    if (!b) continue;
    const dCol = Math.sign(b.col - a.col);
    const dRow = Math.sign(b.row - a.row);
    for (let c = a.col + dCol; c !== b.col + dCol && dCol !== 0; c += dCol) pathCells.add(`${c}:${a.row}`);
    for (let r = a.row + dRow; r !== b.row + dRow && dRow !== 0; r += dRow) pathCells.add(`${b.col}:${r}`);
  }
  for (let cx = col; cx < col + size.w; cx++) {
    for (let cy = row; cy < row + size.h; cy++) {
      if (pathCells.has(`${cx}:${cy}`)) return false;
    }
  }
  if (!isTerrainFlatEnough(col, row, size)) return false;
  // Collision with existing
  const candidate = { col, row, size };
  for (const t of map.value.towers) {
    const sz = t.size ? t.size : { w: 1, h: 1 };
    if (rectanglesOverlap(candidate, { col: t.col, row: t.row, size: sz })) return false;
  }
  return true;
}

function findBuildingAtCell(col, row) {
  for (const t of map.value.towers) {
    const sz = t.size ? t.size : { w: 1, h: 1 };
    if (col >= t.col && col < t.col + sz.w && row >= t.row && row < t.row + sz.h) return t;
  }
  return null;
}

function addNewBuilding(col, row) {
  const def = getSelectedDef();
  if (!canPlace(col, row, def.size)) return null;
  const b = {
    id: crypto.randomUUID(),
    type: def.type,
    col,
    row,
    level: 1,
    size: { w: def.size.w, h: def.size.h },
    height: def.height,
    color: def.color,
    props: def.props || {}
  };
  map.value.towers.push(b);
  return b;
}

function removeBuildingByCell(col, row) {
  const t = findBuildingAtCell(col, row);
  if (!t) return;
  const idx = map.value.towers.findIndex(x => x.id === t.id);
  if (idx >= 0) map.value.towers.splice(idx, 1);
}

function renderAll() {
  const { scene } = babylonRef.value;
  const heightmap = map.value.heightmap;
  // Remove previous building/tower meshes
  scene.meshes.filter(m => m.name.startsWith('building-') || m.name.startsWith('tower-')).forEach(m => m.dispose());
  for (const t of map.value.towers) {
    const hasSize = t && t.size && Number.isFinite(Number(t.size.w)) && Number.isFinite(Number(t.size.h));
    const hasHeight = Number.isFinite(Number(t.height));
    if (hasSize && hasHeight) {
      addBuilding(scene, map.value.grid, t, heightmap);
    } else {
      // Normalize legacy entries to box 1x1 with height from level for consistent visuals
      const lvl = Math.max(1, Number(t.level || 1));
      const norm = {
        id: t.id,
        type: t.type,
        col: t.col,
        row: t.row,
        size: { w: 1, h: 1 },
        height: 2 + lvl * 0.2,
        color: t.color || { r: 0.6, g: 0.6, b: 0.6 }
      };
      addBuilding(scene, map.value.grid, norm, heightmap);
    }
  }
}

let previewMesh = null;

function applyTerrainBrush(cell) {
  const grid = map.value.grid;
  map.value.heightmap = normalizeHeightmap(grid, map.value.heightmap);
  const hm = map.value.heightmap;
  const radius = Math.max(0.1, Number(brushRadius.value) || 0.1);
  const strength = Math.max(0.01, Number(brushStrength.value) || 0.01);
  const rows = grid.rows;
  const cols = grid.cols;
  const targetHeight = brushMode.value === 'flatten'
    ? (Number.isFinite(flattenTargetHeight.value) ? flattenTargetHeight.value : (hm?.[cell.row]?.[cell.col] ?? 0))
    : null;

  const rMin = Math.max(0, Math.floor(cell.row - radius));
  const rMax = Math.min(rows - 1, Math.ceil(cell.row + radius));
  const cMin = Math.max(0, Math.floor(cell.col - radius));
  const cMax = Math.min(cols - 1, Math.ceil(cell.col + radius));

  for (let r = rMin; r <= rMax; r++) {
    for (let c = cMin; c <= cMax; c++) {
      const dx = c - cell.col;
      const dy = r - cell.row;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist > radius + 0.001) continue;
      // Smooth falloff to avoid hard steps
      const falloff = Math.max(0, 1 - dist / radius);
      const weight = falloff * falloff; // quadratic falloff
      const current = Number(hm?.[r]?.[c]) || 0;
      let next = current;
      if (brushMode.value === 'raise') {
        next = current + strength * weight;
      } else if (brushMode.value === 'lower') {
        next = current - strength * weight;
      } else if (brushMode.value === 'smooth') {
        let acc = 0;
        let totalW = 0;
        for (let nr = Math.max(0, r - Math.ceil(radius)); nr <= Math.min(rows - 1, r + Math.ceil(radius)); nr++) {
          for (let nc = Math.max(0, c - Math.ceil(radius)); nc <= Math.min(cols - 1, c + Math.ceil(radius)); nc++) {
            const ddx = nc - c;
            const ddy = nr - r;
            const nd = Math.sqrt(ddx * ddx + ddy * ddy);
            if (nd > radius) continue;
            const nv = hm?.[nr]?.[nc];
            if (!Number.isFinite(nv)) continue;
            const nw = Math.max(0, 1 - nd / radius);
            acc += nv * nw;
            totalW += nw;
          }
        }
        const avg = totalW > 0 ? acc / totalW : current;
        next = current + (avg - current) * Math.min(1, strength * weight);
      } else if (brushMode.value === 'flatten') {
        const target = Number.isFinite(targetHeight) ? targetHeight : current;
        next = current + (target - current) * Math.min(1, strength * weight);
      }
      hm[r][c] = clampHeight(next);
    }
  }
  updateHeightmapTexture(babylonRef.value?.ground, grid, hm);
  renderAll();
  drawPath(babylonRef.value.scene, map.value.grid, map.value?.path?.waypoints || [], map.value.heightmap);
}

function updateTerrainPreview(cell) {
  if (!previewMesh) return;
  const size = brushRadius.value * 2 + 0.5;
  const h = 0.2;
  const pos = gridToWorld(map.value.grid, cell.col, cell.row);
  const groundHeight = sampleHeight(map.value.heightmap, map.value.grid, cell.col, cell.row, true);
  cursorHeight.value = groundHeight;
  lastTerrainCell.value = cell;
  pos.y = groundHeight + h / 2 + 0.05;
  previewMesh.scaling.set(size, h, size);
  previewMesh.position = pos;
  if (previewMesh.material?.diffuseColor) {
    previewMesh.material.diffuseColor.set(0.2, 0.6, 0.9);
  }
  previewMesh.setEnabled(true);
}

function pickFlattenHeight(cell) {
  const h = sampleHeight(map.value.heightmap, map.value.grid, cell.col, cell.row, true);
  flattenTargetHeight.value = h;
}

function pickFlattenHeightFromLast() {
  if (lastTerrainCell.value) {
    pickFlattenHeight(lastTerrainCell.value);
  }
}

async function init() {
  try {
    const data = await getMap();
    const grid = data?.grid || map.value.grid;
    const normalizedHm = normalizeHeightmap(grid, data?.heightmap);
    const needsGeneration = isFlatHeightmap(normalizedHm);
    map.value = {
      ...map.value,
      ...data,
      grid,
      heightmap: needsGeneration ? generateDefaultHeightmap(grid.rows, grid.cols, 11) : normalizedHm
    };
    if (!map.value.path || !Array.isArray(map.value.path.waypoints)) {
      map.value.path = { waypoints: [] };
    }
  } catch (e) {
    console.error(e);
    status.value = 'Не удалось загрузить карту, использую стандартную.';
  }

  const engine = createEngine(canvasRef.value);
  engineRef.value = engine;
  const { scene, ground } = createScene(engine, map.value.grid, map.value.heightmap);
  babylonRef.value = { scene, ground };

  previewMesh = makePreviewMesh(scene, map.value.grid);

  engine.runRenderLoop(() => {
    scene.render();
  });

  renderAll();
  drawPath(scene, map.value.grid, map.value?.path?.waypoints || [], map.value.heightmap);

  // Preview update on move (and path ghost)
  scene.onPointerObservable.add((pointerInfo) => {
    const cell = pickGrid(scene, map.value.grid);
    if (!cell) return;
    const def = getSelectedDef();
    if (mode.value === 'place') {
      const valid = canPlace(cell.col, cell.row, def.size);
      updatePreviewMesh(previewMesh, map.value.grid, { col: cell.col, row: cell.row, size: def.size, height: def.height }, valid, map.value.heightmap);
    } else if (mode.value === 'remove') {
      // hide preview in remove mode
      if (previewMesh) previewMesh.setEnabled(false);
    } else if (mode.value === 'path') {
      if (previewMesh) previewMesh.setEnabled(false);
    } else if (mode.value === 'terrain') {
      updateTerrainPreview(cell);
      if (isPaintingTerrain) applyTerrainBrush(cell);
    } else {
      if (previewMesh) previewMesh.setEnabled(false);
    }
  }, PointerEventTypes.POINTERMOVE);

  // Place/Remove/Path on click
  scene.onPointerObservable.add((pointerInfo) => {
    if (pointerInfo.type !== PointerEventTypes.POINTERDOWN) return;
    const cell = pickGrid(scene, map.value.grid);
    if (!cell) return;
    if (mode.value === 'place') {
      const b = addNewBuilding(cell.col, cell.row);
      if (b) renderAll();
    } else if (mode.value === 'remove') {
      removeBuildingByCell(cell.col, cell.row);
      renderAll();
    } else if (mode.value === 'path') {
      if (!map.value.path) map.value.path = { waypoints: [] };
      if (!Array.isArray(map.value.path.waypoints)) map.value.path.waypoints = [];
      const wps = map.value.path.waypoints;
      const last = wps[wps.length - 1];
      if (last && last.col === cell.col && last.row === cell.row) {
        // toggle remove last if clicking same cell
        wps.pop();
      } else {
        wps.push({ col: cell.col, row: cell.row });
      }
      drawPath(scene, map.value.grid, wps, map.value.heightmap);
    } else if (mode.value === 'terrain') {
      pickFlattenHeight(cell);
      applyTerrainBrush(cell);
      isPaintingTerrain = true;
    }
  }, PointerEventTypes.POINTERDOWN);

  scene.onPointerObservable.add((pointerInfo) => {
    if (pointerInfo.type === PointerEventTypes.POINTERUP) {
      isPaintingTerrain = false;
    }
  }, PointerEventTypes.POINTERUP);

  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      if (previewMesh) previewMesh.setEnabled(false);
    }
  });
}

async function doSave() {
  saving.value = true;
  status.value = '';
  try {
    map.value.heightmap = normalizeHeightmap(map.value.grid, map.value.heightmap);
    await saveMap(map.value);
    status.value = 'Сохранено';
  } catch (e) {
    console.error(e);
    status.value = 'Ошибка сохранения';
  } finally {
    saving.value = false;
    setTimeout(() => (status.value = ''), 1200);
  }
}

onMounted(() => init());

onBeforeUnmount(() => {
  if (engineRef.value) engineRef.value.dispose();
});
</script>

<template>
  <div class="map-editor">
    <header class="toolbar">
      <div class="toolbar-left">
        <div class="brand">Редактор карты</div>
        <div class="mode-switch">
          <label v-for="opt in modeOptions" :key="opt" :class="['chip', mode === opt ? 'active' : '']">
            <input type="radio" :value="opt" v-model="mode" />
            <span>{{ modeLabels[opt] }}</span>
          </label>
        </div>
      </div>
      <div class="toolbar-right">
        <div class="grid-pill">Колонки {{ map.grid.cols }} · Ряды {{ map.grid.rows }} · Размер {{ map.grid.cellSize }}</div>
        <button class="btn primary" :disabled="saving" @click="doSave">Сохранить</button>
        <span class="status" :class="{ success: status === 'Сохранено' }">{{ status }}</span>
      </div>
    </header>

    <div class="workspace">
      <aside class="side-panel">
        <section class="panel-block" v-if="mode === 'terrain'">
          <div class="section-title">Кисть рельефа</div>
          <label class="field">
            <span>Инструмент</span>
            <select v-model="brushMode">
              <option value="raise">Поднять</option>
              <option value="lower">Опустить</option>
              <option value="smooth">Сгладить</option>
              <option value="flatten">Выровнять по высоте</option>
            </select>
          </label>
          <label class="field slider">
            <div class="field-top">
              <span>Радиус</span>
              <span class="value">{{ brushRadius.toFixed(1) }} яч.</span>
            </div>
            <input type="range" min="0" max="5" step="0.5" v-model.number="brushRadius" />
          </label>
          <label class="field slider">
            <div class="field-top">
              <span>Сила</span>
              <span class="value">{{ brushStrength.toFixed(2) }}</span>
            </div>
            <input type="range" min="0.05" max="1.2" step="0.05" v-model.number="brushStrength" />
          </label>
          <p class="hint">Зажмите мышь и тяните для изменения рельефа. Постройки требуют ровных площадок.</p>
          <div class="pill muted" style="margin-top:6px;">Высота под курсором: {{ cursorHeight.toFixed(2) }}</div>
          <div class="pill muted" style="margin-top:6px;">
            Высота выравнивания: {{ flattenTargetHeight === null ? 'авто' : flattenTargetHeight.toFixed(2) }}
          </div>
          <div class="button-row">
            <button class="btn ghost" @click="pickFlattenHeightFromLast" :disabled="!lastTerrainCell">Взять высоту</button>
            <button class="btn ghost" @click="flattenTargetHeight = null">Сбросить</button>
          </div>
        </section>

        <section class="panel-block">
          <div class="section-title">Сетка</div>
          <div class="pill muted">Колонки {{ map.grid.cols }} · Ряды {{ map.grid.rows }} · Размер {{ map.grid.cellSize }}</div>
        </section>

        <section class="panel-block">
          <div class="section-title">Объекты</div>
          <AssetManager />
        </section>
      </aside>

      <main class="stage">
        <div class="canvas-wrap">
          <canvas ref="canvasRef"></canvas>
        </div>
        <div class="catalog">
          <div
            v-for="item in catalog"
            :key="item.key"
            class="catalog-card"
            :class="{ active: selectedKey === item.key }"
            @click="selectedKey = item.key"
          >
            <div class="card-header">
              <div class="card-title">{{ item.label }}</div>
              <div class="card-meta">{{ item.size.w }}x{{ item.size.h }} · высота {{ item.height }}</div>
            </div>
            <div class="swatch" :style="{ background: `rgb(${Math.floor(item.color.r*255)}, ${Math.floor(item.color.g*255)}, ${Math.floor(item.color.b*255)})` }"></div>
          </div>
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
  font-family: 'Inter', system-ui, -apple-system, sans-serif;
}

.toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 16px;
  gap: 12px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.08);
  background: rgba(255, 255, 255, 0.02);
  backdrop-filter: blur(8px);
  position: sticky;
  top: 0;
  z-index: 3;
}

.toolbar-left {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
}

.brand {
  font-weight: 700;
  letter-spacing: 0.2px;
  color: #f8fafc;
}

.mode-switch {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}

.chip {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 6px 10px;
  border-radius: 8px;
  border: 1px solid rgba(255, 255, 255, 0.1);
  background: rgba(255, 255, 255, 0.04);
  color: #d1d5db;
  cursor: pointer;
  transition: border-color 0.15s ease, background-color 0.15s ease, color 0.15s ease;
}

.chip input {
  display: none;
}

.chip.active {
  border-color: #3b82f6;
  background: rgba(59, 130, 246, 0.16);
  color: #f8fafc;
}

.toolbar-right {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}

.grid-pill {
  padding: 6px 10px;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.06);
  color: #cbd5e1;
  font-size: 13px;
}

.btn {
  border: none;
  border-radius: 8px;
  padding: 8px 14px;
  font-weight: 600;
  cursor: pointer;
  transition: transform 0.1s ease, box-shadow 0.1s ease, opacity 0.2s ease;
}

.btn.ghost {
  background: rgba(255, 255, 255, 0.06);
  color: #e5e7eb;
  border: 1px solid rgba(255, 255, 255, 0.12);
}

.btn.primary {
  background: linear-gradient(135deg, #2563eb, #3b82f6);
  color: #f8fafc;
  box-shadow: 0 10px 25px rgba(59, 130, 246, 0.25);
}

.btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
  box-shadow: none;
}

.status {
  min-width: 60px;
  font-size: 13px;
  color: #cbd5e1;
}

.status.success {
  color: #22c55e;
}

.workspace {
  flex: 1;
  display: grid;
  grid-template-columns: 280px 1fr;
  gap: 12px;
  padding: 12px;
  overflow: hidden;
}

.side-panel {
  display: flex;
  flex-direction: column;
  gap: 12px;
  overflow: auto;
}

.panel-block {
  background: rgba(255, 255, 255, 0.03);
  border: 1px solid rgba(255, 255, 255, 0.06);
  border-radius: 12px;
  padding: 12px;
  box-shadow: 0 10px 40px rgba(0, 0, 0, 0.25);
}

.section-title {
  font-weight: 600;
  margin-bottom: 8px;
  color: #e2e8f0;
}

.field {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-bottom: 10px;
  color: #cbd5e1;
}

.field select {
  width: 100%;
  padding: 8px 10px;
  border-radius: 8px;
  border: 1px solid rgba(255, 255, 255, 0.08);
  background: rgba(255, 255, 255, 0.04);
  color: #e5e7eb;
}

.field.slider input {
  width: 100%;
}

.field-top {
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: 13px;
}

.field .value {
  color: #94a3b8;
}

.hint {
  font-size: 12px;
  color: #94a3b8;
  margin: 4px 0 0;
}

.pill {
  display: inline-flex;
  align-items: center;
  padding: 8px 10px;
  border-radius: 10px;
  border: 1px solid rgba(255, 255, 255, 0.08);
  background: rgba(255, 255, 255, 0.04);
}

.pill.muted {
  color: #cbd5e1;
  font-size: 13px;
}

.button-row {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
  margin-top: 8px;
}

.stage {
  display: flex;
  flex-direction: column;
  background: rgba(255, 255, 255, 0.02);
  border: 1px solid rgba(255, 255, 255, 0.05);
  border-radius: 12px;
  overflow: hidden;
  box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.02);
}

.canvas-wrap {
  flex: 1;
  position: relative;
  background: radial-gradient(circle at 20% 20%, rgba(59, 130, 246, 0.08), transparent 25%), #0b1021;
}

.canvas-wrap canvas {
  width: 100%;
  height: 100%;
  display: block;
}

.catalog {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
  gap: 10px;
  padding: 12px;
  border-top: 1px solid rgba(255, 255, 255, 0.05);
  background: rgba(255, 255, 255, 0.03);
}

.catalog-card {
  padding: 10px;
  border-radius: 10px;
  border: 1px solid rgba(255, 255, 255, 0.08);
  background: rgba(255, 255, 255, 0.02);
  cursor: pointer;
  transition: border-color 0.15s ease, transform 0.1s ease, background-color 0.15s ease;
  display: flex;
  align-items: center;
  gap: 10px;
}

.catalog-card.active {
  border-color: #3b82f6;
  background: rgba(59, 130, 246, 0.08);
  box-shadow: 0 12px 35px rgba(59, 130, 246, 0.15);
}

.card-header {
  flex: 1;
}

.card-title {
  font-weight: 600;
  color: #e5e7eb;
}

.card-meta {
  font-size: 12px;
  color: #94a3b8;
}

.swatch {
  width: 42px;
  height: 42px;
  border-radius: 10px;
  border: 1px solid rgba(255, 255, 255, 0.12);
  box-shadow: inset 0 1px 4px rgba(0, 0, 0, 0.35);
}

@media (max-width: 1024px) {
  .workspace {
    grid-template-columns: 1fr;
  }

  .side-panel {
    flex-direction: row;
    flex-wrap: wrap;
  }

  .panel-block {
    flex: 1;
    min-width: 240px;
  }
}
</style>
