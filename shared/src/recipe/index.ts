/**
 * recipe-compiler public API (Фаза P-MO, research §15).
 * Декларативная авторка моделей: JSON recipe → compile() → плоский v2 IR (PartV2[]).
 * LLM/human-авторит .json (Volume/Part/Group/Mirror/Row/Scatter); компилятор эммитит IR.
 * Клиентский assembleRecipe → voxel-stamps → greedy mesh (P-MO клиентская часть).
 */
export * from './types.js';
export * from './errors.js';
export * from './place.js';
export * from './xorshift32.js';
export { compile, type CompileResult } from './compile.js';

/** loadRecipe: JSON-строка → RecipeV3 (базовая валидация формата). Бросает при невалидном JSON. */
export function loadRecipe(json: string): import('./types.js').RecipeV3 {
  const data = JSON.parse(json);
  if (!data || typeof data !== 'object') throw new Error('Recipe JSON: not an object');
  if (data.format_version !== 3) throw new Error(`Recipe JSON: format_version must be 3 (got ${data.format_version})`);
  if (!Array.isArray(data.units)) throw new Error('Recipe JSON: units must be an array');
  return data as import('./types.js').RecipeV3;
}
