import {loadCharacterRecipe, type CharacterRecipeV1} from '@voxkera/engine-recipe';
import {compileCharacterAsset, CharacterAnimator, type RGB, createIndexedPalette} from '@voxkera/voxel-core';
import {findNavigationPath, type GridData} from '@voxkera/engine-terrain';
import {validateSceneKit, type SceneKitSpec} from '@voxkera/engine-scene';
declare const recipe:CharacterRecipeV1, kit:SceneKitSpec;
const grid:GridData={cols:3,rows:3,cellSize:1};
findNavigationPath(grid,{col:0,row:0},{col:2,row:2},()=>false);
const color:RGB=[1,0,0];createIndexedPalette([{label:'red',base:color}],color);
const parsed=loadCharacterRecipe('{}');void parsed;
const result=compileCharacterAsset(recipe);if(result.ok){const name:string=result.asset.character.name;void name;}
validateSceneKit(kit);void CharacterAnimator;
