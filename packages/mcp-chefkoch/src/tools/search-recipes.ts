import type { TextContent } from '@modelcontextprotocol/sdk/types.js';
import { SearchRecipesSchema } from '../schemas/search-recipes.schema.ts';
import { searchRecipes } from '../client/search.ts';
import { ChefkochError } from '../utils/errors.ts';
import { logger } from '../utils/logger.ts';

export async function searchRecipesTool(input: unknown): Promise<{ content: TextContent[] }> {
  const parsed = SearchRecipesSchema.safeParse(input);
  if (!parsed.success) {
    throw new ChefkochError(
      `Invalid input: ${parsed.error.message}`,
      'VALIDATION_ERROR',
    );
  }
  const { query, page, prep_times, ratings, sort, properties, health, categories, countries, meal_type } = parsed.data;
  try {
    const results = await searchRecipes({
      query,
      page,
      prep_times,
      ratings,
      sort,
      properties,
      health,
      categories,
      countries,
      meal_type,
    });
    const text = JSON.stringify(results, null, 2);
    return { content: [{ type: 'text', text }] };
  } catch (error) {
    logger.error(
      { query, error: error instanceof Error ? error.message : String(error) },
      'search_recipes failed',
    );
    throw error;
  }
}
