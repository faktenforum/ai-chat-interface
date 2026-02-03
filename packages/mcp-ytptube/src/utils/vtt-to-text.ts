/**
 * Parse WebVTT (and SRT) and produce plain text with timestamps preserved.
 * Uses @plussub/srt-vtt-parser for robust parsing (handles dot/comma, SRT/VTT).
 * Output: optional Language header, then [HH:MM:SS.mmm --> HH:MM:SS.mmm] + cue text per block.
 */

import { parse } from '@plussub/srt-vtt-parser';

const UTF8_DECODER = new TextDecoder('utf-8');

function msToVttTime(ms: number): string {
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  const s = Math.floor((ms % 60_000) / 1_000);
  const f = ms % 1_000;
  return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}.${f.toString().padStart(3, '0')}`;
}

/** Extract optional "Language: xx" from VTT header (first ~500 chars). */
function extractLanguageHeader(raw: string): string | null {
  const head = raw.slice(0, 500);
  const match = head.match(/^Language:\s*(\S+)/im);
  return match ? match[1]!.trim() : null;
}

export function vttToPlainText(buffer: ArrayBuffer): string {
  const raw = UTF8_DECODER.decode(buffer);
  const language = extractLanguageHeader(raw);

  let result: { entries: Array<{ from: number; to: number; text: string }> };
  try {
    result = parse(raw);
  } catch {
    return '';
  }

  const out: string[] = [];
  if (language) {
    out.push(`Language: ${language}`, '', '');
  }

  for (const entry of result.entries ?? []) {
    const text = (entry.text ?? '').trim();
    if (!text) continue;
    const start = msToVttTime(entry.from);
    const end = msToVttTime(entry.to);
    out.push(`[${start} --> ${end}]`, text, '');
  }

  return out.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}
