import { defineStore } from 'pinia';
import type { GameSnapshot, SimStatus, TowerType, Weather } from '@tower/shared';

interface GameState {
  tick: number;
  status: SimStatus;
  waveIndex: number;
  totalWaves: number;
  gold: number;
  lives: number;
  maxLives: number;
  enemiesAlive: number;
  waveEnemiesRemaining: number;
  towerCount: number;
  timeOfDay: number;
  weather: Weather;
}

export const useGameStore = defineStore('game', {
  state: (): GameState => ({
    tick: 0,
    status: 'prep',
    waveIndex: -1,
    totalWaves: 0,
    gold: 0,
    lives: 0,
    maxLives: 0,
    enemiesAlive: 0,
    waveEnemiesRemaining: 0,
    towerCount: 0,
    timeOfDay: 0.5,
    weather: 'clear'
  }),
  getters: {
    waveLabel: (s): string => {
      if (s.waveIndex < 0) return `0 / ${s.totalWaves}`;
      return `${s.waveIndex + 1} / ${s.totalWaves}`;
    },
    isOver: (s): boolean => s.status === 'won' || s.status === 'lost',
    canStartWave: (s): boolean => s.status === 'prep' && s.waveIndex + 1 < s.totalWaves,
    /** Фаза суток по timeOfDay (0=полночь, 0.5=полдень). */
    timePhase(s): 'Ночь' | 'Рассвет' | 'День' | 'Сумерки' {
      const t = s.timeOfDay;
      if (t >= 0.22 && t < 0.30) return 'Рассвет';
      if (t >= 0.30 && t < 0.70) return 'День';
      if (t >= 0.70 && t < 0.80) return 'Сумерки';
      return 'Ночь';
    },
    weatherLabel(s): string {
      switch (s.weather) {
        case 'rain': return 'Дождь';
        case 'storm': return 'Гроза';
        default: return 'Ясно';
      }
    }
  },
  actions: {
    setTotalWaves(n: number): void {
      this.totalWaves = n;
    },
    setSnapshot(snap: GameSnapshot): void {
      this.tick = snap.tick;
      this.status = snap.status;
      this.waveIndex = snap.waveIndex;
      this.gold = snap.gold;
      this.lives = snap.lives;
      this.enemiesAlive = snap.enemies.length;
      this.waveEnemiesRemaining = snap.waveEnemiesRemaining;
      this.towerCount = snap.towers.length;
      this.timeOfDay = snap.timeOfDay;
      this.weather = snap.weather;
    },
    setMaxLives(n: number): void {
      this.maxLives = n;
    },
    canAfford(tower: TowerType): boolean {
      return this.gold >= tower.cost;
    }
  }
});
