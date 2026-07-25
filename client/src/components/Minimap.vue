<script setup lang="ts">
/**
 * M8.1 — Minimap canvas overlay.
 * Чистый Vue + canvas-overlay; НЕ Babylon GUI (дешевле). Чертит:
 *  - bounds карты (background)
 *  - obstacles/water (по tiles если есть)
 *  - resource-nodes (точки)
 *  - buildings (квадраты) + units (точки) — всех игроков, цветом slot
 *  - fog of war: explored = затемнённый, never-seen = чёрный (если есть visibility map)
 *  - camera viewport rectangle
 *  - clickable → pan RTS-camera (через emit('focus', worldX, worldZ))
 */
import { onBeforeUnmount, onMounted, ref, watch } from 'vue';
import type { GameSnapshot, MapDocument, PlayerState } from '@tower/shared';

const props = defineProps<{
  map: MapDocument;
  snapshot: GameSnapshot | null;
  /** Visible-cells set для fog-of-war (по playerId/slot). null = полный reveal. */
  visibleCells?: Set<string> | null;
  exploredCells?: Set<string> | null;
  /** Camera world-target + visible ortho-extents (для viewport rect). */
  camera?: { x: number; z: number; halfW: number; halfH: number } | null;
  size?: number;
}>();

const emit = defineEmits<{
  (e: 'focus', worldX: number, worldZ: number): void;
  (e: 'select-box', fromX: number, fromY: number, toX: number, toY: number): void;
}>();

const canvasRef = ref<HTMLCanvasElement | null>(null);
let rafId = 0;

const COLORS = ['#2E86DE', '#E74C3C', '#F4D03F', '#58D68D'];

function worldToMinimap(x: number, z: number, size: number, map: MapDocument): { x: number; y: number } {
  const cs = map.grid.cellSize;
  const halfW = (map.grid.cols * cs) / 2;
  const halfH = (map.grid.rows * cs) / 2;
  return {
    x: ((x + halfW) / (map.grid.cols * cs)) * size,
    y: ((z + halfH) / (map.grid.rows * cs)) * size
  };
}

function draw(): void {
  const canvas = canvasRef.value;
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const size = props.size ?? 160;
  if (canvas.width !== size) canvas.width = size;
  if (canvas.height !== size) canvas.height = size;
  const map = props.map;
  const snap = props.snapshot;

  // background
  ctx.fillStyle = '#0b0e14';
  ctx.fillRect(0, 0, size, size);

  // tiles (terrain) — упрощённо, по tiles-array если есть
  if (map.tiles) {
    const cellPx = size / map.grid.cols;
    for (let r = 0; r < map.grid.rows; r++) {
      const row = map.tiles[r];
      if (!row) continue;
      for (let c = 0; c < map.grid.cols; c++) {
        const t = row[c];
        if (!t) continue;
        let col = '#0b0e14';
        if (t === 'grass') col = '#1d2e1a';
        else if (t === 'dirt') col = '#2a1f12';
        else if (t === 'road') col = '#3a342a';
        else if (t === 'water') col = '#0d1e30';
        else if (t === 'rock') col = '#1a1a1a';
        else if (t === 'sand') col = '#2e2613';
        ctx.fillStyle = col;
        ctx.fillRect(c * cellPx, r * cellPx, cellPx + 0.5, cellPx + 0.5);
      }
    }
  }

  // fog of war overlay (если есть)
  if (props.exploredCells && props.visibleCells) {
    const cellPx = size / map.grid.cols;
    for (let r = 0; r < map.grid.rows; r++) {
      for (let c = 0; c < map.grid.cols; c++) {
        const key = `${c}:${r}`;
        if (props.visibleCells.has(key)) continue;          // fully visible
        if (props.exploredCells?.has(key)) {
          ctx.fillStyle = 'rgba(0,0,0,0.55)';               // explored = gray
          ctx.fillRect(c * cellPx, r * cellPx, cellPx + 0.5, cellPx + 0.5);
        } else {
          ctx.fillStyle = 'rgba(0,0,0,0.95)';               // never seen = black
          ctx.fillRect(c * cellPx, r * cellPx, cellPx + 0.5, cellPx + 0.5);
        }
      }
    }
  }

  // resource nodes
  if (map.resourceNodes) {
    for (const n of map.resourceNodes) {
      const w = worldToMinimap(n.col * map.grid.cellSize, n.row * map.grid.cellSize, size, map);
      ctx.fillStyle = n.kind === 'gold' ? '#F1C40F' : n.kind === 'ore' ? '#7F8C8D' : n.kind === 'stone' ? '#BDC3C7' : '#7D6608';
      ctx.fillRect(w.x - 1, w.y - 1, 3, 3);
    }
  }

  if (snap) {
    // players: units + buildings
    const players = snap.playersState ?? [];
    const drawPlayer = (p: PlayerState): void => {
      if (p.defeated) return;
      const col = `#${p.color}`;
      ctx.fillStyle = col;
      // buildings — squares
      for (const b of p.buildings) {
        const w = worldToMinimap(b.col * map.grid.cellSize, b.row * map.grid.cellSize, size, map);
        ctx.fillRect(w.x - 2, w.y - 2, 4, 4);
      }
      // units — small dots
      for (const u of p.units) {
        const w = worldToMinimap(u.position.x, u.position.z, size, map);
        ctx.fillRect(w.x - 0.5, w.y - 0.5, 2, 2);
      }
    };
    if (players.length > 0) {
      for (const p of players) drawPlayer(p);
    } else {
      // legacy single-player — все defenders/buildings цветом 0
      ctx.fillStyle = COLORS[0];
      for (const b of snap.productionBuildings ?? []) {
        const w = worldToMinimap(b.col * map.grid.cellSize, b.row * map.grid.cellSize, size, map);
        ctx.fillRect(w.x - 2, w.y - 2, 4, 4);
      }
      for (const u of snap.defenderUnits ?? []) {
        const w = worldToMinimap(u.position.x, u.position.z, size, map);
        ctx.fillRect(w.x - 0.5, w.y - 0.5, 2, 2);
      }
    }
  }

  // camera viewport rect
  if (props.camera) {
    const tl = worldToMinimap(props.camera.x - props.camera.halfW, props.camera.z - props.camera.halfH, size, map);
    const br = worldToMinimap(props.camera.x + props.camera.halfW, props.camera.z + props.camera.halfH, size, map);
    ctx.strokeStyle = 'rgba(255,255,255,0.65)';
    ctx.lineWidth = 1;
    ctx.strokeRect(tl.x, tl.y, br.x - tl.x, br.y - tl.y);
  }

  // border
  ctx.strokeStyle = 'rgba(120,140,170,0.4)';
  ctx.lineWidth = 1;
  ctx.strokeRect(0.5, 0.5, size - 1, size - 1);
}

function onClick(e: MouseEvent): void {
  const canvas = canvasRef.value;
  if (!canvas) return;
  const rect = canvas.getBoundingClientRect();
  const px = (e.clientX - rect.left) / rect.width;
  const py = (e.clientY - rect.top) / rect.height;
  const map = props.map;
  const cs = map.grid.cellSize;
  const halfW = (map.grid.cols * cs) / 2;
  const halfH = (map.grid.rows * cs) / 2;
  emit('focus', px * map.grid.cols * cs - halfW, py * map.grid.rows * cs - halfH);
}

onMounted(() => {
  const loop = (): void => { draw(); rafId = requestAnimationFrame(loop); };
  rafId = requestAnimationFrame(loop);
  if (canvasRef.value) {
    canvasRef.value.addEventListener('click', onClick);
  }
});
onBeforeUnmount(() => {
  cancelAnimationFrame(rafId);
  if (canvasRef.value) canvasRef.value.removeEventListener('click', onClick);
});

watch(() => [props.snapshot, props.camera], () => { /* redraw via raf */ }, { deep: true });
</script>

<template>
  <canvas ref="canvasRef" class="minimap" :width="size ?? 160" :height="size ?? 160" />
</template>

<style scoped>
.minimap {
  position: absolute;
  right: 12px;
  bottom: 12px;
  width: 160px;
  height: 160px;
  border-radius: 4px;
  border: 1px solid rgba(120, 140, 170, 0.6);
  background: #0b0e14;
  cursor: crosshair;
  z-index: 8;
  pointer-events: auto;
  image-rendering: pixelated;
  image-rendering: crisp-edges;
}
</style>
