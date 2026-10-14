import type { Enemy, EnemyType, GameSnapshot, GridData, RtsWorldSite } from '@tower/shared';
import type { GridNavigator } from '@tower/engine-terrain';

export interface RtsOpponentDeps {
  state: GameSnapshot; types: Map<string, EnemyType>; grid: GridData;
  navigator: GridNavigator; base: { col: number; row: number }; dt: number;
  heightAt: (col: number, row: number) => number;
}
/** Guard leashes, roaming patrols and raids share terrain navigation and fight units. */
export function tickRtsOpponents({ state, types, grid, navigator, base, dt, heightAt }: RtsOpponentDeps): number {
  let baseDamage = 0;
  const units = state.defenderUnits ?? [];
  for (const enemy of state.enemies) {
    if (!enemy.alive || enemy.stationary) continue;
    const type = types.get(enemy.typeId);
    if (!type) continue;
    enemy.combatCooldown = Math.max(0,(enemy.combatCooldown ?? 0)-dt);
    const home = {col:enemy.homeCol ?? base.col,row:enemy.homeRow ?? base.row};
    const hx = (home.col+.5-grid.cols/2)*grid.cellSize, hz = (home.row+.5-grid.rows/2)*grid.cellSize;
    const targets = units.filter(unit => unit.hp>0
      && Math.hypot(unit.position.x-enemy.position.x,unit.position.z-enemy.position.z)<6*grid.cellSize
      && (enemy.rtsRole !== 'guard' || Math.hypot(unit.position.x-hx,unit.position.z-hz)<7*grid.cellSize));
    targets.sort((a,b)=>Math.hypot(a.position.x-enemy.position.x,a.position.z-enemy.position.z)
      -Math.hypot(b.position.x-enemy.position.x,b.position.z-enemy.position.z) || a.id.localeCompare(b.id));
    const target = targets[0];
    const slow = enemy.slowUntilTick != null && state.tick<enemy.slowUntilTick ? enemy.slowFactor ?? 1 : 1;
    const distance = type.speed*grid.cellSize*slow*dt;
    if (target) {
      const range = grid.cellSize*1.15;
      if (Math.hypot(target.position.x-enemy.position.x,target.position.z-enemy.position.z)<=range) {
        if (enemy.combatCooldown<=0) {
          target.hp = Math.max(0,target.hp-Math.max(4,type.damageToBase*4));
          enemy.combatCooldown = 1;
        }
      } else navigator.move(enemy.id,enemy.position,{col:target.col,row:target.row},distance,1);
    } else if (enemy.rtsRole === 'raider') {
      const x = (base.col+.5-grid.cols/2)*grid.cellSize, z = (base.row+.5-grid.rows/2)*grid.cellSize;
      if (Math.hypot(x-enemy.position.x,z-enemy.position.z)<=2.3*grid.cellSize) {
        if(enemy.combatCooldown<=0) {baseDamage+=Math.max(8,type.damageToBase*12);enemy.combatCooldown=1.2;}
      } else {
        // Alternate raids threaten exposed workers/resource sites before the keep.
        const worker = units.find(unit=>unit.hp>0 && unit.typeId==='worker' && unit.gatherNodeId);
        const goal = enemy.homeCol === undefined && worker ? {col:worker.col,row:worker.row} : base;
        navigator.move(enemy.id,enemy.position,goal,distance,2);
      }
    } else {
      const phase = Math.floor(state.tick/240)+(parseInt(enemy.id.replace(/\D/g,''),10)||0);
      const offsets = [[2,0],[0,2],[-2,0],[0,-2]];
      const offset = offsets[phase%4]!;
      const goal = enemy.rtsRole==='guard' ? home : {
        col:Math.max(0,Math.min(grid.cols-1,home.col+offset[0]!)),
        row:Math.max(0,Math.min(grid.rows-1,home.row+offset[1]!))
      };
      navigator.move(enemy.id,enemy.position,goal,distance,1);
    }
    const col = enemy.position.x/grid.cellSize+grid.cols/2-.5;
    const row = enemy.position.z/grid.cellSize+grid.rows/2-.5;
    enemy.position.y = heightAt(col,row);
  }
  return baseDamage;
}

/** Clear guards, then hold the site. Rewards are applied once in the authoritative sim. */
export function tickWorldSites(state: GameSnapshot, grid: GridData, dt: number): void {
  for(const site of state.worldSites ?? []) {
    if(site.secured) continue;
    const x = (site.col+.5-grid.cols/2)*grid.cellSize, z = (site.row+.5-grid.rows/2)*grid.cellSize;
    const hostile = state.enemies.some(enemy=>enemy.alive && !enemy.stationary
      && (site.guardIds.includes(enemy.id) || Math.hypot(enemy.position.x-x,enemy.position.z-z)<4*grid.cellSize));
    const present = (state.defenderUnits ?? []).some(unit=>unit.hp>0
      && Math.hypot(unit.position.x-x,unit.position.z-z)<2.5*grid.cellSize);
    site.progress = !hostile && present ? Math.min(1,site.progress+dt/(site.kind==='beacon'?10:3)) : Math.max(0,site.progress-dt*.08);
    if(site.progress>=1) {
      site.secured = true;
      if(state.resources) {
        state.resources.wood += site.reward.wood ?? 0;
        state.resources.stone += site.reward.stone ?? 0;
      }
      state.gold += site.reward.gold ?? 0;
    }
  }
}

export function makeWorldSite(id: string, kind: RtsWorldSite['kind'], col: number, row: number): RtsWorldSite {
  return {id,kind,col,row,name:kind==='supplies'?'Забытый обоз':'Сигнальный пост',guardIds:[],progress:0,secured:false,
    reward:kind==='supplies'?{wood:80,stone:50}:{gold:75}};
}
