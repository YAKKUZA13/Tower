import assert from 'node:assert/strict';
import { GridNavigator, findNavigationPath, gridToWorldData } from '../packages/engine-terrain/src/index';
import { createRigMotion, advanceRigMotion } from '../packages/voxel-core/src/index';
import { GameSim } from '../client/src/sim/game-sim';
import { castSpell, tickSpellImpacts } from '../client/src/sim/systems/rts';
import { tickWorldSites, tickRtsOpponents } from '../client/src/sim/systems/rts-world';
import { getRtsMap, RTS_MAPS } from '../shared/src/maps/rts-maps';
import { DEFAULT_CATALOG } from '../shared/src/catalogs/default';
import type { Enemy, Spell } from '@tower/shared';

const advance = (sim:GameSim, seconds:number) => { for(let i=0;i<seconds*30;i++) sim.step(1/30); };
{
  const map = structuredClone(getRtsMap('rts-2p-crossroads')!);
  const originalNodes = structuredClone(map.resourceNodes);
  const first = new GameSim({ map, catalog: DEFAULT_CATALOG, ownerId: 'first' });
  const second = new GameSim({ map, catalog: DEFAULT_CATALOG, ownerId: 'second' });
  advance(first, 20);
  assert.notDeepEqual(first.map.resourceNodes, originalNodes, 'the running match consumes its own deposits');
  assert.deepEqual(map.resourceNodes, originalNodes, 'gathering must preserve the map catalog');
  assert.deepEqual(second.map.resourceNodes, originalNodes, 'parallel matches must have independent deposits');

  const worker = first.state.defenderUnits![0]!;
  const nodeId = worker.gatherNodeId!;
  const lastDeposit = first.map.resourceNodes!.find(node => node.id === nodeId)!;
  lastDeposit.amount = 1;
  worker.col = lastDeposit.col - 1;
  worker.row = lastDeposit.row;
  worker.position = gridToWorldData(first.map.grid, worker.col, worker.row);
  worker.carry = 0;
  worker.gatherState = 'gathering';
  worker.gatherTimer = 10;
  advance(first, 0.1);
  assert(!first.map.resourceNodes!.some(node => node.id === nodeId), 'depleted deposits are removed in the current match');
  const restarted = new GameSim({ map, catalog: DEFAULT_CATALOG, ownerId: 'restarted' });
  assert.deepEqual(restarted.map.resourceNodes, originalNodes, 'restarting restores every original deposit');
  assert(restarted.state.defenderUnits!.every(unit => restarted.map.resourceNodes!.some(node => node.id === unit.gatherNodeId)));
  console.log('✓ Gathering and depletion are isolated per match; restarting restores resources and worker assignments');
}
{
  const grid={cols:12,rows:10,cellSize:1};
  const blocked=(col:number,row:number)=>col===5 && row!==8;
  const path=findNavigationPath(grid,{col:2,row:2},{col:8,row:2},blocked)!;
  assert(path.some(cell=>cell.row===8));assert(path.every(cell=>!blocked(cell.col,cell.row)));
  const navigator=new GridNavigator(grid,blocked),position=gridToWorldData(grid,2,2);
  for(let i=0;i<400;i++) navigator.move('worker',position,{col:8,row:2},.1);
  assert(Math.hypot(position.x-gridToWorldData(grid,8,2).x,position.z-gridToWorldData(grid,8,2).z)<.01);
  assert.equal(findNavigationPath(grid,{col:2,row:2},{col:8,row:2},col=>col===5),null);
  console.log('✓ Navigation detours around barriers; unreachable goals never teleport');
}
{
  const sim=new GameSim({map:getRtsMap('rts-2p-crossroads')!,catalog:DEFAULT_CATALOG,ownerId:'test'});
  const initial=sim.state.resources!.wood;
  advance(sim,20);
  assert(sim.state.resources!.wood>initial,'workers must actually deliver wood');
  for(const unit of sim.state.defenderUnits!) assert.equal(unit.col,Math.floor(unit.position.x/sim.map.grid.cellSize+sim.map.grid.cols/2));
  const worker=sim.state.defenderUnits![0]!;
  sim.applyInput({tick:sim.state.tick,userId:'test',action:{kind:'order-unit-stop',unitIds:[worker.id]}});
  assert.equal(worker.gatherNodeId,null);
  const destination={col:12,row:8};
  sim.applyInput({tick:sim.state.tick,userId:'test',action:{kind:'order-unit-move',unitIds:[worker.id],...destination}});
  advance(sim,6);
  assert.equal(worker.moveOrderCol,undefined);
  assert.equal(worker.col,destination.col);
  console.log('✓ Workers deliver cargo, update cells, and obey stop/move instead of fighting gathering');
}
{
  const grid={cols:10,rows:10,cellSize:1};
  const center=gridToWorldData(grid,5,5);
  const enemy=(id:string,dx:number):Enemy=>({id,typeId:'skeleton',hp:100,maxHp:100,pathProgress:0,position:{...center,x:center.x+dx},alive:true});
  const enemies=[enemy('center',0),enemy('edge',1.9),enemy('outside',2.1)];
  const spell:Spell={id:'meteor',name:'meteor',description:'',effect:'meteor',radius:2,power:60,cooldown:10};
  const active=castSpell({spell,col:5,row:5,grid,enemies,walls:[],gold:{gold:0},nextId:()=> 'meteor-test',tick:0}).active;
  assert.equal(enemies[0]!.hp,100);
  for(let i=0;i<20;i++) tickSpellImpacts([active],enemies,grid);
  assert.equal(enemies[0]!.hp,100);
  tickSpellImpacts([active],enemies,grid);
  assert.equal(enemies[0]!.hp,40);assert.equal(enemies[1]!.hp,40);assert.equal(enemies[2]!.hp,100);
  tickSpellImpacts([active],enemies,grid);assert.equal(enemies[0]!.hp,40);
  console.log('✓ Meteor resolves once after flight, across its exact circular area');
}
{
  for(const map of RTS_MAPS) {
    const sim=new GameSim({map:structuredClone(map),catalog:DEFAULT_CATALOG,ownerId:'test'});
    assert.equal(sim.state.worldSites?.length,2,`two activities on ${map.id}`);
    assert(sim.state.enemies.some(e=>e.rtsRole==='patrol'));
  }
  const sim=new GameSim({map:getRtsMap('rts-2p-crossroads')!,catalog:DEFAULT_CATALOG,ownerId:'test'});
  const site=sim.state.worldSites![0]!,unit=sim.state.defenderUnits![0]!;
  const beforePositions=sim.state.enemies.map(e=>({...e.position}));
  (sim as unknown as {recomputeRoute(remap:boolean):void}).recomputeRoute(true);
  assert.deepEqual(sim.state.enemies.map(e=>e.position),beforePositions,'wall changes must never project RTS guards/town halls onto TD routes');
  unit.position=gridToWorldData(sim.map.grid,site.col,site.row);unit.col=site.col;unit.row=site.row;
  tickWorldSites(sim.state,sim.map.grid,4);assert.equal(site.secured,false);
  sim.state.enemies=sim.state.enemies.filter(e=>!site.guardIds.includes(e.id));
  const wood=sim.state.resources!.wood;
  tickWorldSites(sim.state,sim.map.grid,4);assert.equal(site.secured,true);assert.equal(sim.state.resources!.wood,wood+80);
  tickWorldSites(sim.state,sim.map.grid,4);assert.equal(sim.state.resources!.wood,wood+80);
  const enemy:Enemy={id:'attack-test',typeId:'skeleton',hp:100,maxHp:100,pathProgress:0,position:{...unit.position,x:unit.position.x+.5},alive:true,rtsRole:'guard',homeCol:unit.col,homeRow:unit.row};
  sim.state.enemies.push(enemy);
  const hp=unit.hp;
  tickRtsOpponents({state:sim.state,types:new Map(DEFAULT_CATALOG.enemies.map(e=>[e.id,e])),grid:sim.map.grid,
    navigator:new GridNavigator(sim.map.grid,()=>false),base:{col:8,row:8},dt:1/30,heightAt:()=>0});
  assert(unit.hp<hp,'guards must fight player units, not walk through them');
  console.log('✓ All maps have guarded activities and patrols; capture rewards cannot repeat; enemies fight units');
}
{
  const motion=createRigMotion(0,0);
  for(let i=0;i<120;i++) advanceRigMotion(motion,Math.floor(i/2)/30,0,1/60,1);
  const speed=motion.speed;
  advanceRigMotion(motion,motion.targetX,0,1/60,1);
  assert(motion.speed>0 && motion.speed>speed*.6,'no idle-pose snapping between simulation ticks');
  for(let i=0;i<120;i++) advanceRigMotion(motion,motion.targetX,0,1/60,1);
  assert(motion.speed<.001);
  console.log('✓ Rig gait remains smooth between fixed ticks and settles when stopped');
}
console.log('✅ RTS gameplay regressions passed');
