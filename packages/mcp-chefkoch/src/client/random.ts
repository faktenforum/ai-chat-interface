/**
 * Fetch a random recipe from chefkoch.de (zufallsrezept).
 * Retries up to maxRetries if the redirect lands on a Plus recipe.
 */

import { RANDOM_RECIPE_URL, USER_AGENT } from './constants.ts';
import type { RecipeData } from './recipe.ts';
import { fetchRecipe } from './recipe.ts';

const MAX_RETRIES = 3;

/**
 * Get one random recipe. Follows redirect from zufallsrezept; retries if result is Plus.
 */
export async function getRandomRecipe(maxRetries: number = MAX_RETRIES): Promise<RecipeData> {
  let lastError: Error | null = null;
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      const res = await fetch(RANDOM_RECIPE_URL, {
        headers: { 'User-Agent': USER_AGENT },
        redirect: 'follow',
      });
      if (!res.ok) {
        throw new Error(`Random recipe redirect failed: ${res.status}`);
      }
      const finalUrl = res.url;
      if (!finalUrl || !finalUrl.includes('chefkoch.de/rezepte/')) {
        throw new Error('Invalid redirect URL from zufallsrezept');
      }
      const recipe = await fetchRecipe(finalUrl);
      if (!recipe.is_plus_recipe) {
        return recipe;
      }
      lastError = new Error(`Skipping Chefkoch Plus recipe (attempt ${attempt + 1})`);
    } catch (e) {
      lastError = e instanceof Error ? e : new Error(String(e));
    }
  }
  throw lastError ?? new Error(`Failed to get non-Plus random recipe after ${maxRetries} attempts`);
}
