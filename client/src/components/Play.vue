<script setup>
import { ref, onMounted, onBeforeUnmount } from 'vue';
import { getMap } from '../services/api.js';
import { createEngine, createScene, drawPath, gridToWorld, addBuilding } from '../babylon/createScene.js';
import { createMob } from '../babylon/mobs.js';
import { findTarget, spawnProjectile } from '../babylon/combat.js';
import { createWavesController } from '../babylon/waves.js';
import { PointerEventTypes, Vector3 } from 'babylonjs';

const canvasRef = ref(null);
const engineRef = ref(null);
const babylonRef = ref(null);

const map = ref(null);
const gold = ref(10);
const baseHp = ref(20);
const speedMult = ref(1);
const running = ref(false);

// runtime state
let mobs = [];
let projectiles = [];
let towers = [];
let wavesCtrl = null;

function start() {
  if (wavesCtrl) wavesCtrl.start();
  running.value = true;
}
function pause() { running.value = false; if (wavesCtrl) wavesCtrl.pause(); }
function resume() { running.value = true; if (wavesCtrl) wavesCtrl.resume(); }
function setSpeed(mult) { speedMult.value = mult; }

async function init() {
  const data = await getMap();
  map.value = data;
  baseHp.value = data?.base?.hp || 20;
  const engine = createEngine(canvasRef.value);
  engineRef.value = engine;
  const { scene } = createScene(engine, data.grid);
  babylonRef.value = { scene };
  drawPath(scene, data.grid, data?.path?.waypoints || []);

  // Game loop
  let lastTime = performance.now();
  engine.runRenderLoop(() => {
    const now = performance.now();
    let delta = (now - lastTime) / 1000 * speedMult.value;
    lastTime = now;

    if (running.value) {
      // update waves -> spawn mobs
      if (wavesCtrl) wavesCtrl.update(delta);
      // update mobs
      for (let i = mobs.length - 1; i >= 0; i--) {
        const m = mobs[i];
        m.update(delta);
        if (m.reachedEnd()) {
          m.dispose(); mobs.splice(i, 1); baseHp.value -= 1;
        } else if (m.hp <= 0) {
          m.dispose(); mobs.splice(i, 1); gold.value += 1;
        }
      }
      // render/update towers fire
      for (const t of towers) {
        t.cooldown -= delta;
        if (t.cooldown <= 0) {
          const origin = t.mesh.position.clone();
          const target = findTarget(mobs, origin, t.rangeWorld);
          if (target) {
            t.cooldown = 1 / t.attackSpeed;
            const proj = spawnProjectile(scene, origin, target, t.projectileSpeed, (mob) => {
              mob.setHp(mob.hp - t.damage);
            });
            projectiles.push(proj);
          }
        }
      }
      for (let i = projectiles.length - 1; i >= 0; i--) {
        const p = projectiles[i];
        p.update(delta);
      }
    }
    scene.render();
  });

  // Waves controller & spawner
  wavesCtrl = createWavesController(babylonRef.value.scene, data.grid, data, (w) => {
    const mob = createMob(babylonRef.value.scene, data.grid, { hp: w.hp, speed: w.speed }, data?.path?.waypoints || []);
    mobs.push(mob);
  });

  // instantiate towers from buildings map
  towers = [];
  for (const b of data.towers) {
    const hasSize = b && b.size && Number.isFinite(Number(b.size.w)) && Number.isFinite(Number(b.size.h));
    const hasHeight = Number.isFinite(Number(b.height));
    // Build a mesh for visual only
    const vis = hasSize && hasHeight ? addBuilding(babylonRef.value.scene, data.grid, b) : null;
    // Tower stats baseline
    const attackSpeed = 1; // shots per second
    const damage = 2;
    const rangeCells = Math.max(1, Math.ceil(((b?.size?.w||1)+(b?.size?.h||1))/2 + 1));
    const projectileSpeed = 6;
    const rangeWorld = rangeCells * data.grid.cellSize;
    towers.push({ mesh: vis, cooldown: 0, attackSpeed, damage, rangeWorld, projectileSpeed });
  }
}

onMounted(() => init());
onBeforeUnmount(() => { if (engineRef.value) engineRef.value.dispose(); mobs.forEach(m=>m.dispose()); });
</script>

<template>
  <div style="display:flex; height:100%;">
    <div style="width:260px; padding:10px; border-right:1px solid #ddd; display:flex; flex-direction:column; gap:10px;">
      <div><strong>Play</strong></div>
      <div>Gold: {{ gold }}</div>
      <div>Base HP: {{ baseHp }}</div>
      <div style="display:flex; gap:6px;">
        <button @click="start">Start</button>
        <button @click="pause">Pause</button>
        <button @click="resume">Resume</button>
      </div>
      <div style="display:flex; gap:6px; align-items:center;">
        <span>Speed:</span>
        <button @click="setSpeed(1)">1x</button>
        <button @click="setSpeed(2)">2x</button>
        <button @click="setSpeed(4)">4x</button>
      </div>
    </div>
    <div style="flex:1; position:relative;">
      <canvas ref="canvasRef" style="width:100%; height:100%;"></canvas>
    </div>
  </div>
  <div v-if="!map?.path || (map.path.waypoints?.length||0) === 0" style="position:absolute; inset:0; display:flex; align-items:center; justify-content:center; pointer-events:none; font-size:18px; color:#b00;">
    Настройте путь в редакторе (режим Path)
  </div>
</template>

