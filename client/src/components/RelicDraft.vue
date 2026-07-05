<script setup lang="ts">
import type { PlacedRelic, RelicRarity, RelicType } from '@tower/shared';

const props = defineProps<{
  /** TypeId реликвий, предложенных в драфте (3 шт). */
  choices: string[];
  /** Полный каталог реликвий (для резолва typeId → описание). */
  relicCatalog: RelicType[];
  /** Уже размещённые реликвии (для списка удаления/пересмотра). */
  placedRelics: PlacedRelic[];
}>();

const emit = defineEmits<{
  (e: 'pick', relicTypeId: string): void;
  (e: 'skip'): void;
  (e: 'remove', relicId: string): void;
}>();

const RARITY_LABEL: Record<RelicRarity, string> = {
  common: 'Обычная',
  rare: 'Редкая',
  epic: 'Эпическая'
};

function relicById(id: string): RelicType | undefined {
  return props.relicCatalog.find((r) => r.id === id);
}

function placedInfo(p: PlacedRelic): RelicType | undefined {
  return relicById(p.typeId);
}
</script>

<template>
  <div class="relic-draft">
    <div class="draft-card">
      <div class="draft-title">Драфт реликвий</div>
      <p class="draft-sub">Волна зачищена. Выберите тотем и разместите его в лабиринте — эффект применится к подходящим башням/стенам/экономике.</p>

      <div class="choices">
        <button
          v-for="id in choices"
          :key="id"
          class="choice"
          :class="relicById(id)?.rarity"
          @click="emit('pick', id)"
        >
          <div class="choice-head">
            <span class="choice-name">{{ relicById(id)?.name ?? id }}</span>
            <span class="choice-rarity" :class="relicById(id)?.rarity">{{ RARITY_LABEL[relicById(id)?.rarity ?? 'common'] }}</span>
          </div>
          <p class="choice-desc">{{ relicById(id)?.description }}</p>
          <span class="choice-hint">Выбрать и разместить →</span>
        </button>
        <div v-if="choices.length === 0" class="empty">Реликвий не осталось.</div>
      </div>

      <div v-if="placedRelics.length > 0" class="placed">
        <div class="placed-title">Размещённые реликвии (можно снять)</div>
        <ul>
          <li v-for="p in placedRelics" :key="p.id">
            <span class="placed-name">{{ placedInfo(p)?.name ?? p.typeId }}</span>
            <span class="placed-rarity" :class="placedInfo(p)?.rarity">{{ RARITY_LABEL[placedInfo(p)?.rarity ?? 'common'] }}</span>
            <button class="remove-btn" @click="emit('remove', p.id)">Снять</button>
          </li>
        </ul>
      </div>

      <button class="skip-btn" @click="emit('skip')">Пропустить (без реликвии)</button>
    </div>
  </div>
</template>

<style scoped>
.relic-draft {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(2, 6, 23, 0.82);
  z-index: 5;
}
.draft-card {
  background: #0f172a;
  border: 1px solid rgba(139, 92, 246, 0.35);
  border-radius: 16px;
  padding: 20px 22px;
  width: min(680px, 92vw);
  max-height: 88vh;
  overflow: auto;
  display: flex;
  flex-direction: column;
  gap: 14px;
  color: #e5e7eb;
}
.draft-title {
  font-size: 22px;
  font-weight: 800;
  color: #c4b5fd;
}
.draft-sub {
  color: #94a3b8;
  font-size: 13px;
  line-height: 1.45;
  margin: 0;
}
.choices {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
  gap: 10px;
}
.choice {
  text-align: left;
  border: 1px solid rgba(148, 163, 184, 0.22);
  border-radius: 12px;
  background: rgba(255, 255, 255, 0.04);
  color: #e5e7eb;
  padding: 12px;
  cursor: pointer;
  display: flex;
  flex-direction: column;
  gap: 8px;
  transition: border-color 0.12s, background 0.12s;
}
.choice:hover {
  background: rgba(139, 92, 246, 0.14);
  border-color: rgba(139, 92, 246, 0.6);
}
.choice.common { box-shadow: inset 3px 0 0 #83a580; }
.choice.rare { box-shadow: inset 3px 0 0 #3b82f6; }
.choice.epic { box-shadow: inset 3px 0 0 #a855f7; }
.choice-head {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  gap: 8px;
}
.choice-name { font-weight: 800; font-size: 15px; }
.choice-rarity {
  font-size: 10px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  padding: 2px 6px;
  border-radius: 6px;
}
.choice-rarity.common { color: #a3b8a0; background: rgba(131, 165, 128, 0.18); }
.choice-rarity.rare { color: #93c5fd; background: rgba(59, 130, 246, 0.18); }
.choice-rarity.epic { color: #d8b4fe; background: rgba(168, 85, 247, 0.18); }
.choice-desc {
  color: #cbd5e1;
  font-size: 12px;
  line-height: 1.4;
  margin: 0;
}
.choice-hint {
  color: #c4b5fd;
  font-size: 11px;
  font-weight: 700;
}
.empty {
  color: #64748b;
  font-size: 13px;
  grid-column: 1 / -1;
  text-align: center;
  padding: 16px;
}
.placed {
  border-top: 1px solid rgba(255, 255, 255, 0.08);
  padding-top: 10px;
}
.placed-title {
  font-weight: 700;
  color: #cbd5e1;
  font-size: 12px;
  margin-bottom: 6px;
}
.placed ul {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.placed li {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
}
.placed-name { color: #e5e7eb; flex: 1; }
.placed-rarity {
  font-size: 10px;
  padding: 1px 5px;
  border-radius: 5px;
}
.placed-rarity.common { color: #a3b8a0; background: rgba(131, 165, 128, 0.18); }
.placed-rarity.rare { color: #93c5fd; background: rgba(59, 130, 246, 0.18); }
.placed-rarity.epic { color: #d8b4fe; background: rgba(168, 85, 247, 0.18); }
.remove-btn {
  border: 1px solid rgba(239, 68, 68, 0.45);
  background: rgba(239, 68, 68, 0.12);
  color: #fca5a5;
  border-radius: 6px;
  padding: 3px 8px;
  font-size: 11px;
  cursor: pointer;
}
.remove-btn:hover { background: rgba(239, 68, 68, 0.28); }
.skip-btn {
  margin-top: 4px;
  border: 1px solid rgba(148, 163, 184, 0.3);
  background: rgba(255, 255, 255, 0.05);
  color: #cbd5e1;
  border-radius: 10px;
  padding: 10px;
  font-weight: 700;
  cursor: pointer;
}
.skip-btn:hover { background: rgba(255, 255, 255, 0.1); }
</style>
