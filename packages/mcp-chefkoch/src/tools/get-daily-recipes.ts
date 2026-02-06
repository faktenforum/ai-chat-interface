import type { TextContent } from '@modelcontextprotocol/sdk/types.js';
import { GetDailyRecipesSchema } from '../schemas/get-daily-recipes.schema.ts';
import { getDailyRecipes } from '../client/daily.ts';
import { ChefkochError } from '../utils/errors.ts';
import { logger } from '../utils/logger.ts';

export async function getDailyRecipesTool(input: unknown): Promise<{ content: TextContent[] }> {
  const parsed = GetDailyRecipesSchema.safeParse(input);
  if (!parsed.success) {
    throw new ChefkochError(
      `Invalid input: ${parsed.error.message}`,
      'VALIDATION_ERROR',
    );
  }
  try {
    const results = await getDailyRecipes(parsed.data.type);
    const text = JSON.stringify(results, null, 2);
    return { content: [{ type: 'text', text }] };
  } catch (error) {
    logger.error(
      { type: parsed.data.type, error: error instanceof Error ? error.message : String(error) },
      'get_daily_recipes failed',
    );
    throw error;
  }
}
