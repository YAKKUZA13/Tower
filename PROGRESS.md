# M8-PLAN Implementation Progress

## ✅ Completed

### M8-fix — RTS terrain + missing RTS assets (render-breakage fix)
**Problem:** после имплементации M8 (и заимствования из Magnum-Opus) RTS-сцена ломалась:
(а) карта выглядела как «доска в космосе» — плоская плита + тёмная бездна под ней +
крепостной бордюр (зубцы/руны/черепа); (б) юниты на сцене не рисовались / висели криво,
хотя на минимапе были; (в) построенные здания не были видны.

**Root causes:**
1. `createScene` — TD-only: игнорировал `heightmap` (параметр `_heightmap`), рисуя
   плоский пол на y=0, тогда как все рендереры ставят объекты на `sampleHeight(...)`
   (1.0..2.0 на RTS-картах с rolling-heightmap) → объекты парили на 1–2 единицы над
   видимой плитой. На минимапе видны (читают col/row из сима, не world-Y).
2. `RtsGame.vue` использовал TD `createScene` (board + fortress border).
3. У `unit:worker` НЕ было rigged-дефа / voxel-билдера / glTF → `resolveUnitDef`
   возвращал пустой риг без мешей → workers полностью невидимы.
4. У `building:town-hall` / `town-hall-l2` / `watch-tower` НЕ было voxel-билдеров →
   `AssetCatalog.buildMaster` падал в fallback-бокс 0.4 → крошечный куб вместо базы.

**Fixes:**
- **NEW `client/src/babylon/terrain/rts-terrain.ts`** — `createRtsGround()`: сплошной
  RTS-террейн (один Mesh). Вершины в центрах клеток со смещением Y по heightmap →
  ВЕРХ поверхности в клетке = `sampleHeight` в точности (юниты/здания/ресурсы стоят
  на террейне, не парят). Per-quad vertex-colors из tiles-матрицы (grass/dirt/water/
  rock/sand) + детерминированный jitter. Apron (18 колец за периметром) плавно сходит
  к fog-цвету → нет «края доски», террейн уходит в туман как в StarCraft/AoE.
  Контракт сохранён: name='ground', isPickable=true, receiveShadows=true.
- **`createScene.ts`** — добавлена `createRtsScene()` (без board/border/underlay,
  использует `createRtsGround`). TD `createScene` не тронут (back-compat для co-op).
- **`RtsGame.vue`** — переключён на `createRtsScene`, `TileRenderer` убран (цвета
  тайлов теперь в террейне), camera target.y = `sampleHeight(focusCell)` (камера
  смотрит «в уровень земли», не на плоскость y=0).
- **`voxel-builder.ts`** — добавлены `townHallBuilding` / `townHallL2Building` /
  `watchTowerBuilding` + статичный `workerUnit` (fallback); все зарегистрированы в
  `VOXEL_BUILDERS` + emissive-акценты.
- **`voxel/importers/unit-rigs.ts`** — добавлен `workerRigged` (гуманоид 11-партного
  рига с киркой в forearmR, animKind='humanoid' → общий walk-cycle); зарегистрирован
  как `'unit:worker'`.

**Smoke:** `scripts/smoke-rts-terrain.ts` (NEW) — NullEngine: структура ground-меша,
exact-match vertex Y == heightmap, `createRtsScene` не создаёт board-border/
decorations/underlay, новые билдеры возвращают 80+/100+ вокселей, `workerRigged`
валиден (11/11 joints). **ALL PASSED.** Существующие smokes (rts-solo/rts-m8/
pixel-art/voxel-rig) — regression-safe.

### M8.RTS-solo — RTS solo mode on canonical RTS maps (NEW)
End-to-end RTS solo gameplay on the large RTS maps (rts-2p-crossroads / 3p-trident / 4p-quadrants) with a proper free-pan/zoom/rotate RTS camera — **not** the rotating TD-camera stub.

**Shared (catalog + maps + types):**
- `shared/src/catalogs/default.ts` — merged `buildRtsCatalogExtension()` into DEFAULT_CATALOG: town-hall / town-hall-l2 / rts-barracks / rts-watch-tower / worker / 8 upgrades now ship in the default catalog (previously exported but unused).
- `shared/src/maps/rts-maps.ts` — all 3 RTS maps now carry `rts: { enabled, commanderTypeId, startingResources }`. The previous gap (RTS maps had `gameMode='rts'` but no `rts.enabled`) is closed.
- `shared/src/types/td.ts` — added `Enemy.stationary?: boolean` for the AI town-hall target (skips tickMovement, still attackable).

**Sim (`client/src/sim/game-sim.ts`):**
- `rtsEnabled` now triggers from `map.rts?.enabled || map.gameMode === 'rts'` (canonical RTS maps activate RTS mode without needing both flags).
- `rtsSolo` flag = `gameMode === 'rts' && playerStarts.length >= 2`.
- `initRtsState` reads `map.playerStarts` when `rtsSolo`:
  - Player (slot 0): town-hall placed at `playerStarts[0].townHall`; workers spawned at `playerStarts[0].workers` with **auto-gather** assigned to the nearest wood/stone node.
  - AI (slot 1+): each start spawns a stationary `boss`-Enemy (the AI town-hall = win target).
  - `tdSpawn` = AI start (slot 1), `tdBase` = player town-hall — so AI attack waves pathfind from the AI base to the player base.
  - `state.lives = RTS_TOWN_HALL_HP` (1500) — player loses when town-hall HP hits 0.
  - `state.status = 'wave'` from the start (no TD prep/wave cycle).
- `tickRtsAi(dt)`: every `RTS_AI_FIRST_WAVE_DELAY=35s` then `RTS_AI_WAVE_INTERVAL=30s`, spawns escalating waves (goblin → skeleton → zombie+demon) at the AI town-hall that walk the route to the player's town-hall.
- Win condition: all stationary AI town-halls destroyed → `status='won'`.
- Public getters: `isRtsSolo()`, `getPlayerTownHall()`, `getAiTownHall()`, `getAiNextWaveIn()`.
- `client/src/sim/systems/movement.ts` — `tickMovement` skips `stationary` enemies (AI town-hall doesn't walk).

**Render (`client/src/babylon/`):**
- `resources/resource-node-renderer.ts` (NEW) — instanced box-marker per resource-kind (wood/stone/ore/gold) with depletion-driven scaling. Pickable for right-click gather orders.
- `rtscam.ts` is now used in production (was previously unwired).

**UI (`client/src/components/`):**
- `RtsGame.vue` (NEW) — full RTS-only component:
  - RTS camera via `attachRtsCamera` (ortho, WASD/edge pan, wheel zoom, Q/E rotate 45°, pixel-snap compatible) — **no rotating TD camera**.
  - Initial camera target = player's town-hall position; bounds clamped to map.
  - Selection: click select, shift-click toggle, drag box-select (Vector3.Project over `unit-inst-*` meshes), control groups Ctrl+1..9 / 1..9.
  - Orders: right-click = move (grid formation) / attack (on enemy) / gather (on resource node); shift = waypoint queue; A = attack-move; S = stop; Space = pause.
  - Build/train/cast mode via ProductionPanel (click building/unit/spell → click on map).
  - HUD: top-left shows player town-hall HP + AI town-hall HP + next-wave timer; top-right has pause/speed/back controls.
  - Minimap (click → focus camera), SelectionBox overlay, ControlGroupBar.
  - Game-over modal with won/lost messaging.
- `RtsLobby.vue` (NEW) — map picker (2p Crossroads / 3p Trident / 4p Quadrants) with stats preview, then start.
- `EconomyBar.vue` — hides the TD "Старт волны" button when `rtsEnabled` (RTS solo has no manual wave-start).
- `App.vue` — new nav button "RTS соло" → `view='rts-lobby'` → `RtsLobby` → `view='rts-game'` → `RtsGame`.

**Smoke test:** `scripts/smoke-rts-solo.ts` (NEW) — verifies init (town-hall, workers, auto-gather, AI threat, lives=1500), AI wave spawn schedule (35s/30s + escalation), win-condition (kill AI town-hall → 'won'), lose-condition (lives=0 → 'lost'), all 3 maps init correctly. **ALL PASSED.**

### Step 0 — Determinism Audit
- Audited `client/src/sim` and `client/src/domain` for `Math.random|Date.now|performance.now|new Date()`.
- Only `performance.now()` in `sim-sync.ts` (GuestSync render-interpolation buffer — allowed by spec).
- Sim is fully deterministic via `mulberry32` seeded RNG. **No changes required.**

### M8.R — Pixel-art render pipeline (all 10 effects + smoke)
Files in `client/src/babylon/pixel-art/`:
- `lowres.ts` (R1) — RTT 640×360 + NEAREST blit + sub-pixel uniform
- `cam-snap.ts` (R2) — Orthographic dimetric + pixel-snap (t3ssel8r)
- `toon-pixel-art.ts` (R3) — 5-band ramp + smoothed attenuation + normal noise + cloud/sun-shadow uniforms
- `outline-dn.ts` (R4) — depth+normal 4-tap outlines (replaces color-Sobel); uses DepthRenderer + GeometryBufferRenderer
- `cloud-shadow.ts` (R5) — tileable 256×256 procedural cloud noise + uniforms helper
- `grass.ts` (R6) — thin-instance billboards + Bramwell base-position lighting hack + poisson-disk placement
- `godrays.ts` (R7) — fullscreen raymarched volumetric god rays (depth reconstruct + radial sun-boost)
- `water.ts` (R8) — MirrorTexture planar reflection + Voronoi wave texture + refraction/depth-fade + specular
- `poisson-leaves.ts` (R9) — Fast Adaptive Blue Noise on Polygonal Surfaces (tree canopy bake) + `types.ts`
- `particles-night.ts` (R10) — bake sprite-sheets + SpriteManager + night-overlay (vignette + grain + cool tint) + `nightAmountFromTimeOfDay`
- `scripts/smoke-pixel-art.ts` — NullEngine headless verify, ALL PASSED
- `scripts/poisson-leaves.ts` — CLI bake + determinism test, ALL PASSED
- `client/public/assets/tree-canopy-oak.json` — baked asset

### M8.1 — TD removal + large RTS map + RTS camera + minimap + chunked rendering
- `shared/types/map.ts` — added `gameMode: 'rts'|'td'`, `playerStarts`, `resourceNodes`, `chunkedStreaming`; TD-поля marked `@deprecated` (optional, defaults in runtime).
- `client/src/babylon/rtscam.ts` — RTS camera: WASD pan, edge-scroll, wheel zoom (ortho half-extents), Q/E rotate (yaw 45° steps), pixel-snap-compatible, bounds-clamping.
- `client/src/components/Minimap.vue` — canvas overlay (terrain tiles, fog explored/unexplored, units/buildings per-slot color, resource-nodes, camera viewport rect, click → focus).
- `client/src/babylon/terrain/chunked-voxel-field.ts` — ChunkedVoxelField (16×16 chunks, lazy-build, frustum-culling, LOD via distance, dirty-tracking for destructible terrain).
- `client/src/babylon/level-renderer.ts` — RTS-aware: skips spawn/base markers when `gameMode='rts'`.
- `shared/src/maps/rts-maps.ts` — 3 RTS maps (rts-2p-crossroads 64×64, rts-3p-trident 72×72, rts-4p-quadrants 80×80) with playerStarts + resourceNodes + symmetric layouts + rolling heightmap.

### M8.2 — UI/render (selection, orders, formations, control groups, waypoints)
- `shared/types/sim.ts` — extended `PlayerAction` with `order-unit-attack-move`, `order-unit-patrol`, `order-unit-waypoint-queue`, `order-unit-gather`, `research-upgrade`, `assign-control-group`, `rts-slot-action`; added `FormationKind`.
- `shared/types/economy.ts` — added `waypoints[]`, `patrolLoop`, `gatherNodeId/carry/carryKind/gatherState/gatherTimer` on `DefenderUnit`; added `worker/carryCapacity/gatherTime` on `DefenderUnitType`.
- `client/src/sim/systems/formations.ts` — `computeFormation` (grid/wedge/line/column/none) + `formationToOrders`.
- `client/src/sim/game-sim.ts` — handlers for all new orders (attack-move, patrol, waypoint-queue, gather, research-upgrade); tickUnits integrates waypoints-queue + patrol-loop.
- `client/src/composables/useSelection.ts` — multi-select state (select/selectMany/addToSelection/boxSelect/clear/has/count).
- `client/src/composables/useControlGroups.ts` — Ctrl+1..9 (assign/recall/has/clear).
- `client/src/components/SelectionBox.vue` — drag-rectangle overlay.
- `client/src/components/ControlGroupBar.vue` — 1..9 badges.

### M8.3 — Economy + tech tree + workers
- `shared/types/economy.ts` — added `ResourceKind`, `UpgradeType` (researchable upgrades with target/magnitude/epoch/requires).
- `shared/types/map.ts` — added `ResourceNode` (id/col/row/kind/amount).
- `shared/types/sim.ts` — added `UpgradeType[]` in `GameCatalog`.
- `shared/src/catalogs/rts-catalog.ts` — Town Hall L1/L2, RTS-Barracks, Watch Tower, Worker unit, 8 upgrades (epoch/melee-attack/armor/ranged/gather-capacity/unlock-mage/unlock-smelter).
- `client/src/sim/systems/gathering.ts` — worker FSM (to-node/gathering/to-base), resource depletion, drop-off to town-hall.
- `client/src/sim/game-sim.ts` — integrates `tickGathering` + `pruneDepletedNodes` + research-progress (ticks `researching[].remainingSec`, moves finished to `researchedUpgrades`).

### M8.4 — PvP netcode (per-player state, fog of war, prediction, pvp-rooms, reconnect)
- `shared/types/sim.ts` — added `PlayerState[]` (slot/userId/color/defeated/resources/units/buildings/commanderCooldowns/epoch/researchedUpgrades/researching/visibleCells).
- `shared/types/realtime.ts` — added `PvpClientMessage`/`PvpServerMessage` unions (queue/lobby-ready/pick-color/pick-start-pos/match-found/match-start/snapshot/reconcile/defeated/match-ended/reconnect/paused/resumed) + `PVP_TICK_HZ=25`, `PVP_RECONNECT_GRACE_SEC=30`, `PVP_DEFEAT_AFTER_SEC=120`.
- `client/src/sim/visibility.ts` — `computeVisibilityForPlayer`, `computeVisibilityAll`, `filterSnapshotForPlayer`, `computeExploredCells`.
- `client/src/sim/prediction.ts` — `ClientPredictor<S>` (input-buffer + predicted-state + reconcile with rollback+replay; semantics: "confirmed at N = inputs tick<N processed").
- `server/src/realtime/visibility.ts` — server-side authoritative `computeVisibilityForSlot`/`computeAllVisibilities`/`filterSnapshotForViewer`.
- `server/src/realtime/server-sim-loop.ts` — `ServerSimLoop` (25Hz setInterval, input-buffer per tick, visibility-filter fanout, win-condition).
- `server/src/realtime/pvp-rooms.ts` — `PvpRooms` (lobby/matchmaking/lobby-ready/pick-color/pick-start-pos/match-start/in-game input-queue/reconnect-grace/defeat-after/match-end).
- `server/src/realtime/matchmaking.ts` — `InMemoryMatchmaker` (FIFO queue, dedup, tryFormMatch).
- `server/src/index.ts` — wired PvpRooms into `/ws` route alongside CoopRooms (parallel namespaces via `pvp:` prefix).

### M8.5 — Maps / balance / start positions
- `shared/src/maps/rts-maps.ts` — 3 maps as listed above (M8.1).
- `shared/src/index.ts` — exports `rts-maps` + `rts-catalog`.

## Smoke Tests Status (all green)
- `smoke-rts-solo.ts` ✅ (NEW — RTS-solo init + AI waves + win/lose + auto-gather + all 3 maps)
- `smoke-pixel-art.ts` ✅ (R1-R10 + smoke, 50+ checks)
- `smoke-rts-m8.ts` ✅ (formations + visibility + gathering + prediction)
- `poisson-leaves.ts` ✅ (R9 bake + determinism + asset write)
- `smoke-rts.ts` ✅ (existing — Phase 6 RTS, regression-safe)
- `smoke-unit-orders.ts` ✅ (existing — M8.2 sim-core, regression-safe)
- `smoke-tiles.ts` ✅ (existing — Phase T tiles)
- `smoke-coop.ts` ✅ (existing — Phase 7 netcode)

## Type-check / Build Status
- `npm run typecheck` ✅ across shared/server/client.
- `npm --workspace shared run build` ✅.

## Notes / Architectural Decisions
1. **TD code preserved as legacy** (per M8-PLAN §M8.1: "оставить как legacy-поля, не использовать в RTS-режиме").
   The TD gameplay path (waves/path/base-hp/draft) still works for `gameMode='td'` maps. RTS-only maps use `gameMode='rts'`.
2. **GameSim not yet hoisted to shared/** — `server-sim-loop.ts` and `pvp-rooms.ts` use a `simFactory` DI seam; the actual hoist is the next big step for production server-authoritative sim (documented in `server/src/realtime/server-sim-loop.ts` header comment).
3. **Pixel-art effects are separable and individually toggleable** — each module exports a handle with dispose().
4. **Minimap is a pure canvas overlay** (Vue) — no Babylon GUI dependency.
5. **PvpRooms and CoopRooms coexist** behind separate message-prefix namespaces; legacy co-op path unchanged.

## What REMAINS for full production deployment
- **GameSim hoist to `shared/src/sim/`** — required for real server-authoritative PvP (currently `pvp-rooms.ts` simFactory throws).
- **Real-network integration testing** of prediction/rollback with actual latency/packet-loss (M8-PLAN M8.4 risk-section flagged this).
- **Production RTS polish**: ~~selection-rings on units~~ ✅ (done M8.renderfix), building-placement ghost preview, training-queue UI at barracks, AI difficulty tuning, real town-hall model for the AI opponent (currently uses `boss`).
- **Asset-bake pipeline** for `.gltf`/`.vox` → tree-canopy JSON at production scale.

## ✅ M8.renderfix — починка RTS-рендера после M8 (главное)

**Жалобы:** постройки/юниты не отображаются, карта «крутится не туда», выделение не
работает, строители огромные, минимап ок но сцена — «фоллбек на фоллбеке, всё
перемешано». Корень — не надо было отказываться от вокселей: баги были
изолированные. Уйдём к Magnum-Opus только как к крайнему случаю — не понадобилось.

**Найденные причины (через живую инспекцию сцены):**
1. **Мусор из glTF (главное «всё перемешано»):** `loadGlbTemplate` при падении
   `MergeMeshes` (разный sideOrientation у подсеток glTF) прятал только `meshes[0]`,
   а остальные body/eyes/weapon-подсетки оставались видимыми в origin (0,0,0) →
   28 крупных meшей стекались в одну точку. `importGltfParts` тоже добалял glTF
   меши в сцену и не чистил. На minimise они видны (т.к. читают col/row из сима).
2. **Гигантские юниты (главное «строители слишком большие»):** `assembleRig`
   клал нормализацию (scaling=1/height + recenter) на **root**, а рендереры делали
   `root.scaling.set(cellSize)` / `root.position.set(worldPos)` → **перезатирали**
   нормализацию. Воркер получался 25.6 ед (нужно ~1.5), AI-town-hall 66 ед.
3. **Камера смотрела в пустой угол:** `frameTarget = focusWorld*0.5` ставил цель
   между базой и центром (база на краю кадра), а `enableEdgeScroll` дрейфовал,
   пока мышь у края/вне canvas (`scene.pointerX/Y` хранили последнее положение).
4. **Выделение сломано:** `pickUnit`/`pickEnemy`/`boxSelectUnits` фильтровали
   меши по префиксу `unit-inst-`/`enemy-inst-`, а rigged-риги имеют парт-меши
   `<joint>-part` → клик/рамка всегда промахивались.
5. **Toon-vs-clone рассинхрон:** `applyToonToScene` заменял материалы тех meшей,
   что существуют на момент вызова, а клоны (spawn юнитов) получали свежий
   StandardMaterial → «пол-toon / пол-Standard».
6. **TD-рудименты в RTS:** TowerRenderer + ProjectilePool грузились в RTS
   (башни/снаряды — TD), heal-walls spell (стены — TD) был в RTS-командире,
   «TD-игра» кнопка в навигации.

**Fixes:**
- **`asset-catalog.ts`** — опция `skipGltf` (RTS использует только процедурные
  воксель-риги/билдеры: UNIT_RIGS / RIGGED_DEFS / VOXEL_BUILDERS). Убивает мусор
  glTF, merge-предупреждения и резко ускоряет init. Дефенсивно починены утечки:
  `loadGlbTemplate` dispose'ит все подсетки при падении merge; `importGltfParts`
  dispose'ит загруженные root-ноды после извлечения CharacterDef.
- **`voxel-parts.ts assembleRig`** — нормализация перенесена на **дочерний
  norm-узел**, root остаётся identity → рендереры свободно ставят world-position/
  scaling поверх. `computeDefBounds` считает воксели как кубики [v,v+1) → высота
  рига ровно 1.0. Юниты теперь 1.5 ед (cellSize), пропорционально зданиям.
- **`rtscam.ts`** — edge-scroll только когда курсор реально над canvas
  (pointerinside-tracking через canvas pointer-events), покадровый clamp target
  в bounds. `RtsGame.vue` — camera target = town-hall игрока напрямую, visibleH
  подобран под cellSize.
- **`unit-renderer-rigged.ts` / `enemy-renderer-rigged.ts`** — парт-меши клонов
  тегируются `metadata.rigId`/`rigKind`; root врага命名为 `enemy-rig-<id>`.
  `RtsGame.vue pickUnit/pickEnemy/boxSelectUnits` переписаны на metadata
  (walk-up по родителям как fallback).
- **`RtsGame.vue`** — toon ВЫКЛ (USE_TOON=false): единый материал-путь (baked
  AO + Standard + Atmosphere). TowerRenderer/ProjectilePool убраны из RTS
  (сделаны optional в `game-loop.ts`). Командир без heal-walls spell. Здания
  ×2.4 крупнее юнитов. Добавлен **selection-ring** (emissive torus под выделенным
  юнитом). Atmosphere ярче (exposure 1.6, ambient 1.25, sun 1.4, vignette 0.7).
- **`App.vue`** — скрыта «TD-игра» кнопка навигации (бренд = Tower — RTS).

**Verify (всё зелёное):** typecheck (shared/server/client), client build (152
модуля), smoke-voxel-rig / smoke-rts-solo / smoke-rts-terrain / smoke-rts-m8 /
smoke-voxel-mesh / smoke-voxel-toon / smoke-rts / smoke-tiles — ALL PASSED.
Визуально (Babylon + Playwright): town-hall видим и крупнее юнитов, воркеры ~1.5
ед (было 25.6), 0 мусорных glTF-мешей, камера на базе, клик по юниту → selection
+ cyan-ring под ногами. Минимап консистентен со сценой.

---

## ? S0 � Monorepo Restructure (spec-research-report.md �3, Task 1)

**Date:** 2026-07-30

### New packages created

| Package | Source | Contents |
|---------|--------|----------|
| `@tower/engine-recipe` | shared/src/recipe/* | Recipe v3 schema + compile + place-algebra + xorshift32 + errors (pure-TS, 6 files) |
| `@tower/voxel-core` | client/src/babylon/voxel/* (pure parts) | Voxel types, greedy meshing, visualHull, SDF, kit-assembler, palette-core, parts-types, voxel IO (pure-TS, 16 files) |
| `@tower/engine-terrain` | client/src/domain/grid-math.ts | Grid math/heightmap utilities (pure-TS, depends on @tower/shared) |

### Back-compat re-export stubs
- shared/src/recipe/index.ts > re-exports from @tower/engine-recipe
- client/src/domain/grid-math.ts > re-exports from @tower/engine-terrain
- 9 pure voxel files in client > 1-line `export * from '@tower/voxel-core'` stubs
- 3 mixed voxel files (voxel-builder, voxel-palette, voxel-parts) > keep Babylon funcs + re-export pure

### Dependency graph
@tower/engine-recipe  (no deps)
@tower/engine-terrain > @tower/shared
@tower/voxel-core     > @tower/shared
@tower/shared         > @tower/engine-recipe
client                > @tower/shared + @tower/voxel-core + @tower/engine-terrain

### Verify (all green)
- typecheck: 6/6 packages pass
- build: 6/6 packages + client Vite prod (169 modules)
- smoke tests: 14/14 pass
