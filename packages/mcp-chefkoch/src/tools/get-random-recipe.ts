import type { TextContent } from '@modelcontextprotocol/sdk/types.js';
import { getRandomRecipe } from '../client/random.ts';
import { logger } from '../utils/logger.ts';

export async function getRandomRecipeTool(_input: unknown): Promise<{ content: TextContent[] }> {
  try {
    const recipe = await getRandomRecipe();
    const text = JSON.stringify(recipe, null, 2);
    return { content: [{ type: 'text', text }] };
  } catch (error) {
    logger.error(
      { error: error instanceof Error ? error.message : String(error) },
      'get_random_recipe failed',
    );
    throw error;
  }
}
