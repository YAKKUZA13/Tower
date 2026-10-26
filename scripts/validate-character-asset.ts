import { readFileSync } from 'node:fs';
import { characterRecipeJsonSchema, loadCharacterRecipe } from '@voxkera/engine-recipe';
import { compileCharacterAsset } from '@voxkera/voxel-core';

if (process.argv[2] === '--schema') {
  console.log(JSON.stringify(characterRecipeJsonSchema(), null, 2));
} else {
  const path = process.argv[2];
  if (!path) throw new Error('Usage: tsx scripts/validate-character-asset.ts <recipe.json> | --schema');
  const parsed = loadCharacterRecipe(readFileSync(path, 'utf8'));
  const result = parsed.ok ? compileCharacterAsset(parsed.recipe) : parsed;
  if (!result.ok) { console.error(JSON.stringify(result, null, 2)); process.exitCode = 1; }
  else console.log(JSON.stringify({ ok: true, id: result.asset.recipe.id, ...result.asset.metrics }, null, 2));
}
