/**
 * Caps terminal output before it goes back to the model.
 *
 * An uncapped `cat` or build log costs the whole conversation: the output is re-sent with every
 * model call for the rest of the turn, and the provider's tokens-per-minute quota is what actually
 * runs out (Scaleway answers 429 "INSUFFICIENT QUOTA" once a minute's worth is used up). Head and
 * tail are what a reader needs - the command that ran and how it ended - so the middle is dropped
 * and the model is told how to page the rest with read_terminal_output.
 */

const DEFAULT_MAX_OUTPUT_CHARS = 40_000;
/** Below this a split into head and tail is pointless. */
const MIN_SPLIT_CHARS = 400;

export interface CappedOutput {
  output: string;
  /** Present only when something was dropped, so untruncated results stay clean. */
  output_truncated?: true;
  omitted_chars?: number;
  total_chars?: number;
}

export function maxOutputChars(): number {
  const configured = parseInt(process.env.MCP_LINUX_MAX_OUTPUT_CHARS || '', 10);
  return Number.isFinite(configured) && configured > 0 ? configured : DEFAULT_MAX_OUTPUT_CHARS;
}

export function capOutput(text: string, limit: number = maxOutputChars()): CappedOutput {
  if (text.length <= limit) {
    return { output: text };
  }

  const omitted = text.length - limit;
  const notice = `\n\n[... ${omitted} characters omitted. Read them with read_terminal_output using offset/length. ...]\n\n`;

  if (limit < MIN_SPLIT_CHARS) {
    return {
      output: text.slice(0, limit) + notice,
      output_truncated: true,
      omitted_chars: omitted,
      total_chars: text.length,
    };
  }

  /* Two thirds head, one third tail: the start carries what the command was doing, the end carries
   * the exit state and any error, which is usually the part being looked for. */
  const headChars = Math.floor((limit * 2) / 3);
  const tailChars = limit - headChars;

  return {
    output: text.slice(0, headChars) + notice + text.slice(text.length - tailChars),
    output_truncated: true,
    omitted_chars: omitted,
    total_chars: text.length,
  };
}
