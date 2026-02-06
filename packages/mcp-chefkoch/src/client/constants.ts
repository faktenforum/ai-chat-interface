/**
 * Chefkoch.de base URL and request configuration
 */
export const BASE_URL = 'https://www.chefkoch.de';
export const RECIPES_BASE = `${BASE_URL}/rezepte`;
export const RANDOM_RECIPE_URL = `${BASE_URL}/rezepte/zufallsrezept/`;
export const DAILY_COOKING_URL = `${BASE_URL}/rezepte/was-koche-ich-heute/`;
export const DAILY_BAKING_URL = `${BASE_URL}/rezepte/was-backe-ich-heute/`;

export const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36';

/**
 * Search filter options and internal IDs (from Python SearchRetriever)
 */
export const PREP_TIMES = ['15', '30', '60', '120', 'Alle'] as const;
export const PREP_TIME_IDS = ['15', '30', '60', '120', ''] as const;

export const RATINGS = ['Alle', '2', '3', '4', 'Top'] as const;
export const RATING_IDS = ['1', '2', '3', '4', '4.5'] as const;

export const SORT_OPTIONS = ['Empfehlung', 'Bewertung', 'Neuheiten'] as const;
export const SORT_IDS = ['2', '3', '6'] as const;
