/**
 * Tool: get_thumbnail_url
 * Link to the video thumbnail (from yt-dlp info; for preview/UI).
 */

import type { TextContent } from '@modelcontextprotocol/sdk/types.js';
import { GetThumbnailUrlSchema } from '../schemas/get-thumbnail-url.schema.ts';
import type { YTPTubeConfig } from '../clients/ytptube.ts';
import { getUrlInfo } from '../clients/ytptube.ts';
import { VideoTranscriptsError } from '../utils/errors.ts';
import { logger } from '../utils/logger.ts';
import { formatThumbnailUrlResponse, formatErrorResponse } from '../utils/response-format.ts';

export interface GetThumbnailUrlDeps {
  ytptube: YTPTubeConfig;
}

/**
 * get_thumbnail_url(media_url)
 * Returns thumbnail URL from YTPTube GET /api/yt-dlp/url/info (thumbnail field in yt-dlp info; may be empty for audio-only).
 */
export async function getThumbnailUrl(
  input: unknown,
  deps: GetThumbnailUrlDeps,
): Promise<{ content: TextContent[] }> {
  const parsed = GetThumbnailUrlSchema.safeParse(input);
  if (!parsed.success) {
    const msg = parsed.error.flatten().formErrors.join('; ') || 'Invalid input';
    throw new VideoTranscriptsError(msg, 'VALIDATION_ERROR');
  }

  const { media_url } = parsed.data;
  const ytp = deps.ytptube;

  try {
    const info = await getUrlInfo(ytp, media_url);
    const thumbnail = typeof info.thumbnail === 'string' ? info.thumbnail : undefined;
    if (!thumbnail?.trim()) {
      return {
        content: [
          {
            type: 'text',
            text: formatErrorResponse('Thumbnail not available for this URL.'),
          },
        ],
      };
    }
    const relay = 'Use this URL to display the video thumbnail.';
    const text = formatThumbnailUrlResponse({ thumbnail_url: thumbnail, relay });
    return { content: [{ type: 'text', text }] };
  } catch (e) {
    const err = e instanceof Error ? e : new Error(String(e));
    logger.warn({ err, media_url }, 'YTPTube GET /api/yt-dlp/url/info failed for thumbnail');
    return {
      content: [
        { type: 'text', text: formatErrorResponse(`Failed to get thumbnail: ${err.message}`) },
      ],
    };
  }
}
