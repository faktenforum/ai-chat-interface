import { z } from 'zod';

export const GetRecipeSchema = z.object({
  url: z.string().url().optional().describe('Full URL of the recipe on chefkoch.de'),
  recipeId: z.string().optional().describe('Recipe ID or path segment (e.g. 745721177147257/Lasagne.html)'),
}).refine((data) => data.url != null || data.recipeId != null, {
  message: 'Either url or recipeId must be provided',
});

export type GetRecipeInput = z.infer<typeof GetRecipeSchema>;
