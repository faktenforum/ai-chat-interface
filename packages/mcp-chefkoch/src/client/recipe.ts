/**
 * Recipe fetcher and parser for chefkoch.de
 * Ported from FaserF/chefkoch (fix-newchefkochwebsites) - supports __NEXT_DATA__ and JSON-LD.
 */

import * as cheerio from 'cheerio';
import { RECIPES_BASE, USER_AGENT } from './constants.ts';

export interface RecipeData {
  title: string;
  image_url: string;
  prep_time_minutes: number | null;
  cook_time_minutes: number | null;
  total_time_minutes: number | null;
  difficulty: string;
  servings: number | null;
  ingredients: string[];
  instructions: string;
  author: string;
  calories: string;
  rating: number;
  number_ratings: number;
  url: string;
  is_plus_recipe: boolean;
}

const DIFFICULTY_MAP: Record<string, string> = {
  SIMPLE: 'simpel',
  NORMAL: 'normal',
  ADVANCED: 'pfiffig',
};

/**
 * Parse ISO 8601 duration (e.g. PT30M, PT1H15M) to minutes
 */
function parseDurationToMinutes(val: unknown): number | null {
  if (val == null) return null;
  if (typeof val === 'number') return val;
  const s = String(val).trim();
  if (!s.startsWith('P')) return null;
  let total = 0;
  const hoursMatch = s.match(/(\d+)H/i);
  if (hoursMatch) total += Number(hoursMatch[1]) * 60;
  const minutesMatch = s.match(/(\d+)M/i);
  if (minutesMatch) total += Number(minutesMatch[1]);
  return total > 0 ? total : null;
}

/**
 * Scrape time from HTML by searching for label text (e.g. "Zubereitungszeit")
 */
function scrapeTimeMinutes($: cheerio.CheerioAPI, searchTexts: string[]): number | null {
  const text = $('body').text();
  const lower = text.toLowerCase();
  for (const search of searchTexts) {
    const idx = lower.indexOf(search.toLowerCase());
    if (idx === -1) continue;
    const snippet = text.slice(idx, idx + 80);
    const hoursMatch = snippet.match(/(\d+)\s*(?:Std\.?|Stunde|Stunden|h)/i);
    const minutesMatch = snippet.match(/(\d+)\s*(?:Min\.?|Minuten)/i);
    let total = 0;
    if (hoursMatch) total += Number(hoursMatch[1]) * 60;
    if (minutesMatch) total += Number(minutesMatch[1]);
    if (total > 0) return total;
  }
  return null;
}

/**
 * Fetch recipe page and parse into RecipeData
 */
export async function fetchRecipe(urlOrId: string): Promise<RecipeData> {
  let url: string;
  if (urlOrId.startsWith('http')) {
    url = urlOrId.split('?')[0];
    if (!url.includes('chefkoch.de')) {
      throw new Error('Invalid URL: must be from chefkoch.de');
    }
  } else {
    url = `${RECIPES_BASE}/${urlOrId}`;
  }

  const res = await fetch(url, {
    headers: { 'User-Agent': USER_AGENT },
    redirect: 'follow',
  });
  if (!res.ok) {
    throw new Error(`Failed to fetch recipe: ${res.status} ${res.statusText}`);
  }
  const html = await res.text();
  const $ = cheerio.load(html);

  const isNewFormat = $('#__NEXT_DATA__').length > 0;
  const hasPlusBadge = $('.ds-plus-badge').length > 0;
  const hasSubscriptionCard = $('.ds-subscription-card--plus').length > 0;
  const h3WithPlus = $('h3').filter((_, el) => $(el).text().includes('Mit PLUS'));
  const hasOldPlus = $('.subscription-card').length > 0 && h3WithPlus.length > 0;
  const isPlusRecipe = (hasPlusBadge && hasSubscriptionCard) || hasOldPlus;

  let recipeData: Record<string, unknown> = {};

  if (!isPlusRecipe && isNewFormat) {
    const nextDataEl = $('#__NEXT_DATA__');
    const raw = nextDataEl.html();
    if (raw) {
      try {
        const data = JSON.parse(raw) as { props?: { pageProps?: { recipe?: unknown; initialRecipe?: unknown } } };
        const pageProps = data?.props?.pageProps ?? {};
        recipeData = (pageProps.recipe ?? pageProps.initialRecipe ?? {}) as Record<string, unknown>;
      } catch {
        // ignore
      }
    }
  }

  if (!isPlusRecipe && Object.keys(recipeData).length === 0) {
    $('script[type="application/ld+json"]').each((_, el) => {
      const raw = $(el).html();
      if (!raw) return;
      try {
        const data = JSON.parse(raw) as { '@type'?: string; '@graph'?: Array<{ '@type'?: string }> };
        if (data['@type'] === 'Recipe') {
          recipeData = data as unknown as Record<string, unknown>;
          return false; // break
        }
        if (Array.isArray(data['@graph'])) {
          for (const item of data['@graph']) {
            if (item?.['@type'] === 'Recipe') {
              recipeData = item as unknown as Record<string, unknown>;
              return false;
            }
          }
        }
      } catch {
        // ignore
      }
    });
  }

  // Title
  let title = 'Chefkoch Plus Recipe (Content Blocked)';
  if (!isPlusRecipe) {
    const titleStr =
      (recipeData.title as string) ?? (recipeData.name as string) ?? $('h1').first().text().trim() ?? 'Title not found';
    title = titleStr.split(' von ')[0].split(' - ')[0].trim();
  }

  // Image
  let image_url = 'picture not found';
  if (isPlusRecipe) {
    const og = $('meta[property="og:image"]').attr('content');
    if (og) image_url = og;
    else image_url = 'picture not found (Chefkoch Plus)';
  } else if (isNewFormat && recipeData.image && typeof recipeData.image === 'object' && recipeData.image !== null && 'url' in recipeData.image) {
    image_url = String((recipeData.image as { url: string }).url);
  } else if (Array.isArray(recipeData.image) && recipeData.image.length > 0) {
    image_url = String(recipeData.image[0]);
  } else if (typeof recipeData.image === 'string') {
    image_url = recipeData.image;
  } else {
    const og = $('meta[property="og:image"]').attr('content');
    if (og) image_url = og;
  }

  // Times
  const prepTime =
    parseDurationToMinutes(recipeData.preparationTime ?? recipeData.prepTime) ??
    scrapeTimeMinutes($, ['Zubereitungszeit', 'Arbeitszeit']);
  const cookTime =
    parseDurationToMinutes(recipeData.cookingTime ?? recipeData.cookTime) ??
    scrapeTimeMinutes($, ['Koch-/Backzeit', 'Backzeit']);
  const totalTime =
    parseDurationToMinutes(recipeData.totalTime) ??
    scrapeTimeMinutes($, ['Gesamtzeit']) ??
    (prepTime != null && cookTime != null ? prepTime + cookTime : null);

  // Difficulty
  let difficulty = 'unknown';
  if (!isPlusRecipe) {
    if (isNewFormat && recipeData.difficulty) {
      difficulty = DIFFICULTY_MAP[String(recipeData.difficulty).toUpperCase()] ?? String(recipeData.difficulty).toLowerCase();
    } else if (recipeData.recipeDifficulty) {
      difficulty = String(recipeData.recipeDifficulty).toLowerCase();
    }
  } else {
    difficulty = 'blocked';
  }
  // Fallback: scrape difficulty from HTML (Nuxt/Vue pages use __NUXT_DATA__, not __NEXT_DATA__)
  if (!isPlusRecipe && difficulty === 'unknown') {
    const difficultyTitle = $('.recipe-meta-property-group__title').filter((_, el) =>
      $(el).text().trim().toLowerCase() === 'schwierigkeit',
    );
    if (difficultyTitle.length) {
      const val = difficultyTitle.closest('.recipe-meta-property-group__labels').find('.recipe-meta-property-group__value').first().text().trim();
      if (val) difficulty = val.toLowerCase();
    }
  }

  // Servings
  let servings: number | null = null;
  if (!isPlusRecipe) {
    if (recipeData.servings != null) servings = Number(recipeData.servings);
    else if (recipeData.recipeYield != null) {
      const m = String(recipeData.recipeYield).match(/\d+/);
      if (m) servings = Number(m[0]);
    }
    if (servings == null) {
      const val = $('input[name="portionen"]').attr('value');
      if (val) servings = Number(val) || null;
    }
  }

  // Ingredients
  let ingredients: string[] = [];
  if (isPlusRecipe) {
    ingredients = ['Content blocked (Chefkoch Plus)'];
  } else if (Array.isArray((recipeData as { ingredientGroups?: Array<{ ingredients?: Array<{ amount?: unknown; unit?: string; name?: string }> }> }).ingredientGroups)) {
    const groups = (recipeData as { ingredientGroups: Array<{ ingredients?: Array<{ amount?: unknown; unit?: string; name?: string }> }> }).ingredientGroups;
    for (const group of groups) {
      for (const ing of group.ingredients ?? []) {
        const parts = [
          ing.amount != null ? String(ing.amount) : '',
          ing.unit ?? '',
          ing.name ?? '',
        ].filter(Boolean);
        ingredients.push(parts.join(' ').trim());
      }
    }
  } else if (Array.isArray(recipeData.recipeIngredient)) {
    ingredients = recipeData.recipeIngredient.map(String);
  }

  if (ingredients.length === 0 && !isPlusRecipe) {
    $('table.ingredients tr').each((_, row) => {
      const amount = $(row).find('.td-amount').text().trim();
      const name = $(row).find('.td-name').text().trim();
      if (amount || name) ingredients.push(`${amount} ${name}`.trim());
    });
  }

  // Instructions
  let instructions = '';
  if (isPlusRecipe) {
    instructions = 'Content blocked (Chefkoch Plus)';
  } else if (typeof recipeData.instructions === 'string') {
    instructions = recipeData.instructions.trim();
  } else if (Array.isArray(recipeData.recipeInstructions)) {
    const texts = (recipeData.recipeInstructions as Array<{ text?: string }>)
      .map((s) => (s && typeof s.text === 'string' ? s.text : ''))
      .filter(Boolean);
    instructions = texts.join('\n').trim();
  } else if (typeof recipeData.recipeInstructions === 'string') {
    instructions = recipeData.recipeInstructions.trim();
  }
  if (!instructions && !isPlusRecipe) {
    const spans = $('span.instruction__text');
    if (spans.length) {
      instructions = spans
        .map((_, el) => $(el).text().trim())
        .get()
        .join('\n')
        .trim();
    } else {
      const div = $('#rezept-zubereitung');
      if (div.length) instructions = div.text().replace(/\s+/g, '\n').trim();
    }
  }

  // Author
  let author = 'Unbekannt';
  if (isPlusRecipe) author = 'Unbekannt (Chefkoch Plus)';
  else if (recipeData.author && typeof recipeData.author === 'object' && recipeData.author !== null && 'username' in recipeData.author) {
    author = String((recipeData.author as { username: string }).username);
  } else if (Array.isArray(recipeData.author) && recipeData.author.length > 0 && recipeData.author[0] && typeof recipeData.author[0] === 'object' && recipeData.author[0] !== null && 'name' in recipeData.author[0]) {
    author = String((recipeData.author[0] as { name: string }).name);
  } else if (recipeData.author && typeof recipeData.author === 'object' && recipeData.author !== null && 'name' in recipeData.author) {
    author = String((recipeData.author as { name: string }).name);
  } else {
    const tag = $('.recipe-author__name').first().text().trim();
    if (tag) author = tag;
  }

  // Calories
  let calories = 'k.A.';
  if (isPlusRecipe) calories = 'k.A. (Chefkoch Plus)';
  else {
    const nutrition = recipeData.nutrition as Record<string, unknown> | undefined;
    if (nutrition?.nutrients && typeof nutrition.nutrients === 'object' && nutrition.nutrients !== null && 'calories' in nutrition.nutrients) {
      const kcal = (nutrition.nutrients as { calories: unknown }).calories;
      if (kcal != null) calories = `${kcal} kcal`;
    } else if (nutrition?.calories != null) {
      calories = String(nutrition.calories);
    } else {
      const tag = $('.recipe-calories').first().text().trim();
      if (tag) calories = tag;
    }
  }

  // Rating
  const ratingBlock = (recipeData.rating ?? recipeData.aggregateRating) as Record<string, unknown> | undefined;
  const number_ratings = isPlusRecipe ? 0 : Number(ratingBlock?.numRatings ?? ratingBlock?.ratingCount ?? 0) || 0;
  const rating = isPlusRecipe ? 0 : Number(ratingBlock?.average ?? ratingBlock?.ratingValue ?? 0) || 0;

  return {
    title,
    image_url,
    prep_time_minutes: prepTime,
    cook_time_minutes: cookTime,
    total_time_minutes: totalTime,
    difficulty,
    servings,
    ingredients,
    instructions,
    author,
    calories,
    rating,
    number_ratings,
    url,
    is_plus_recipe: isPlusRecipe,
  };
}
