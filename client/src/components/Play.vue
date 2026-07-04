<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue';
import type { Engine, Scene } from 'babylonjs';
import { getMap } from '../services/api';
import type { MapDocument } from '../domain/map';
import { createEngine, createScene } from '../babylon/createScene';
import { addPlacedObject } from '../babylon/object-renderer';
import { pickSceneObject } from '../babylon/picking';

const canvasRef = ref<HTMLCanvasElement | null>(null);
const engineRef = ref<Engine | null>(null);
const sceneRef = ref<Scene | null>(null);
const map = ref<MapDocument | null>(null);
const selectedObjectId = ref<string | null>(null);
const status = ref('Загрузка карты...');

function renderObjects(scene: Scene, data: MapDocument): void {
  for (const obj of data.objects || []) {
    addPlacedObject(scene, obj, data.heightmap, data.grid);
  }
}

async function init(): Promise<void> {
  try {
    const data = await getMap();
    map.value = data;
    if (!canvasRef.value) return;
    const engine = createEngine(canvasRef.value);
    engineRef.value = engine;
    const { scene } = createScene(engine, data.grid, data.heightmap, { editor: false });
    sceneRef.value = scene;
    renderObjects(scene, data);
    scene.onPointerDown = () => {
      selectedObjectId.value = pickSceneObject(scene)?.objectId || null;
    };
    engine.runRenderLoop(() => scene.render());
    status.value = '';
  } catch (error) {
    console.error(error);
    status.value = 'Не удалось загрузить карту';
  }
}

onMounted(() => init());
onBeforeUnmount(() => engineRef.value?.dispose());
</script>

<template>
  <div class="play-layout">
    <aside class="play-sidebar">
      <div class="panel-title">Карта поля боя</div>
      <div class="stat-line">Объектов: {{ map?.objects?.length || 0 }}</div>
      <div class="stat-line">Выбрано: {{ selectedObjectId || 'нет объекта' }}</div>
      <p class="hint">
        Это итоговая карта для сессии. Вращайте камеру мышью, приближайте колесом и выбирайте объекты кликом.
      </p>
    </aside>
    <div class="play-stage">
      <canvas ref="canvasRef" class="play-canvas"></canvas>
      <div v-if="status" class="play-alert">{{ status }}</div>
    </div>
  </div>
</template>

<style scoped>
.play-layout {
  display: flex;
  height: 100%;
  background: #0b1021;
  color: #e5e7eb;
}
.play-sidebar {
  width: 280px;
  padding: 14px;
  border-right: 1px solid rgba(255, 255, 255, 0.08);
  background: rgba(15, 23, 42, 0.92);
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.panel-title {
  font-weight: 800;
  color: #f8fafc;
}
.stat-line {
  padding: 8px 10px;
  border-radius: 10px;
  background: rgba(255, 255, 255, 0.06);
  color: #cbd5e1;
  font-size: 14px;
}
.hint {
  color: #94a3b8;
  font-size: 13px;
  line-height: 1.45;
}
.play-stage {
  flex: 1;
  position: relative;
  min-width: 0;
}
.play-canvas {
  display: block;
  width: 100%;
  height: 100%;
}
.play-alert {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  pointer-events: none;
  color: #fca5a5;
  text-align: center;
  padding: 12px;
}
@media (max-width: 960px) {
  .play-layout {
    flex-direction: column;
  }
  .play-sidebar {
    width: auto;
    border-right: none;
    border-bottom: 1px solid rgba(255, 255, 255, 0.08);
  }
}
</style>
