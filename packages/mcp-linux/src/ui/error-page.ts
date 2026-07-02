/**
 * Standalone error page for upload/download browser routes.
 */

import { esc, layout } from './html.ts';

/** Renders a minimal standalone error document (used with the matching HTTP status). */
export function renderErrorPage(title: string, message: string): string {
  const body = `
    <div class="card" style="max-width:34rem;margin:2rem auto;text-align:center">
      <h1 style="margin-bottom:.5rem">${esc(title)}</h1>
      <p>${esc(message)}</p>
      <p class="muted">Request a new link from the assistant in LibreChat.</p>
    </div>`;
  return layout({ title, body });
}
