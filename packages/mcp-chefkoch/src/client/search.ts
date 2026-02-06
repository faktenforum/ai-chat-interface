/**
 * Search recipes on chefkoch.de
 * Builds search URL from filter options and parses recipe cards (summaries only, no full fetch).
 */

import * as cheerio from 'cheerio';
import { USER_AGENT } from './constants.ts';
import {
  PREP_TIMES,
  PREP_TIME_IDS,
  RATINGS,
  RATING_IDS,
  SORT_OPTIONS,
  SORT_IDS,
} from './constants.ts';

export interface RecipeSummary {
  title: string;
  url: string;
  image_url?: string;
  rating?: number;
}

const PROPERTIES = ['Einfach', 'Schnell', 'Basisrezepte', 'Preiswert'] as const;
const PROPERTY_IDS = ['50', '49', '79', '48'] as const;
const HEALTH = [
  'Vegetarisch',
  'Vegan',
  'Kalorienarm',
  'Low Carb',
  'Ketogen',
  'Paleo',
  'Fettarm',
  'Trennkost',
  'Vollwert',
] as const;
const HEALTH_IDS = ['32', '57', '55', '9948', '9947', '7710', '56', '112', '143'] as const;
const CATEGORIES = [
  'Auflauf',
  'Pizza',
  'Reis- oder Nudelsalat',
  'Salat',
  'Salatdressing',
  'Tarte',
  'Fingerfood',
  'Dips',
  'Saucen',
  'Suppe',
  'Klöße',
  'Brot und Brötchen',
  'Brotspeise',
  'Aufstrich',
  'Süßspeise',
  'Eis',
  'Kuchen',
  'Kekse',
  'Torte',
  'Confiserie',
  'Getränke',
  'Shake',
  'Gewürzmischung',
  'Pasten',
  'Studentenküche',
] as const;
const CATEGORY_IDS = [
  '30', '82', '94', '15', '3669', '122', '52', '35', '34', '40', '166', '108', '46', '51',
  '89', '127', '92', '147', '93', '157', '11', '113', '313', '243', '211',
] as const;
const COUNTRIES = [
  'Deutschland', 'Italien', 'Spanien', 'Portugal', 'Frankreich', 'England', 'Osteuropa',
  'Skandinavien', 'Griechenland', 'Türkei', 'Russland', 'Naher Osten', 'Asien', 'Indien',
  'Japan', 'Amerika', 'Mexiko', 'Karibik', 'Lateinamerika', 'Afrika', 'Marokko', 'Ägypten', 'Australien',
] as const;
const COUNTRY_IDS = [
  '65', '28', '43', '149', '84', '117', '86', '133', '44', '103', '212', '163', '14', '13',
  '148', '38', '74', '95', '114', '101', '131', '168', '145',
] as const;
const MEAL_TYPES = ['Hauptspeise', 'Vorspeise', 'Beilage', 'Dessert', 'Snack', 'Frühstück'] as const;
const MEAL_TYPE_IDS = ['21', '19', '36', '90', '71', '53'] as const;

function indexOf<T extends string>(arr: readonly T[], val: string): number {
  const i = arr.indexOf(val as T);
  return i >= 0 ? i : -1;
}

function toIds(
  values: string[],
  labels: readonly string[],
  ids: readonly string[],
): string[] {
  return values
    .map((v) => {
      const i = indexOf(labels, v);
      return i >= 0 ? ids[i] : null;
    })
    .filter((x): x is string => x != null);
}

export interface SearchOptions {
  query: string;
  page?: number;
  properties?: string[];
  health?: string[];
  categories?: string[];
  countries?: string[];
  meal_type?: string[];
  prep_times?: string;
  ratings?: string;
  sort?: string;
}

/**
 * Build search URL from options (mirrors Python SearchRetriever.get_recipes URL)
 */
function buildSearchUrl(options: SearchOptions): string {
  const page = Math.max(1, options.page ?? 1);
  const prepTimes = options.prep_times ?? 'Alle';
  const ratings = options.ratings ?? 'Alle';
  const sort = options.sort ?? 'Empfehlung';

  const prepIdx = indexOf(PREP_TIMES, prepTimes);
  const prepId = prepIdx >= 0 ? PREP_TIME_IDS[prepIdx] : '';
  const ratingIdx = indexOf(RATINGS, ratings);
  const ratingId = ratingIdx >= 0 ? RATING_IDS[ratingIdx] : '1';
  const sortIdx = indexOf(SORT_OPTIONS, sort);
  const sortId = sortIdx >= 0 ? SORT_IDS[sortIdx] : '2';

  const propIds = toIds(options.properties ?? [], PROPERTIES, PROPERTY_IDS);
  const healthIds = toIds(options.health ?? [], HEALTH, HEALTH_IDS);
  const catIds = toIds(options.categories ?? [], CATEGORIES, CATEGORY_IDS);
  const countryIds = toIds(options.countries ?? [], COUNTRIES, COUNTRY_IDS);
  const mealIds = toIds(options.meal_type ?? [], MEAL_TYPES, MEAL_TYPE_IDS);

  const combined = 't' + [...propIds, ...healthIds, ...catIds, ...countryIds, ...mealIds].join(',');
  const encodedQuery = encodeURIComponent(options.query);
  return `https://www.chefkoch.de/rs/s${page - 1}${combined}p${prepId}r${ratingId}o${sortId}/${encodedQuery}/Rezepte.html`;
}

/**
 * Search recipes; returns summaries from the listing page (no full recipe fetch per result).
 */
export async function searchRecipes(options: SearchOptions): Promise<RecipeSummary[]> {
  const url = buildSearchUrl(options);
  const res = await fetch(url, {
    headers: { 'User-Agent': USER_AGENT },
    redirect: 'follow',
  });
  if (!res.ok) {
    throw new Error(`Search failed: ${res.status} ${res.statusText}`);
  }
  const html = await res.text();
  const $ = cheerio.load(html);
  const summaries: RecipeSummary[] = [];

  $('div.ds-recipe-card').each((_, card) => {
    const link = $(card).find('a[href*="/rezepte/"]').first();
    const href = link.attr('href');
    if (!href) return;
    const url = href.startsWith('http') ? href : `https://www.chefkoch.de${href}`;
    const title = link.attr('title') ?? $(card).find('.ds-recipe-card__title, [class*="recipe-card"] [class*="title"]').first().text().trim() ?? '';
    const img = $(card).find('img[src]').first().attr('src');
    const ratingEl = $(card).find('[class*="rating"], [data-rating]').first();
    const ratingStr = ratingEl.attr('data-rating') ?? ratingEl.text().trim();
    let rating: number | undefined = ratingStr ? Number(ratingStr.replace(',', '.')) : undefined;
    if (rating != null && Number.isNaN(rating)) rating = undefined;
    const cleanTitle = (title || 'Recipe').replace(/^Zum Rezept\s+/i, '').trim() || 'Recipe';
    summaries.push({
      title: cleanTitle,
      url,
      image_url: img || undefined,
      rating: rating != null && !Number.isNaN(rating) ? rating : undefined,
    });
  });

  return summaries;
}
