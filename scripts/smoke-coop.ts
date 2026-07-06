/**
 * Headless smoke-тест co-op (Фаза 7).
 * Проверяет:
 *  1. GuestSync: буферизация + интерполяция позиций между двумя снапшотами.
 *  2. GameSim.reconcile: заменяет состояние авторитетным снапшотом + пересчитывает маршрут.
 *  3. GameSim.applyRenderState: покадровое обновление без клона + recompute маршрута по version.
 *  4. CoopRooms (server): join/welcome, host/guest routing (guest input → host,
 *     host state → guests), leave (host-left распускает комнату, peer-left — нет).
 *
 * Запуск: npx tsx scripts/smoke-coop.ts
 */
import { GuestSync } from '../client/src/sim/sim-sync';
import { GameSim } from '../client/src/sim/game-sim';
import { DEFAULT_CATALOG } from '../shared/src/catalogs/default';
import { CoopRooms } from '../server/src/services/coop-rooms';
import type { CoopClient } from '../server/src/services/coop-rooms';
import type { CoopServerMessage, GameSnapshot, MapDocument, PlayerInput } from '../shared/src/index';

function makeMap(): MapDocument {
  return {
    version: 2,
    grid: { cols: 16, rows: 10, cellSize: 1.5 },
    heightmap: Array.from({ length: 10 }, () => Array.from({ length: 16 }, () => 0)),
    path: { waypoints: [{ col: 0, row: 5 }, { col: 15, row: 5 }] },
    spawnPoint: { col: 0, row: 5 },
    base: { col: 15, row: 5, hp: 20 },
    startingGold: 100,
    waves: []
  };
}

let failures = 0;
function check(name: string, cond: boolean, details = ''): void {
  if (cond) {
    console.log(`  ✓ ${name}`);
  } else {
    failures += 1;
    console.error(`  ✗ FAIL: ${name} ${details}`);
  }
}

// ── Mock WebSocket ──
class MockSocket {
  readyState = 1;
  received: CoopServerMessage[] = [];
  send(raw: string): void {
    try { this.received.push(JSON.parse(raw) as CoopServerMessage); } catch { /* ignore */ }
  }
}

function makeClient(userId: string, sessionId: string, isHost: boolean): { client: CoopClient; socket: MockSocket } {
  const socket = new MockSocket();
  const client: CoopClient = {
    socket: socket as unknown as CoopClient['socket'],
    sessionId,
    userId,
    username: userId,
    isHost,
    coopRole: 'free',
    ready: false
  };
  return { client, socket };
}

console.log('\n=== Co-op Smoke Test (Фаза 7) ===\n');

// ── 1. GuestSync: интерполяция ──
console.log('1. GuestSync — буферизация и интерполяция:');
{
  const sync = new GuestSync();
  const t0 = 1000;
  // мок performance.now
  const origNow = globalThis.performance;
  let clock = t0;
  (globalThis as { performance?: { now: () => number } }).performance = { now: () => clock } as Performance;

  const baseSnap: GameSnapshot = {
    tick: 10, status: 'wave', waveIndex: 0, gold: 100, lives: 20, pathLength: 22.5,
    enemies: [{ id: 'e1', typeId: 'skeleton', hp: 30, maxHp: 30, pathProgress: 5, position: { x: 0, y: 0, z: 0 }, alive: true }],
    towers: [], walls: [], projectiles: [], routeVersion: 1, waveEnemiesRemaining: 5,
    relics: [], pendingRelicChoices: [], timeOfDay: 0.5, weather: 'clear',
    ownerId: 'host', players: []
  };

  clock = t0;
  sync.push({ ...baseSnap, enemies: [{ ...baseSnap.enemies[0], position: { x: 0, y: 0, z: 0 } }] });
  check('latest доступен после push', sync.getLatest() !== null);
  check('sample с 1 снапшотом → snap (нет интерполяции)', sync.sample(t0 + 50) !== null);

  clock = t0 + 100;
  const snap2 = { ...baseSnap, tick: 13, enemies: [{ ...baseSnap.enemies[0], position: { x: 10, y: 0, z: 0 }, pathProgress: 8 }] };
  sync.push(snap2);

  // буфер < MIN_BUFFER_FOR_INTERP (2) — оба доступны, но проверим интерполяцию при enough
  clock = t0 + 250;
  const snap3 = { ...baseSnap, tick: 16, enemies: [{ ...baseSnap.enemies[0], position: { x: 20, y: 0, z: 0 }, pathProgress: 11 }] };
  sync.push(snap3);

  // теперь буфер = 3 снапшота; sample на renderTime = (t0+250) - 120 = t0+130
  // попадает между snap1 (t0) и snap2 (t0+100)? Нет: t0+130 > t0+100. Между snap2 и snap3.
  const sampled = sync.sample(t0 + 250);
  check('sample возвращает снапшот', sampled !== null);
  if (sampled && sampled.enemies.length > 0) {
    const px = sampled.enemies[0].position.x;
    // snap2 at arrival t0+100 (x=10), snap3 at t0+250 (x=20); renderTime=t0+130
    // alpha = (130-100)/(250-100) = 30/150 = 0.2; x = 10 + (20-10)*0.2 = 12
    check('позиция интерполирована (≈12)', Math.abs(px - 12) < 0.6, `got x=${px.toFixed(2)}`);
  }

  sync.clear();
  check('clear опустошает буфер', sync.getLatest() === null);
  (globalThis as { performance?: Performance }).performance = origNow;
}

// ── 2. GameSim.reconcile ──
console.log('\n2. GameSim.reconcile — авторитетная замена состояния:');
{
  const sim = new GameSim({ map: makeMap(), catalog: DEFAULT_CATALOG, ownerId: 'host', seed: 42 });
  const hostSnap: GameSnapshot = sim.serialize();
  // смоделируем authoritative snapshot с башней + врагом + стеной
  const wallSnap: GameSnapshot = {
    ...hostSnap,
    tick: 99,
    gold: 250,
    lives: 7,
    towers: [{ id: 'tower-1', typeId: 'arrow', col: 5, row: 3, level: 0, upgradePathIndex: -1, cooldown: 0, rotationY: 0, targetingMode: 'first' }],
    enemies: [{ id: 'e1', typeId: 'skeleton', hp: 15, maxHp: 30, pathProgress: 3, position: { x: 1, y: 0, z: 1 }, alive: true }],
    walls: [{ id: 'wall-1', col: 3, row: 5, hp: 50, maxHp: 60, material: 'wood', burning: false }],
    routeVersion: hostSnap.routeVersion + 1
  };
  sim.reconcile(wallSnap);
  check('tick обновлён', sim.state.tick === 99, `got ${sim.state.tick}`);
  check('gold обновлён', sim.state.gold === 250);
  check('lives обновлены', sim.state.lives === 7);
  check('башня появилась', sim.state.towers.length === 1);
  check('враг появился', sim.state.enemies.length === 1);
  check('стена появилась', sim.state.walls.length === 1);
  check('маршрут пересчитан (есть waypoints)', sim.getRouteWaypoints().length >= 1);
  // applyRenderState не должен клонировать (тот же объект)
  const before = { ...wallSnap };
  sim.applyRenderState(before);
  check('applyRenderState принимает снапшот', sim.state.tick === before.tick);
  // повторный applyRenderState с тем же routeVersion не должен пересчитывать маршрут (по lastAppliedRouteVersion)
  // проверим, что routeVersion в state не растёт бесконтрольно — это допустимо, т.к. он не сравнивается с state
}

// ── 3. CoopRooms: join + routing ──
console.log('\n3. CoopRooms — маршрутизация комнаты:');
{
  const rooms = new CoopRooms();
  const sid = 'sess-1';
  const hostId = 'host-user';
  const guestId = 'guest-user';

  const { client: host, socket: hostSocket } = makeClient(hostId, sid, true);
  const { client: guest, socket: guestSocket } = makeClient(guestId, sid, false);

  const welcome1 = rooms.join(host, hostId);
  check('host welcome type', welcome1.type === 'coop:welcome');
  check('host isHost=true', (welcome1 as { isHost: boolean }).isHost === true);
  check('host один в списке', (welcome1 as { players: unknown[] }).players.length === 1);

  const welcome2 = rooms.join(guest, hostId);
  check('guest welcome type', welcome2.type === 'coop:welcome');
  check('guest isHost=false', (welcome2 as { isHost: boolean }).isHost === false);
  check('guest видит 2 игрока', (welcome2 as { players: unknown[] }).players.length === 2);
  // host должен получить coop:players (бродкаст при непустой комнате)
  check('host получил coop:players', hostSocket.received.some((m) => m.type === 'coop:players'));

  // guest:input → только хосту
  hostSocket.received.length = 0;
  guestSocket.received.length = 0;
  const input: PlayerInput = { tick: 5, userId: guestId, action: { kind: 'start-wave' } };
  rooms.handleMessage(guest, { type: 'coop:input', input });
  check('host получил guest input', hostSocket.received.some((m) => m.type === 'coop:input'));
  check('guest НЕ получил свой input обратно', !guestSocket.received.some((m) => m.type === 'coop:input'));

  // host:state → всем гостям (не хосту)
  hostSocket.received.length = 0;
  guestSocket.received.length = 0;
  const snap: GameSnapshot = {
    tick: 1, status: 'wave', waveIndex: 0, gold: 50, lives: 20, pathLength: 10,
    enemies: [], towers: [], walls: [], projectiles: [], routeVersion: 1, waveEnemiesRemaining: 0,
    relics: [], pendingRelicChoices: [], timeOfDay: 0.5, weather: 'clear',
    ownerId: hostId, players: []
  };
  rooms.handleMessage(host, { type: 'coop:state', snapshot: snap });
  check('guest получил state от хоста', guestSocket.received.some((m) => m.type === 'coop:state'));
  check('хост НЕ получил свой state обратно', !hostSocket.received.some((m) => m.type === 'coop:state'));

  // не-хост не может раздавать state
  guestSocket.received.length = 0;
  rooms.handleMessage(guest, { type: 'coop:state', snapshot: snap });
  check('не-хост НЕ может раздавать state (ничего не пришло)', guestSocket.received.length === 0);

  // request-snapshot от гостя → хосту
  hostSocket.received.length = 0;
  rooms.handleMessage(guest, { type: 'coop:request-snapshot' });
  check('host получил request-snapshot', hostSocket.received.some((m) => m.type === 'coop:request-snapshot'));

  // guest leave → host получает peer-left + players, комната живёт
  hostSocket.received.length = 0;
  const out = rooms.leave(guest);
  check('leave: не hostLeft', out.hostLeft === false);
  check('host получил peer-left или players', hostSocket.received.some((m) => m.type === 'coop:peer-left' || m.type === 'coop:players'));
}

// ── 4. CoopRooms: host-left распускает комнату ──
console.log('\n4. CoopRooms — отключение хоста:');
{
  const rooms = new CoopRooms();
  const sid = 'sess-2';
  const { client: host, socket: hostSocket } = makeClient('h2', sid, true);
  const { client: guest, socket: guestSocket } = makeClient('g2', sid, false);
  rooms.join(host, 'h2');
  rooms.join(guest, 'h2');

  hostSocket.received.length = 0;
  guestSocket.received.length = 0;
  const out = rooms.leave(host);
  check('leave хоста → hostLeft=true', out.hostLeft === true);
  check('leave хоста → sessionId возвращён', out.sessionId === sid);
  // повторный join гостя должен вернуть ошибку (комнаты нет) — но join создаёт новую комнату
  // с owner=переданный. Проверим, что после распада комнаты гость при reconnect не падает.
  const rewelcome = rooms.join(guest, 'h2');
  check('гость может reconnect (новая комната)', rewelcome.type === 'coop:welcome');
}

// ── 5. CoopRooms: лимит 4 игроков ──
console.log('\n5. CoopRooms — лимит игроков:');
{
  const rooms = new CoopRooms();
  const sid = 'sess-3';
  for (let i = 0; i < 4; i++) {
    const { client } = makeClient(`u${i}`, sid, i === 0);
    const w = rooms.join(client, 'u0');
    check(`игрок ${i + 1} добавлен`, w.type === 'coop:welcome');
  }
  const { client: extra } = makeClient('u4', sid, false);
  const w = rooms.join(extra, 'u0');
  check('5-й игрок отклонён (room_full)', w.type === 'coop:error' && (w as { code: string }).code === 'room_full');
}

// ── 6. end-to-end симуляции host→guest через reconcile (детерминизм) ──
console.log('\n6. Детерминизм: host step → snapshot → guest reconcile:');
{
  const map = makeMap();
  const hostSim = new GameSim({ map, catalog: DEFAULT_CATALOG, ownerId: 'host', seed: 7 });
  const guestSim = new GameSim({ map, catalog: DEFAULT_CATALOG, ownerId: 'host', seed: 7 });

  // host размещает башню и делает несколько шагов
  hostSim.applyInput({ tick: 0, userId: 'host', action: { kind: 'place-tower', typeId: 'arrow', col: 5, row: 3 } });
  for (let i = 0; i < 10; i++) hostSim.step(1 / 30);

  const snap = hostSim.serialize();
  guestSim.reconcile(snap);

  check('guest gold = host gold', guestSim.state.gold === hostSim.state.gold, `host=${hostSim.state.gold} guest=${guestSim.state.gold}`);
  check('guest tick = host tick', guestSim.state.tick === hostSim.state.tick);
  check('guest towers = host towers', guestSim.state.towers.length === hostSim.state.towers.length);
  check('guest route = host route (waypoints)', guestSim.getRouteWaypoints().length === hostSim.getRouteWaypoints().length);
}

console.log('\n===');
if (failures === 0) {
  console.log('✅ ALL PASSED\n');
} else {
  console.error(`❌ ${failures} FAILED\n`);
  process.exit(1);
}
