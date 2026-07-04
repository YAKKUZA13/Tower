<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { listAssets, uploadAsset, deleteAsset, type AssetRecord } from '../services/api';

const MAX_FILE_SIZE = 10 * 1024 * 1024;

const props = defineProps<{
  selectedAssetId?: string | null;
}>();
const emit = defineEmits<{
  assetSelected: [asset: AssetRecord];
}>();

const assets = ref<AssetRecord[]>([]);
const status = ref('');
const uploading = ref(false);
const isDragging = ref(false);
const fileInputRef = ref<HTMLInputElement | null>(null);

async function refresh() {
  try {
    assets.value = await listAssets();
  } catch (e) {
    status.value = 'Failed to load assets';
  }
}

async function handleFile(event: Event) {
  const target = event.target as HTMLInputElement;
  const file = target.files?.[0];
  await uploadFile(file);
  target.value = '';
}

async function handleDrop(event: DragEvent) {
  isDragging.value = false;
  const file = event.dataTransfer?.files?.[0];
  await uploadFile(file);
}

async function uploadFile(file?: File) {
  if (!file) return;
  if (file.size > MAX_FILE_SIZE) {
    status.value = 'Файл больше 10 MB';
    setTimeout(() => (status.value = ''), 1800);
    return;
  }

  uploading.value = true;
  status.value = 'Загружаю...';
  try {
    const base64 = await toBase64(file);
    await uploadAsset({ name: file.name, dataBase64: base64, mime: file.type });
    status.value = 'Загружено';
    await refresh();
  } catch (e) {
    console.error(e);
    status.value = 'Не удалось загрузить';
  } finally {
    uploading.value = false;
    setTimeout(() => (status.value = ''), 1200);
  }
}

function toBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result;
      if (typeof result === 'string') {
        const commaIdx = result.indexOf(',');
        resolve(commaIdx >= 0 ? result.slice(commaIdx + 1) : result);
      } else {
        reject(new Error('invalid file data'));
      }
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

async function removeAsset(id: string) {
  try {
    await deleteAsset(id);
    await refresh();
  } catch (e) {
    status.value = 'Не удалось удалить';
  }
}

function openFilePicker() {
  if (!uploading.value) fileInputRef.value?.click();
}

function selectAsset(asset: AssetRecord) {
  emit('assetSelected', asset);
}

function formatAssetSize(bytes: number) {
  const size = Number(bytes) || 0;
  if (size >= 1024 * 1024) return `${(size / 1024 / 1024).toFixed(1)} MB`;
  return `${(size / 1024).toFixed(1)} KB`;
}

onMounted(() => refresh());
</script>

<template>
  <div class="asset-manager">
    <button
      type="button"
      class="upload-dropzone"
      :class="{ dragging: isDragging, uploading }"
      :disabled="uploading"
      @click="openFilePicker"
      @dragover.prevent="isDragging = true"
      @dragleave.prevent="isDragging = false"
      @drop.prevent="handleDrop"
    >
      <input
        ref="fileInputRef"
        class="file-input"
        type="file"
        accept=".glb,.gltf,.obj,image/*"
        :disabled="uploading"
        @change="handleFile"
      />
      <span class="upload-icon">+</span>
      <span class="upload-title">{{ uploading ? 'Загрузка ассета...' : 'Загрузить ассет' }}</span>
      <span class="upload-help">GLB, GLTF, OBJ или текстуры до 10 MB</span>
    </button>

    <div v-if="status" class="status" :class="{ error: status.includes('Не') || status.includes('больше') }">
      {{ status }}
    </div>

    <div v-if="assets.length === 0" class="empty-state">
      Нет ассетов. Перетащите файл сюда или нажмите на область загрузки.
    </div>

    <div v-else class="asset-list">
      <button
        v-for="a in assets"
        :key="a.id"
        type="button"
        class="asset-item"
        :class="{ selected: props.selectedAssetId === a.id }"
        @click="selectAsset(a)"
      >
        <div class="asset-preview">
          {{ a.name?.split('.').pop()?.slice(0, 3)?.toUpperCase() || '3D' }}
        </div>
        <div class="asset-info">
          <div class="asset-name" :title="a.name">{{ a.name }}</div>
          <div class="asset-meta">{{ formatAssetSize(a.size) }} · {{ a.mime || 'тип не задан' }}</div>
        </div>
        <button type="button" class="delete-button" @click.stop="removeAsset(a.id)">Удалить</button>
      </button>
    </div>
  </div>
</template>

<style scoped>
.asset-manager {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.upload-dropzone {
  width: 100%;
  border: 1px dashed rgba(96, 165, 250, 0.55);
  border-radius: 14px;
  padding: 18px 14px;
  background:
    linear-gradient(135deg, rgba(59, 130, 246, 0.16), rgba(14, 165, 233, 0.07)),
    rgba(255, 255, 255, 0.03);
  color: #e5e7eb;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 7px;
  text-align: center;
  transition: border-color 0.15s ease, background-color 0.15s ease, transform 0.12s ease;
}

.upload-dropzone:hover,
.upload-dropzone.dragging {
  border-color: #93c5fd;
  background-color: rgba(59, 130, 246, 0.12);
  transform: translateY(-1px);
}

.upload-dropzone.uploading {
  opacity: 0.7;
  cursor: wait;
}

.file-input {
  display: none;
}

.upload-icon {
  width: 34px;
  height: 34px;
  border-radius: 50%;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background: rgba(59, 130, 246, 0.22);
  color: #bfdbfe;
  font-size: 24px;
  line-height: 1;
}

.upload-title {
  font-weight: 700;
  color: #f8fafc;
}

.upload-help {
  max-width: 190px;
  color: #94a3b8;
  font-size: 12px;
  line-height: 1.35;
}

.status {
  border-radius: 10px;
  padding: 8px 10px;
  background: rgba(34, 197, 94, 0.12);
  color: #86efac;
  font-size: 12px;
}

.status.error {
  background: rgba(239, 68, 68, 0.12);
  color: #fca5a5;
}

.empty-state {
  border-radius: 12px;
  padding: 12px;
  background: rgba(255, 255, 255, 0.035);
  color: #94a3b8;
  font-size: 13px;
  line-height: 1.4;
}

.asset-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
  max-height: 280px;
  overflow: auto;
  padding-right: 2px;
}

.asset-item {
  display: grid;
  grid-template-columns: 38px minmax(0, 1fr);
  gap: 10px;
  align-items: center;
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 12px;
  padding: 9px;
  background: rgba(255, 255, 255, 0.04);
  color: inherit;
  cursor: pointer;
  text-align: left;
  width: 100%;
}

.asset-item.selected {
  border-color: rgba(96, 165, 250, 0.75);
  background: rgba(59, 130, 246, 0.16);
}

.asset-preview {
  width: 38px;
  height: 38px;
  border-radius: 10px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(15, 23, 42, 0.65);
  border: 1px solid rgba(148, 163, 184, 0.18);
  color: #bfdbfe;
  font-size: 11px;
  font-weight: 800;
}

.asset-info {
  min-width: 0;
}

.asset-name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: #e5e7eb;
  font-weight: 650;
}

.asset-meta {
  margin-top: 3px;
  color: #94a3b8;
  font-size: 12px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.delete-button {
  grid-column: 1 / -1;
  border: 1px solid rgba(248, 113, 113, 0.28);
  border-radius: 9px;
  padding: 6px 8px;
  background: rgba(239, 68, 68, 0.08);
  color: #fecaca;
  font-weight: 650;
}

.delete-button:hover {
  background: rgba(239, 68, 68, 0.16);
}
</style>

