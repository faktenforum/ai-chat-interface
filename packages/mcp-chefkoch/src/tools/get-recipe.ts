import type { TextContent } from '@modelcontextprotocol/sdk/types.js';
import { GetRecipeSchema } from '../schemas/get-recipe.schema.ts';
import { fetchRecipe } from '../client/recipe.ts';
import { ChefkochError } from '../utils/errors.ts';
import { logger } from '../utils/logger.ts';

export async function getRecipe(input: unknown): Promise<{ content: TextContent[] }> {
  const parsed = GetRecipeSchema.safeParse(input);
  if (!parsed.success) {
    throw new ChefkochError(
      `Invalid input: ${parsed.error.message}`,
      'VALIDATION_ERROR',
    );
  }
  const { url, recipeId } = parsed.data;
  const urlOrId = url ?? recipeId!;
  try {
    const recipe = await fetchRecipe(urlOrId);
    const text = JSON.stringify(recipe, null, 2);
    return { content: [{ type: 'text', text }] };
  } catch (error) {
    logger.error(
      { urlOrId, error: error instanceof Error ? error.message : String(error) },
      'get_recipe failed',
    );
    throw error;
  }
}
