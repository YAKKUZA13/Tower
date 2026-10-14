<script setup lang="ts">
/**
 * M8 — RTS solo component.
 *
 * Канонический RTS-геймплей на большой RTS-карте (rts-2p-crossroads / 3p-trident /
 * 4p-quadrants): свободная RTS-камера (pan WASD/edge, zoom wheel, rotate Q/E),
 * minimap, production panel, полный контроль юнитов (выделение / box-select /
 * control-groups / приказы move/attack/gather / formation / shift-waypoints),
 * экономика (workers добывают, здания производят, tech-tree), AI-opponent
 * (слот 1+ спавнит волны атакующих юнитов к town-hall игрока; победа = уничтожить
 * AI town-hall).
 *
 * НЕ использует вращающуюся TD-камеру (createScene.attachControl) — камера
 * управляется rtscam.ts: ORTHOGRAPHIC + свободный pan/zoom + вращение по Q/E.
 */
import { computed, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue';
import { Color3 } from '@babylonjs/core/Maths/math.color.js';
import { Matrix, Vector3 } from '@babylonjs/core/Maths/math.vector.js';
import { Viewport } from '@babylonjs/core/Maths/math.viewport.js';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder.js';
import { PointerEventTypes } from '@babylonjs/core/Events/pointerEvents.js';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial.js';
import type { Engine } from '@babylonjs/core/Engines/engine.js';
import type { Mesh } from '@babylonjs/core/Meshes/mesh.js';
import type { Scene } from '@babylonjs/core/scene.js';
import {
  DEFAULT_CATALOG,
  DEFAULT_RELICS,
  RTS_MAPS,
  getRtsMap
} from '@tower/shared';
import type {
  CommanderType,
  DefenderUnitType,
  FormationKind,
  MapDocument,
  PlayerAction,
  PlayerInput,
  ProductionBuildingType,
  ResourceNode
} from '@tower/shared';
import { loadMap } from '../services/maps';
import { audio } from '../services/audio';
import { canPlaceProductionBuilding, canTrainUnit } from '../domain/placement';
import {
  createEngine,
  createRtsScene,
  gridToWorld,
  makePreviewMesh,
  sampleHeight,
  setGridVisible
} from '../babylon/createScene';
import { pickGrid } from '../babylon/picking';
import { LevelOverlay } from '../babylon/level-renderer';
import { EnemyRenderer, type EnemySceneRenderer } from '../babylon/enemies/enemy-renderer';
import { RiggedEnemyRenderer } from '../babylon/enemies/enemy-renderer-rigged';
import { UnitRenderer, type UnitSceneRenderer } from '../babylon/units/unit-renderer';
import { RiggedUnitRenderer } from '../babylon/units/unit-renderer-rigged';
import { AssetCatalog } from '../babylon/asset-catalog';
import { AtmosphereRenderer } from '../babylon/atmosphere';
import { applyToonToScene } from '../babylon/voxel/voxel-toon';
import { startGameLoop } from '../babylon/game-loop';
import { attachRtsCamera, type RtsCameraHandle } from '../babylon/rtscam';
import { ResourceNodeRenderer } from '../babylon/resources/resource-node-renderer';
import { RtsSceneryRenderer } from '../babylon/terrain/rts-scenery';
import { WorldSiteRenderer } from '../babylon/world-sites';
import { GameSim } from '../sim/game-sim';
import { useGameStore } from '../stores/game-store';
import { computeFormation } from '../sim/systems/formations';
import { useSelection } from '../composables/useSelection';
import { useControlGroups } from '../composables/useControlGroups';
import EconomyBar from './EconomyBar.vue';
import ProductionPanel from './ProductionPanel.vue';
import Minimap from './Minimap.vue';
import SelectionBox from './SelectionBox.vue';
import ControlGroupBar from './ControlGroupBar.vue';
import RtsIcon from './RtsIcon.vue';

const USE_RIGGED_ENEMIES = true;
const USE_RIGGED_UNITS = true;
// Toon-override ВЫКЛ в RTS: applyToonToScene заменяет материалы только тех meшей,
// что существуют на момент вызова — риги-клоны (spawn юнитов/врагов) создаются
// позже и получают свежий StandardMaterial → «половина toon / половина Standard».
// В RTS проще и единообразнее: baked AO (vertex colors) + StandardMaterial +
// AtmosphereRenderer (ACES/bloom/grain/vignette). Toon оставлен для TD/co-op.
const USE_TOON = false;

const props = defineProps<{
  /** Id RTS-карты. По умолчанию — первая (rts-2p-crossroads). */
  mapId?: string;
}>();

const emit = defineEmits<{ (e: 'back'): void }>();

const canvasRef = ref<HTMLCanvasElement | null>(null);
const engineRef = shallowRef<Engine | null>(null);
const sceneRef = shallowRef<Scene | null>(null);
const simRef = shallowRef<GameSim | null>(null);
const unitRendererRef = shallowRef<UnitSceneRenderer | null>(null);
const resourceRendererRef = shallowRef<ResourceNodeRenderer | null>(null);
let catalog: AssetCatalog | null = null;
let overlay: LevelOverlay | null = null;
let toonHandle: { dispose: () => void } | null = null;
let enemyRenderer: EnemySceneRenderer | null = null;
let unitRenderer: UnitSceneRenderer | null = null;
let atmosphere: AtmosphereRenderer | null = null;
let sceneryRenderer: RtsSceneryRenderer | null = null;
let worldSiteRenderer: WorldSiteRenderer | null = null;
let disposed = false;
let staticSceneBlocked = new Set<string>();
let loop: ReturnType<typeof startGameLoop> | null = null;
let rtsCam: RtsCameraHandle | null = null;
let previewMesh: Mesh | null = null;
let spellPreview: Mesh | null = null;

// ── Selection rings (visual feedback для выделенных юнитов) ──
// Плоский emissive torus под каждым выделенным юнитом; пул переиспользуется.
let selectionRingPool: Mesh[] = [];
let selectionRingMat: StandardMaterial | null = null;
let selectionObserver: { dispose: () => void } | null = null;

function ensureSelectionRings(scene: Scene): void {
  if (selectionRingMat) return;
  selectionRingMat = new StandardMaterial('sel-ring-mat', scene);
  selectionRingMat.emissiveColor = new Color3(0.46, 0.96, 0.68);
  selectionRingMat.diffuseColor = new Color3(0, 0, 0);
  selectionRingMat.alpha = 0.85;
  selectionRingMat.disableLighting = true; // чисто emissive → читается при любом освещении
}

/** Создаёт/переиспользует torus-кольцо; позиционирует под юнитом. */
function acquireRing(scene: Scene, idx: number): Mesh {
  let ring = selectionRingPool[idx];
  if (!ring) {
    ring = MeshBuilder.CreateTorus(`sel-ring-${idx}`, { diameter: 1.42, thickness: 0.085, tessellation: 28 }, scene);
    // Babylon torus is already horizontal in XZ.
    ring.material = selectionRingMat;
    ring.isPickable = false;
    ring.doNotSyncBoundingInfo = true;
    selectionRingPool[idx] = ring;
  }
  ring.setEnabled(true);
  return ring;
}

const statusMessage = ref('Загрузка RTS-карты…');
let statusTimer: ReturnType<typeof setTimeout> | null = null;
const gameOver = ref(false);
const paused = ref(false);
const speed = ref(1);

// ── Build/train/cast mode (как в Game.vue, но в RTS-only контексте) ──
const productionBuildings: ProductionBuildingType[] = DEFAULT_CATALOG.productionBuildings ?? [];
const defenderUnits: DefenderUnitType[] = DEFAULT_CATALOG.defenderUnits ?? [];
// Командир без TD-механик: убираем heal-walls (стены — TD-концепция, в RTS их нет).
// RTS-командиру оставляем только боевые/экономические заклинания.
const commander: CommanderType | null = (() => {
  const c = DEFAULT_CATALOG.commanders?.[0] ?? null;
  if (!c) return null;
  const rtsSpells = (c.spells ?? []).filter((s) => s.effect !== 'heal-walls');
  return { ...c, spells: rtsSpells };
})();
const rtsMode = ref<'idle' | 'build' | 'train' | 'cast'>('idle');
const rtsSelectedId = ref<string | null>(null);

// ── Selection state ──
const selection = useSelection();
const ctrlGroups = useControlGroups();
const commandMarkerDisposers = new Set<() => void>();

// ── Box-select drag state ──
const dragActive = ref(false);
const dragStart = ref<{ x: number; y: number } | null>(null);
const dragCurrent = ref<{ x: number; y: number } | null>(null);
let dragMoved = false;

// ── Camera viewport (для minimap rect) ──
const cameraViewport = ref<{ x: number; z: number; halfW: number; halfH: number } | null>(null);

const gameStore = useGameStore();

// Fallback для template когда sim ещё не готов (Minimap требует MapDocument).
const fallbackMap: MapDocument = {
  version: 1,
  grid: { cols: 1, rows: 1, cellSize: 1 },
  heightmap: [[0]],
  metadata: { name: 'loading' }
};

// ── derived UI getters (town-hall / AI statuses) ──
const playerTownHallHp = computed(() => {
  const sim = simRef.value;
  if (!sim) return { hp: 0, max: 0 };
  // lives = town-hall HP (RTS-solo); max = RTS_TOWN_HALL_HP (1500).
  return { hp: Math.max(0, gameStore.lives), max: 1500 };
});
const aiTownHallHp = computed(() => {
  void gameStore.tick;
  const sim = simRef.value;
  if (!sim) return { hp: 0, max: 0, alive: false };
  const ai = sim.getAiTownHall();
  return { hp: ai?.hp ?? 0, max: ai?.maxHp ?? 0, alive: !!ai };
});
const aiNextWave = computed(() => { void gameStore.tick; return Math.ceil(simRef.value?.getAiNextWaveIn() ?? 0); });
const status = computed(() => gameStore.status);
const isWon = computed(() => status.value === 'won');
const isLost = computed(() => status.value === 'lost');
const ownedUnits = computed(() => simRef.value?.state.defenderUnits ?? []);
const selectedCount = computed(() => selection.selectedIds.value.length);
const unitLabels: Record<string, string> = {
  worker: 'Рабочий',
  knight: 'Рыцарь',
  archer: 'Лучник',
  mage: 'Маг',
  commander: 'Командир'
};
const selectedUnits = computed(() => {
  const ids = new Set(selection.selectedIds.value);
  return gameStore.defenderUnits.filter((unit) => ids.has(unit.id));
});
const selectionBreakdown = computed(() => {
  const counts = new Map<string, { typeId: string; name: string; count: number; worker: boolean }>();
  for (const unit of selectedUnits.value) {
    const type = defenderUnits.find((candidate) => candidate.id === unit.typeId);
    const previous = counts.get(unit.typeId);
    if (previous) previous.count += 1;
    else counts.set(unit.typeId, {
      typeId: unit.typeId,
      name: unitLabels[unit.typeId] ?? type?.name ?? unit.typeId,
      count: 1,
      worker: Boolean(type?.worker)
    });
  }
  return [...counts.values()];
});
const selectionTitle = computed(() => {
  if (selectionBreakdown.value.length === 1 && selectedCount.value === 1) return selectionBreakdown.value[0]!.name;
  return `Отряд · ${selectedCount.value}`;
});
const selectionOrderLabel = computed(() => {
  const units = selectedUnits.value;
  if (units.some(unit=>unit.navigationStatus==='blocked')) return 'Нет прохода · откройте путь или смените цель';
  if (units.some(unit=>unit.gatherState==='to-base')) return 'Несёт ресурсы в ратушу';
  if (units.some((unit) => unit.gatherState === 'gathering')) return 'Добывает ресурс';
  if (units.some((unit) => unit.gatherNodeId)) return 'Идёт к месторождению';
  if (units.some((unit) => unit.attackOrderEnemyId || unit.targetEnemyId)) return 'Атакует цель';
  if (units.some((unit) => unit.moveOrderCol !== undefined || (unit.waypoints?.length ?? 0) > 0)) return 'Выполняет приказ движения';
  return 'Ожидает приказа';
});
const selectedWorkerCount = computed(() => {
  const sim = simRef.value;
  if (!sim) return 0;
  return selection.selectedIds.value.filter((id) => {
    const unit = sim.state.defenderUnits?.find((candidate) => candidate.id === id);
    return unit ? Boolean(sim.getUnitType(unit.typeId)?.worker) : false;
  }).length;
});
const miningQuestSteps = computed(() => {
  const nodes = simRef.value?.map.resourceNodes ?? [];
  const stoneIds = new Set(nodes.filter((node) => node.kind === 'stone').map((node) => node.id));
  const sentToStone = gameStore.defenderUnits.some((unit) => Boolean(unit.gatherNodeId && stoneIds.has(unit.gatherNodeId)));
  const mineBuilt = gameStore.productionBuildings.some((building) => building.typeId === 'mine');
  return [
    { label: 'Выберите рабочего', done: selectedWorkerCount.value > 0 },
    { label: 'Отправьте его к камню', done: sentToStone },
    { label: 'Поставьте шахту', done: mineBuilt },
    { label: 'Добудьте 10 руды', done: gameStore.resources.ore >= 30 }
  ];
});

function focusWorldSite(col: number, row: number): void {
  const sim = simRef.value;
  if (!sim) return;
  const position = gridToWorld(sim.map.grid,col,row);
  rtsCam?.focusOn(position.x,position.z);
}

// ── placement checks (как в Game.vue) ──
function canPlaceBuildingAt(col: number, row: number): boolean {
  const sim = simRef.value;
  if (!sim || !rtsSelectedId.value || rtsMode.value !== 'build') return false;
  const type = sim.getProductionType(rtsSelectedId.value);
  if (!type) return false;
  const grid = sim.map.grid;
  if (col < 0 || row < 0 || col >= grid.cols || row >= grid.rows) return false;
  if (sim.isPathCell(col, row)) return false;
  // Не строить поверх тайлов water/rock
  const tiles = sim.map.tiles;
  if (tiles) {
    const t = tiles[row]?.[col];
    if (t === 'water' || t === 'rock') return false;
  }
  return canPlaceProductionBuilding(
    {
      grid,
      spawn: { col: 0, row: 0 },
      base: { col: grid.cols - 1, row: grid.rows - 1 },
      walls: sim.state.walls,
      towers: sim.state.towers,
      relics: sim.state.relics,
      tiles: sim.map.tiles,
      productionBuildings: sim.state.productionBuildings ?? [],
      staticBlocked: staticSceneBlocked
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
      spawn: { col: 0, row: 0 },
      base: { col: grid.cols - 1, row: grid.rows - 1 },
      walls: sim.state.walls,
      towers: sim.state.towers,
      relics: sim.state.relics,
      tiles: sim.map.tiles,
      productionBuildings: sim.state.productionBuildings ?? [],
      staticBlocked: staticSceneBlocked
    },
    col,
    row
  );
}

function applyAction(action: PlayerAction): void {
  const sim = simRef.value;
  if (!sim) return;
  switch (action.kind) {
    case 'build-production':
    case 'train-unit':
      audio.play('place');
      break;
    case 'cast-spell':
      audio.play('spell');
      break;
  }
  sim.applyInput({ tick: sim.state.tick, userId: 'local', action });
  // Player commands mutate the deterministic simulation synchronously. Mirror
  // the resulting snapshot immediately so quest steps, costs and buttons do
  // not wait for the next stepped render callback.
  gameStore.setSnapshot(sim.serialize());
}

function showStatus(message: string, durationMs = 2600): void {
  statusMessage.value = message;
  if (statusTimer) clearTimeout(statusTimer);
  statusTimer = setTimeout(() => {
    statusMessage.value = '';
    statusTimer = null;
  }, durationMs);
}

function spawnCommandMarker(kind: 'move' | 'gather' | 'attack', position: Vector3): void {
  const scene = sceneRef.value;
  const sim = simRef.value;
  if (!scene || !sim) return;
  const colors = {
    move: new Color3(0.29, 0.78, 0.57),
    gather: new Color3(0.92, 0.69, 0.27),
    attack: new Color3(0.94, 0.25, 0.18)
  } as const;
  const marker = MeshBuilder.CreateTorus(`command-marker-${kind}`, {
    diameter: sim.map.grid.cellSize * 0.88,
    thickness: sim.map.grid.cellSize * 0.075,
    tessellation: 32
  }, scene);
  const material = new StandardMaterial(`command-marker-${kind}-mat`, scene);
  material.diffuseColor = new Color3(0, 0, 0);
  material.emissiveColor = colors[kind];
  material.disableLighting = true;
  material.alpha = 0.95;
  marker.material = material;
  marker.position.copyFrom(position);
  marker.position.y += 0.12;
  // Torus lies in the ground plane by default.
  marker.isPickable = false;
  marker.metadata = { commandMarker: kind };
  const started = performance.now();
  const observer = scene.onBeforeRenderObservable.add(() => {
    const progress = Math.min(1, (performance.now() - started) / 760);
    const scale = 0.55 + progress * 0.85;
    marker.scaling.set(scale, scale, scale);
    material.alpha = 0.95 * (1 - progress);
  });
  let timeout: ReturnType<typeof setTimeout>;
  const dispose = (): void => {
    clearTimeout(timeout);
    commandMarkerDisposers.delete(dispose);
    scene.onBeforeRenderObservable.remove(observer);
    marker.dispose();
    material.dispose();
  };
  commandMarkerDisposers.add(dispose);
  timeout = setTimeout(dispose, 800);
}

function placementFailure(col: number, row: number): string {
  const sim = simRef.value;
  if (!sim) return 'Сцена ещё загружается.';
  const tile = sim.map.tiles?.[row]?.[col];
  if (tile === 'water') return 'Здесь вода — найдите сухую площадку.';
  if (tile === 'rock') return 'Скальный грунт занят породой.';
  if (sim.isPathCell(col, row)) return 'Здесь проходит путь вражеского отряда.';
  if (sim.isStaticBlockedCell(col, row)) return 'Площадку перекрывает объект окружения.';
  return 'Клетка занята. Наведите фантом на свободную площадку.';
}

// ── preview mesh (ghost-маркер строительства/тренировки) ──
function updatePreview(): void {
  const scene = sceneRef.value;
  const sim = simRef.value;
  if (!scene || !sim || !previewMesh) return;
  spellPreview?.setEnabled(false);
  if (rtsMode.value === 'idle') {
    previewMesh.setEnabled(false);
    return;
  }
  const cell = pickGrid(scene, sim.map.grid);
  if (!cell) {
    previewMesh.setEnabled(false);
    return;
  }
  let valid = false;
  let color: [number, number, number] = [0.9, 0.18, 0.18];
  if (rtsMode.value === 'cast') {
    const spell = commander?.spells.find(spell => spell.id === rtsSelectedId.value);
    if (!spellPreview) {
      spellPreview = MeshBuilder.CreateTorus('spell-radius-preview', { diameter: 2, thickness: .045, tessellation: 64 }, scene);
      const material = new StandardMaterial('spell-radius-preview-mat', scene);
      material.disableLighting = true; material.alpha = .8;
      spellPreview.material = material; spellPreview.isPickable = false;
    }
    const pos = gridToWorld(sim.map.grid, cell.col, cell.row);
    spellPreview.position.set(pos.x, sampleHeight(sim.map.heightmap, sim.map.grid, cell.col, cell.row,true)+.12, pos.z);
    spellPreview.scaling.setAll((spell?.radius ?? 1)*sim.map.grid.cellSize);
    const ice = spell?.effect === 'freeze';
    (spellPreview.material as StandardMaterial).emissiveColor.set(ice ? .35 : 1, ice ? .8 : .4, ice ? 1 : .1);
    spellPreview.setEnabled(true); previewMesh.setEnabled(false);
    return;
  } else if (rtsMode.value === 'build') {
    valid = canPlaceBuildingAt(cell.col, cell.row);
    color = valid ? [0.35, 0.78, 0.52] : [0.9, 0.18, 0.18];
  } else if (rtsMode.value === 'train') {
    valid = canTrainUnitAt(cell.col, cell.row);
    color = valid ? [0.25, 0.65, 0.95] : [0.9, 0.18, 0.18];
  }
  const pos = gridToWorld(sim.map.grid, cell.col, cell.row);
  const groundY = sampleHeight(sim.map.heightmap, sim.map.grid, cell.col, cell.row, true);
  previewMesh.position.set(pos.x, groundY + 0.04, pos.z);
  const mat = previewMesh.material as { diffuseColor?: { r: number; g: number; b: number } } | null;
  if (mat?.diffuseColor) {
    mat.diffuseColor.r = color[0];
    mat.diffuseColor.g = color[1];
    mat.diffuseColor.b = color[2];
  }
  previewMesh.scaling.set(sim.map.grid.cellSize * 0.92, 0.08, sim.map.grid.cellSize * 0.92);
  previewMesh.setEnabled(true);
  void valid;
}

// ── picking helpers ──
/** Минимальный контракт ноды для walk-up (name + metadata + parent). */
interface PickNode {
  name?: string;
  metadata?: Record<string, unknown>;
  parent?: PickNode | null;
}

/**
 * Возвращает rigId (unit или enemy) из pick-меша: сначала через metadata.rigId
 * (тегированные парты rigged-рига), затем по имени root (префикс unit-rig- или
 * enemy-rig-), затем walk-up по родителям до rig-корня.
 */
function rigIdFromMesh(mesh: PickNode | null | undefined, kind: 'unit' | 'enemy'): string | null {
  if (!mesh) return null;
  const md = mesh.metadata;
  if (md && md.rigKind === kind && typeof md.rigId === 'string') return md.rigId;
  const prefix = kind === 'unit' ? 'unit-rig-' : 'enemy-rig-';
  if (typeof mesh.name === 'string' && mesh.name.startsWith(prefix)) return mesh.name.slice(prefix.length);
  // walk up parents (part mesh → ... → rig root)
  let p: PickNode | null | undefined = mesh.parent;
  while (p) {
    if (typeof p.name === 'string' && p.name.startsWith(prefix)) return p.name.slice(prefix.length);
    const pmd = p.metadata;
    if (pmd && pmd.rigKind === kind && typeof pmd.rigId === 'string') return pmd.rigId;
    p = p.parent;
  }
  return null;
}

function projectToCanvas(scene: Scene, world: Vector3): { x: number; y: number } | null {
  const camera = scene.activeCamera;
  const engine = engineRef.value;
  const canvas = canvasRef.value;
  if (!camera || !engine || !canvas) return null;
  const renderWidth = engine.getRenderWidth();
  const renderHeight = engine.getRenderHeight();
  const viewport = camera.viewport.toGlobal(renderWidth, renderHeight);
  const projected = Vector3.Project(world, Matrix.IdentityReadOnly, scene.getTransformMatrix(), viewport);
  return {
    x: projected.x * canvas.clientWidth / renderWidth,
    y: projected.y * canvas.clientHeight / renderHeight
  };
}

function pointerDistanceSq(point: { x: number; y: number }, scene: Scene): number {
  const dx = point.x - scene.pointerX;
  const dy = point.y - scene.pointerY;
  return dx * dx + dy * dy;
}

function pickUnit(): string | null {
  const scene = sceneRef.value;
  if (!scene) return null;
  const pick = scene.pick(scene.pointerX, scene.pointerY, (mesh) => {
    const md = mesh.metadata as Record<string, unknown> | undefined;
    return md?.rigKind === 'unit' || mesh.name.startsWith('unit-rig-') || mesh.name.startsWith('unit-inst-');
  });
  const picked = (pick?.pickedMesh ?? null) as PickNode | null;
  const id = rigIdFromMesh(picked, 'unit');
  if (id) return id;
  // back-compat: старый InstancedMesh-рендерер (unit-inst-<id>)
  if (picked && typeof picked.name === 'string' && picked.name.startsWith('unit-inst-')) return picked.name.slice('unit-inst-'.length);

  // Stable screen-space fallback for small animated rigs at RTS zoom.
  const sim = simRef.value;
  if (!sim) return null;
  let nearest: { id: string; distanceSq: number } | null = null;
  for (const unit of sim.state.defenderUnits ?? []) {
    const y = sampleHeight(sim.map.heightmap, sim.map.grid, unit.col, unit.row, true) + sim.map.grid.cellSize * 0.72;
    const screen = projectToCanvas(scene, new Vector3(unit.position.x, y, unit.position.z));
    if (!screen) continue;
    const distanceSq = pointerDistanceSq(screen, scene);
    if (distanceSq <= 34 * 34 && (!nearest || distanceSq < nearest.distanceSq)) nearest = { id: unit.id, distanceSq };
  }
  return nearest?.id ?? null;
}

function pickEnemy(): string | null {
  const scene = sceneRef.value;
  if (!scene) return null;
  const pick = scene.pick(scene.pointerX, scene.pointerY, (mesh) => {
    const md = mesh.metadata as Record<string, unknown> | undefined;
    return md?.rigKind === 'enemy' || mesh.name.startsWith('enemy-rig-') || mesh.name.startsWith('enemy-inst-');
  });
  const picked = (pick?.pickedMesh ?? null) as PickNode | null;
  const id = rigIdFromMesh(picked, 'enemy');
  if (id) return id;
  if (picked && typeof picked.name === 'string' && picked.name.startsWith('enemy-inst-')) return picked.name.slice('enemy-inst-'.length);
  const sim = simRef.value;
  if (!sim) return null;
  let nearest: { id: string; distanceSq: number } | null = null;
  for (const enemy of sim.state.enemies) {
    const cs = sim.map.grid.cellSize;
    const col = Math.floor((enemy.position.x + sim.map.grid.cols * cs * 0.5) / cs);
    const row = Math.floor((enemy.position.z + sim.map.grid.rows * cs * 0.5) / cs);
    const y = sampleHeight(sim.map.heightmap, sim.map.grid, col, row, true) + cs * 0.65;
    const screen = projectToCanvas(scene, new Vector3(enemy.position.x, y, enemy.position.z));
    if (!screen) continue;
    const distanceSq = pointerDistanceSq(screen, scene);
    if (distanceSq <= 38 * 38 && (!nearest || distanceSq < nearest.distanceSq)) nearest = { id: enemy.id, distanceSq };
  }
  return nearest?.id ?? null;
}

function pickResourceNode(): string | null {
  const scene = sceneRef.value;
  const sim = simRef.value;
  if (!scene || !sim) return null;
  const direct = resourceRendererRef.value?.pickNodeId(
    scene.pick(scene.pointerX, scene.pointerY, (m) => m.name.startsWith('rn-inst-'))?.pickedMesh ?? null
  ) ?? null;
  if (direct) return direct;

  let nearest: { id: string; distanceSq: number } | null = null;
  for (const node of sim.map.resourceNodes ?? []) {
    if (node.amount <= 0) continue;
    const world = gridToWorld(sim.map.grid, node.col, node.row);
    const y = sampleHeight(sim.map.heightmap, sim.map.grid, node.col, node.row, true)
      + sim.map.grid.cellSize * (node.kind === 'wood' ? 0.9 : 0.55);
    const screen = projectToCanvas(scene, new Vector3(world.x, y, world.z));
    if (!screen) continue;
    const distanceSq = pointerDistanceSq(screen, scene);
    const radius = node.kind === 'wood' ? 54 : 46;
    if (distanceSq <= radius * radius && (!nearest || distanceSq < nearest.distanceSq)) nearest = { id: node.id, distanceSq };
  }
  return nearest?.id ?? null;
}

/** Box-select: возвращает id юнитов игрока, чьи риг-руты попадают в screen-rect. */
function boxSelectUnits(x0: number, y0: number, x1: number, y1: number): string[] {
  const scene = sceneRef.value;
  const engine = engineRef.value;
  const canvas = canvasRef.value;
  const camera = scene?.activeCamera;
  if (!scene || !engine || !camera || !canvas) return [];
  const minX = Math.min(x0, x1);
  const maxX = Math.max(x0, x1);
  const minY = Math.min(y0, y1);
  const maxY = Math.max(y0, y1);
  const rw = engine.getRenderWidth();
  const rh = engine.getRenderHeight();
  const viewport = camera.viewport.toGlobal(rw, rh);
  scene.updateTransformMatrix(true);
  const transform = scene.getTransformMatrix();
  const world = Matrix.Identity();
  // Собираем по одному meшу на rigId (первый попавшийся парт), затем берём
  // позицию rig-рута (walk up) и проецируем. Это покрывает и rigged
  // (unit-rig-<id>) и старый InstancedMesh-рендерер (unit-inst-<id>).
  const rootByUnitId = new Map<string, PickNode>();
  for (const mesh of scene.meshes) {
    const node = mesh as unknown as PickNode;
    const md = node.metadata;
    let id: string | null = null;
    if (md?.rigKind === 'unit' && typeof md.rigId === 'string') id = md.rigId;
    else if (typeof node.name === 'string' && node.name.startsWith('unit-rig-')) id = node.name.slice('unit-rig-'.length);
    else if (typeof node.name === 'string' && node.name.startsWith('unit-inst-')) id = node.name.slice('unit-inst-'.length);
    if (!id || rootByUnitId.has(id)) continue;
    // для rigged — нужен root TransformNode (part meши имеют смещение); walk up.
    let root: PickNode = node;
    let p: PickNode | null | undefined = node.parent;
    while (p) {
      if (typeof p.name === 'string' && p.name.startsWith('unit-rig-')) { root = p; break; }
      p = p.parent;
    }
    rootByUnitId.set(id, root);
  }
  const out: string[] = [];
  for (const [id, root] of rootByUnitId) {
    const abs = (root as unknown as { getAbsolutePosition?: () => { x: number; y: number; z: number } }).getAbsolutePosition?.();
    if (!abs) continue;
    const projected = Vector3.Project(new Vector3(abs.x, abs.y, abs.z), world, transform, viewport);
    const screenX = projected.x * canvas.clientWidth / rw;
    const screenY = projected.y * canvas.clientHeight / rh;
    if (screenX >= minX && screenX <= maxX && screenY >= minY && screenY <= maxY) {
      out.push(id);
    }
  }
  return out;
}

// ── Keyboard shortcuts (RTS hotkeys) ──
function onKeyDown(ev: KeyboardEvent): void {
  const code = ev.code;
  // Control groups: Ctrl+1..9 → assign; 1..9 (без модификатора) → recall.
  if (code.startsWith('Digit')) {
    const n = parseInt(code.slice('Digit'.length), 10);
    if (n >= 1 && n <= 9) {
      if (ev.ctrlKey || ev.metaKey) {
        if (selection.selectedIds.value.length > 0) {
          ctrlGroups.assign(n, selection.selectedIds.value);
          applyAction({ kind: 'assign-control-group', unitIds: selection.selectedIds.value, group: n });
        }
        ev.preventDefault();
        return;
      }
      if (ctrlGroups.has(n)) {
        const ids = ctrlGroups.recall(n);
        selection.selectMany(ids);
        focusCameraOnUnits(ids);
      }
      return;
    }
  }
  switch (code) {
    case 'Escape':
      if (rtsMode.value !== 'idle') {
        rtsMode.value = 'idle';
        rtsSelectedId.value = null;
      } else {
        selection.clear();
      }
      updatePreview();
      break;
    case 'KeyS':
      // S → stop selected units
      if (selection.selectedIds.value.length > 0) {
        applyAction({ kind: 'order-unit-stop', unitIds: [...selection.selectedIds.value] });
      }
      break;
    case 'KeyA':
      // A → attack-move on next click (for simplicity: enter "build" of attack-move via prompt)
      if (selection.selectedIds.value.length > 0) {
        const scene = sceneRef.value;
        const sim = simRef.value;
        if (scene && sim) {
          const cell = pickGrid(scene, sim.map.grid);
          if (cell) {
            applyAction({ kind: 'order-unit-attack-move', unitIds: [...selection.selectedIds.value], col: cell.col, row: cell.row });
          }
        }
      }
      break;
    case 'KeyH':
      // H → halt/hold (используем stop как приближенную)
      if (selection.selectedIds.value.length > 0) {
        applyAction({ kind: 'order-unit-stop', unitIds: [...selection.selectedIds.value] });
      }
      break;
    case 'Space':
      paused.value = !paused.value;
      loop?.setPaused(paused.value);
      ev.preventDefault();
      break;
    case 'Delete':
      // Delete → sell/demolish selected building (если выбрано здание) — задел на будущее.
      break;
  }
}

function focusCameraOnUnits(ids: string[]): void {
  const sim = simRef.value;
  const rts = rtsCam;
  if (!sim || !rts || ids.length === 0) return;
  let sumX = 0, sumZ = 0, n = 0;
  for (const id of ids) {
    const u = sim.state.defenderUnits?.find((x) => x.id === id);
    if (u) { sumX += u.position.x; sumZ += u.position.z; n += 1; }
  }
  if (n > 0) rts.focusOn(sumX / n, sumZ / n);
}

// ── Pointer (selection + orders + box-select + build-place) ──
function setupPointerHandlers(): void {
  const scene = sceneRef.value;
  if (!scene) return;

  scene.onPointerObservable.add((info) => {
    if (info.type === PointerEventTypes.POINTERMOVE) {
      // box-select drag update
      if (dragActive.value && dragStart.value) {
        dragCurrent.value = { x: scene.pointerX, y: scene.pointerY };
        const dx = Math.abs(dragCurrent.value.x - dragStart.value.x);
        const dy = Math.abs(dragCurrent.value.y - dragStart.value.y);
        if (dx > 3 || dy > 3) dragMoved = true;
      }
      updatePreview();
    } else if (info.type === PointerEventTypes.POINTERDOWN) {
      const ev = info.event as { button: number; shiftKey?: boolean; ctrlKey?: boolean };
      const isRight = ev.button === 2;
      const isLeft = ev.button === 0;

      // Build / train / cast placement (left-click in those modes)
      if (isLeft && rtsMode.value !== 'idle' && rtsSelectedId.value) {
        const sim = simRef.value;
        if (!sim) return;
        const cell = pickGrid(scene, sim.map.grid);
        if (!cell) {
          showStatus('Курсор вне доступной области карты.');
          return;
        }
        if (rtsMode.value === 'cast') {
          applyAction({ kind: 'cast-spell', spellId: rtsSelectedId.value, col: cell.col, row: cell.row });
          rtsMode.value = 'idle';
          rtsSelectedId.value = null;
          updatePreview();
        } else if (rtsMode.value === 'build' && canPlaceBuildingAt(cell.col, cell.row)) {
          const before = sim.state.productionBuildings?.length ?? 0;
          const typeId = rtsSelectedId.value;
          applyAction({ kind: 'build-production', typeId: rtsSelectedId.value, col: cell.col, row: cell.row });
          const after = sim.state.productionBuildings?.length ?? 0;
          if (after > before) {
            const name = productionBuildings.find((building) => building.id === typeId)?.name ?? 'Здание';
            showStatus(`${name}: строительство начато.`);
            rtsMode.value = 'idle';
            rtsSelectedId.value = null;
            updatePreview();
          } else {
            showStatus('Не хватает ресурсов для этого здания.');
          }
        } else if (rtsMode.value === 'build') {
          showStatus(placementFailure(cell.col, cell.row));
        } else if (rtsMode.value === 'train' && canTrainUnitAt(cell.col, cell.row)) {
          const before = sim.state.defenderUnits?.length ?? 0;
          const typeId = rtsSelectedId.value;
          applyAction({ kind: 'train-unit', typeId: rtsSelectedId.value, col: cell.col, row: cell.row });
          const after = sim.state.defenderUnits?.length ?? 0;
          if (after > before) {
            const name = defenderUnits.find((unit) => unit.id === typeId)?.name ?? 'Боец';
            showStatus(`${name} вступил в отряд.`);
            rtsMode.value = 'idle';
            rtsSelectedId.value = null;
            updatePreview();
          } else {
            showStatus('Не хватает ресурсов для найма.');
          }
        }
        return;
      }

      if (isLeft) {
        // Box-select start (или single-select на POINTERUP)
        dragActive.value = true;
        dragStart.value = { x: scene.pointerX, y: scene.pointerY };
        dragCurrent.value = { ...dragStart.value };
        dragMoved = false;
      } else if (isRight) {
        // Правый клик = приказ
        issueRightClickOrder(!!ev.shiftKey);
      }
    } else if (info.type === PointerEventTypes.POINTERUP) {
      const ev = info.event as { button: number; shiftKey?: boolean };
      if (ev.button !== 0) return;
      if (!dragActive.value) return;
      const start = dragStart.value;
      const end = { x: scene.pointerX, y: scene.pointerY } as const;
      dragActive.value = false;
      dragStart.value = null;
      dragCurrent.value = null;
      if (!start) return;

      if (!dragMoved) {
        // single click → select / toggle
        const unitId = pickUnit();
        if (unitId) {
          if (ev.shiftKey) {
            selection.addToSelection([unitId], 'toggle');
          } else {
            selection.select(unitId);
          }
        } else if (!ev.shiftKey) {
          // клик по пустому месту → снять выделение (если не в build/train/cast)
          selection.clear();
        }
        return;
      }
      // box-select: собрали drag-rect
      const ids = boxSelectUnits(start.x, start.y, end.x, end.y);
      if (ids.length > 0) {
        selection.selectMany(ids);
      }
    }
  });
}

function issueRightClickOrder(shiftQueue: boolean): void {
  const sim = simRef.value;
  const scene = sceneRef.value;
  if (!sim || !scene) return;
  const ids = selection.selectedIds.value;
  if (ids.length === 0) return;

  // 1) Вражеский юнит/здание → attack-order
  const enemyId = pickEnemy();
  if (enemyId) {
    applyAction({ kind: 'order-unit-attack', unitIds: [...ids], enemyId });
    const enemy = sim.state.enemies.find((candidate) => candidate.id === enemyId);
    if (enemy) {
      spawnCommandMarker('attack', new Vector3(enemy.position.x, enemy.position.y, enemy.position.z));
      const target = enemy.stationary ? 'вражеский оплот' : 'вражескую цель';
      showStatus(`Цель принята · ${ids.length} ${ids.length === 1 ? 'боец атакует' : 'бойцов атакуют'} ${target}`);
    }
    return;
  }
  // 2) Resource node → gather (только workers)
  const nodeId = pickResourceNode();
  if (nodeId) {
    // 仅 для workers; военные юниты ignore.
    const workers = ids.filter((id) => {
      const u = sim.state.defenderUnits?.find((x) => x.id === id);
      const t = u ? sim.getUnitType(u.typeId) : null;
      return !!t?.worker;
    });
    if (workers.length > 0) {
      applyAction({ kind: 'order-unit-gather', unitIds: workers, nodeId });
      const node = sim.map.resourceNodes?.find((candidate) => candidate.id === nodeId);
      if (node) {
        const world = gridToWorld(sim.map.grid, node.col, node.row);
        const groundY = sampleHeight(sim.map.heightmap, sim.map.grid, node.col, node.row, true);
        spawnCommandMarker('gather', new Vector3(world.x, groundY, world.z));
        const resource = { wood: 'дерево', stone: 'камень', ore: 'руду', gold: 'золото' }[node.kind];
        showStatus(`Приказ подтверждён · ${workers.length} ${workers.length === 1 ? 'рабочий добывает' : 'рабочих добывают'} ${resource}`);
      }
    } else {
      showStatus('Для добычи выберите рабочего. Боевые отряды этот приказ не выполняют.');
    }
    return;
  }
  // 3) Terrain → move order с формацией (grid по умолчанию)
  const cell = pickGrid(scene, sim.map.grid);
  if (!cell) return;
  const formation: FormationKind = 'grid';
  if (shiftQueue) {
    // shift = очередь
    applyAction({ kind: 'order-unit-waypoint-queue', unitIds: [...ids], waypoints: [{ col: cell.col, row: cell.row }], append: true });
    showStatus(`Маршрут дополнен · точка добавлена для ${ids.length} юн.`);
  } else {
    // выровнять выделенных через формацию (server-side orderUnitMove уже это делает,
    // но мы дублируем здесь для ясности — берёт длину ids).
    const positions = computeFormation(ids.length, { col: cell.col, row: cell.row }, formation, { spacing: 1.2 });
    void positions;
    applyAction({ kind: 'order-unit-move', unitIds: [...ids], col: cell.col, row: cell.row, formation });
    showStatus(`Приказ движения принят · ${ids.length} ${ids.length === 1 ? 'юнит' : 'юнитов'}`);
  }
  const world = gridToWorld(sim.map.grid, cell.col, cell.row);
  const groundY = sampleHeight(sim.map.heightmap, sim.map.grid, cell.col, cell.row, true);
  spawnCommandMarker('move', new Vector3(world.x, groundY, world.z));
}

// ── Build/train/cast select (из ProductionPanel) ──
function onSelectBuilding(typeId: string): void {
  rtsMode.value = 'build';
  rtsSelectedId.value = typeId;
  const name = productionBuildings.find((building) => building.id === typeId)?.name ?? 'здание';
  showStatus(`Разместите ${name}: зелёный фантом означает свободную клетку.`, 4200);
  updatePreview();
}
function onSelectUnit(typeId: string): void {
  rtsMode.value = 'train';
  rtsSelectedId.value = typeId;
  showStatus('Укажите свободную клетку рядом с крепостью.', 3600);
  updatePreview();
}
function onSelectSpell(spellId: string): void {
  rtsMode.value = 'cast';
  rtsSelectedId.value = spellId;
  updatePreview();
}
function cancelRtsMode(): void {
  rtsMode.value = 'idle';
  rtsSelectedId.value = null;
  updatePreview();
}

// ── camera viewport → minimap ──
function syncCameraViewport(): void {
  const rts = rtsCam;
  if (!rts) return;
  const tgt = rts.camera.target;
  const h = rts.getVisibleH();
  const aspect = (engineRef.value?.getRenderWidth() ?? 1) / Math.max(1, engineRef.value?.getRenderHeight() ?? 1);
  cameraViewport.value = { x: tgt.x, z: tgt.z, halfW: (h / 2) * aspect, halfH: h / 2 };
}

function onMinimapFocus(wx: number, wz: number): void {
  rtsCam?.focusOn(wx, wz);
}

// ── init / dispose ──
function buildSim(map: MapDocument, staticBlockedCells: readonly { col: number; row: number }[]): void {
  const sim = new GameSim({ map, catalog: DEFAULT_CATALOG, ownerId: 'local', staticBlockedCells });
  simRef.value = sim;
  gameStore.setRtsEnabled(sim.isRtsEnabled());
  gameStore.setMaxLives(sim.state.lives);
  gameStore.setSnapshot(sim.serialize());
  gameOver.value = false;
  rtsMode.value = 'idle';
  rtsSelectedId.value = null;
  selection.clear();
  ctrlGroups.clearAll();
}

async function init(): Promise<void> {
  const id = props.mapId || RTS_MAPS[0]!.metadata!.name as string;
  let map: MapDocument;
  try {
    // loadMap сначала ищет в BUILTIN_MAPS; RTS-карты экспортируются отдельным реестром.
    map = getRtsMap(id) ?? loadMap(id);
  } catch {
    map = getRtsMap(id) ?? RTS_MAPS[0]!;
  }
  if (!canvasRef.value) return;

  const engine = createEngine(canvasRef.value);
  // Render the 3D layer on a stable low-resolution grid; CSS performs the
  // nearest-neighbour upscale while the DOM HUD remains native-resolution.
  const pixelTargetWidth = 960;
  engine.setHardwareScalingLevel(Math.max(1, canvasRef.value.clientWidth / pixelTargetWidth));
  engineRef.value = engine;
  // M8-fix: createRtsScene вместо TD createScene — нет «доски в космосе»,
  // террейн следует heightmap (объекты больше не парят над плоским полом).
  const { scene, camera, light, ground } = createRtsScene(engine, map.grid, map.heightmap, {
    tiles: map.tiles
  });
  sceneRef.value = scene;
  setGridVisible(scene, false);

  // The ritual scene belongs to voxel-lab and deliberately stays isolated from
  // the game. RTS uses its own catalog-driven town hall and starts with no
  // fixture-specific navigation blockers.
  sceneryRenderer = new RtsSceneryRenderer(scene,map);
  const sceneryCells = sceneryRenderer.getNavigationBlockedCells();
  staticSceneBlocked = new Set(sceneryCells.map(cell=>`${cell.col}:${cell.row}`));
  buildSim(map, sceneryCells);
  const sim = simRef.value!;

  const loadedCatalog = await AssetCatalog.create(scene, {
    // RTS использует только процедурные воксель-риги/билдеры (UNIT_RIGS,
    // RIGGED_DEFS, VOXEL_BUILDERS). glTF здесь не нужен — обход убирает
    // «мусорные» подсетки glTF в origin, merge-предупреждения и ускоряет init.
    skipGltf: true
  });
  if (disposed) {
    loadedCatalog.dispose();
    return;
  }
  catalog = loadedCatalog;

  // town-hall игрока — база для командира и как точка фокуса камеры.
  const pTownHall = sim.getPlayerTownHall();
  const focusCol = pTownHall?.col ?? Math.floor(map.grid.cols / 2);
  const focusRow = pTownHall?.row ?? Math.floor(map.grid.rows / 2);
  const focusWorld = gridToWorld(map.grid, focusCol, focusRow);
  const mapHalfW = (map.grid.cols * map.grid.cellSize) / 2;
  const mapHalfH = (map.grid.rows * map.grid.cellSize) / 2;
  // Y-центр террейна в точке фокуса — камера смотрит «в уровень земли».
  const focusGroundY = sampleHeight(map.heightmap, map.grid, focusCol, focusRow, true);

  // Начальный кадр держит базу главным объектом, но слегка смещается к центру
  // карты: так на угловых стартах экран не заполняется внешним apron-полем.
  const frameTargetX = focusWorld.x * 0.91;
  const frameTargetZ = focusWorld.z * 0.91;
  const frameTargetY = focusGroundY;

  // ── RTS camera (ORTHOgraphic + pan/zoom/rotate) — НЕ вращается как TD ──
  rtsCam = attachRtsCamera(scene, camera, engine, {
    target: { x: frameTargetX, y: frameTargetY, z: frameTargetZ },
    bounds: { minX: -mapHalfW, maxX: mapHalfW, minZ: -mapHalfH, maxZ: mapHalfH },
    pitch: Math.PI / 5,            // 36°: ритуал и terrain читаются сверху
    initialYaw: -Math.PI / 4,      // 45° iso
    // Видимая высота — чуть больше базы + её окрестностей (workers/resources).
    // Раньше 28 — слишком далеко для cellSize 1.5. ~16 даёт читаемый кадр базы.
    initialVisibleH: Math.max(14, Math.min(22, map.grid.cellSize * 12)),
    minVisibleH: 6,
    maxVisibleH: Math.max(40, map.grid.rows * map.grid.cellSize * 1.2),
    panSpeed: 22
  });

  // атмосфера (день/ночь, тени, туман, пост-процесс)
  // M8-fix (яркость): RTS-карты большие + ortho-камера → TD-значения (fog 0.006,
  // exposure 1.1, vignette 2.4) давили кадр в темноту (global mean lum ≈ 18/255).
  // Для RTS — слабее fog, выше exposure, легче vignette, ярче ambient/sun.
  const bossTypeIds = new Set(DEFAULT_CATALOG.enemies.filter((e) => e.category === 'boss').map((e) => e.id));
  atmosphere = new AtmosphereRenderer(scene, camera, map.grid, {
    hemispheric: light,
    ground,
    board: { width: map.grid.cols * map.grid.cellSize, height: map.grid.rows * map.grid.cellSize },
    bossTypeIds,
    fogDensity: 0.0025,
    exposure: 1.68,
    vignetteWeight: 0.48,
    ambientIntensity: 1.22,
    sunIntensity: 1.32,
    ssaoStrength: 0.45,
    ssaoRadius: 0.52,
    pixelArt: true
  });

  overlay = new LevelOverlay(scene, map, catalog);
  atmosphere.attachBaseMarker({ position: new Vector3(focusWorld.x, focusGroundY, focusWorld.z) }, map.grid.cellSize);

  const shadowCtl = {
    add: (m: Mesh) => atmosphere!.addShadowCaster(m),
    remove: (m: Mesh) => atmosphere!.removeShadowCaster(m)
  };

  enemyRenderer = USE_RIGGED_ENEMIES
    ? new RiggedEnemyRenderer(scene, DEFAULT_CATALOG.enemies, map.grid.cellSize, catalog, camera, shadowCtl)
    : new EnemyRenderer(scene, DEFAULT_CATALOG.enemies, map.grid.cellSize, catalog, { enableDebris: false });

  // RTS render: юниты + здания (rigged по умолчанию)
  const commanderCatalogId = sim.getCommander()?.modelRef.catalogId ?? null;
  const uRenderer: UnitSceneRenderer = USE_RIGGED_UNITS
    ? new RiggedUnitRenderer(
        scene,
        DEFAULT_CATALOG.defenderUnits ?? [],
        DEFAULT_CATALOG.productionBuildings ?? [],
        map.grid,
        map.heightmap,
        catalog,
        commanderCatalogId,
        { col: focusCol, row: focusRow },
        shadowCtl
      )
    : new UnitRenderer(
        scene,
        DEFAULT_CATALOG.defenderUnits ?? [],
        DEFAULT_CATALOG.productionBuildings ?? [],
        map.grid,
        map.heightmap,
        catalog,
        commanderCatalogId,
        { col: focusCol, row: focusRow }
      );
  unitRenderer = uRenderer;
  unitRendererRef.value = uRenderer;

  // resource nodes
  resourceRendererRef.value = new ResourceNodeRenderer(scene, map.grid, map.heightmap);

  for (const m of enemyRenderer.getShadowCasterMeshes()) atmosphere.addShadowCaster(m);
  for (const m of uRenderer.getShadowCasterMeshes()) atmosphere.addShadowCaster(m);
  for (const m of sceneryRenderer.getShadowCasterMeshes()) atmosphere.addShadowCaster(m);

  if (USE_TOON) {
    toonHandle = applyToonToScene(scene, camera, [0.3, 1.0, 0.4], { edgeStrength: 0.8 });
  }

  previewMesh = makePreviewMesh(scene);
  worldSiteRenderer = new WorldSiteRenderer(scene,map.grid,map.heightmap);
  worldSiteRenderer.sync(sim.state.worldSites ?? []);

  loop = startGameLoop(
    engine,
    scene,
    sim,
    {
      enemies: enemyRenderer,
      units: uRenderer,
      atmosphere
    },
    (snap) => {
      gameStore.setSnapshot(snap);
      worldSiteRenderer?.sync(snap.worldSites ?? []);
      if (!gameOver.value && (snap.status === 'won' || snap.status === 'lost')) gameOver.value = true;
      // resource-node depletion sync
      resourceRendererRef.value?.sync(snap.resources ? (sim.map.resourceNodes ?? []) : []);
      // camera viewport → minimap rect
      syncCameraViewport();
    },
    () => { /* route overlay no-op */ },
    { stepping: true }
  );

  // Resource nodes: первичная отрисовка + периодический sync (depletion)
  resourceRendererRef.value?.sync(map.resourceNodes ?? []);

  setupPointerHandlers();
  // disable browser context menu on right-click (для приказов)
  canvasRef.value?.addEventListener('contextmenu', (e) => e.preventDefault());
  window.addEventListener('keydown', onKeyDown);

  // ── Selection rings: per-frame позиционирование под выделенными юнитами ──
  ensureSelectionRings(scene);
  const ringObs = scene.onBeforeRenderObservable.add(() => {
    const sim = simRef.value;
    if (!sim) return;
    const ids = selection.selectedIds.value;
    const grid = sim.map.grid;
    const used = Math.min(ids.length, selectionRingPool.length);
    for (let i = 0; i < used; i++) {
      const ring = selectionRingPool[i]!;
      const id = ids[i]!;
      const unit = sim.state.defenderUnits?.find((u) => u.id === id);
      if (!unit) { ring.setEnabled(false); continue; }
      const groundY = sampleHeight(sim.map.heightmap, grid, unit.col, unit.row, true);
      ring.position.set(unit.position.x, groundY + 0.065, unit.position.z);
      ring.setEnabled(true);
    }
    // лишние кольца (выделение уменьшилось) — скрыть
    for (let i = used; i < selectionRingPool.length; i++) selectionRingPool[i]!.setEnabled(false);
    // если выделение больше пула — дозакупить
    for (let i = selectionRingPool.length; i < ids.length; i++) {
      acquireRing(scene, i);
      const ring = selectionRingPool[i]!;
      const unit = sim.state.defenderUnits?.find((u) => u.id === ids[i]!);
      if (unit) {
        const groundY = sampleHeight(sim.map.heightmap, grid, unit.col, unit.row, true);
        ring.position.set(unit.position.x, groundY + 0.065, unit.position.z);
      }
    }
  });
  selectionObserver = { dispose: (): void => { scene.onBeforeRenderObservable.remove(ringObs); } };

  statusMessage.value = '';
}

// ── control (pause/speed) ──
function togglePause(): void {
  paused.value = !paused.value;
  loop?.setPaused(paused.value);
}
function cycleSpeed(): void {
  speed.value = speed.value === 1 ? 2 : (speed.value === 2 ? 3 : 1);
  loop?.setSpeed(speed.value);
}

function resetCamera(): void {
  rtsCam?.reset();
}

onMounted(() => {
  disposed = false;
  void init();
});
onBeforeUnmount(() => {
  disposed = true;
  if (statusTimer) clearTimeout(statusTimer);
  for (const disposeMarker of [...commandMarkerDisposers]) disposeMarker();
  window.removeEventListener('keydown', onKeyDown);
  loop?.stop();
  selectionObserver?.dispose();
  selectionObserver = null;
  for (const r of selectionRingPool) r.dispose();
  selectionRingPool = [];
  selectionRingMat?.dispose();
  selectionRingMat = null;
  overlay?.dispose();
  toonHandle?.dispose();
  toonHandle = null;
  enemyRenderer?.dispose();
  unitRenderer?.dispose();
  resourceRendererRef.value?.dispose();
  sceneryRenderer?.dispose();
  worldSiteRenderer?.dispose();
  spellPreview?.dispose(false,true); spellPreview = null;
  sceneryRenderer = null;
  rtsCam?.dispose();
  staticSceneBlocked.clear();
  atmosphere?.dispose();
  catalog?.dispose();
  engineRef.value?.dispose();
});

// Resource nodes нужно sync при изменении (depletion синхронно в game-sim).
watch(() => simRef.value?.map.resourceNodes, (nodes: ResourceNode[] | undefined) => {
  if (nodes) resourceRendererRef.value?.sync(nodes);
}, { deep: true });

// expose для дебага в консоли
// Kept narrow for parent components and browser smoke tests; gameplay still
// flows through pointer input rather than mutating the simulation directly.
defineExpose({ sim: simRef, scene: sceneRef });
</script>

<template>
  <div class="rts-layout">
    <EconomyBar />

    <div class="rts-body">
      <main class="rts-stage">
        <canvas ref="canvasRef" class="rts-canvas" />
        <div v-if="statusMessage" class="game-alert">{{ statusMessage }}</div>

        <!-- Top-left HUD: player + AI town-hall HP / next wave -->
        <div class="hud-corner top-left">
          <div class="hud-card">
            <div class="hud-title"><RtsIcon name="home" :size="12" /> Крепость</div>
            <div class="hp-bar">
              <div class="hp-fill player" :style="{ width: `${(playerTownHallHp.hp / Math.max(1, playerTownHallHp.max)) * 100}%` }" />
              <span class="hp-text">{{ playerTownHallHp.hp }} / {{ playerTownHallHp.max }}</span>
            </div>
          </div>
          <div class="hud-card enemy">
            <div class="hud-title"><RtsIcon name="tower" :size="12" /> Вражеский оплот</div>
            <div class="hp-bar">
              <div class="hp-fill ai" :class="{ dead: !aiTownHallHp.alive }" :style="{ width: `${(aiTownHallHp.hp / Math.max(1, aiTownHallHp.max)) * 100}%` }" />
              <span class="hp-text">{{ aiTownHallHp.alive ? `${aiTownHallHp.hp} / ${aiTownHallHp.max}` : 'уничтожен' }}</span>
            </div>
            <div class="hud-meta">Следующий налёт · {{ aiNextWave }}с</div>
          </div>
        </div>

        <!-- Top-right HUD: control bar -->
        <div class="hud-corner top-right">
          <button class="ctrl-btn" title="Вернуть камеру к крепости" @click="resetCamera"><RtsIcon name="home" :size="15" /></button>
          <button class="ctrl-btn" :class="{ active: paused }" :title="paused ? 'Продолжить' : 'Пауза'" @click="togglePause"><RtsIcon name="pause" :size="14" /></button>
          <button class="ctrl-btn speed" :class="{ active: speed > 1 }" title="Скорость симуляции" @click="cycleSpeed">×{{ speed }}</button>
          <button class="ctrl-btn ghost" title="В lobby" @click="emit('back')"><RtsIcon name="back" :size="15" /></button>
        </div>

        <!-- Build/train/cast banner -->
        <div v-if="rtsMode !== 'idle'" class="rts-mode-banner">
          <span v-if="rtsMode === 'cast'">Цель заклинания — кликните по полю</span>
          <span v-else-if="rtsMode === 'build'">Строительство здания — кликните по свободной клетке</span>
          <span v-else-if="rtsMode === 'train'">Тренировка юнита — кликните по свободной клетке</span>
          <button class="btn ghost" @click="cancelRtsMode">Отмена (Esc)</button>
        </div>

        <!-- Selection summary (bottom-center) -->
        <div v-if="selectedCount > 0" class="selection-summary">
          <div class="sel-heading">
            <span class="sel-title">{{ selectionTitle }}</span>
            <span class="sel-order">{{ selectionOrderLabel }}</span>
          </div>
          <div class="sel-roster">
            <div v-for="entry in selectionBreakdown" :key="entry.typeId" class="sel-unit">
              <RtsIcon :name="entry.worker ? 'worker' : entry.typeId" :size="20" />
              <span>{{ entry.name }}</span>
              <b>×{{ entry.count }}</b>
            </div>
          </div>
          <span class="sel-hint">ПКМ — приказ · Shift — очередь · A — атака · S — стоп · Ctrl+1..9 — группа</span>
        </div>

        <!-- Control groups bar -->
        <ControlGroupBar :ctrl="ctrlGroups" @recall="(g) => { const ids = ctrlGroups.recall(g); selection.selectMany(ids); focusCameraOnUnits(ids); }" />

        <!-- Box-select overlay -->
        <SelectionBox :active="dragActive" :start="dragStart" :current="dragCurrent" />

        <!-- Minimap -->
        <Minimap
          :map="simRef?.map ?? fallbackMap"
          :snapshot="simRef?.serialize() ?? null"
          :camera="cameraViewport"
          :size="180"
          @focus="onMinimapFocus"
        />

        <!-- Game over modal -->
        <div v-if="gameOver" class="overlay-modal">
          <div class="modal-card">
            <div class="modal-title" :class="{ won: isWon, lost: isLost }">
              {{ isWon ? 'Победа' : 'Крепость пала' }}
            </div>
            <div class="modal-text">
              <template v-if="isWon">Вражеский оплот уничтожен. Золотая эра наступила.</template>
              <template v-else>Ваш Town Hall пал. В следующий раз стройте больше казарм и держите воинов у переправ.</template>
            </div>
            <div class="modal-actions">
              <button class="btn ghost" @click="emit('back')">В лобби</button>
            </div>
          </div>
        </div>
      </main>

      <aside class="rts-side">
        <section class="quest-panel">
          <div class="quest-kicker">Первый приказ</div>
          <div class="quest-title"><RtsIcon name="ore" :size="18" /> Камень для шахты</div>
          <p>Рабочие должны открыть залежь и закрепить добычу до первого налёта.</p>
          <ol>
            <li v-for="(step, index) in miningQuestSteps" :key="step.label" :class="{ done: step.done }">
              <span>{{ step.done ? '✓' : index + 1 }}</span>{{ step.label }}
            </li>
          </ol>
        </section>
        <section class="world-objectives" aria-label="Задачи в мире">
          <div class="quest-kicker">Разведка окрестностей</div>
          <p>Снимите охрану и удержите точку отрядом. Нажмите на задачу, чтобы найти её.</p>
          <button v-for="site in gameStore.worldSites" :key="site.id" type="button" :class="{ secured: site.secured }"
            @click="focusWorldSite(site.col,site.row)">
            <span>{{ site.secured ? '✓' : '◇' }}</span><span><strong>{{ site.name }}</strong>
              <small>{{ site.secured ? 'Задача выполнена' : site.progress > 0 ? `Удержание · ${Math.round(site.progress * 100)}%` : 'Снять охрану и занять' }}</small>
              <small>{{ site.kind === 'supplies' ? '+80 дерева · +50 камня' : '+75 золота · налёты реже' }}</small>
            </span>
          </button>
        </section>
        <ProductionPanel
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

        <div class="control-legend"><b>ЛКМ</b> выбрать · <b>ПКМ</b> приказ · <b>WASD</b> камера · <b>Q/E</b> поворот</div>
      </aside>
    </div>
  </div>
</template>

<style scoped>
.rts-layout {
  display: flex;
  flex-direction: column;
  height: 100%;
  background: #0e1017;
  color: #cbb99f;
  --iron: #17181e;
  --iron-2: #222027;
  --brass: #9f7d68;
  --brass-dim: rgba(159, 125, 104, 0.42);
  --ink: #090a0e;
  --player: #83c7a3;
  --enemy: #cf5d48;
  font-family: Georgia, 'Times New Roman', serif;
}
.rts-body {
  flex: 1;
  display: flex;
  min-height: 0;
}
.rts-stage {
  flex: 1;
  position: relative;
  min-width: 0;
  overflow: hidden;
  background: #0c1019;
}
.rts-stage::after {
  content: '';
  position: absolute;
  inset: 0;
  pointer-events: none;
  z-index: 2;
  box-shadow: inset 0 0 110px rgba(5, 6, 15, 0.58);
}
.rts-canvas {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  outline: none;
  touch-action: none;
  image-rendering: pixelated;
}
.game-alert {
  position: absolute;
  top: 12px;
  left: 50%;
  transform: translateX(-50%);
  background: rgba(18, 18, 23, 0.96);
  border: 1px solid #80675b;
  color: #dfcdb4;
  padding: 8px 15px;
  border-radius: 0;
  font: clamp(11px, 0.75vw, 13px) 'Lucida Console', monospace;
  letter-spacing: 0.03em;
  box-shadow: 0 10px 30px rgba(0, 0, 0, 0.28);
  z-index: 7;
}
.hud-corner {
  position: absolute;
  display: flex;
  flex-direction: column;
  gap: 6px;
  pointer-events: none;
  z-index: 6;
}
.hud-corner.top-left { top: 14px; left: 14px; }
.hud-corner.top-right { top: 12px; right: 12px; flex-direction: row; pointer-events: auto; }
.hud-card {
  background: rgba(17, 18, 23, 0.94);
  border: 1px solid rgba(131, 199, 163, 0.5);
  border-left: 2px solid var(--player);
  border-radius: 0;
  padding: 7px 9px;
  min-width: clamp(184px, 16vw, 224px);
  box-shadow: inset 0 0 0 2px rgba(0, 0, 0, .46), 3px 3px 0 rgba(0, 0, 0, .24);
}
.hud-card.enemy { border-color: rgba(198, 93, 75, 0.5); border-left-color: var(--enemy); }
.hud-title {
  display: flex;
  align-items: center;
  gap: 5px;
  font: clamp(10px, 0.7vw, 12px) 'Lucida Console', monospace;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: #9a8a7b;
  margin-bottom: 4px;
}
.hp-bar {
  position: relative;
  width: 100%;
  height: 14px;
  background: rgba(0, 0, 0, 0.55);
  border: 1px solid #090a0e;
  overflow: hidden;
}
.hp-fill {
  position: absolute;
  inset: 0 auto 0 0;
  transition: width 0.2s linear;
}
.hp-fill.player { background: #588a70; }
.hp-fill.ai { background: #9f4135; }
.hp-fill.ai.dead { background: #3f3f46; }
.hp-text {
  position: relative;
  z-index: 1;
  display: block;
  text-align: center;
  font: 9px 'Lucida Console', monospace;
  font-weight: 700;
  line-height: 14px;
  color: #fff;
  text-shadow: 0 1px 2px rgba(0, 0, 0, 0.85);
}
.hud-meta { font: clamp(9px, 0.62vw, 11px) 'Lucida Console', monospace; color: #c57667; margin-top: 5px; text-transform: uppercase; }
.ctrl-btn {
  width: 33px;
  height: 33px;
  display: grid;
  place-items: center;
  border-radius: 0;
  background: rgba(17, 18, 23, 0.94);
  border: 1px solid var(--brass-dim);
  color: #bba68f;
  cursor: pointer;
  font-size: 14px;
  font-weight: 700;
}
.ctrl-btn:hover { border-color: var(--brass); color: #ead6ba; }
.ctrl-btn.active { background: #24372f; border-color: var(--player); }
.ctrl-btn.speed { font: 9px 'Lucida Console', monospace; }
.ctrl-btn.ghost { width: auto; padding: 0 12px; }
.rts-mode-banner {
  position: absolute;
  top: 56px;
  left: 50%;
  transform: translateX(-50%);
  display: flex;
  gap: 10px;
  align-items: center;
  background: rgba(18, 18, 23, 0.96);
  border: 1px solid var(--brass);
  padding: 6px 12px;
  border-radius: 0;
  color: #d5c0a5;
  font: 10px 'Lucida Console', monospace;
  z-index: 6;
}
.selection-summary {
  position: absolute;
  bottom: 14px;
  left: 50%;
  transform: translateX(-50%);
  display: flex;
  flex-direction: column;
  gap: 8px;
  align-items: stretch;
  width: min(560px, calc(100% - 230px));
  background: rgba(18, 18, 23, 0.94);
  border: 1px solid var(--brass-dim);
  padding: 10px 14px 9px;
  border-radius: 0;
  z-index: 6;
  pointer-events: none;
}
.sel-heading { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; border-bottom: 1px solid #463a35; padding-bottom: 6px; }
.sel-title { color: #dfcdb4; font: 700 clamp(15px, 1.1vw, 19px) Georgia, serif; }
.sel-order { color: var(--player); font: 10px 'Lucida Console', monospace; text-transform: uppercase; }
.sel-roster { display: flex; flex-wrap: wrap; gap: 6px; }
.sel-unit { display: grid; grid-template-columns: 20px auto auto; align-items: center; gap: 7px; min-width: 132px; padding: 6px 8px; color: #cbb99f; background: #15171c; border-left: 2px solid #577e69; font: 11px 'Lucida Console', monospace; }
.sel-unit b { color: #8fc6a4; margin-left: auto; }
.sel-hint { font: 9px/1.35 'Lucida Console', monospace; color: #776d66; text-align: center; }
.rts-side {
  width: clamp(320px, 24vw, 390px);
  flex: 0 0 clamp(320px, 24vw, 390px);
  background: #15161b;
  border-left: 1px solid var(--brass-dim);
  display: flex;
  flex-direction: column;
  overflow-y: auto;
}
.quest-panel { margin: 12px 12px 0; padding: 11px; background: #111217; border: 1px solid #58473f; box-shadow: inset 0 0 0 2px #090a0d; }
.world-objectives { margin: 12px 12px 0; padding: 11px; border: 1px solid #58473f; background: #111217; }
.world-objectives p { color: #9b8d80; font-size: 12px; line-height: 1.45; margin: 7px 0; }
.world-objectives button { display: flex; align-items: center; gap: 9px; width: 100%; padding: 10px 7px; background: #18171b; border: 1px solid #59483f; color: #dfcdb4; text-align: left; cursor: pointer; margin-top: 7px; }
.world-objectives button:focus-visible, .world-objectives button:hover { border-color: #b99a78; outline: 1px solid #b99a78; }
.world-objectives button > span:first-child { font-size: 24px; color: #b99a78; }
.world-objectives strong { font: 700 16px Georgia, serif; }
.world-objectives small { display: block; font-size: 11px; line-height: 1.5; color: #9b8d80; }
.world-objectives .secured { border-color: #45614e; }
.world-objectives .secured > span:first-child { color: #8ac09a; }
.quest-kicker { color: #806e60; font: 10px 'Lucida Console', monospace; text-transform: uppercase; letter-spacing: .15em; }
.quest-title { display: flex; align-items: center; gap: 7px; margin-top: 5px; color: #dfcdb4; font: 700 17px Georgia, serif; }
.quest-panel p { margin: 7px 0 9px; color: #9b8d80; font-size: 12px; line-height: 1.45; }
.quest-panel ol { display: grid; gap: 4px; margin: 0; padding: 0; list-style: none; }
.quest-panel li { display: flex; align-items: center; gap: 7px; color: #9b8b7c; font: 10px 'Lucida Console', monospace; }
.quest-panel li span { width: 17px; height: 17px; display: grid; place-items: center; border: 1px solid #59483f; color: #b99a78; background: #18171b; }
.quest-panel li.done { color: #789f84; text-decoration: line-through; text-decoration-color: #405948; }
.quest-panel li.done span { color: #8ac09a; border-color: #45614e; }
.control-legend { margin-top: auto; padding: 9px 12px 12px; border-top: 1px solid #362e2c; color: #81766e; font: 10px/1.5 'Lucida Console', monospace; }
.control-legend b { color: #ad9984; }
.overlay-modal {
  position: absolute;
  inset: 0;
  background: rgba(0, 0, 0, 0.65);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 20;
}
.modal-card {
  background: #171b18;
  border: 1px solid var(--brass);
  border-radius: 2px;
  padding: 28px 36px;
  text-align: center;
  min-width: 320px;
}
.modal-title { font-size: 28px; font-weight: 800; margin-bottom: 8px; }
.modal-title.won { color: #22c55e; }
.modal-title.lost { color: #ef4444; }
.modal-text { color: #cbd5e1; font-size: 13px; margin-bottom: 18px; max-width: 320px; }
.modal-actions { display: flex; gap: 8px; justify-content: center; }
.btn {
  border: none;
  border-radius: 2px;
  padding: 8px 14px;
  font-weight: 700;
  cursor: pointer;
}
.btn.primary { background: #376b8f; color: #fff; }
.btn.ghost { background: #d8d0bb; color: #171b18; border: 1px solid #eee5cf; }
.btn.danger { background: #ef4444; color: #fff; }

@media (max-width: 1180px) {
  .rts-side { width: 300px; flex-basis: 300px; }
  .hud-card { min-width: 168px; }
  .selection-summary { width: min(480px, calc(100% - 205px)); left: 12px; transform: none; }
  .sel-hint { display: none; }
  .quest-panel { margin: 9px 9px 0; }
}

@media (max-width: 820px) {
  .rts-body { flex-direction: column; overflow-y: auto; }
  .rts-stage { flex: 0 0 62vh; min-height: 430px; }
  .rts-side { width: 100%; flex: 0 0 auto; max-height: none; border-left: 0; border-top: 1px solid var(--brass-dim); }
  .selection-summary { width: min(470px, calc(100% - 24px)); }
  .hud-corner.top-left { top: 10px; left: 10px; }
  .hud-corner.top-right { top: 10px; right: 10px; }
  .quest-panel p { display: none; }
}
</style>
