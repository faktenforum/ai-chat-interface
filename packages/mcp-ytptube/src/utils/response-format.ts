/** Key=value header blocks for MCP tool results; transcript as separate block. */

const DELIM = '\n---\n';
const TRANSCRIPT_LABEL = 'transcript:';

export interface TranscriptResponseParams {
  url: string;
  job_id: string;
  transcript: string;
  fromArchive?: boolean;
  /** URL as stored by YTPTube; use as video_url in get_transcript_status when present. */
  status_url?: string;
}

export interface TranscriptResponseBlocks {
  metadata: string;
  transcript: string;
}

/** Two blocks for transcript: metadata (result, url, job_id, relay) and transcript text. */
export function formatTranscriptResponseAsBlocks(params: TranscriptResponseParams): TranscriptResponseBlocks {
  const { url, job_id, transcript, fromArchive, status_url } = params;
  const relay = fromArchive
    ? 'Transcript below (from archive).'
    : 'Transcript below.';
  const lines = [
    'result=transcript',
    `url=${url}`,
    `job_id=${job_id}`,
    `relay=${relay}`,
  ];
  if (status_url != null && status_url !== url) lines.push(`status_url=${status_url}`);
  const metadata = lines.join('\n');
  const transcriptText = transcript?.trim() || '(empty)';
  return { metadata, transcript: transcriptText };
}

/** Legacy single-string transcript response (metadata + delimiter + transcript). */
export function formatTranscriptResponse(params: TranscriptResponseParams): string {
  const { metadata, transcript } = formatTranscriptResponseAsBlocks(params);
  return `${metadata}${DELIM}${TRANSCRIPT_LABEL}\n${transcript}`;
}

export type StatusKind = 'queued' | 'downloading' | 'finished' | 'error' | 'not_found';

export interface StatusResponseParams {
  status: StatusKind;
  job_id?: string;
  url?: string;
  status_url?: string;
  progress?: number;
  reason?: string;
  relay: string;
}

/** Single key=value block for status (no transcript). */
export function formatStatusResponse(params: StatusResponseParams): string {
  const parts: string[] = ['result=status', `status=${params.status}`];
  if (params.job_id != null) parts.push(`job_id=${params.job_id}`);
  if (params.url != null) parts.push(`url=${params.url}`);
  if (params.status_url != null && params.status_url !== params.url) parts.push(`status_url=${params.status_url}`);
  if (params.progress != null) parts.push(`progress=${params.progress}%`);
  if (params.reason != null) parts.push(`reason=${params.reason}`);
  parts.push(`relay=${params.relay}`);
  return parts.join('\n');
}

/** Error response: result=error, relay=message. */
export function formatErrorResponse(message: string): string {
  return `result=error\nrelay=${message}`;
}
