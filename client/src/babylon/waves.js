export function createWavesController(scene, grid, config, spawner) {
  let time = 0;
  let waveIndex = 0;
  let spawnedInWave = 0;
  let sinceLastSpawn = 0;
  let running = false;

  function start() {
    running = true;
    time = 0;
    waveIndex = 0;
    spawnedInWave = 0;
    sinceLastSpawn = 0;
  }

  function pause() { running = false; }
  function resume() { running = true; }

  function update(deltaSeconds) {
    if (!running) return;
    const waves = Array.isArray(config?.waves) ? config.waves : [];
    if (waveIndex >= waves.length) return;
    const w = waves[waveIndex];
    sinceLastSpawn += deltaSeconds;
    if (spawnedInWave < w.count && sinceLastSpawn >= w.interval) {
      spawnedInWave += 1;
      sinceLastSpawn = 0;
      spawner(w);
    }
    if (spawnedInWave >= w.count) {
      // Simple: advance to next wave after one interval of idle
      time += deltaSeconds;
      if (time >= w.interval) {
        waveIndex += 1; spawnedInWave = 0; sinceLastSpawn = 0; time = 0;
      }
    }
  }

  return { start, pause, resume, update, get waveIndex() { return waveIndex; } };
}

