export interface Reward {
  id: string;
  type: string;
  label: string;
  earnedAt: number;
}

export interface ProgressionStat {
  key: string;
  value: number;
}

export interface PlayerProfile {
  wins: number;
  losses: number;
  rewards: Reward[];
  stats: Record<string, number>;
}
