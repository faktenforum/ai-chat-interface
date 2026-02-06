/**
 * Fetch daily recipe suggestions (was-koche-ich-heute / was-backe-ich-heute).
 * Returns summaries from the listing page (links and titles from cards).
 */

import * as cheerio from 'cheerio';
import { DAILY_BAKING_URL, DAILY_COOKING_URL, USER_AGENT } from './constants.ts';
import type { RecipeSummary } from './search.ts';

export type DailyType = 'kochen' | 'backen';

export async function getDailyRecipes(type: DailyType): Promise<RecipeSummary[]> {
  const url = type === 'kochen' ? DAILY_COOKING_URL : DAILY_BAKING_URL;
  const res = await fetch(url, {
    headers: { 'User-Agent': USER_AGENT },
    redirect: 'follow',
  });
  if (!res.ok) {
    throw new Error(`Daily recipes failed: ${res.status} ${res.statusText}`);
  }
  const html = await res.text();
  const $ = cheerio.load(html);
  const summaries: RecipeSummary[] = [];

  $('a.ds-recipe-card__link').each((_, el) => {
    const href = $(el).attr('href');
    if (!href || !href.includes('chefkoch.de/rezept')) return;
    const fullUrl = href.startsWith('http') ? href : `https://www.chefkoch.de${href}`;
    const title = $(el).attr('title') ?? $(el).find('[class*="title"]').first().text().trim() ?? '';
    const card = $(el).closest('.ds-recipe-card');
    const img = card.find('img[src]').first().attr('src');
    summaries.push({
      title: title || 'Recipe',
      url: fullUrl,
      image_url: img || undefined,
    });
  });

  return summaries;
}
