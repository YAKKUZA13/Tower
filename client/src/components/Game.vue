<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, shallowRef } from 'vue';
import { PointerEventTypes } from 'babylonjs';
import type { Engine, Mesh, Scene } from 'babylonjs';
import { DEFAULT_CATALOG, DEFAULT_RELICS } from '@tower/shared';
import type {
  CommanderType,
  DefenderUnitType,
  MapDocument,
  PlayerInput,
  ProductionBuildingType,
  RelicType,
  TargetingMode,
  TowerType,
  UnitStance
} from '@tower/shared';
import { getMap } from '../services/api';
import { canPlaceWall, canPlaceRelic, canPlaceProductionBuilding, canTrainUnit } from '../domain/placement';
import { createEngine, createScene, gridToWorld, makePreviewMesh, sampleHeight, setGridVisible } from '../babylon/createScene';
import { pickGrid } from '../babylon/picking';
import { LevelOverlay } from '../babylon/level-renderer';
import { EnemyRenderer } from '../babylon/enemies/enemy-renderer';
import { TowerRenderer } from '../babylon/towers/tower-renderer';
import { ProjectilePool } from '../babylon/projectiles/projectile-pool';
import { WallRenderer } from '../babylon/walls/wall-renderer';
import { RelicRenderer } from '../babylon/relics/relic-renderer';
import { UnitRenderer } from '../babylon/units/unit-renderer';
import { AssetCatalog } from '../babylon/asset-catalog';
import { AtmosphereRenderer } from '../babylon/atmosphere';
import { startGameLoop } from '../babylon/game-loop';
import type { GameLoopHandle } from '../babylon/game-loop';
import { GameSim } from '../sim/game-sim';
import { useGameStore } from '../stores/game-store';
import { useAuthStore } from '../stores/auth-store';
import EconomyBar from './EconomyBar.vue';
import TowerShop from './TowerShop.vue';
import RelicDraft from './RelicDraft.vue';
import ProductionPanel from './ProductionPanel.vue';
import type { WallMaterial, WallMaterialDef } from '@tower/shared';

const canvasRef = ref<HTMLCanvasElement | null>(null);
const engineRef = shallowRef<Engine | null>(null);
const sceneRef = shallowRef<Scene | null>(null);
const simRef = shallowRef<GameSim | null>(null);
const towerRendererRef = shallowRef<TowerRenderer | null>(null);
const relicRendererRef = shallowRef<RelicRenderer | null>(null);
const unitRendererRef = shallowRef<UnitRenderer | null>(null);
let catalog: AssetCatalog | null = null;
let overlay: LevelOverlay | null = null;
let enemyRenderer: EnemyRenderer | null = null;
let projectilePool: ProjectilePool | null = null;
let wallRenderer: WallRenderer | null = null;
let relicRenderer: RelicRenderer | null = null;
let unitRenderer: UnitRenderer | null = null;
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

// ── режим стройки стен (Фаза 4) ──
const wallMaterials: WallMaterialDef[] = DEFAULT_CATALOG.walls ?? [];
const wallBuildMode = ref(false);
const repairMode = ref(false);
const selectedWallMaterial = ref<WallMaterial>(wallMaterials[0]?.material ?? 'wood');

// ── режим размещения реликвий (Фаза 5) ──
const relicCatalog: RelicType[] = DEFAULT_RELICS;
/** typeId реликвии, которую игрок выбрал в драфте и теперь размещает на поле. */
const relicPlaceTypeId = ref<string | null>(null);

// ── RTS-режим (Фаза 6) ──
const rtsEnabled = ref(false);
const productionBuildings: ProductionBuildingType[] = DEFAULT_CATALOG.productionBuildings ?? [];
const defenderUnits: DefenderUnitType[] = DEFAULT_CATALOG.defenderUnits ?? [];
const commander: CommanderType | null = DEFAULT_CATALOG.commanders?.[0] ?? null;
/** Активный RTS-режим мыши. */
const rtsMode = ref<'idle' | 'build' | 'train' | 'cast'>('idle');
/** TypeId выбранного здания/юнита либо spellId заклинания. */
const rtsSelectedId = ref<string | null>(null);
/** Id выбранного юнита (для смены stance). */
const selectedUnitId = ref<string | null>(null);
const selectedUnitStance = ref<UnitStance>('guard');
const stanceOptions: { mode: UnitStance; label: string }[] = [
  { mode: 'guard', label: 'Оборона' },
  { mode: 'patrol', label: 'Патруль' },
  { mode: 'aggressive', label: 'Атака' }
];

const gameStore = useGameStore();
const authStore = useAuthStore();
const userId = computed(() => authStore.user?.userId || 'local');

/** Показывать модалку драфта: статус draft и игрок ещё не в режиме размещения. */
const showDraft = computed(() => gameStore.isDraft && relicPlaceTypeId.value === null);

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
  if (sim.state.walls.some((w) => w.col === col && w.row === row)) return false;
  const type = sim.getTowerType(typeId);
  if (!type) return false;
  return sim.state.gold >= type.cost;
}

function wallDef(material: WallMaterial): WallMaterialDef | undefined {
  return wallMaterials.find((m) => m.material === material);
}

function canPlaceWallAt(col: number, row: number, material: WallMaterial): boolean {
  const sim = simRef.value;
  if (!sim) return false;
  const grid = sim.map.grid;
  if (col < 0 || row < 0 || col >= grid.cols || row >= grid.rows) return false;
  const def = wallDef(material);
  if (!def) return false;
  if (sim.state.gold < def.cost) return false;
  return canPlaceWall(
    { grid, spawn: sim.map.spawnPoint, base: sim.map.base, walls: sim.state.walls, towers: sim.state.towers },
    col,
    row
  );
}

function wallAt(col: number, row: number): { id: string; material: WallMaterial } | null {
  const sim = simRef.value;
  if (!sim) return null;
  const w = sim.state.walls.find((x) => x.col === col && x.row === row);
  return w ? { id: w.id, material: w.material } : null;
}

function canPlaceRelicAt(col: number, row: number): boolean {
  const sim = simRef.value;
  if (!sim || !relicPlaceTypeId.value) return false;
  if (sim.state.status !== 'draft') return false;
  const grid = sim.map.grid;
  if (col < 0 || row < 0 || col >= grid.cols || row >= grid.rows) return false;
  if (sim.isPathCell(col, row)) return false;
  return canPlaceRelic(
    { grid, spawn: sim.map.spawnPoint, base: sim.map.base, walls: sim.state.walls, towers: sim.state.towers, relics: sim.state.relics },
    col,
    row
  );
}

// ── RTS: проверка размещения зданий/юнитов (Фаза 6) ──
function canPlaceBuildingAt(col: number, row: number): boolean {
  const sim = simRef.value;
  if (!sim || !rtsSelectedId.value || rtsMode.value !== 'build') return false;
  const type = sim.getProductionType(rtsSelectedId.value);
  if (!type) return false;
  const grid = sim.map.grid;
  if (col < 0 || row < 0 || col >= grid.cols || row >= grid.rows) return false;
  if (sim.isPathCell(col, row)) return false;
  return canPlaceProductionBuilding(
    {
      grid,
      spawn: sim.map.spawnPoint,
      base: sim.map.base,
      walls: sim.state.walls,
      towers: sim.state.towers,
      relics: sim.state.relics,
      productionBuildings: sim.state.productionBuildings ?? []
    },
    col,
    row
  );
}

function canTrainUnitAt(col: number, row: number): boolean {
  const sim = simRef.value;
  if (!sim || !rtsSelectedId.value || rtsMode.value !== 'train') return false;
  const grid = sim.map.grid;
  if (col < 0 || row < 0 || col >= grid.cols || row >= grid.rows) return false;
  return canTrainUnit(
    {
      grid,
      spawn: sim.map.spawnPoint,
      base: sim.map.base,
      walls: sim.state.walls,
      towers: sim.state.towers,
      relics: sim.state.relics,
      productionBuildings: sim.state.productionBuildings ?? []
    },
    col,
    row
  );
}

function pickRelicInstance(): string | null {
  const scene = sceneRef.value;
  const renderer = relicRendererRef.value;
  if (!scene || !renderer) return null;
  const pick = scene.pick(scene.pointerX, scene.pointerY, (mesh) => mesh.name.startsWith('relic-inst-'));
  return renderer.pickRelicId(pick?.pickedMesh ?? null);
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
  if (repairMode.value || sellMode.value || (!selectedTypeId.value && !wallBuildMode.value && !relicPlaceTypeId.value && rtsMode.value === 'idle')) {
    previewMesh.setEnabled(false);
    return;
  }
  const cell = pickGrid(scene, sim.map.grid);
  if (!cell) {
    previewMesh.setEnabled(false);
    return;
  }
  let valid: boolean;
  let color: [number, number, number];
  if (relicPlaceTypeId.value) {
    valid = canPlaceRelicAt(cell.col, cell.row);
    color = valid ? [0.55, 0.35, 0.85] : [0.9, 0.18, 0.18];
  } else if (rtsMode.value === 'cast') {
    valid = true;
    color = [0.96, 0.62, 0.10];
  } else if (rtsMode.value === 'build') {
    valid = canPlaceBuildingAt(cell.col, cell.row);
    color = valid ? [0.55, 0.35, 0.85] : [0.9, 0.18, 0.18];
  } else if (rtsMode.value === 'train') {
    valid = canTrainUnitAt(cell.col, cell.row);
    color = valid ? [0.25, 0.65, 0.95] : [0.9, 0.18, 0.18];
  } else if (wallBuildMode.value) {
    valid = canPlaceWallAt(cell.col, cell.row, selectedWallMaterial.value);
    color = valid ? [0.55, 0.42, 0.20] : [0.9, 0.18, 0.18];
  } else if (selectedTypeId.value) {
    valid = canPlaceAt(cell.col, cell.row, selectedTypeId.value);
    color = valid ? [0.2, 0.8, 0.25] : [0.9, 0.18, 0.18];
  } else {
    previewMesh.setEnabled(false);
    return;
  }
  const pos = gridToWorld(sim.map.grid, cell.col, cell.row);
  const groundY = sampleHeight(sim.map.heightmap, sim.map.grid, cell.col, cell.row, true);
  previewMesh.position.set(pos.x, groundY + sim.map.grid.cellSize * 0.55, pos.z);
  const mat = previewMesh.material as { diffuseColor?: { r: number; g: number; b: number } } | null;
  if (mat?.diffuseColor) {
    mat.diffuseColor.r = color[0];
    mat.diffuseColor.g = color[1];
    mat.diffuseColor.b = color[2];
  }
  previewMesh.scaling.set(sim.map.grid.cellSize * 0.85, sim.map.grid.cellSize * 1.1, sim.map.grid.cellSize * 0.85);
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
      // ── Фаза 5: размещение выбранной реликвии из драфта ──
      if (relicPlaceTypeId.value) {
        const sim = simRef.value;
        if (!sim) return;
        const cell = pickGrid(scene, sim.map.grid);
        if (cell && canPlaceRelicAt(cell.col, cell.row)) {
          applyAction({ kind: 'pick-relic', relicTypeId: relicPlaceTypeId.value, col: cell.col, row: cell.row });
          relicPlaceTypeId.value = null;
        }
        return;
      }
      // ── Фаза 5: снятие размещённой реликвии во время драфта (пересмотр доса) ──
      if (gameStore.isDraft) {
        const relicId = pickRelicInstance();
        if (relicId) {
          applyAction({ kind: 'remove-relic', relicId });
          return;
        }
      }
      // ── Фаза 6: RTS-режимы мыши ──
      if (rtsMode.value === 'cast' && rtsSelectedId.value) {
        const sim = simRef.value;
        if (!sim) return;
        const cell = pickGrid(scene, sim.map.grid);
        if (cell) {
          applyAction({ kind: 'cast-spell', spellId: rtsSelectedId.value, col: cell.col, row: cell.row });
          rtsMode.value = 'idle';
          rtsSelectedId.value = null;
        }
        return;
      }
      if (rtsMode.value === 'build' && rtsSelectedId.value) {
        const sim = simRef.value;
        if (!sim) return;
        const cell = pickGrid(scene, sim.map.grid);
        if (cell && canPlaceBuildingAt(cell.col, cell.row)) {
          applyAction({ kind: 'build-production', typeId: rtsSelectedId.value, col: cell.col, row: cell.row });
        }
        return;
      }
      if (rtsMode.value === 'train' && rtsSelectedId.value) {
        const sim = simRef.value;
        if (!sim) return;
        const cell = pickGrid(scene, sim.map.grid);
        if (cell && canTrainUnitAt(cell.col, cell.row)) {
          applyAction({ kind: 'train-unit', typeId: rtsSelectedId.value, col: cell.col, row: cell.row });
        }
        return;
      }
      if (repairMode.value) {
        const sim = simRef.value;
        if (!sim) return;
        const cell = pickGrid(scene, sim.map.grid);
        const w = cell ? wallAt(cell.col, cell.row) : null;
        if (w) applyAction({ kind: 'repair-wall', wallId: w.id });
        return;
      }
      if (sellMode.value) {
        const id = pickTower();
        if (id) {
          applyAction({ kind: 'sell-tower', towerId: id });
          selectedTowerId.value = null;
        }
        return;
      }
      if (wallBuildMode.value) {
        const sim = simRef.value;
        if (!sim) return;
        const cell = pickGrid(scene, sim.map.grid);
        if (cell && canPlaceWallAt(cell.col, cell.row, selectedWallMaterial.value)) {
          applyAction({ kind: 'place-wall', material: selectedWallMaterial.value, col: cell.col, row: cell.row });
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
      const towerId = pickTower();
      if (towerId) {
        selectedTowerId.value = towerId;
        syncSelectedTowerFromSnapshot();
        return;
      }
      // ── Фаза 6: выбор юнита для смены stance ──
      const unitId = pickUnit();
      if (unitId) {
        selectedUnitId.value = unitId;
        const sim = simRef.value;
        if (sim) {
          const u = sim.state.defenderUnits?.find((x) => x.id === unitId);
          selectedUnitStance.value = u?.stance ?? 'guard';
        }
      }
    }
  });
}

function pickUnit(): string | null {
  const scene = sceneRef.value;
  const renderer = unitRendererRef.value;
  if (!scene || !renderer) return null;
  const pick = scene.pick(scene.pointerX, scene.pointerY, (mesh) => mesh.name.startsWith('unit-inst-'));
  return renderer.pickUnitId(pick?.pickedMesh ?? null);
}

function buildSim(map: MapDocument): void {
  const playable = ensurePlayableMap(map);
  const sim = new GameSim({ map: playable, catalog: DEFAULT_CATALOG, ownerId: userId.value });
  simRef.value = sim;
  rtsEnabled.value = sim.isRtsEnabled();
  gameStore.setRtsEnabled(rtsEnabled.value);
  gameStore.setMaxLives(playable.base.hp);
  const waveCount = (playable.waves?.length ?? 0) > 0 ? playable.waves.length : DEFAULT_CATALOG.waves.length;
  gameStore.setTotalWaves(waveCount);
  gameStore.setSnapshot(sim.serialize());
  selectedTowerId.value = null;
  selectedUnitId.value = null;
  rtsMode.value = 'idle';
  rtsSelectedId.value = null;
  relicPlaceTypeId.value = null;
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
  rtsEnabled.value = sim.isRtsEnabled();
  gameStore.setRtsEnabled(rtsEnabled.value);
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
  wallRenderer = new WallRenderer(scene, DEFAULT_CATALOG.walls ?? [], playable.grid, playable.heightmap, catalog);
  const rRenderer = new RelicRenderer(scene, DEFAULT_RELICS, playable.grid, playable.heightmap, catalog);
  relicRenderer = rRenderer;
  relicRendererRef.value = rRenderer;

  // ── Фаза 6: RTS-рендер (только если режим включён) ──
  if (sim.isRtsEnabled()) {
    const commanderCatalogId = sim.getCommander()?.modelRef.catalogId ?? null;
    const uRenderer = new UnitRenderer(
      scene,
      DEFAULT_CATALOG.defenderUnits ?? [],
      DEFAULT_CATALOG.productionBuildings ?? [],
      playable.grid,
      playable.heightmap,
      catalog,
      commanderCatalogId,
      playable.base
    );
    unitRenderer = uRenderer;
    unitRendererRef.value = uRenderer;
    for (const m of uRenderer.getShadowCasterMeshes()) atmosphere.addShadowCaster(m);
  }

  // тени — только башни, враги и реликвии (юниты добавятся в Фазе 6). receiveShadows=false на террейне.
  for (const m of towerRenderer.getShadowCasterMeshes()) atmosphere.addShadowCaster(m);
  for (const m of enemyRenderer.getShadowCasterMeshes()) atmosphere.addShadowCaster(m);
  for (const m of rRenderer.getShadowCasterMeshes()) atmosphere.addShadowCaster(m);

  previewMesh = makePreviewMesh(scene);

  loop = startGameLoop(
    engine,
    scene,
    sim,
    {
      enemies: enemyRenderer,
      towers: towerRenderer,
      projectiles: projectilePool,
      walls: wallRenderer,
      relics: rRenderer,
      units: unitRenderer ?? undefined,
      atmosphere
    },
    (snap) => {
      gameStore.setSnapshot(snap);
      if (!gameOver.value && gameStore.isOver) gameOver.value = true;
      syncSelectedTowerFromSnapshot();
    },
    (waypoints) => overlay?.updateRoute(waypoints)
  );

  setupPointerHandlers();
  statusMessage.value = '';
}

function restart(): void {
  const sim = simRef.value;
  if (!sim) return;
  const map = sim.map;
  buildSim(map);
  // перерисуем башни/врагов/стены/реликвии/юнитов с нового состояния сразу
  const scene = sceneRef.value;
  if (scene) {
    const s = simRef.value!;
    enemyRenderer?.sync(s.state);
    towerRendererRef.value?.sync(s.state);
    projectilePool?.sync(s.state);
    wallRenderer?.sync(s.state);
    relicRenderer?.sync(s.state);
    unitRenderer?.sync(s.state, 0);
    overlay?.updateRoute(s.getRouteWaypoints());
  }
  relicPlaceTypeId.value = null;
}

function onSelectType(typeId: string): void {
  selectedTypeId.value = typeId;
  selectedTowerId.value = null;
  wallBuildMode.value = false;
  repairMode.value = false;
  sellMode.value = false;
  updatePreview();
}

function onSellMode(enabled: boolean): void {
  sellMode.value = enabled;
  if (enabled) {
    selectedTowerId.value = null;
    wallBuildMode.value = false;
    repairMode.value = false;
  }
  updatePreview();
}

function onWallBuildMode(enabled: boolean): void {
  wallBuildMode.value = enabled;
  if (enabled) {
    selectedTypeId.value = null;
    selectedTowerId.value = null;
    sellMode.value = false;
    repairMode.value = false;
  }
  updatePreview();
}

function onRepairMode(enabled: boolean): void {
  repairMode.value = enabled;
  if (enabled) {
    selectedTypeId.value = null;
    selectedTowerId.value = null;
    sellMode.value = false;
    wallBuildMode.value = false;
  }
  updatePreview();
}

function selectWallMaterial(material: WallMaterial): void {
  selectedWallMaterial.value = material;
  if (!wallBuildMode.value) onWallBuildMode(true);
  updatePreview();
}

function cancelBuildModes(): void {
  wallBuildMode.value = false;
  repairMode.value = false;
  updatePreview();
}

// ── Фаза 5: обработчики драфта реликвий ──
function onRelicPick(relicTypeId: string): void {
  relicPlaceTypeId.value = relicTypeId;
  updatePreview();
}

function onRelicSkip(): void {
  applyAction({ kind: 'skip-draft' });
  relicPlaceTypeId.value = null;
}

function onRelicRemove(relicId: string): void {
  applyAction({ kind: 'remove-relic', relicId });
}

function cancelRelicPlace(): void {
  relicPlaceTypeId.value = null;
  updatePreview();
}

// ── Фаза 6: RTS-обработчики ──
function onSelectBuilding(typeId: string): void {
  selectedTypeId.value = null;
  selectedTowerId.value = null;
  wallBuildMode.value = false;
  repairMode.value = false;
  sellMode.value = false;
  relicPlaceTypeId.value = null;
  rtsMode.value = 'build';
  rtsSelectedId.value = typeId;
  updatePreview();
}

function onSelectUnit(typeId: string): void {
  selectedTypeId.value = null;
  selectedTowerId.value = null;
  wallBuildMode.value = false;
  repairMode.value = false;
  sellMode.value = false;
  relicPlaceTypeId.value = null;
  rtsMode.value = 'train';
  rtsSelectedId.value = typeId;
  updatePreview();
}

function onSelectSpell(spellId: string): void {
  selectedTypeId.value = null;
  wallBuildMode.value = false;
  repairMode.value = false;
  sellMode.value = false;
  relicPlaceTypeId.value = null;
  rtsMode.value = 'cast';
  rtsSelectedId.value = spellId;
  updatePreview();
}

function cancelRtsMode(): void {
  rtsMode.value = 'idle';
  rtsSelectedId.value = null;
  updatePreview();
}

function setUnitStance(mode: UnitStance): void {
  if (!selectedUnitId.value) return;
  selectedUnitStance.value = mode;
  applyAction({ kind: 'set-unit-stance', unitId: selectedUnitId.value, stance: mode });
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
  wallRenderer?.dispose();
  relicRenderer?.dispose();
  unitRenderer?.dispose();
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

        <!-- Фаза 5: индикатор режима размещения реликвии -->
        <div v-if="relicPlaceTypeId" class="relic-place-banner">
          <span>Разместите реликвию в свободной клетке</span>
          <button class="btn ghost" @click="cancelRelicPlace">Отмена</button>
        </div>

        <!-- Фаза 6: индикатор RTS-режима мыши -->
        <div v-if="rtsMode !== 'idle'" class="rts-mode-banner">
          <span v-if="rtsMode === 'cast'">Цель заклинания — кликните по полю</span>
          <span v-else-if="rtsMode === 'build'">Строительство здания — кликните по свободной клетке</span>
          <span v-else-if="rtsMode === 'train'">Тренировка юнита — кликните по свободной клетке</span>
          <button class="btn ghost" @click="cancelRtsMode">Отмена</button>
        </div>

        <!-- Фаза 5: драфт реликвий между волнами -->
        <RelicDraft
          v-if="showDraft"
          :choices="gameStore.pendingRelicChoices"
          :relic-catalog="relicCatalog"
          :placed-relics="gameStore.relics"
          @pick="onRelicPick"
          @skip="onRelicSkip"
          @remove="onRelicRemove"
        />

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

        <section class="wall-shop">
          <div class="info-title">Стены лабиринта</div>
          <div class="wall-grid">
            <button
              v-for="m in wallMaterials"
              :key="m.material"
              class="wall-btn"
              :class="{ active: wallBuildMode && selectedWallMaterial === m.material, disabled: gameStore.gold < m.cost }"
              :disabled="gameStore.gold < m.cost"
              :title="`${m.name} · ${m.maxHp} HP`"
              @click="selectWallMaterial(m.material)"
            >
              <span class="wall-mat" :data-mat="m.material">{{ m.name }}</span>
              <span class="wall-cost">{{ m.cost }}g</span>
            </button>
          </div>
          <div class="wall-toggles">
            <button class="btn ghost" :class="{ active: repairMode }" @click="onRepairMode(!repairMode)">Ремонт</button>
            <button v-if="wallBuildMode || repairMode" class="btn ghost" @click="cancelBuildModes">Отмена</button>
          </div>
          <p class="hint">
            Стены перенаправляют врагов (длиннее путь). Нельзя запереть базу.
            Враги ломают стены; огненные снаряды поджигают их.
          </p>
        </section>

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

        <!-- Фаза 6: RTS-режим «Тёмная крепость» -->
        <ProductionPanel
          v-if="rtsEnabled"
          :buildings="productionBuildings"
          :units="defenderUnits"
          :commander="commander"
          :active-mode="rtsMode"
          :selected-id="rtsSelectedId"
          :resources="gameStore.resources"
          :gold="gameStore.gold"
          :cooldowns="gameStore.commanderCooldowns"
          @select-building="onSelectBuilding"
          @select-unit="onSelectUnit"
          @select-spell="onSelectSpell"
          @cancel="cancelRtsMode"
        />

        <!-- Фаза 6: выбор юнита → смена stance -->
        <section v-if="rtsEnabled && selectedUnitId" class="unit-info">
          <div class="info-title">Юнит</div>
          <div class="stance-row">
            <button
              v-for="m in stanceOptions"
              :key="m.mode"
              class="btn ghost stance-btn"
              :class="{ active: selectedUnitStance === m.mode }"
              @click="setUnitStance(m.mode)"
            >{{ m.label }}</button>
          </div>
          <p class="hint">Оборона — стоит на точке. Патруль — ходит вокруг. Атака — гонит врагов по всему полю.</p>
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
.relic-place-banner {
  position: absolute;
  top: 12px;
  left: 50%;
  transform: translateX(-50%);
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 8px 14px;
  background: rgba(15, 23, 42, 0.92);
  border: 1px solid rgba(168, 85, 247, 0.5);
  border-radius: 10px;
  color: #d8b4fe;
  font-weight: 700;
  font-size: 13px;
  z-index: 4;
}
.relic-place-banner .btn.ghost { margin: 0; }
.rts-mode-banner {
  position: absolute;
  top: 56px;
  left: 50%;
  transform: translateX(-50%);
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 8px 14px;
  background: rgba(15, 23, 42, 0.92);
  border: 1px solid rgba(245, 158, 11, 0.5);
  border-radius: 10px;
  color: #fcd34d;
  font-weight: 700;
  font-size: 13px;
  z-index: 4;
}
.rts-mode-banner .btn.ghost { margin: 0; }
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
.unit-info {
  padding: 12px;
  border-top: 1px solid rgba(255, 255, 255, 0.08);
}
.stance-row {
  display: flex;
  gap: 6px;
  margin-bottom: 8px;
}
.stance-btn {
  flex: 1;
  padding: 6px 8px;
  font-size: 12px;
}
.wall-shop {
  padding: 12px;
  border-top: 1px solid rgba(255, 255, 255, 0.08);
}
.wall-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 6px;
  margin-bottom: 8px;
}
.wall-btn {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
  padding: 8px 4px;
  border-radius: 8px;
  border: 1px solid rgba(255, 255, 255, 0.12);
  background: rgba(255, 255, 255, 0.05);
  color: #e5e7eb;
  cursor: pointer;
  font-size: 12px;
}
.wall-btn.active {
  border-color: #d97706;
  background: rgba(217, 119, 6, 0.22);
}
.wall-btn.disabled {
  opacity: 0.45;
  cursor: not-allowed;
}
.wall-mat[data-mat='wood']  { color: #b58a55; }
.wall-mat[data-mat='stone'] { color: #b8bcc4; }
.wall-mat[data-mat='bone']  { color: #d8d2bd; }
.wall-cost { font-size: 10px; color: #fbbf24; font-weight: 700; }
.wall-toggles {
  display: flex;
  gap: 6px;
  margin-bottom: 8px;
}
.btn.ghost {
  flex: 1;
  background: rgba(255, 255, 255, 0.06);
  color: #cbd5e1;
  border: 1px solid rgba(255, 255, 255, 0.12);
}
.btn.ghost.active {
  background: rgba(37, 99, 235, 0.3);
  color: #fff;
  border-color: #2563eb;
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
