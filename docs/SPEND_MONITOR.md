# Spend Monitor

Org-wide cost monitor for LibreChat. It aggregates spend from the `transactions`
collection in LibreChat's MongoDB and serves an in-platform status page.

**Reads only, apart from explicit admin actions:** changing the org budget or period,
resetting one user's limit, and lifting an org freeze. Optionally it enforces an org-wide hard cap by zeroing user
balances when spend reaches 100% of the budget (`SPEND_MONITOR_ENFORCE`).
Per-user limits are defined by LibreChat's own `balance` config either way — the monitor
displays them and can hand a single user their allowance back early.

A Scaleway billing webhook and email/webhook alerts are possible later phases.

## Endpoints

- `GET /health` — liveness
- `GET /api/spend` — current-period spend JSON (org total, per-provider, per-model, per-user)
- `GET /` — HTML status page (auto-refreshes every 30s)
- `POST /settings` — change the org budget / accounting period (see [Changing the budget](#changing-the-budget-and-period))
- `POST /users/:id/reset` — reset one user's limit (see [Per-user limits](#per-user-limits))
- `POST /restore` — lift enforcement and restore balances (only when enforce is `on`/`dry-run`)
- `POST /mcp` — MCP endpoint (admin-gated; see [MCP endpoint](#mcp-endpoint))

Local: `http://localhost:3016` and `http://spend.localhost`. Prod/dev: `https://spend.${DOMAIN}` (behind Traefik basic auth). The `/mcp` endpoint is Docker-network only (reached by LibreChat at `http://${STACK_NAME}-spend-monitor:3016/mcp`), never exposed via Traefik.

## How spend is computed

LibreChat writes one `transactions` row per spend. Convention: **1,000,000 token credits = 1 USD**; `tokenValue` is negative for usage. The monitor:

- matches `createdAt >= periodStart` and `tokenType in ['prompt','completion']` (refills, `tokenType: 'credits'`, are excluded)
- org spend USD = `-sum(tokenValue) / 1_000_000`
- provider split: model ids containing `/` are OpenRouter, bare ids are Scaleway
- period: calendar month (default), calendar week, or a rolling 30/7-day window

Spend is recorded after a completion, so the total trails real spend by at most the in-flight requests since the last poll. This is a monitor, not a hard cap.

The banner also shows when the org counter restarts. `calendar-month` restarts on the 1st and
`calendar-week` on Monday (UTC, ISO weeks); the `rolling-*` windows slide continuously and
never reset, so nothing is shown for them.

## Changing the budget and period

`SPEND_MONITOR_BUDGET_USD` and `SPEND_MONITOR_PERIOD` are **defaults**, not the last word.
The dashboard's **Budget** section edits both at runtime and the override is stored in the
monitor's own `spendmonitor_state` collection, so it survives a restart and needs no
redeploy. Each field shows whether it is currently overridden, and the tooltip names the
environment default it would fall back to; **Use env defaults** drops both overrides.

Same thing over HTTP, and via the `set_org_budget` MCP tool:

```bash
curl -X POST http://spend.localhost/settings \
  -H 'Content-Type: application/json' \
  -d '{"budgetUsd": 250, "period": "calendar-week"}'

# drop the overrides again
curl -X POST http://spend.localhost/settings \
  -H 'Content-Type: application/json' -d '{"budgetUsd": null, "period": null}'
```

Periods: `calendar-month` (default), `calendar-week`, `rolling-30d`, `rolling-7d`.

**With `SPEND_MONITOR_ENFORCE=on` this is a live switch, in both directions.** Lowering the
budget below current spend freezes every user immediately — the response reports
`frozen: true, enforcementChanged: true` rather than predicting it, and the dashboard says
so in a dialog. Raising it back above spend lifts the freeze and restores the snapshotted
balances on the same request.

## Per-user limits

The **Users** table joins each user's period spend with their `balances` document in
LibreChat: credits left, the amount LibreChat refills, and `lastRefill + refillInterval`
as **Next auto-refill**.

That date is an *eligibility* date, not a scheduled reset. LibreChat's balance check only
tops a user up when their credits are used up **and** the interval has passed
(`packages/api/src/middleware/checkBalance.ts`), and it *adds* `refillAmount` rather than
resetting to it — an unused balance is not zeroed at the interval boundary. Rows whose
interval has already elapsed are marked `due now`: those users get their top-up the moment
they run out.

**Reset** (per row, or `POST /users/:id/reset`, or the `reset_user_limit` MCP tool) sets
`tokenCredits` to the user's configured `refillAmount` and moves `lastRefill` to now. So
the user can work again immediately and the next automatic refill is a full interval away.

It is refused when:

- an org freeze is active (`409`) — the freeze re-zeroes balances every poll, so the reset
  would be undone on the next tick. Restore first, then reset.
- the user has no `refillAmount` (auto-refill off) — there is no per-user allowance to
  infer, so the HTTP route returns `400` and the MCP tool needs an explicit `credits_usd`.
- the user has no `balances` document yet (LibreChat creates it on their first request).

Amounts are USD; LibreChat stores credits (`1,000,000 credits = $1`). The org-wide
`balance` defaults themselves live in `librechat.prod.yaml` / `librechat.dev.yaml`.

## Configuration (env)

| Var | Default | Meaning |
|-----|---------|---------|
| `SPEND_MONITOR_PORT` | `3016` | port (host + container) |
| `SPEND_MONITOR_BUDGET_USD` | `100` | org budget default; overridable at runtime |
| `SPEND_MONITOR_PERIOD` | `calendar-month` | `calendar-month`, `calendar-week`, `rolling-30d`, `rolling-7d`; overridable at runtime |
| `SPEND_MONITOR_WARN_PCT` | `50` | warn threshold (%) |
| `SPEND_MONITOR_CRIT_PCT` | `80` | critical threshold (%) |
| `SPEND_MONITOR_EUR_RATE` | `0.92` | EUR per USD, display only |
| `SPEND_MONITOR_POLL_SECONDS` | `60` | aggregation interval |
| `SPEND_MONITOR_ENFORCE` | `off` | `off` / `dry-run` / `on` — hard stop by zeroing balances |
| `SPEND_MONITOR_BASIC_AUTH` | — | prod/dev: Traefik basic-auth htpasswd line |
| `SPEND_MONITOR_ADMIN_EMAILS` | — | comma-separated emails allowed to use the MCP tools; empty disables `/mcp` |

The MongoDB URI is not configured separately — the service reuses LibreChat's
`LIBRECHAT_MONGO_URI` (compose default), so it always reads the same database.

## MCP endpoint

The monitor also speaks MCP over `POST /mcp`, so admins can pull the spend report and
lift a freeze from inside a LibreChat chat instead of opening the hosted page. The
hosted page and `POST /restore` remain the ops fallback — enforcement must be operable
when LibreChat itself is down.

Tools:

- `get_usage_report` — returns the current spend summary as JSON plus the dashboard as
  an MCP-UI resource (`ui://spend-monitor/report`) rendered inline in the chat. Its
  buttons (Refresh, and Restore when a freeze is active) post tool actions back to
  LibreChat, arriving as new messages that ask the agent to run the matching tool.
- `restore_balances` (requires `confirm: true`) — same effect as the dashboard's Restore
  button / `POST /restore`.
- `reset_user_limit` (`email`, `confirm: true`, optional `credits_usd`) — same effect as a
  row's Reset button. Takes the login email rather than an id, and `credits_usd` overrides
  the default (the user's own refill amount).
- `set_org_budget` (`confirm: true`, optional `budget_usd` / `period`, or `reset: true`) —
  same effect as the dashboard's Budget form. Reports what the change actually did, including
  whether it froze or unfroze the org.

**Access control.** YAML-defined MCP servers are global in LibreChat (`chatMenu: false`
only hides a server from the chat picker; any agent can still attach it), so the endpoint
is gated server-side: it checks the `X-User-Email` header against
`SPEND_MONITOR_ADMIN_EMAILS`. If that list is empty the endpoint returns `403` for every
request (deny-by-default), since it exposes org-wide spend and a write action. The MCP
server is wired into LibreChat as `spend` in `librechat.yaml` with the `X-User-*` headers.

## Alerting

In-platform only for now: the status-page banner turns amber/orange/red at the
warn/crit/over thresholds, and each level transition is logged (structured Pino
warning at crit/over). Email and webhook notifiers are stubbed for a later phase.

## Enforcement (optional hard stop)

`SPEND_MONITOR_ENFORCE` (default `off`):

- `off` — monitor only, never writes to LibreChat's database.
- `dry-run` — logs what it *would* zero/restore but writes nothing. Use this first.
- `on` — when spend reaches 100% of budget, it snapshots all balances, sets every
  `tokenCredits` to 0 and disables auto-refill, so LibreChat's pre-request balance
  check blocks all further requests. It re-zeroes each poll (catching in-flight spend
  and newly created users), **auto-restores** when the period resets or the budget is
  raised (spend < budget), and can be lifted manually via the dashboard's **Restore**
  button (`POST /restore`).

Snapshot and enforcement state live in the `spendmonitor_balance_snapshot` and
`spendmonitor_state` collections (the monitor's own, not LibreChat's). There is a lag
of up to one poll + in-flight requests before the cap bites (spend is recorded after a
completion), so set the budget slightly below the true ceiling. Coarse by design: it
cuts off all users at once.

## Basic auth (prod/dev)

The dashboard exposes cost data, so prod/dev gate it with a Traefik basic-auth
middleware. Set `SPEND_MONITOR_BASIC_AUTH` to an htpasswd line:

```bash
htpasswd -nbB admin 'your-password'
# -> admin:$2y$05$....
```

Use the full `user:hash` string. `scripts/setup-env.ts` auto-escapes `$` to `$$`
for compose interpolation (idempotent), so manual doubling is only needed if you
edit `.env` by hand without running setup-env. Local does not use basic auth
(localhost-bound + `spend.localhost`).

## Deploy

Built and published by `.github/workflows/build-spend-monitor.yml` to
`ghcr.io/faktenforum/spend-monitor` (`:latest` on main, `:dev` on branches).
Bundled in `docker-compose.{local,local-dev,prod,dev}.yml`; local builds from
source, prod/dev pull the image.
