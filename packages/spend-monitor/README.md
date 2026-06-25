# spend-monitor

Org-wide cost monitor for LibreChat. Aggregates spend from the `transactions`
collection in LibreChat's MongoDB and serves an in-platform status page.
Read-only by default; can optionally enforce an org hard cap by zeroing balances
when over budget (`SPEND_MONITOR_ENFORCE`). Per-user limits stay in LibreChat.

## Endpoints

- `GET /health` — liveness, `{status:"ok"}`
- `GET /api/spend` — current-period spend JSON (org total, per-provider, per-model, top users)
- `GET /` — HTML status page (auto-refreshes every `SPEND_MONITOR_POLL_SECONDS`)

## Config (env)

| Var | Default | Meaning |
|-----|---------|---------|
| `PORT` | `3016` | listen port |
| `SPEND_MONITOR_MONGO_URI` | `mongodb://prod-mongodb:27017/LibreChat` | LibreChat MongoDB |
| `SPEND_MONITOR_DB` | `LibreChat` | database name |
| `SPEND_MONITOR_BUDGET_USD` | `100` | monthly org budget (USD) |
| `SPEND_MONITOR_PERIOD` | `calendar-month` | `calendar-month` or `rolling-30d` |
| `SPEND_MONITOR_WARN_PCT` | `50` | warn threshold (%) |
| `SPEND_MONITOR_CRIT_PCT` | `80` | critical threshold (%) |
| `SPEND_MONITOR_EUR_RATE` | `0.92` | EUR per USD, display only |
| `SPEND_MONITOR_POLL_SECONDS` | `60` | aggregation interval |
| `SPEND_MONITOR_ENFORCE` | `off` | `off`/`dry-run`/`on` — hard stop by zeroing balances |

Spend uses LibreChat's convention: `1,000,000 token credits = 1 USD`. `tokenValue`
is negative for usage; `tokenType: 'credits'` rows (refills) are excluded.
Provider split: model ids containing `/` are OpenRouter, bare ids are Scaleway.

Under this repo's compose these are wired up for you: `PORT` is fixed at 3016 (only
the host side of the local binding follows `SPEND_MONITOR_PORT`) and
`SPEND_MONITOR_MONGO_URI` defaults to `LIBRECHAT_MONGO_URI`. See
`docker-compose.spend-monitor.yml`.

## Run

```bash
npm install
SPEND_MONITOR_MONGO_URI=mongodb://localhost:27017/LibreChat npm start
```
