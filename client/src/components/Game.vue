<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, shallowRef } from 'vue';
import { PointerEventTypes } from 'babylonjs';
import type { Engine, Mesh, Scene } from 'babylonjs';
import { DEFAULT_CATALOG } from '@tower/shared';
import type { MapDocument, PlayerInput, TargetingMode, TowerType } from '@tower/shared';
import { getMap } from '../services/api';
import { createEngine, createScene, gridToWorld, makePreviewMesh, sampleHeight, setGridVisible } from '../babylon/createScene';
import { pickGrid } from '../babylon/picking';
import { LevelOverlay } from '../babylon/level-renderer';
import { EnemyRenderer } from '../babylon/enemies/enemy-renderer';
import { TowerRenderer } from '../babylon/towers/tower-renderer';
import { ProjectilePool } from '../babylon/projectiles/projectile-pool';
import { AssetCatalog } from '../babylon/asset-catalog';
import { AtmosphereRenderer } from '../babylon/atmosphere';
import { startGameLoop } from '../babylon/game-loop';
import type { GameLoopHandle } from '../babylon/game-loop';
import { GameSim } from '../sim/game-sim';
import { useGameStore } from '../stores/game-store';
import { useAuthStore } from '../stores/auth-store';
import EconomyBar from './EconomyBar.vue';
import TowerShop from './TowerShop.vue';

const canvasRef = ref<HTMLCanvasElement | null>(null);
const engineRef = shallowRef<Engine | null>(null);
const sceneRef = shallowRef<Scene | null>(null);
const simRef = shallowRef<GameSim | null>(null);
const towerRendererRef = shallowRef<TowerRenderer | null>(null);
let catalog: AssetCatalog | null = null;
let overlay: LevelOverlay | null = null;
let enemyRenderer: EnemyRenderer | null = null;
let projectilePool: ProjectilePool | null = null;
let atmosphere: AtmosphereRenderer | null = null;
let loop: GameLoopHandle | null = null;
let previewMesh: Mesh | null = null;

const statusMessage = ref('Загрузка...');
const selectedTypeId = ref<string | null>(DEFAULT_CATALOG.towers[0]?.id ?? null);
const sellMode = ref(false);
const selectedTowerId = ref<string | null>(null);
const selectedTowerTypeId = ref<string | null>(null);
const selectedTowerMode = ref<TargetingMode>('first');
const gameOver = ref(false);

const gameStore = useGameStore();
const authStore = useAuthStore();
const userId = computed(() => authStore.user?.userId || 'local');

const targetingModes: { mode: TargetingMode; label: string }[] = [
  { mode: 'first', label: 'Первый' },
  { mode: 'last', label: 'Последний' },
  { mode: 'nearest', label: 'Ближайший' },
  { mode: 'strongest', label: 'Сильнейший' },
  { mode: 'weakest', label: 'Слабейший' }
];

const towerTypes: TowerType[] = DEFAULT_CATALOG.towers;

function ensurePlayableMap(map: MapDocument): MapDocument {
  const waypoints = map.path?.waypoints ?? [];
  if (waypoints.length >= 2) return map;
  // дефолтный L-образный путь от спавна до базы
  const spawn = map.spawnPoint ?? { col: 0, row: 0 };
  const base = map.base ?? { col: map.grid.cols - 1, row: map.grid.rows - 1, hp: 20 };
  const mid = { col: base.col, row: spawn.row };
  return {
    ...map,
    spawnPoint: spawn,
    base,
    path: { waypoints: [spawn, mid, { col: base.col, row: base.row }] }
  };
}

function canPlaceAt(col: number, row: number, typeId: string | null): boolean {
  const sim = simRef.value;
  if (!sim || !typeId) return false;
  const grid = sim.map.grid;
  if (col < 0 || row < 0 || col >= grid.cols || row >= grid.rows) return false;
  if (sim.isPathCell(col, row)) return false;
  if (sim.state.towers.some((t) => t.col === col && t.row === row)) return false;
  const type = sim.getTowerType(typeId);
  if (!type) return false;
  return sim.state.gold >= type.cost;
}

function applyAction(action: PlayerInput['action']): void {
  const sim = simRef.value;
  if (!sim) return;
  sim.applyInput({ tick: sim.state.tick, userId: userId.value, action });
}

function updatePreview(): void {
  const scene = sceneRef.value;
  const sim = simRef.value;
  if (!scene || !sim || !previewMesh) return;
  if (sellMode.value || !selectedTypeId.value) {
    previewMesh.setEnabled(false);
    return;
  }
  const cell = pickGrid(scene, sim.map.grid);
  if (!cell) {
    previewMesh.setEnabled(false);
    return;
  }
  const valid = canPlaceAt(cell.col, cell.row, selectedTypeId.value);
  const pos = gridToWorld(sim.map.grid, cell.col, cell.row);
  const groundY = sampleHeight(sim.map.heightmap, sim.map.grid, cell.col, cell.row, true);
  previewMesh.position.set(pos.x, groundY + sim.map.grid.cellSize * 0.55, pos.z);
  const mat = previewMesh.material as { diffuseColor?: { r: number; g: number; b: number } } | null;
  if (mat?.diffuseColor) {
    mat.diffuseColor.r = valid ? 0.2 : 0.9;
    mat.diffuseColor.g = valid ? 0.8 : 0.18;
    mat.diffuseColor.b = valid ? 0.25 : 0.18;
  }
  previewMesh.scaling.set(sim.map.grid.cellSize * 0.7, sim.map.grid.cellSize * 1.1, sim.map.grid.cellSize * 0.7);
  previewMesh.setEnabled(true);
}

function pickTower(): string | null {
  const scene = sceneRef.value;
  const renderer = towerRendererRef.value;
  if (!scene || !renderer) return null;
  const pick = scene.pick(scene.pointerX, scene.pointerY, (mesh) => mesh.name.startsWith('tower-inst-'));
  return renderer.pickTowerId(pick?.pickedMesh ?? null);
}

function syncSelectedTowerFromSnapshot(): void {
  const sim = simRef.value;
  if (!sim || !selectedTowerId.value) {
    selectedTowerTypeId.value = null;
    return;
  }
  const tower = sim.state.towers.find((t) => t.id === selectedTowerId.value);
  if (!tower) {
    selectedTowerId.value = null;
    selectedTowerTypeId.value = null;
    return;
  }
  selectedTowerTypeId.value = tower.typeId;
  selectedTowerMode.value = tower.targetingMode ?? sim.getTowerType(tower.typeId)?.targetingMode ?? 'first';
}

function setupPointerHandlers(): void {
  const scene = sceneRef.value;
  if (!scene) return;
  scene.onPointerObservable.add((info) => {
    if (info.type === PointerEventTypes.POINTERMOVE) {
      updatePreview();
    } else if (info.type === PointerEventTypes.POINTERDOWN) {
      if (sellMode.value) {
        const id = pickTower();
        if (id) {
          applyAction({ kind: 'sell-tower', towerId: id });
          selectedTowerId.value = null;
        }
        return;
      }
      if (selectedTypeId.value) {
        const sim = simRef.value;
        if (!sim) return;
        const cell = pickGrid(scene, sim.map.grid);
        if (cell && canPlaceAt(cell.col, cell.row, selectedTypeId.value)) {
          applyAction({ kind: 'place-tower', typeId: selectedTypeId.value, col: cell.col, row: cell.row });
        }
        return;
      }
      // выбор существующей башни
      const id = pickTower();
      selectedTowerId.value = id;
      syncSelectedTowerFromSnapshot();
    }
  });
}

function buildSim(map: MapDocument): void {
  const playable = ensurePlayableMap(map);
  const sim = new GameSim({ map: playable, catalog: DEFAULT_CATALOG, ownerId: userId.value });
  simRef.value = sim;
  gameStore.setMaxLives(playable.base.hp);
  const waveCount = (playable.waves?.length ?? 0) > 0 ? playable.waves.length : DEFAULT_CATALOG.waves.length;
  gameStore.setTotalWaves(waveCount);
  gameStore.setSnapshot(sim.serialize());
  selectedTowerId.value = null;
  gameOver.value = false;
}

async function init(): Promise<void> {
  let map: MapDocument;
  try {
    map = await getMap();
  } catch (e) {
    console.error(e);
    statusMessage.value = 'Не удалось загрузить карту';
    return;
  }
  if (!canvasRef.value) return;
  const playable = ensurePlayableMap(map);

  const engine = createEngine(canvasRef.value);
  engineRef.value = engine;
  const { scene, camera, light, ground } = createScene(engine, playable.grid, playable.heightmap, { editor: false });
  sceneRef.value = scene;
  setGridVisible(scene, true);

  buildSim(map);

  const sim = simRef.value!;
  catalog = await AssetCatalog.create(scene);

  // ── атмосфера (Фаза 3): день/ночь, тени, туман, погода, пост-процесс ──
  const bossTypeIds = new Set(DEFAULT_CATALOG.enemies.filter((e) => e.category === 'boss').map((e) => e.id));
  atmosphere = new AtmosphereRenderer(scene, camera, playable.grid, {
    hemispheric: light,
    ground,
    board: { width: playable.grid.cols * playable.grid.cellSize, height: playable.grid.rows * playable.grid.cellSize },
    bossTypeIds
  });

  overlay = new LevelOverlay(scene, playable, catalog);
  atmosphere.attachBaseMarker(overlay.baseMarker, playable.grid.cellSize);

  enemyRenderer = new EnemyRenderer(scene, DEFAULT_CATALOG.enemies, playable.grid.cellSize, catalog);
  const towerRenderer = new TowerRenderer(scene, DEFAULT_CATALOG.towers, playable.grid, playable.heightmap, catalog);
  towerRendererRef.value = towerRenderer;
  projectilePool = new ProjectilePool(scene, playable.grid.cellSize, catalog);

  // тени — только башни и враги (юниты добавятся в Фазе 6). receiveShadows=false на террейне.
  for (const m of towerRenderer.getShadowCasterMeshes()) atmosphere.addShadowCaster(m);
  for (const m of enemyRenderer.getShadowCasterMeshes()) atmosphere.addShadowCaster(m);

  previewMesh = makePreviewMesh(scene);

  loop = startGameLoop(engine, scene, sim, {
    enemies: enemyRenderer,
    towers: towerRenderer,
    projectiles: projectilePool,
    atmosphere
  }, (snap) => {
    gameStore.setSnapshot(snap);
    if (!gameOver.value && gameStore.isOver) gameOver.value = true;
    syncSelectedTowerFromSnapshot();
  });

  setupPointerHandlers();
  statusMessage.value = '';
}

function restart(): void {
  const sim = simRef.value;
  if (!sim) return;
  const map = sim.map;
  buildSim(map);
  // перерисуем башни/врагов с нового состояния сразу
  const scene = sceneRef.value;
  if (scene) {
    const s = simRef.value!;
    enemyRenderer?.sync(s.state);
    towerRendererRef.value?.sync(s.state);
    projectilePool?.sync(s.state);
  }
}

function onSelectType(typeId: string): void {
  selectedTypeId.value = typeId;
  selectedTowerId.value = null;
}

function onSellMode(enabled: boolean): void {
  sellMode.value = enabled;
  if (enabled) selectedTowerId.value = null;
  updatePreview();
}

function setTargeting(mode: TargetingMode): void {
  if (!selectedTowerId.value) return;
  selectedTowerMode.value = mode;
  applyAction({ kind: 'set-targeting', towerId: selectedTowerId.value, mode });
}

function sellSelected(): void {
  if (!selectedTowerId.value) return;
  applyAction({ kind: 'sell-tower', towerId: selectedTowerId.value });
  selectedTowerId.value = null;
}

onMounted(() => init());
onBeforeUnmount(() => {
  loop?.stop();
  overlay?.dispose();
  enemyRenderer?.dispose();
  towerRendererRef.value?.dispose();
  projectilePool?.dispose();
  atmosphere?.dispose();
  catalog?.dispose();
  engineRef.value?.dispose();
});
</script>

<template>
  <div class="game-layout">
    <EconomyBar @start-wave="applyAction({ kind: 'start-wave' })" />

    <div class="game-body">
      <main class="game-stage">
        <canvas ref="canvasRef" class="game-canvas"></canvas>
        <div v-if="statusMessage" class="game-alert">{{ statusMessage }}</div>
        <div v-if="gameOver" class="overlay-modal">
          <div class="modal-card">
            <div class="modal-title" :class="gameStore.status">
              {{ gameStore.status === 'won' ? 'Победа!' : 'Поражение' }}
            </div>
            <div class="modal-text">
              Волна: {{ gameStore.waveLabel }} · Золото: {{ gameStore.gold }}
            </div>
            <button class="btn primary" @click="restart">Заново</button>
          </div>
        </div>
      </main>

      <aside class="game-side">
        <TowerShop
          :towers="towerTypes"
          :selected-type-id="selectedTypeId"
          :sell-mode="sellMode"
          :gold="gameStore.gold"
          @select="onSelectType"
          @sell-mode="onSellMode"
        />

        <section v-if="selectedTowerId && selectedTowerTypeId" class="tower-info">
          <div class="info-title">Башня: {{ simRef?.getTowerType(selectedTowerTypeId)?.name ?? selectedTowerTypeId }}</div>
          <label class="field">
            <span>Наводка</span>
            <select :value="selectedTowerMode" @change="setTargeting(($event.target as HTMLSelectElement).value as TargetingMode)">
              <option v-for="m in targetingModes" :key="m.mode" :value="m.mode">{{ m.label }}</option>
            </select>
          </label>
          <button class="btn danger" @click="sellSelected">Продать ({{ Math.floor((simRef?.getTowerType(selectedTowerTypeId)?.cost ?? 0) / 2) }}g)</button>
        </section>

        <section class="hint-block">
          <div class="info-title">Подсказка</div>
          <p class="hint">Выберите башню слева и кликните по клетке возле пути. Кнопка «Старт волны» запускает врагов. Цель — защитить базу (зелёный куб) от всех волн.</p>
        </section>
      </aside>
    </div>
  </div>
</template>

<style scoped>
.game-layout {
  display: flex;
  flex-direction: column;
  height: 100%;
  background: #0b1021;
  color: #e5e7eb;
}
.game-body {
  flex: 1;
  display: grid;
  grid-template-columns: 1fr 300px;
  min-height: 0;
}
.game-stage {
  position: relative;
  min-width: 0;
  background: #15162a;
}
.game-canvas {
  display: block;
  width: 100%;
  height: 100%;
  outline: none;
}
.game-alert {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #fca5a5;
  pointer-events: none;
}
.overlay-modal {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(2, 6, 23, 0.78);
}
.modal-card {
  background: #0f172a;
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 16px;
  padding: 24px 28px;
  display: flex;
  flex-direction: column;
  gap: 14px;
  align-items: center;
}
.modal-title {
  font-size: 26px;
  font-weight: 800;
}
.modal-title.won { color: #22c55e; }
.modal-title.lost { color: #ef4444; }
.modal-text { color: #cbd5e1; }
.game-side {
  border-left: 1px solid rgba(255, 255, 255, 0.08);
  background: rgba(15, 23, 42, 0.6);
  display: flex;
  flex-direction: column;
  min-height: 0;
  overflow: auto;
}
.tower-info, .hint-block {
  padding: 12px;
  border-top: 1px solid rgba(255, 255, 255, 0.08);
}
.info-title {
  font-weight: 800;
  color: #f8fafc;
  margin-bottom: 10px;
}
.field {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-bottom: 10px;
  color: #cbd5e1;
  font-size: 13px;
}
.field select {
  padding: 8px;
  border-radius: 8px;
  border: 1px solid rgba(255, 255, 255, 0.12);
  background: rgba(255, 255, 255, 0.06);
  color: #e5e7eb;
}
.hint {
  color: #94a3b8;
  font-size: 12px;
  line-height: 1.45;
}
.btn {
  border: none;
  border-radius: 8px;
  padding: 8px 12px;
  font-weight: 700;
}
.btn.primary { background: #2563eb; color: #fff; }
.btn.danger { background: #dc2626; color: #fff; }
@media (max-width: 980px) {
  .game-body { grid-template-columns: 1fr; }
}
</style>
