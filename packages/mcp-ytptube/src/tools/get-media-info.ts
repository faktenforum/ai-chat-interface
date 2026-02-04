/**
 * Tool: get_media_info
 * Metadata (title, duration, extractor) for a media URL without downloading – preview before transcript or download.
 */

import type { TextContent } from '@modelcontextprotocol/sdk/types.js';
import { GetMediaInfoSchema } from '../schemas/get-media-info.schema.ts';
import type { YTPTubeConfig } from '../clients/ytptube.ts';
import { getUrlInfo } from '../clients/ytptube.ts';
import { VideoTranscriptsError } from '../utils/errors.ts';
import { logger } from '../utils/logger.ts';
import { formatVideoInfoResponse, formatErrorResponse } from '../utils/response-format.ts';

export interface GetMediaInfoDeps {
  ytptube: YTPTubeConfig;
}

/**
 * get_media_info(media_url)
 * Returns title, duration, extractor from YTPTube GET /api/yt-dlp/url/info (no download).
 */
export async function getMediaInfo(
  input: unknown,
  deps: GetMediaInfoDeps,
): Promise<{ content: TextContent[] }> {
  const parsed = GetMediaInfoSchema.safeParse(input);
  if (!parsed.success) {
    const msg = parsed.error.flatten().formErrors.join('; ') || 'Invalid input';
    throw new VideoTranscriptsError(msg, 'VALIDATION_ERROR');
  }

  const { media_url } = parsed.data;
  const ytp = deps.ytptube;

  try {
    const info = await getUrlInfo(ytp, media_url);
    const title = typeof info.title === 'string' ? info.title : undefined;
    const duration = typeof info.duration === 'number' ? info.duration : undefined;
    const extractor = typeof info.extractor === 'string' ? info.extractor : undefined;
    const relay = 'Metadata above. Use request_transcript to start download/transcript.';
    const text = formatVideoInfoResponse({ title, duration, extractor, relay });
    return { content: [{ type: 'text', text }] };
  } catch (e) {
    const err = e instanceof Error ? e : new Error(String(e));
    logger.warn({ err, media_url }, 'YTPTube GET /api/yt-dlp/url/info failed');
    return {
      content: [
        { type: 'text', text: formatErrorResponse(`Failed to get media info: ${err.message}`) },
      ],
    };
  }
}
