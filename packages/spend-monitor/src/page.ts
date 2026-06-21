import type { Level, Snapshot } from './aggregate.ts';

const COLORS: Record<Level, { bg: string; fg: string; label: string }> = {
  ok: { bg: '#065f46', fg: '#d1fae5', label: 'OK' },
  warn: { bg: '#92400e', fg: '#fef3c7', label: 'WARNING' },
  crit: { bg: '#9a3412', fg: '#ffedd5', label: 'CRITICAL' },
  over: { bg: '#991b1b', fg: '#fee2e2', label: 'OVER BUDGET' },
};

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string,
  );
}

function usd(n: number): string {
  return `$${n.toFixed(2)}`;
}
function eur(n: number): string {
  return `€${n.toFixed(2)}`;
}

function rows(cells: string[][]): string {
  return cells.map((r) => `<tr>${r.map((c) => `<td>${c}</td>`).join('')}</tr>`).join('');
}

export function renderPage(s: Snapshot): string {
  const c = COLORS[s.level];
  const pct = Math.round(s.usedRatio * 100);
  const barWidth = Math.min(100, pct);

  const providerRows = rows([
    ['OpenRouter', usd(s.byProvider.openrouter)],
    ['Scaleway', usd(s.byProvider.scaleway)],
  ]);

  const modelRows = rows(
    s.byModel.slice(0, 20).map((m) => [esc(m.model), m.provider, usd(m.usd)]),
  );

  const userRows = rows(s.topUsers.map((u) => [esc(u.user), usd(u.usd)]));

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta http-equiv="refresh" content="30" />
<title>LibreChat spend monitor</title>
<style>
  :root { color-scheme: light dark; }
  body { font-family: system-ui, -apple-system, Segoe UI, Roboto, sans-serif; margin: 0; padding: 1.5rem; background: #0b0f14; color: #e5e7eb; }
  .wrap { max-width: 880px; margin: 0 auto; }
  h1 { font-size: 1.1rem; font-weight: 600; color: #9ca3af; margin: 0 0 1rem; }
  .banner { background: ${c.bg}; color: ${c.fg}; border-radius: 10px; padding: 1.25rem 1.5rem; }
  .level { font-size: 0.8rem; letter-spacing: 0.08em; opacity: 0.9; }
  .headline { font-size: 2rem; font-weight: 700; margin: 0.25rem 0; }
  .sub { font-size: 0.9rem; opacity: 0.9; }
  .bar { height: 8px; background: rgba(255,255,255,0.2); border-radius: 999px; margin-top: 0.9rem; overflow: hidden; }
  .bar > span { display: block; height: 100%; width: ${barWidth}%; background: rgba(255,255,255,0.85); }
  table { width: 100%; border-collapse: collapse; margin-top: 0.5rem; font-size: 0.9rem; }
  th, td { text-align: left; padding: 0.4rem 0.6rem; border-bottom: 1px solid #1f2937; }
  td:last-child, th:last-child { text-align: right; font-variant-numeric: tabular-nums; }
  section { margin-top: 1.75rem; }
  section h2 { font-size: 0.85rem; text-transform: uppercase; letter-spacing: 0.05em; color: #9ca3af; margin: 0 0 0.3rem; }
  footer { margin-top: 2rem; font-size: 0.78rem; color: #6b7280; }
  code { color: #93c5fd; }
</style>
</head>
<body>
<div class="wrap">
  <h1>LibreChat &mdash; org spend monitor (read-only)</h1>
  <div class="banner">
    <div class="level">${c.label} &middot; ${pct}% of budget</div>
    <div class="headline">${usd(s.spentUsd)} <span style="opacity:.6;font-size:1.2rem">/ ${usd(s.budgetUsd)}</span></div>
    <div class="sub">${eur(s.eur.spent)} / ${eur(s.eur.budget)} &middot; period: ${s.period}</div>
    <div class="bar"><span></span></div>
  </div>

  <section>
    <h2>By provider</h2>
    <table><thead><tr><th>Provider</th><th>Spend</th></tr></thead><tbody>${providerRows}</tbody></table>
  </section>

  <section>
    <h2>By model (top 20)</h2>
    <table><thead><tr><th>Model</th><th>Provider</th><th>Spend</th></tr></thead><tbody>${modelRows || '<tr><td colspan="3">no usage yet</td></tr>'}</tbody></table>
  </section>

  <section>
    <h2>Top users</h2>
    <table><thead><tr><th>User</th><th>Spend</th></tr></thead><tbody>${userRows || '<tr><td colspan="2">no usage yet</td></tr>'}</tbody></table>
  </section>

  <footer>
    period start <code>${esc(s.periodStart)}</code> &middot; updated <code>${esc(s.updatedAt)}</code> &middot; auto-refresh 30s &middot;
    1,000,000 credits = $1 &middot; EUR is display-only (rate ${s.eur.rate})
  </footer>
</div>
</body>
</html>`;
}
