/**
 * Parse WebVTT and produce plain text with timestamps preserved.
 * Keeps cue time ranges as [HH:MM:SS.mmm --> HH:MM:SS.mmm] before each cue text;
 * optional Language from header is output at the start when present.
 */

const UTF8_DECODER = new TextDecoder('utf-8');

/** Time line pattern: 00:00:00.000 --> 00:00:02.500 */
const TIME_LINE_RE = /^(\d{2}:\d{2}:\d{2}\.\d{3})\s*-->\s*(\d{2}:\d{2}:\d{2}\.\d{3})/;

export function vttToPlainText(buffer: ArrayBuffer): string {
  const text = UTF8_DECODER.decode(buffer);
  const lines = text.split(/\r?\n/);
  const out: string[] = [];
  let i = 0;
  let headerLanguage: string | null = null;

  // Skip optional BOM and "WEBVTT" line
  while (i < lines.length) {
    const line = lines[i] ?? '';
    const trimmed = line.trim();
    if (trimmed.startsWith('WEBVTT')) {
      i++;
      break;
    }
    if (trimmed) break;
    i++;
  }

  // Header: lines until first blank; optionally capture "Language: xx"
  while (i < lines.length) {
    const line = lines[i] ?? '';
    if (line.trim() === '') break;
    const langMatch = line.match(/^Language:\s*(\S+)/i);
    if (langMatch) headerLanguage = langMatch[1]!.trim();
    i++;
  }

  if (headerLanguage) {
    out.push(`Language: ${headerLanguage}`, '', '');
  }

  // Cue blocks: time line then cue text until blank or next time line
  while (i < lines.length) {
    const line = lines[i] ?? '';
    if (line.trim() === '') {
      i++;
      continue;
    }
    const timeMatch = line.match(TIME_LINE_RE);
    if (timeMatch) {
      const timeStamp = `[${timeMatch[1]} --> ${timeMatch[2]}]`;
      out.push(timeStamp);
      i++;
      const cueLines: string[] = [];
      while (i < lines.length) {
        const next = lines[i] ?? '';
        if (next.trim() === '') break;
        if (TIME_LINE_RE.test(next.trim())) break;
        cueLines.push(next);
        i++;
      }
      if (cueLines.length > 0) {
        out.push(cueLines.join('\n'));
      }
      out.push('');
    } else {
      i++;
    }
  }

  return out.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}
