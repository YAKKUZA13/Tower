<script setup lang="ts">
defineProps<{ name: string; size?: number }>();
</script>

<template>
  <svg class="rts-icon" :width="size ?? 18" :height="size ?? 18" viewBox="0 0 16 16" aria-hidden="true">
    <g v-if="name === 'wood'">
      <rect x="2" y="9" width="11" height="3"/><rect x="4" y="5" width="10" height="3"/><rect class="hi" x="11" y="6" width="2" height="1"/><rect class="hi" x="10" y="10" width="2" height="1"/>
    </g>
    <g v-else-if="name === 'stone'">
      <polygon points="2,11 4,6 8,4 12,6 14,11 11,13 4,13"/><rect class="hi" x="6" y="6" width="4" height="2"/>
    </g>
    <g v-else-if="name === 'ore'">
      <rect x="7" y="3" width="2" height="11" transform="rotate(-35 8 8)"/><rect class="hi" x="3" y="3" width="10" height="2" transform="rotate(18 8 4)"/>
    </g>
    <g v-else-if="name === 'gold'">
      <polygon points="8,1 13,5 11,13 5,13 3,5"/><rect class="hi" x="7" y="4" width="2" height="5"/>
    </g>
    <g v-else-if="name === 'worker'">
      <rect x="6" y="2" width="4" height="4"/><rect x="4" y="7" width="7" height="6"/><rect class="hi" x="11" y="4" width="2" height="9" transform="rotate(-25 12 8)"/>
    </g>
    <g v-else-if="name === 'knight'">
      <polygon points="3,3 9,2 12,5 11,12 7,14 3,11"/><rect class="hi" x="6" y="5" width="2" height="6"/><rect class="hi" x="4" y="7" width="6" height="2"/>
    </g>
    <g v-else-if="name === 'archer'">
      <path d="M4 2Q13 8 4 14" fill="none" stroke="currentColor" stroke-width="2"/><rect class="hi" x="7" y="3" width="1" height="11" transform="rotate(-42 8 8)"/>
    </g>
    <g v-else-if="name === 'mage' || name === 'spell'">
      <polygon points="8,1 10,5 14,7 10,9 8,15 6,9 2,7 6,5"/><rect class="hi" x="7" y="6" width="2" height="3"/>
    </g>
    <g v-else-if="name === 'mine'">
      <polygon points="2,13 3,7 8,3 13,7 14,13"/><rect class="cut" x="6" y="8" width="4" height="5"/>
    </g>
    <g v-else-if="name === 'barracks' || name === 'building'">
      <rect x="2" y="6" width="12" height="8"/><polygon points="1,6 8,2 15,6"/><rect class="cut" x="7" y="9" width="3" height="5"/>
    </g>
    <g v-else-if="name === 'tower'">
      <rect x="4" y="5" width="8" height="9"/><rect x="3" y="2" width="3" height="4"/><rect x="7" y="2" width="2" height="4"/><rect x="10" y="2" width="3" height="4"/>
    </g>
    <g v-else-if="name === 'home'">
      <polygon points="2,8 8,2 14,8 12,8 12,14 4,14 4,8"/><rect class="cut" x="7" y="10" width="3" height="4"/>
    </g>
    <g v-else-if="name === 'pause'"><rect x="3" y="2" width="4" height="12"/><rect x="9" y="2" width="4" height="12"/></g>
    <g v-else-if="name === 'back'"><polygon points="2,8 8,2 8,6 14,6 14,10 8,10 8,14"/></g>
    <g v-else><rect x="3" y="3" width="10" height="10"/><rect class="cut" x="6" y="6" width="4" height="4"/></g>
  </svg>
</template>

<style scoped>
.rts-icon { display: block; color: currentColor; shape-rendering: crispEdges; }
.rts-icon rect, .rts-icon polygon, .rts-icon path { fill: currentColor; }
.rts-icon path[fill='none'] { fill: none; }
.rts-icon .hi { fill: #d6c0a1; }
.rts-icon .cut { fill: #111217; }
</style>
