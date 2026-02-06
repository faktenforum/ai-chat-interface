import { z } from 'zod';

export const SearchRecipesSchema = z.object({
  query: z.string().min(1).describe('Search query for recipes'),
  page: z.number().int().min(1).optional().default(1).describe('Page number'),
  prep_times: z.enum(['15', '30', '60', '120', 'Alle']).optional().describe('Max preparation time'),
  ratings: z.enum(['Alle', '2', '3', '4', 'Top']).optional().describe('Minimum rating filter'),
  sort: z.enum(['Empfehlung', 'Bewertung', 'Neuheiten']).optional().describe('Sort order'),
  properties: z.array(z.string()).optional().describe('Properties: Einfach, Schnell, Basisrezepte, Preiswert'),
  health: z.array(z.string()).optional().describe('Diet: Vegetarisch, Vegan, etc.'),
  categories: z.array(z.string()).optional().describe('Recipe category'),
  countries: z.array(z.string()).optional().describe('Cuisine country'),
  meal_type: z.array(z.string()).optional().describe('Meal type: Hauptspeise, Vorspeise, etc.'),
});

export type SearchRecipesInput = z.infer<typeof SearchRecipesSchema>;
