/**
 * Strip ANSI escape sequences (colors, cursor, etc.) so terminal output
 * can be shown as plain text in the UI.
 */
export function stripAnsi(str: string): string {
  if (typeof str !== 'string') return '';
  return str
    .replace(/\x1b\[[0-9;]*m/g, '')
    .replace(/\x1b\[?[0-9;]*[a-zA-Z]/g, '')
    .replace(/\x1b\][^\x07]*\x07/g, '')
    .replace(/\x1b[PX^_][^\x1b]*\x1b\\/g, '')
    .replace(/\x1b[\[\]()][AB012]/g, '');
}
