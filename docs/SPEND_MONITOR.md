# Spend Monitor

Org-wide cost monitor for LibreChat. It aggregates spend from the `transactions`
collection in LibreChat's MongoDB and serves an in-platform status page.

**Read-only by default.** Optionally it enforces an org-wide hard cap by zeroing
user balances when spend reaches 100% of the budget (`SPEND_MONITOR_ENFORCE`).
Per-user limits stay in LibreChat's own balance system either way.

A Scaleway billing webhook and email/webhook alerts are possible later phases.

## Endpoints

- `GET /health` — liveness
- `GET /api/spend` — current-period spend JSON (org total, per-provider, per-model, top users)
- `GET /` — HTML status page (auto-refreshes every 30s)
- `POST /restore` — lift enforcement and restore balances (only when enforce is `on`/`dry-run`)

Local: `http://localhost:3016` and `http://spend.localhost`. Prod/dev: `https://spend.${DOMAIN}` (behind Traefik basic auth).

## How spend is computed

LibreChat writes one `transactions` row per spend. Convention: **1,000,000 token credits = 1 USD**; `tokenValue` is negative for usage. The monitor:

- matches `createdAt >= periodStart` and `tokenType in ['prompt','completion']` (refills, `tokenType: 'credits'`, are excluded)
- org spend USD = `-sum(tokenValue) / 1_000_000`
- provider split: model ids containing `/` are OpenRouter, bare ids are Scaleway
- period: calendar month (default) or rolling 30 days

Spend is recorded after a completion, so the total trails real spend by at most the in-flight requests since the last poll. This is a monitor, not a hard cap.

## Configuration (env)

| Var | Default | Meaning |
|-----|---------|---------|
| `SPEND_MONITOR_PORT` | `3016` | port (host + container) |
| `SPEND_MONITOR_BUDGET_USD` | `100` | monthly org budget (set the real figure) |
| `SPEND_MONITOR_PERIOD` | `calendar-month` | `calendar-month` or `rolling-30d` |
| `SPEND_MONITOR_WARN_PCT` | `50` | warn threshold (%) |
| `SPEND_MONITOR_CRIT_PCT` | `80` | critical threshold (%) |
| `SPEND_MONITOR_EUR_RATE` | `0.92` | EUR per USD, display only |
| `SPEND_MONITOR_POLL_SECONDS` | `60` | aggregation interval |
| `SPEND_MONITOR_ENFORCE` | `off` | `off` / `dry-run` / `on` — hard stop by zeroing balances |
| `SPEND_MONITOR_BASIC_AUTH` | — | prod/dev: Traefik basic-auth htpasswd line |

The MongoDB URI is not configured separately — the service reuses LibreChat's
`LIBRECHAT_MONGO_URI` (compose default), so it always reads the same database.

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

Use the full `user:hash` string. If login is rejected when the value comes from
an env file, double every `$` to `$$` (compose interpolation). Local does not use
basic auth (localhost-bound + `spend.localhost`).

## Deploy

Built and published by `.github/workflows/build-spend-monitor.yml` to
`ghcr.io/faktenforum/spend-monitor` (`:latest` on main, `:dev` on branches).
Bundled in `docker-compose.{local,local-dev,prod,dev}.yml`; local builds from
source, prod/dev pull the image.
