import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadCharacterRecipe } from '@voxkera/engine-recipe';
import { compileCharacterAsset, CharacterAnimator, VoxelStampRegistry, assembleRecipe, createIndexedPalette } from '@voxkera/voxel-core';
import { createCharacterAssetTemplate } from '@voxkera/voxel-babylon';
import { findNavigationPath } from '@voxkera/engine-terrain';
import { validateSceneKit, rasterizeNavBlockers } from '@voxkera/engine-scene';
import { buildSceneKit } from '@voxkera/scene-babylon';
import { NullEngine } from '@babylonjs/core/Engines/nullEngine.js';
import { Scene } from '@babylonjs/core/scene.js';
const here=dirname(fileURLToPath(import.meta.url));
const parsed=loadCharacterRecipe(readFileSync(join(here,'node_modules/@voxkera/engine-recipe/skills/tower-assets/assets/starter.json'),'utf8'));assert.ok(parsed.ok);
const compiled=compileCharacterAsset(parsed.recipe);assert.ok(compiled.ok);
const engine=new NullEngine(),scene=new Scene(engine);
const baseline=[scene.meshes.length,scene.geometries.length,scene.materials.length,scene.transformNodes.length];
try {
  const template=createCharacterAssetTemplate(scene,compiled.asset),a=template.instantiate(),b=template.instantiate();
  a.play('look');a.advance(.25);assert.equal(b.parts.get('head').rotation.y,0);
  assert.equal(template.liveInstances,2);template.dispose();a.dispose();b.dispose();
  assert.deepEqual([scene.meshes.length,scene.geometries.length,scene.materials.length,scene.transformNodes.length],baseline);
  const kit={formatVersion:1,name:'consumer-box',materials:[{id:'base',baseColor:[.3,.5,.4],roughness:.9}],nodes:[{id:'box',primitive:{kind:'box',size:[1,1,1]},material:'base',collider:{kind:'box',size:[1,1,1],navBlocking:true},socketId:'top'}],emitters:[],budget:{maxNodes:5,maxEstimatedTriangles:100,maxEmitters:0,maxAnimatedInstances:0},quality:{targetStyle:'neutral',criticalFeatures:['box'],failureModes:['missing box'],requiredViews:['front']}};
  assert.ok(validateSceneKit(kit).ok);
  assert.ok(rasterizeNavBlockers(kit,{cols:3,rows:3,cellSize:1}).length>0);
  const built=buildSceneKit(scene,kit);assert.equal(built.colliders.length,1);assert.ok(built.sockets.has('top'));built.dispose();
  assert.deepEqual([scene.meshes.length,scene.geometries.length,scene.materials.length,scene.transformNodes.length],baseline);
  assert.ok(findNavigationPath({cols:3,rows:3,cellSize:1},{col:0,row:0},{col:2,row:2},()=>false));
  const registry=new VoxelStampRegistry({colors:{stone:[1,0,0]},resolveMaterial:()=>[0,1,0]});
  assert.ok(assembleRecipe([{id:'a',asset:'box',params:{},position:[0,0,0],rotation:[0,0,0]}],registry).every(v=>v.color[1]===1));
  assert.equal(createIndexedPalette([{label:'red',base:[1,0,0]}],[0,0,0]).snapToPalette([1,0,0]),0);
  assert.equal(typeof CharacterAnimator,'function');
  for(const name of ['engine-recipe','engine-terrain','engine-scene','voxel-core','voxel-babylon','scene-babylon']) {
    const api=await import(`@voxkera/${name}`);
    for(const forbidden of ['VOXEL_BUILDERS','towerBase','towerAccent','relicAccent','enemyEye','SLOT_CATALOG','assembleCharacter'])assert.ok(!(forbidden in api));
    for(const subpath of ['src/index.ts','dist/index.js'])await assert.rejects(import(`@voxkera/${name}/${subpath}`),{code:'ERR_PACKAGE_PATH_NOT_EXPORTED'});
  }
} finally {scene.dispose();engine.dispose();}
console.log('PASS packed JS runtime: characters, independent poses, lifecycle, scene colliders/sockets, navigation, injectable materials/palette and closed exports');
