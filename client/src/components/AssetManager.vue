<script setup>
import { ref, onMounted } from 'vue';
import { listAssets, uploadAsset, deleteAsset } from '../services/api.js';

const assets = ref([]);
const status = ref('');
const uploading = ref(false);

async function refresh() {
  try {
    assets.value = await listAssets();
  } catch (e) {
    status.value = 'Failed to load assets';
  }
}

async function handleFile(event) {
  const file = event.target.files?.[0];
  if (!file) return;
  uploading.value = true;
  status.value = 'Uploading...';
  try {
    const base64 = await toBase64(file);
    await uploadAsset({ name: file.name, dataBase64: base64, mime: file.type });
    status.value = 'Uploaded';
    await refresh();
  } catch (e) {
    console.error(e);
    status.value = 'Upload failed';
  } finally {
    uploading.value = false;
    setTimeout(() => (status.value = ''), 1200);
    event.target.value = '';
  }
}

function toBase64(file) {
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

async function removeAsset(id) {
  try {
    await deleteAsset(id);
    await refresh();
  } catch (e) {
    status.value = 'Delete failed';
  }
}

onMounted(() => refresh());
</script>

<template>
  <div style="display:flex; flex-direction:column; gap:10px;">
    <div style="display:flex; gap:8px; align-items:center;">
      <input type="file" @change="handleFile" :disabled="uploading" />
      <span style="color:#555;">Max 10MB, GLB/GLTF/OBJ/textures</span>
    </div>
    <div style="color:#0a0;">{{ status }}</div>
    <div v-if="assets.length === 0" style="color:#666;">Нет ассетов</div>
    <div v-else style="display:flex; flex-direction:column; gap:6px; max-height:260px; overflow:auto;">
      <div v-for="a in assets" :key="a.id" style="border:1px solid #ddd; padding:8px; border-radius:6px; display:flex; justify-content:space-between; align-items:center;">
        <div>
          <div style="font-weight:600;">{{ a.name }}</div>
          <div style="font-size:12px; color:#555;">{{ (a.size/1024).toFixed(1) }} KB • {{ a.mime }}</div>
        </div>
        <button @click="removeAsset(a.id)">Delete</button>
      </div>
    </div>
  </div>
</template>

