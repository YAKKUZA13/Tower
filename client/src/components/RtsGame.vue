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
import { Color3, Matrix, MeshBuilder, PointerEventTypes, StandardMaterial, Vector3, Viewport } from 'babylonjs';
import type { Engine, Mesh, Scene } from 'babylonjs';
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
let loop: ReturnType<typeof startGameLoop> | null = null;
let rtsCam: RtsCameraHandle | null = null;
let previewMesh: Mesh | null = null;

// ── Selection rings (visual feedback для выделенных юнитов) ──
// Плоский emissive torus под каждым выделенным юнитом; пул переиспользуется.
let selectionRingPool: Mesh[] = [];
let selectionRingMat: StandardMaterial | null = null;
let selectionObserver: { dispose: () => void } | null = null;

function ensureSelectionRings(scene: Scene): void {
  if (selectionRingMat) return;
  selectionRingMat = new StandardMaterial('sel-ring-mat', scene);
  selectionRingMat.emissiveColor = new Color3(0.35, 0.75, 1.0);
  selectionRingMat.diffuseColor = new Color3(0, 0, 0);
  selectionRingMat.alpha = 0.85;
  selectionRingMat.disableLighting = true; // чисто emissive → читается при любом освещении
}

/** Создаёт/переиспользует torus-кольцо; позиционирует под юнитом. */
function acquireRing(scene: Scene, idx: number): Mesh {
  let ring = selectionRingPool[idx];
  if (!ring) {
    ring = MeshBuilder.CreateTorus(`sel-ring-${idx}`, { diameter: 1.25, thickness: 0.06, tessellation: 28 }, scene);
    ring.rotation.x = Math.PI / 2; // положить плашмя
    ring.material = selectionRingMat;
    ring.isPickable = false;
    ring.doNotSyncBoundingInfo = true;
    selectionRingPool[idx] = ring;
  }
  ring.setEnabled(true);
  return ring;
}

const statusMessage = ref('Загрузка RTS-карты…');
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
  return { hp: Math.max(0, sim.state.lives), max: 1500 };
});
const aiTownHallHp = computed(() => {
  const sim = simRef.value;
  if (!sim) return { hp: 0, max: 0, alive: false };
  const ai = sim.getAiTownHall();
  return { hp: ai?.hp ?? 0, max: ai?.maxHp ?? 0, alive: !!ai };
});
const aiNextWave = computed(() => Math.ceil(simRef.value?.getAiNextWaveIn() ?? 0));
const status = computed(() => simRef.value?.state.status ?? 'prep');
const isWon = computed(() => status.value === 'won');
const isLost = computed(() => status.value === 'lost');
const ownedUnits = computed(() => simRef.value?.state.defenderUnits ?? []);
const selectedCount = computed(() => selection.selectedIds.value.length);

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
      spawn: { col: 0, row: 0 },
      base: { col: grid.cols - 1, row: grid.rows - 1 },
      walls: sim.state.walls,
      towers: sim.state.towers,
      relics: sim.state.relics,
      tiles: sim.map.tiles,
      productionBuildings: sim.state.productionBuildings ?? []
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
}

// ── preview mesh (ghost-маркер строительства/тренировки) ──
function updatePreview(): void {
  const scene = sceneRef.value;
  const sim = simRef.value;
  if (!scene || !sim || !previewMesh) return;
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
    valid = true;
    color = [0.96, 0.62, 0.10];
  } else if (rtsMode.value === 'build') {
    valid = canPlaceBuildingAt(cell.col, cell.row);
    color = valid ? [0.55, 0.35, 0.85] : [0.9, 0.18, 0.18];
  } else if (rtsMode.value === 'train') {
    valid = canTrainUnitAt(cell.col, cell.row);
    color = valid ? [0.25, 0.65, 0.95] : [0.9, 0.18, 0.18];
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
  return null;
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
  return null;
}

function pickResourceNode(): string | null {
  return resourceRendererRef.value?.pickNodeId(
    sceneRef.value?.pick(sceneRef.value.pointerX, sceneRef.value.pointerY, (m) => m.name.startsWith('rn-inst-'))?.pickedMesh ?? null
  ) ?? null;
}

/** Box-select: возвращает id юнитов игрока, чьи риг-руты попадают в screen-rect. */
function boxSelectUnits(x0: number, y0: number, x1: number, y1: number): string[] {
  const scene = sceneRef.value;
  const engine = engineRef.value;
  const camera = scene?.activeCamera;
  if (!scene || !engine || !camera) return [];
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
    const screen = Vector3.Project(new Vector3(abs.x, abs.y, abs.z), world, transform, viewport);
    if (screen.x >= minX && screen.x <= maxX && screen.y >= minY && screen.y <= maxY) {
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
        if (!cell) return;
        if (rtsMode.value === 'cast') {
          applyAction({ kind: 'cast-spell', spellId: rtsSelectedId.value, col: cell.col, row: cell.row });
          rtsMode.value = 'idle';
          rtsSelectedId.value = null;
        } else if (rtsMode.value === 'build' && canPlaceBuildingAt(cell.col, cell.row)) {
          applyAction({ kind: 'build-production', typeId: rtsSelectedId.value, col: cell.col, row: cell.row });
        } else if (rtsMode.value === 'train' && canTrainUnitAt(cell.col, cell.row)) {
          applyAction({ kind: 'train-unit', typeId: rtsSelectedId.value, col: cell.col, row: cell.row });
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
  } else {
    // выровнять выделенных через формацию (server-side orderUnitMove уже это делает,
    // но мы дублируем здесь для ясности — берёт длину ids).
    const positions = computeFormation(ids.length, { col: cell.col, row: cell.row }, formation, { spacing: 1.2 });
    void positions;
    applyAction({ kind: 'order-unit-move', unitIds: [...ids], col: cell.col, row: cell.row, formation });
  }
}

// ── Build/train/cast select (из ProductionPanel) ──
function onSelectBuilding(typeId: string): void {
  rtsMode.value = 'build';
  rtsSelectedId.value = typeId;
  updatePreview();
}
function onSelectUnit(typeId: string): void {
  rtsMode.value = 'train';
  rtsSelectedId.value = typeId;
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
function buildSim(map: MapDocument): void {
  const sim = new GameSim({ map, catalog: DEFAULT_CATALOG, ownerId: 'local' });
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
  engineRef.value = engine;
  // M8-fix: createRtsScene вместо TD createScene — нет «доски в космосе»,
  // террейн следует heightmap (объекты больше не парят над плоским полом).
  const { scene, camera, light, ground } = createRtsScene(engine, map.grid, map.heightmap, {
    tiles: map.tiles
  });
  sceneRef.value = scene;
  setGridVisible(scene, false);

  buildSim(map);
  const sim = simRef.value!;

  catalog = await AssetCatalog.create(scene, {
    // RTS использует только процедурные воксель-риги/билдеры (UNIT_RIGS,
    // RIGGED_DEFS, VOXEL_BUILDERS). glTF здесь не нужен — обход убирает
    // «мусорные» подсетки glTF в origin, merge-предупреждения и ускоряет init.
    skipGltf: true
  });

  // town-hall игрока — база для командира и как точка фокуса камеры.
  const pTownHall = sim.getPlayerTownHall();
  const focusCol = pTownHall?.col ?? Math.floor(map.grid.cols / 2);
  const focusRow = pTownHall?.row ?? Math.floor(map.grid.rows / 2);
  const focusWorld = gridToWorld(map.grid, focusCol, focusRow);
  const mapHalfW = (map.grid.cols * map.grid.cellSize) / 2;
  const mapHalfH = (map.grid.rows * map.grid.cellSize) / 2;
  // Y-центр террейна в точке фокуса — камера смотрит «в уровень земли».
  const focusGroundY = sampleHeight(map.heightmap, map.grid, focusCol, focusRow, true);

  // M8-fix (фрейминг): камера целиком смотрит на town-hall игрока — это его
  // фокальная точка в начале игры. Раньше target = focusWorld*0.5 ставил цель
  // между базой и центром карты → база оказывалась на самом краю кадра (или за
  // краем), а после дрейфа edge-scroll — в противоположном углу. Теперь центр
  // кадра = база; вокруг неё видны workers/resource-nodes.
  const frameTargetX = focusWorld.x;
  const frameTargetZ = focusWorld.z;
  const frameTargetY = focusGroundY;

  // ── RTS camera (ORTHOgraphic + pan/zoom/rotate) — НЕ вращается как TD ──
  rtsCam = attachRtsCamera(scene, camera, engine, {
    target: { x: frameTargetX, y: frameTargetY, z: frameTargetZ },
    bounds: { minX: -mapHalfW, maxX: mapHalfW, minZ: -mapHalfH, maxZ: mapHalfH },
    pitch: Math.PI / 6,            // ~30° (диметрия)
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
    exposure: 1.6,
    vignetteWeight: 0.7,
    ambientIntensity: 1.25,
    sunIntensity: 1.4
  });

  overlay = new LevelOverlay(scene, map, catalog);

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

  if (USE_TOON) {
    toonHandle = applyToonToScene(scene, camera, [0.3, 1.0, 0.4], { edgeStrength: 0.8 });
  }

  previewMesh = makePreviewMesh(scene);

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
      ring.position.set(unit.position.x, groundY + 0.03, unit.position.z);
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
        ring.position.set(unit.position.x, groundY + 0.03, unit.position.z);
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

onMounted(() => { void init(); });
onBeforeUnmount(() => {
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
  rtsCam?.dispose();
  atmosphere?.dispose();
  catalog?.dispose();
  engineRef.value?.dispose();
});

// Resource nodes нужно sync при изменении (depletion синхронно в game-sim).
watch(() => simRef.value?.map.resourceNodes, (nodes: ResourceNode[] | undefined) => {
  if (nodes) resourceRendererRef.value?.sync(nodes);
}, { deep: true });

// expose для дебага в консоли
defineExpose({ sim: simRef });
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
            <div class="hud-title">🏰 Ваш Town Hall</div>
            <div class="hp-bar">
              <div class="hp-fill player" :style="{ width: `${(playerTownHallHp.hp / Math.max(1, playerTownHallHp.max)) * 100}%` }" />
              <span class="hp-text">{{ playerTownHallHp.hp }} / {{ playerTownHallHp.max }}</span>
            </div>
          </div>
          <div class="hud-card enemy">
            <div class="hud-title">⚔ Вражеский оплот</div>
            <div class="hp-bar">
              <div class="hp-fill ai" :class="{ dead: !aiTownHallHp.alive }" :style="{ width: `${(aiTownHallHp.hp / Math.max(1, aiTownHallHp.max)) * 100}%` }" />
              <span class="hp-text">{{ aiTownHallHp.alive ? `${aiTownHallHp.hp} / ${aiTownHallHp.max}` : 'уничтожен' }}</span>
            </div>
            <div class="hud-meta">⚔ атак через: {{ aiNextWave }}с</div>
          </div>
        </div>

        <!-- Top-right HUD: control bar -->
        <div class="hud-corner top-right">
          <button class="ctrl-btn" :class="{ active: paused }" :title="paused ? 'Продолжить' : 'Пауза'" @click="togglePause">{{ paused ? '▶' : '⏸' }}</button>
          <button class="ctrl-btn" :class="{ active: speed > 1 }" title="Скорость симуляции" @click="cycleSpeed">×{{ speed }}</button>
          <button class="ctrl-btn ghost" title="В lobby" @click="emit('back')">←</button>
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
          <span class="sel-count">{{ selectedCount }}</span>
          <span class="sel-label">выбрано юнитов</span>
          <span class="sel-hint">ЛКМ — выделить · ПКМ — приказ · Shift — добавить · A — attack-move · S — стоп · Ctrl+1..9 — группа</span>
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
              {{ isWon ? '🏆 Победа!' : '☠ Поражение' }}
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

        <section class="hint-block">
          <div class="info-title">Подсказка</div>
          <ul class="hint-list">
            <li><b>ЛКМ</b> — выделить юнита. <b>Shift+ЛКМ</b> — добавить. Зажать ЛКМ и тянуть — рамка.</li>
            <li><b>ПКМ</b> — приказ: идти / атаковать врага / добывать ресурс.</li>
            <li><b>A</b> + точка — атакующий марш. <b>S</b> — стоп. <b>Shift+ПКМ</b> — очередь waypoint-ов.</li>
            <li><b>Ctrl+1..9</b> — группа. <b>1..9</b> — вызвать группу. <b>Space</b> — пауза.</li>
            <li><b>Q / E</b> — повернуть камеру. <b>WASD</b> и края экрана — панорама. <b>Колесо</b> — зум.</li>
            <li>Цель: тренируйте workers → добывайте 🪵🪨⛏ → стройте Barracks → воины → уничтожьте 🔱 вражеский оплот.</li>
          </ul>
        </section>
      </aside>
    </div>
  </div>
</template>

<style scoped>
.rts-layout {
  display: flex;
  flex-direction: column;
  height: 100%;
  background: #0b1021;
  color: #e5e7eb;
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
}
.rts-canvas {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  outline: none;
  touch-action: none;
}
.game-alert {
  position: absolute;
  top: 12px;
  left: 50%;
  transform: translateX(-50%);
  background: rgba(15, 23, 42, 0.85);
  border: 1px solid rgba(168, 85, 247, 0.4);
  color: #f8fafc;
  padding: 6px 12px;
  border-radius: 8px;
  font-size: 13px;
}
.hud-corner {
  position: absolute;
  display: flex;
  flex-direction: column;
  gap: 6px;
  pointer-events: none;
  z-index: 6;
}
.hud-corner.top-left { top: 12px; left: 12px; }
.hud-corner.top-right { top: 12px; right: 12px; flex-direction: row; pointer-events: auto; }
.hud-card {
  background: rgba(11, 16, 33, 0.88);
  border: 1px solid rgba(120, 140, 170, 0.35);
  border-radius: 8px;
  padding: 6px 10px;
  min-width: 200px;
}
.hud-card.enemy { border-color: rgba(231, 76, 60, 0.5); }
.hud-title {
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: #94a3b8;
  margin-bottom: 4px;
}
.hp-bar {
  position: relative;
  width: 100%;
  height: 18px;
  background: rgba(0, 0, 0, 0.55);
  border-radius: 4px;
  overflow: hidden;
}
.hp-fill {
  position: absolute;
  inset: 0 auto 0 0;
  transition: width 0.2s linear;
}
.hp-fill.player { background: linear-gradient(90deg, #2563eb, #60a5fa); }
.hp-fill.ai { background: linear-gradient(90deg, #b91c1c, #ef4444); }
.hp-fill.ai.dead { background: #3f3f46; }
.hp-text {
  position: relative;
  z-index: 1;
  display: block;
  text-align: center;
  font-size: 11px;
  font-weight: 700;
  line-height: 18px;
  color: #fff;
  text-shadow: 0 1px 2px rgba(0, 0, 0, 0.85);
}
.hud-meta { font-size: 11px; color: #fca5a5; margin-top: 3px; }
.ctrl-btn {
  width: 36px;
  height: 36px;
  border-radius: 8px;
  background: rgba(11, 16, 33, 0.85);
  border: 1px solid rgba(120, 140, 170, 0.45);
  color: #e5e7eb;
  cursor: pointer;
  font-size: 14px;
  font-weight: 700;
}
.ctrl-btn.active { background: rgba(59, 130, 246, 0.3); border-color: #3b82f6; }
.ctrl-btn.ghost { width: auto; padding: 0 12px; }
.rts-mode-banner {
  position: absolute;
  top: 56px;
  left: 50%;
  transform: translateX(-50%);
  display: flex;
  gap: 10px;
  align-items: center;
  background: rgba(11, 16, 33, 0.9);
  border: 1px solid rgba(168, 85, 247, 0.5);
  padding: 6px 12px;
  border-radius: 8px;
  z-index: 6;
}
.selection-summary {
  position: absolute;
  bottom: 14px;
  left: 50%;
  transform: translateX(-50%);
  display: flex;
  flex-direction: column;
  gap: 2px;
  align-items: center;
  background: rgba(11, 16, 33, 0.85);
  border: 1px solid rgba(120, 140, 170, 0.35);
  padding: 6px 14px;
  border-radius: 8px;
  z-index: 6;
  pointer-events: none;
}
.sel-count { font-size: 18px; font-weight: 800; color: #60a5fa; }
.sel-label { font-size: 12px; color: #cbd5e1; }
.sel-hint { font-size: 10px; color: #94a3b8; max-width: 600px; text-align: center; line-height: 1.35; }
.rts-side {
  width: 340px;
  background: #0f172a;
  border-left: 1px solid rgba(255, 255, 255, 0.08);
  display: flex;
  flex-direction: column;
  overflow-y: auto;
}
.hint-block {
  padding: 12px;
  border-top: 1px solid rgba(255, 255, 255, 0.08);
}
.info-title { font-weight: 800; color: #f8fafc; margin-bottom: 6px; }
.hint-list { list-style: none; padding: 0; margin: 0; font-size: 11px; line-height: 1.5; color: #94a3b8; }
.hint-list li { padding: 2px 0; }
.hint-list b { color: #cbd5e1; }
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
  background: #0f172a;
  border: 1px solid rgba(255, 255, 255, 0.15);
  border-radius: 12px;
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
  border-radius: 8px;
  padding: 8px 14px;
  font-weight: 700;
  cursor: pointer;
}
.btn.primary { background: #2563eb; color: #fff; }
.btn.ghost { background: #f1f5f9; color: #0f172a; border: 1px solid #e2e8f0; }
.btn.danger { background: #ef4444; color: #fff; }
</style>
