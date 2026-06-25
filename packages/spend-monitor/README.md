# spend-monitor

Read-only org-wide cost monitor for LibreChat. Aggregates spend from the
`transactions` collection in LibreChat's MongoDB and serves an in-platform
status page. It does **not** write to LibreChat's database and does **not**
enforce any limit (per-user limits stay in LibreChat's own balance system).

## Endpoints

- `GET /health` — liveness, `{status:"ok"}`
- `GET /api/spend` — current-period spend JSON (org total, per-provider, per-model, top users)
- `GET /` — HTML status page (auto-refresh 30s)

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

Spend uses LibreChat's convention: `1,000,000 token credits = 1 USD`. `tokenValue`
is negative for usage; `tokenType: 'credits'` rows (refills) are excluded.
Provider split: model ids containing `/` are OpenRouter, bare ids are Scaleway.

## Run

```bash
npm install
SPEND_MONITOR_MONGO_URI=mongodb://localhost:27017/LibreChat npm start
```
