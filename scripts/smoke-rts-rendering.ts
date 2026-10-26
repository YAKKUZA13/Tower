import assert from 'node:assert/strict';
import { NullEngine } from '@babylonjs/core/Engines/nullEngine.js';
import { Scene } from '@babylonjs/core/scene.js';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder.js';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial.js';
import { AreaEffectRenderer } from '@voxkera/scene-babylon';
import { assembleRig, cloneRig, disposeRig, collectRigMeshes } from '@voxkera/voxel-babylon';
import { skeletonRigged } from '../client/src/babylon/voxel/importers/manual-parts';
import { SpellEffectManager } from '../client/src/babylon/units/unit-effects';

const engine=new NullEngine(),scene=new Scene(engine);
{
  const meshCount=scene.meshes.length,materialCount=scene.materials.length;
  const effects=new AreaEffectRenderer(scene);
  for(let i=0;i<10;i++) effects.spawn({id:`spell-${i}`,kind:i%2?'freeze':'meteor',center:{x:0,y:0,z:0},radius:3,duration:2});
  assert(scene.meshes.some(mesh=>mesh.name.startsWith('meteor-projectile')));
  effects.update(.8);
  assert(scene.meshes.filter(mesh=>mesh.name.startsWith('meteor-projectile')).every(mesh=>!mesh.isEnabled()));
  effects.update(2);
  assert.equal(scene.meshes.length,meshCount);assert.equal(scene.materials.length,materialCount);
  effects.dispose();effects.dispose();
  console.log('✓ Meteor flight, impact and frost shaders release every mesh/material at expiry');
}
{
  const material=new StandardMaterial('shared-pick',scene);
  const master=assembleRig(scene,skeletonRigged()),clone=cloneRig(master);
  const pick=MeshBuilder.CreateBox('pick',{},scene);pick.parent=clone;pick.material=material;
  assert(collectRigMeshes(master).every(mesh=>!mesh.doNotSyncBoundingInfo));
  assert(collectRigMeshes(clone).every(mesh=>!mesh.doNotSyncBoundingInfo));
  const expected=scene.meshes.length-collectRigMeshes(clone).length;
  disposeRig(clone);assert.equal(scene.meshes.length,expected);
  assert(scene.materials.includes(material),'shared picking material must survive another rig dying');
  disposeRig(master);material.dispose();
  assert.equal(scene.meshes.length,0);
  console.log('✓ Rig parts use live bounds; disposal leaves no body fragments and preserves shared materials');
}
{
  const manager=new SpellEffectManager(scene,{cols:8,rows:8,cellSize:1},[]);
  const state={tick:0,activeSpells:[{id:'cast-1',spellId:'freeze',col:2,row:2,remainingTicks:60,radius:2}]};
  assert.equal(manager.consumeNewSpell(state)?.id,'cast-1');manager.sync(state);
  for(let i=0;i<20;i++) assert.equal(manager.consumeNewSpell(state),null);
  manager.dispose();assert.equal(scene.meshes.length,0);
  console.log('✓ Commander cast animation consumes an event once, not every frame');
}
scene.dispose();engine.dispose();
console.log('✅ RTS rendering lifecycle regressions passed');
