import {loadCharacterRecipe, type CharacterRecipeV1} from '@voxkera/engine-recipe';
import {compileCharacterAsset, CharacterAnimator, createIndexedPalette, type RGB} from '@voxkera/voxel-core';
import {createCharacterAssetTemplate} from '@voxkera/voxel-babylon';
import {findNavigationPath, type GridData} from '@voxkera/engine-terrain';
import {validateSceneKit, type SceneKitSpec} from '@voxkera/engine-scene';
import {buildSceneKit, type SceneKitHandle} from '@voxkera/scene-babylon';
import type {Scene} from '@babylonjs/core/scene.js';
const grid:GridData={cols:3,rows:3,cellSize:1};
const path=findNavigationPath(grid,{col:0,row:0},{col:2,row:2},()=>false);void path;
const color:RGB=[.2,.3,.4];createIndexedPalette([{label:'base',base:color}],color);
declare const scene:Scene, kit:SceneKitSpec, recipe:CharacterRecipeV1;
const validation=validateSceneKit(kit);const handle:SceneKitHandle=buildSceneKit(scene,kit);void handle;void validation;
const parsed=loadCharacterRecipe('{}');void parsed;
const compiled=compileCharacterAsset(recipe);
if(compiled.ok) {const template=createCharacterAssetTemplate(scene,compiled.asset);const instance=template.instantiate();instance.play('look');instance.dispose();template.dispose();}
void CharacterAnimator;
