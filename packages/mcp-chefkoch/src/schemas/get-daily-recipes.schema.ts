import { z } from 'zod';

export const GetDailyRecipesSchema = z.object({
  type: z.enum(['kochen', 'backen']).describe("'kochen' for cooking tips, 'backen' for baking tips"),
});

export type GetDailyRecipesInput = z.infer<typeof GetDailyRecipesSchema>;
