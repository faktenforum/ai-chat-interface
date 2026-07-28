import type { Level, Snapshot } from './aggregate.ts';
import type { EnforceMode, EnforceState } from './enforce.ts';

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

/** Sub-cent spend is real; show enough decimals so it does not round away to 0.00. */
function money(sym: string, n: number): string {
  const abs = Math.abs(n);
  const dp = abs > 0 && abs < 0.01 ? 4 : 2;
  return `${sym}${n.toFixed(dp)}`;
}
function usd(n: number): string {
  return money('$', n);
}
function eur(n: number): string {
  return money('€', n);
}

function rows(cells: string[][]): string {
  return cells.map((r) => `<tr>${r.map((c) => `<td>${c}</td>`).join('')}</tr>`).join('');
}

/** A JS literal safe to inline inside a double-quoted HTML event attribute. */
function jsArg(value: unknown): string {
  return esc(JSON.stringify(value));
}

/** `2026-08-01 00:00 UTC` - short enough for a table cell, unambiguous about the zone. */
function stamp(iso: string): string {
  return `${iso.slice(0, 10)} ${iso.slice(11, 16)} UTC`;
}

/** Coarse "in 3 days" / "in 5 h" / "due now" for a future instant. */
function until(fromIso: string, toIso: string): string {
  const ms = new Date(toIso).getTime() - new Date(fromIso).getTime();
  if (!Number.isFinite(ms) || ms <= 0) return 'due now';
  const hours = ms / 3_600_000;
  if (hours < 1) return `in ${Math.max(1, Math.round(ms / 60_000))} min`;
  if (hours < 48) return `in ${Math.round(hours)} h`;
  return `in ${Math.round(hours / 24)} days`;
}

const STYLES = `
  :root { color-scheme: light dark; }
  body { font-family: system-ui, -apple-system, Segoe UI, Roboto, sans-serif; margin: 0; padding: 1.5rem; background: #0b0f14; color: #e5e7eb; }
  .wrap { max-width: 880px; margin: 0 auto; }
  .top { display: flex; align-items: center; justify-content: space-between; gap: .5rem; }
  h1 { font-size: 1.1rem; font-weight: 600; color: #9ca3af; margin: 0 0 1rem; }
  .banner { border-radius: 10px; padding: 1.25rem 1.5rem; }
  .level { font-size: 0.8rem; letter-spacing: 0.08em; opacity: 0.9; }
  .headline { font-size: 2rem; font-weight: 700; margin: 0.25rem 0; }
  .sub { font-size: 0.9rem; opacity: 0.9; }
  .bar { height: 8px; background: rgba(255,255,255,0.2); border-radius: 999px; margin-top: 0.9rem; overflow: hidden; }
  .bar > span { display: block; height: 100%; background: rgba(255,255,255,0.85); }
  .enforce { border-radius: 10px; padding: 0.8rem 1.1rem; margin-top: 1rem; font-size: 0.9rem; }
  .enforce.active { background: #7f1d1d; color: #fee2e2; }
  .enforce.armed { background: #1f2937; color: #9ca3af; }
  .btn { background: #fee2e2; color: #7f1d1d; border: 0; border-radius: 6px; padding: 0.35rem 0.7rem; font-weight: 600; cursor: pointer; }
  .btn.ghost { background: #1f2937; color: #d1d5db; }
  .btn.sm { padding: 0.15rem 0.5rem; font-size: 0.78rem; font-weight: 500; }
  .btn[disabled] { opacity: 0.4; cursor: not-allowed; }
  .enforce .btn { margin-left: 0.6rem; }
  table { width: 100%; border-collapse: collapse; margin-top: 0.5rem; font-size: 0.9rem; }
  th, td { text-align: left; padding: 0.4rem 0.6rem; border-bottom: 1px solid #1f2937; }
  td:last-child, th:last-child { text-align: right; }
  td.num, th.num { text-align: right; font-variant-numeric: tabular-nums; }
  .muted { color: #6b7280; }
  .due { color: #fbbf24; }
  section h2 .hint { text-transform: none; letter-spacing: 0; font-weight: 400; }
  section { margin-top: 1.75rem; }
  section h2 { font-size: 0.85rem; text-transform: uppercase; letter-spacing: 0.05em; color: #9ca3af; margin: 0 0 0.3rem; }
  footer { margin-top: 2rem; font-size: 0.78rem; color: #6b7280; }
  code { color: #93c5fd; }
`;

/** Posts iframe size and forwards tool actions. Used only by the MCP variant. */
const MCP_JS = `
(function(){
  function post(){var b=document.body?document.body.scrollHeight:0;window.parent.postMessage({type:'ui-size-change',payload:{width:document.documentElement.scrollWidth,height:Math.max(document.documentElement.scrollHeight,b)}},'*');}
  if(window.ResizeObserver){var ro=new ResizeObserver(post);ro.observe(document.documentElement);if(document.body)ro.observe(document.body);}
  window.addEventListener('load',post);window.addEventListener('resize',post);setTimeout(post,60);post();
})();
function uiTool(name,params,confirmMsg){if(confirmMsg&&!window.confirm(confirmMsg))return;window.parent.postMessage({type:'tool',payload:{toolName:name,params:params||{}}},'*');}`;

type Variant = 'hosted' | 'mcp';

function enforceStrip(mode: EnforceMode, e: EnforceState, variant: Variant): string {
  if (e.active) {
    const dry = mode === 'dry-run' ? ' (DRY-RUN)' : '';
    const restore =
      variant === 'mcp'
        ? `<button class="btn" onclick="uiTool('restore_balances',{confirm:true},'Restore all balances and lift the spending freeze?')">Restore balances</button>`
        : `<button class="btn" onclick="if(confirm('Restore all balances and lift the spending freeze?')){this.disabled=true;fetch('/restore',{method:'POST'}).then(()=>location.reload())}">Restore balances</button>`;
    return `<div class="enforce active">
      <strong>&#9940; Enforcement active${dry}</strong> &mdash; all user balances zeroed since <code>${esc(e.since ?? '')}</code>. ${esc(e.reason ?? '')}
      ${restore}
    </div>`;
  }
  if (e.overridePeriodStart != null) {
    return `<div class="enforce armed">Admin override: freeze lifted for this period &mdash; auto-enforcement re-engages next period if still over budget.</div>`;
  }
  if (mode !== 'off') {
    return `<div class="enforce armed">Enforcement armed: <code>${mode}</code> &mdash; balances are zeroed automatically when spend reaches 100% of budget.</div>`;
  }
  return '';
}

/**
 * Per-user table: spend this period, credits left, when LibreChat's next auto-refill becomes
 * eligible, and a button that hands the user their full allowance back right now.
 * The balance columns only appear when LibreChat's balance system is actually in use.
 */
function usersSection(s: Snapshot, enforcement: EnforceState, variant: Variant): string {
  const withBalance = s.users.some((u) => u.balanceUsd != null);

  if (!withBalance) {
    const body = rows(s.users.map((u) => [esc(u.email), usd(u.usd)]));
    return `<section>
    <h2>Users</h2>
    <table><thead><tr><th>User</th><th>Spend</th></tr></thead><tbody>${
      body || '<tr><td colspan="2">no usage yet</td></tr>'
    }</tbody></table>
  </section>`;
  }

  const frozen = enforcement.active;
  const body = s.users
    .map((u) => {
      const balance = u.balanceUsd == null ? '<span class="muted">-</span>' : usd(u.balanceUsd);
      const refill =
        u.nextRefillAt == null
          ? '<span class="muted">no auto-refill</span>'
          : u.refillDue
            ? `<span class="due">due now</span> <span class="muted">${esc(stamp(u.nextRefillAt))}</span>`
            : `${esc(stamp(u.nextRefillAt))} <span class="muted">${until(s.updatedAt, u.nextRefillAt)}</span>`;

      let action: string;
      if (u.balanceUsd == null) {
        action = `<button class="btn ghost sm" disabled title="no balance record yet">Reset</button>`;
      } else if (frozen) {
        action = `<button class="btn ghost sm" disabled title="org freeze active - restore balances first">Reset</button>`;
      } else if (!(u.refillUsd > 0)) {
        action = `<button class="btn ghost sm" disabled title="no refill amount configured for this user">Reset</button>`;
      } else {
        const label = `Reset to ${usd(u.refillUsd)}`;
        const confirmMsg = `Reset ${u.email} to ${usd(u.refillUsd)} and restart their refill interval?`;
        action =
          variant === 'mcp'
            ? `<button class="btn ghost sm" onclick="uiTool('reset_user_limit',{email:${jsArg(u.email)},confirm:true},${jsArg(confirmMsg)})">${label}</button>`
            : `<button class="btn ghost sm" onclick="if(confirm(${jsArg(confirmMsg)})){this.disabled=true;fetch(${jsArg(`/users/${encodeURIComponent(u.id)}/reset`)},{method:'POST'}).then(()=>location.reload())}">${label}</button>`;
      }

      return `<tr><td>${esc(u.email)}</td><td class="num">${usd(u.usd)}</td><td class="num">${balance}</td><td>${refill}</td><td>${action}</td></tr>`;
    })
    .join('');

  return `<section>
    <h2>Users <span class="hint">- limit resets when depleted after the interval</span></h2>
    <table>
      <thead><tr><th>User</th><th class="num">Spend</th><th class="num">Credits left</th><th>Next auto-refill</th><th>Limit</th></tr></thead>
      <tbody>${body || '<tr><td colspan="5">no users yet</td></tr>'}</tbody>
    </table>
  </section>`;
}

/** Renders the shared dashboard body (banner, enforcement, tables, footer). */
function dashboardBody(
  s: Snapshot,
  mode: EnforceMode,
  enforcement: EnforceState,
  variant: Variant,
  pollSeconds: number,
): string {
  const c = COLORS[s.level];
  const pct = Math.round(s.usedRatio * 100);
  const barWidth = Math.min(100, pct);

  const providerRows = rows([
    ['OpenRouter', usd(s.byProvider.openrouter)],
    ['Scaleway', usd(s.byProvider.scaleway)],
  ]);
  const modelRows = rows(s.byModel.slice(0, 20).map((m) => [esc(m.model), m.provider, usd(m.usd)]));

  const heading =
    variant === 'mcp'
      ? `<div class="top"><h1>LibreChat &mdash; org spend monitor</h1><button class="btn ghost" onclick="uiTool('get_usage_report',{})">Refresh</button></div>`
      : `<h1>LibreChat &mdash; org spend monitor</h1>`;

  const refreshNote =
    variant === 'mcp' ? 'use the Refresh button' : `auto-refresh ${pollSeconds}s`;

  const resetNote =
    s.periodResetAt == null
      ? 'rolling window (no reset - the 30-day window slides)'
      : `resets ${stamp(s.periodResetAt)} (${until(s.updatedAt, s.periodResetAt)})`;

  return `${heading}
  <div class="banner" style="background:${c.bg};color:${c.fg}">
    <div class="level">${c.label} &middot; ${pct}% of budget</div>
    <div class="headline">${usd(s.spentUsd)} <span style="opacity:.6;font-size:1.2rem">/ ${usd(s.budgetUsd)}</span></div>
    <div class="sub">${eur(s.eur.spent)} / ${eur(s.eur.budget)} &middot; period: ${s.period} &middot; ${esc(resetNote)}</div>
    <div class="bar"><span style="width:${barWidth}%"></span></div>
  </div>

  ${enforceStrip(mode, enforcement, variant)}

  <section>
    <h2>By provider</h2>
    <table><thead><tr><th>Provider</th><th>Spend</th></tr></thead><tbody>${providerRows}</tbody></table>
  </section>

  <section>
    <h2>By model (top 20)</h2>
    <table><thead><tr><th>Model</th><th>Provider</th><th>Spend</th></tr></thead><tbody>${modelRows || '<tr><td colspan="3">no usage yet</td></tr>'}</tbody></table>
  </section>

  ${usersSection(s, enforcement, variant)}

  <footer>
    period start <code>${esc(s.periodStart)}</code> &middot; updated <code>${esc(s.updatedAt)}</code> &middot; ${refreshNote} &middot;
    enforce: <code>${mode}</code> &middot; 1,000,000 credits = $1 &middot; EUR display rate ${s.eur.rate}<br />
    LibreChat auto-refill only tops a user up once their credits are used up <em>and</em> the interval has passed;
    &ldquo;Reset&rdquo; grants the full amount immediately and restarts the interval.
  </footer>`;
}

/** Full hosted status page (auto-refreshing, with a fetch-based Restore button). */
export function renderPage(
  s: Snapshot,
  mode: EnforceMode,
  enforcement: EnforceState,
  pollSeconds: number,
): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta http-equiv="refresh" content="${pollSeconds}" />
<title>LibreChat spend monitor</title>
<style>${STYLES}</style>
</head>
<body>
<div class="wrap">${dashboardBody(s, mode, enforcement, 'hosted', pollSeconds)}</div>
</body>
</html>`;
}

/** Embedded MCP-UI variant: no meta-refresh; buttons post tool actions. */
export function renderMcpUi(s: Snapshot, mode: EnforceMode, enforcement: EnforceState): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>LibreChat spend monitor</title>
<style>${STYLES}</style>
</head>
<body>
<div class="wrap">${dashboardBody(s, mode, enforcement, 'mcp', 0)}</div>
<script>${MCP_JS}</script>
</body>
</html>`;
}
