<script setup lang="ts">
import { ref } from 'vue';
import type { CommanderType, DefenderUnitType, ProductionBuildingType, ResourceBag, ResourceId, Spell } from '@tower/shared';
import { RESOURCE_ORDER } from '@tower/shared';
import RtsIcon from './RtsIcon.vue';

const props = defineProps<{
  buildings: ProductionBuildingType[];
  units: DefenderUnitType[];
  commander: CommanderType | null;
  activeMode: 'idle' | 'build' | 'train' | 'cast';
  selectedId: string | null;
  resources: Record<ResourceId, number>;
  gold: number;
  cooldowns: Record<string, number>;
}>();

const emit = defineEmits<{
  (e: 'select-building', typeId: string): void;
  (e: 'select-unit', typeId: string): void;
  (e: 'select-spell', spellId: string): void;
  (e: 'cancel'): void;
}>();

const tab = ref<'build' | 'units' | 'rites'>('build');

function canAfford(cost: ResourceBag): boolean {
  for (const key of RESOURCE_ORDER) {
    const value = cost[key] ?? 0;
    if (key === 'gold' ? props.gold < value : (props.resources[key] ?? 0) < value) return false;
  }
  return true;
}

function costEntries(cost: ResourceBag): Array<{ kind: ResourceId; value: number }> {
  return RESOURCE_ORDER.flatMap((kind) => cost[kind] ? [{ kind, value: cost[kind] ?? 0 }] : []);
}

function buildingIcon(id: string): string {
  if (id.includes('mine')) return 'mine';
  if (id.includes('barracks')) return 'barracks';
  if (id.includes('tower')) return 'tower';
  if (id.includes('town-hall')) return 'home';
  return 'building';
}

function unitIcon(id: string): string {
  return id.includes('worker') ? 'worker' : id.includes('archer') ? 'archer' : id.includes('mage') ? 'mage' : 'knight';
}

function spellReady(spell: Spell): boolean {
  return (props.cooldowns[spell.id] ?? 0) <= 0;
}
</script>

<template>
  <section class="command-book" aria-label="Командная книга">
    <header class="book-head">
      <div class="sigil"><RtsIcon name="home" :size="24" /></div>
      <div>
        <div class="eyebrow">Полевой приказ</div>
        <h2>Тёмная крепость</h2>
      </div>
    </header>

    <nav class="book-tabs" aria-label="Разделы команд">
      <button :class="{ active: tab === 'build' }" @click="tab = 'build'">Строить</button>
      <button :class="{ active: tab === 'units' }" @click="tab = 'units'">Отряд</button>
      <button :class="{ active: tab === 'rites' }" @click="tab = 'rites'">Ритуалы</button>
    </nav>

    <div v-if="tab === 'build'" class="command-grid">
      <button
        v-for="building in buildings"
        :key="building.id"
        class="command"
        :class="{ active: activeMode === 'build' && selectedId === building.id }"
        :disabled="!canAfford(building.cost)"
        @click="emit('select-building', building.id)"
      >
        <span class="command-icon"><RtsIcon :name="buildingIcon(building.id)" :size="25" /></span>
        <span class="command-copy">
          <strong>{{ building.name }}</strong>
          <span class="costs">
            <span v-for="entry in costEntries(building.cost)" :key="entry.kind">
              <RtsIcon :name="entry.kind" :size="11" />{{ entry.value }}
            </span>
          </span>
          <small>{{ building.output.length ? 'производство ресурсов' : building.input?.length ? 'переработка сырья' : 'опорное строение' }}</small>
        </span>
      </button>
    </div>

    <div v-else-if="tab === 'units'" class="command-grid">
      <button
        v-for="unit in units"
        :key="unit.id"
        class="command"
        :class="{ active: activeMode === 'train' && selectedId === unit.id }"
        :disabled="!canAfford(unit.cost)"
        @click="emit('select-unit', unit.id)"
      >
        <span class="command-icon"><RtsIcon :name="unitIcon(unit.id)" :size="25" /></span>
        <span class="command-copy">
          <strong>{{ unit.name }}</strong>
          <span class="costs">
            <span v-for="entry in costEntries(unit.cost)" :key="entry.kind"><RtsIcon :name="entry.kind" :size="11" />{{ entry.value }}</span>
          </span>
          <small>{{ unit.worker ? 'добыча и строительство' : `урон ${unit.damage} · дальность ${unit.range.toFixed(1)}` }}</small>
        </span>
      </button>
    </div>

    <div v-else class="command-grid rites">
      <button
        v-for="spell in commander?.spells ?? []"
        :key="spell.id"
        class="command ritual"
        :class="{ active: activeMode === 'cast' && selectedId === spell.id }"
        :disabled="!spellReady(spell)"
        @click="emit('select-spell', spell.id)"
      >
        <span class="command-icon"><RtsIcon name="spell" :size="25" /></span>
        <span class="command-copy">
          <strong>{{ spell.name }}</strong>
          <span class="ready">{{ spellReady(spell) ? 'ГОТОВО' : `${Math.ceil(cooldowns[spell.id] ?? 0)} С` }}</span>
          <small>{{ spell.description }}</small>
        </span>
      </button>
    </div>

    <button v-if="activeMode !== 'idle'" class="cancel" @click="emit('cancel')">Сбросить приказ · Esc</button>
  </section>
</template>

<style scoped>
.command-book {
  --paper: #c9b69b;
  --paper-dim: #8e7b68;
  --frame: #6f594f;
  --frame-hi: #a98a73;
  --coal: #111217;
  --panel: #18191e;
  --ember: #c95842;
  --soul: #80c9a1;
  padding: 13px 12px 15px;
  color: var(--paper);
  font-family: Georgia, 'Times New Roman', serif;
}
.book-head { display: flex; align-items: center; gap: 10px; padding: 3px 2px 12px; border-bottom: 1px solid #4a3e39; }
.sigil { width: 38px; height: 38px; display: grid; place-items: center; color: var(--paper); border: 1px solid var(--frame); box-shadow: inset 0 0 0 2px #0b0c10; }
.eyebrow { color: var(--paper-dim); font: 10px/1.2 'Lucida Console', monospace; letter-spacing: .14em; text-transform: uppercase; }
h2 { margin: 2px 0 0; color: #dfceb5; font: 700 20px/1 Georgia, serif; letter-spacing: .035em; text-shadow: 2px 2px 0 #090a0d; }
.book-tabs { display: grid; grid-template-columns: repeat(3, 1fr); margin: 9px 0 10px; border: 1px solid #493c37; }
.book-tabs button { height: 36px; border: 0; border-right: 1px solid #493c37; background: #111217; color: #74665b; font: 10px 'Lucida Console', monospace; text-transform: uppercase; cursor: pointer; }
.book-tabs button:last-child { border-right: 0; }
.book-tabs button.active { color: #e0cdb2; background: #292326; box-shadow: inset 0 -2px var(--ember); }
.command-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 5px; }
.command-grid.rites { grid-template-columns: 1fr; }
.command { min-height: 82px; display: grid; grid-template-columns: 39px 1fr; gap: 9px; align-items: start; padding: 9px; text-align: left; color: var(--paper); background: #17181d; border: 1px solid #4e403a; box-shadow: inset 1px 1px #2a2729, inset -1px -1px #090a0d; cursor: pointer; }
.command:hover:not(:disabled) { color: #f0dcc0; border-color: var(--frame-hi); background: #201d20; }
.command.active { border-color: var(--soul); box-shadow: inset 0 0 0 1px #243f35, 0 0 10px rgba(128, 201, 161, .12); }
.command:disabled { opacity: .32; cursor: not-allowed; filter: grayscale(.65); }
.command-icon { width: 37px; height: 37px; display: grid; place-items: center; color: #b99d80; background: #0d0e12; border: 1px solid #5b4940; box-shadow: inset 0 0 0 2px #18171a; }
.command.active .command-icon { color: var(--soul); }
.command-copy { display: flex; min-width: 0; flex-direction: column; gap: 3px; }
.command strong { color: inherit; font: 700 12px/1.2 'Lucida Console', monospace; }
.command small { color: #95877a; font: 11px/1.32 Georgia, serif; }
.costs { display: flex; flex-wrap: wrap; gap: 4px 6px; color: #c69a62; font: 10px 'Lucida Console', monospace; }
.costs span { display: inline-flex; gap: 2px; align-items: center; }
.ready { color: var(--soul); font: 10px 'Lucida Console', monospace; }
.ritual { min-height: 68px; }
.cancel { width: 100%; margin-top: 8px; height: 36px; border: 1px solid #704a43; color: #c98c7e; background: #1d1517; font: 10px 'Lucida Console', monospace; text-transform: uppercase; cursor: pointer; }
.cancel:hover { border-color: var(--ember); color: #efb2a4; }
@media (max-width: 1100px) { .command-grid { grid-template-columns: 1fr; } }
</style>
