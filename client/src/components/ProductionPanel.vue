<script setup lang="ts">
import type { CommanderType, DefenderUnitType, ProductionBuildingType, ResourceBag, ResourceId, Spell } from '@tower/shared';
import { RESOURCE_ORDER } from '@tower/shared';

const props = defineProps<{
  buildings: ProductionBuildingType[];
  units: DefenderUnitType[];
  commander: CommanderType | null;
  /** Текущий выбор режима: 'idle' | 'build' | 'train' | 'cast'. */
  activeMode: 'idle' | 'build' | 'train' | 'cast';
  /** TypeId выбранного здания/юнита для строительства/обучения, либо spellId. */
  selectedId: string | null;
  /** Текущий запас ресурсов (wood/stone/ore; gold — в props.gold). */
  resources: Record<ResourceId, number>;
  /** Текущее золото. */
  gold: number;
  /** Кулдауны заклинаний: spellId → сек до готовности. */
  cooldowns: Record<string, number>;
}>();

const emit = defineEmits<{
  (e: 'select-building', typeId: string): void;
  (e: 'select-unit', typeId: string): void;
  (e: 'select-spell', spellId: string): void;
  (e: 'cancel'): void;
}>();

function costLabel(cost: ResourceBag): string {
  const parts: string[] = [];
  for (const key of RESOURCE_ORDER) {
    const val = cost[key];
    if (val) {
      const icon = key === 'wood' ? '🪵' : key === 'stone' ? '🪨' : key === 'ore' ? '⛏' : '💰';
      parts.push(`${icon}${val}`);
    }
  }
  return parts.join('  ') || '—';
}

function canAfford(cost: ResourceBag): boolean {
  for (const key of RESOURCE_ORDER) {
    const val = cost[key] ?? 0;
    if (key === 'gold') {
      if (props.gold < val) return false;
    } else {
      if ((props.resources[key] ?? 0) < val) return false;
    }
  }
  return true;
}

function spellReady(spell: Spell): boolean {
  return (props.cooldowns[spell.id] ?? 0) <= 0;
}

function spellCooldownLabel(spell: Spell): string {
  const cd = props.cooldowns[spell.id] ?? 0;
  return cd > 0 ? `${Math.ceil(cd)}с` : 'Готово';
}

function selectBuilding(typeId: string): void {
  emit('select-building', typeId);
}
function selectUnit(typeId: string): void {
  emit('select-unit', typeId);
}
function selectSpell(spellId: string): void {
  emit('select-spell', spellId);
}
</script>

<template>
  <div class="rts-panel">
    <div class="info-title">Тёмная крепость</div>

    <!-- Ресурсы -->
    <div class="res-bar">
      <span class="res" title="Дерево">🪵 {{ Math.floor(resources.wood) }}</span>
      <span class="res" title="Камень">🪨 {{ Math.floor(resources.stone) }}</span>
      <span class="res" title="Руда">⛏ {{ Math.floor(resources.ore) }}</span>
      <span class="res gold" title="Золото">💰 {{ gold }}</span>
    </div>

    <!-- Производственные здания -->
    <div class="section-title">Здания</div>
    <div class="grid">
      <button
        v-for="b in buildings"
        :key="b.id"
        class="card"
        :class="{ active: activeMode === 'build' && selectedId === b.id, disabled: !canAfford(b.cost) }"
        :disabled="!canAfford(b.cost)"
        @click="selectBuilding(b.id)"
      >
        <div class="card-name">{{ b.name }}</div>
        <div class="card-cost">{{ costLabel(b.cost) }}</div>
        <div class="card-meta">
          <template v-if="b.output.length">
            <span v-for="o in b.output" :key="o.resource" class="out">
              +{{ o.perSec.toFixed(1) }}/с {{ o.resource === 'wood' ? '🪵' : o.resource === 'stone' ? '🪨' : o.resource === 'ore' ? '⛏' : '💰' }}
            </span>
          </template>
          <template v-else-if="b.input && b.input.length">
            <span class="in">переработка</span>
          </template>
          <template v-else>
            <span class="in">функциональное</span>
          </template>
        </div>
      </button>
    </div>

    <!-- Защитные юниты -->
    <div class="section-title">Юниты</div>
    <div class="grid">
      <button
        v-for="u in units"
        :key="u.id"
        class="card"
        :class="{ active: activeMode === 'train' && selectedId === u.id, disabled: !canAfford(u.cost) }"
        :disabled="!canAfford(u.cost)"
        @click="selectUnit(u.id)"
      >
        <div class="card-name">{{ u.name }}</div>
        <div class="card-cost">{{ costLabel(u.cost) }}</div>
        <div class="card-meta">HP {{ u.hp }} · урон {{ u.damage }} · радиус {{ u.range.toFixed(1) }}</div>
      </button>
    </div>

    <!-- Заклинания командира -->
    <div v-if="commander" class="section-title">Заклинания: {{ commander.name }}</div>
    <div v-if="commander" class="grid spells">
      <button
        v-for="s in commander.spells"
        :key="s.id"
        class="card spell"
        :class="{ active: activeMode === 'cast' && selectedId === s.id, disabled: !spellReady(s) }"
        :disabled="!spellReady(s)"
        @click="selectSpell(s.id)"
      >
        <div class="card-name">{{ s.name }}</div>
        <div class="card-cost" :class="{ ready: spellReady(s) }">{{ spellCooldownLabel(s) }}</div>
        <div class="card-meta" :title="s.description">{{ s.description }}</div>
      </button>
    </div>

    <button v-if="activeMode !== 'idle'" class="btn ghost cancel" @click="emit('cancel')">Отмена</button>
  </div>
</template>

<style scoped>
.rts-panel {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 12px;
  border-top: 1px solid rgba(255, 255, 255, 0.08);
}
.info-title {
  font-weight: 800;
  color: #f8fafc;
}
.res-bar {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
  padding: 6px 8px;
  background: rgba(0, 0, 0, 0.3);
  border-radius: 8px;
  font-size: 12px;
}
.res { color: #cbd5e1; font-weight: 700; }
.res.gold { color: #fbbf24; }
.section-title {
  font-size: 11px;
  color: #94a3b8;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  margin-top: 4px;
}
.grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 6px;
}
.grid.spells {
  grid-template-columns: 1fr;
}
.card {
  text-align: left;
  border: 1px solid rgba(168, 85, 247, 0.25);
  border-radius: 10px;
  background: rgba(168, 85, 247, 0.08);
  color: #e5e7eb;
  padding: 8px;
  cursor: pointer;
}
.card.active {
  border-color: #a855f7;
  background: rgba(168, 85, 247, 0.25);
}
.card.disabled {
  opacity: 0.4;
  cursor: not-allowed;
}
.card.spell {
  border-color: rgba(245, 158, 11, 0.3);
  background: rgba(245, 158, 11, 0.08);
}
.card.spell.active {
  border-color: #f59e0b;
  background: rgba(245, 158, 11, 0.22);
}
.card-name { font-weight: 800; font-size: 13px; }
.card-cost {
  margin-top: 2px;
  color: #fbbf24;
  font-weight: 700;
  font-size: 11px;
}
.card-cost.ready { color: #22c55e; }
.card-meta {
  margin-top: 4px;
  color: #94a3b8;
  font-size: 11px;
  line-height: 1.35;
}
.out { color: #86efac; margin-right: 6px; }
.in { color: #fbbf24; }
.btn.ghost.cancel {
  flex: 1;
  background: rgba(255, 255, 255, 0.06);
  color: #cbd5e1;
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 8px;
  padding: 8px 12px;
  margin-top: 4px;
}
</style>
