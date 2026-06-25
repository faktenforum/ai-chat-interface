# Spend Monitor

Read-only org-wide cost monitor for LibreChat. It aggregates spend from the
`transactions` collection in LibreChat's MongoDB and serves an in-platform
status page. It does **not** write to LibreChat's database and does **not**
enforce limits — per-user limits stay in LibreChat's own balance system.

This is the observability layer (Phase 1). Hard enforcement (zeroing balances),
a Scaleway billing webhook, and email/webhook alerts are possible later phases.

## Endpoints

- `GET /health` — liveness
- `GET /api/spend` — current-period spend JSON (org total, per-provider, per-model, top users)
- `GET /` — HTML status page (auto-refreshes every 30s)

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
| `SPEND_MONITOR_BASIC_AUTH` | — | prod/dev: Traefik basic-auth htpasswd line |

The MongoDB URI is not configured separately — the service reuses LibreChat's
`LIBRECHAT_MONGO_URI` (compose default), so it always reads the same database.

## Alerting

In-platform only for now: the status-page banner turns amber/orange/red at the
warn/crit/over thresholds, and each level transition is logged (structured Pino
warning at crit/over). Email and webhook notifiers are stubbed for a later phase.

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
