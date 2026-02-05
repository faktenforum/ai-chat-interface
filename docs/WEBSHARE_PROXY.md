# Webshare Proxy Setup

Minimal setup for Webshare **fixed proxy URL** (Rotating/Backbone). Used by mcp-ytptube and mcp-youtube-transcript when `YTPTUBE_PROXY` is unset. Available on all Webshare plans including Free.

**Behaviour:** Requests are tried **first without proxy**. If the job fails with a blocked-like error (rate limit, no formats, etc.), a **retry with proxy** is started automatically after a random short delay (2–6 s); with Webshare rotating proxy, the retry uses a different IP. If you set `YTPTUBE_PROXY` explicitly, the proxy is used from the first attempt (no try-without-proxy).

## Recommended plan

For **getting started** and **most use cases** (transcripts and video downloads), we recommend the **Proxy Server** (Datacenter) plan:

- **100 proxies, 250 GB bandwidth/month** — ca. $2.99/month (or ~$1.99/month billed yearly).
- Same product as the free tier; Rotating Proxy Endpoint and `p.webshare.io` work unchanged.
- **Free tier** (10 proxies, 1 GB/month) is only suitable for testing transcripts; video downloads need more bandwidth.

Choose this plan in [Webshare pricing](https://www.webshare.io/pricing) under **Proxy Server** (not Rotating Residential).

## 1. Get credentials in Webshare

We use the **Rotating Proxy Endpoint** (or **Backbone Connection**). Do **not** use Direct Connection — our stack expects the single endpoint `p.webshare.io`, not individual proxy IPs.

1. Open [Proxy List](https://dashboard.webshare.io/proxy/list) (Dashboard → **View My Proxy List**).
2. In **Connection Method**, select **Rotating Proxy Endpoint** (or **Backbone Connection**).
3. The dashboard then shows the connection details. Use these **exactly** for the env variables below:
   - **Domain Name** → `p.webshare.io` (fixed in our code; no env var)
   - **Proxy Port** → `WEBSHARE_PROXY_PORT`
   - **Proxy Username** → `WEBSHARE_PROXY_USERNAME`
   - **Proxy Password** → `WEBSHARE_PROXY_PASSWORD`

Copy the values from the dashboard (use the COPY buttons if available). Default port is 80; alternative ports 1080, 3128, or 9999–29999 are also supported.

## 2. Configure this stack

Set in `.env.local` (local) or in Portainer env (prod/dev). Use the **Proxy Username**, **Proxy Password**, and **Proxy Port** from the Webshare dashboard (step 1):

| Var | Source in Webshare |
|-----|--------------------|
| `WEBSHARE_PROXY_USERNAME` | Proxy Username (e.g. `youruser-rotate`) |
| `WEBSHARE_PROXY_PASSWORD` | Proxy Password |
| `WEBSHARE_PROXY_PORT` | Proxy Port (optional; default 80) |

Example (do not commit real values):

```bash
WEBSHARE_PROXY_USERNAME=your_username
WEBSHARE_PROXY_PASSWORD=your_password
WEBSHARE_PROXY_PORT=80
```

Optional: run `npm run setup:env` and enter Webshare credentials when prompted (or add them manually to `.env.local`).

## 3. Apply and restart

- **Local:** Use `--env-file .env.local` so Webshare (and other) settings are applied:
  - Restart: `docker compose -f docker-compose.local.yml --env-file .env.local up -d mcp-ytptube mcp-youtube-transcript`
  - Rebuild: `docker compose -f docker-compose.local.yml --env-file .env.local up -d --build mcp-ytptube`
- **Prod/Dev:** Redeploy the stack so the updated env is picked up.

## 4. Test

**Quick check (proxy reachable):**

```bash
curl -x "http://YOUR_USER:YOUR_PASS@p.webshare.io:80" https://api.ipify.org
```

You should see an IP (Webshare exit). Replace `YOUR_USER` / `YOUR_PASS` with your credentials, or use the same values as in `.env.local`.

**In-app:** Use an agent that calls the YouTube transcript or YTPTube tool (e.g. request transcript for a public video). Status responses include `proxy_used=true|false` and `attempt=1|2` so the LLM knows whether the current job used a proxy and which attempt it was. Failures may show in mcp-ytptube logs: `docker compose -f docker-compose.local.yml --env-file .env.local logs mcp-ytptube --tail 50`.

## What to try if it still fails (no extra cost)

1. **Proxy from first request** — Set `YTPTUBE_PROXY` to your Webshare URL (e.g. `http://USER:PASS@p.webshare.io:80`). Then the proxy is used on the first attempt instead of only on retry. Useful if the server IP is blocked for the target site from the start.
2. **Backbone instead of Rotating** — In Webshare Dashboard → Proxy List → Connection Method, switch to **Backbone Connection**. Same `p.webshare.io` and credentials; no code change. Can improve stability when IPs rotate.
3. **Check account** — Email verified, subscription active, bandwidth left ([Troubleshooting](https://help.webshare.io/en/articles/8370531-proxies-are-not-working-troubleshooting-common-issues)).

**Other sites than YouTube:** The same proxy (Proxy Server / Datacenter) works for all targets yt-dlp supports (Vimeo, SoundCloud, TikTok, etc.). One proxy URL is used for every request that goes through the proxy.

## Tips from Webshare and other users

- **403 / blocked by target:** With **Residential** proxies, some sites (e.g. YouTube) can return `client_connect_forbidden_host (403)`. Fix: use **Datacenter** (Proxy Server) or **Static Residential** — [Troubleshooting](https://help.webshare.io/en/articles/8370531-proxies-are-not-working-troubleshooting-common-issues). Our stack uses Proxy Server (Datacenter), which is the right product for this.
- **If proxies are still blocked:** Replace blocked IPs from the [proxy list](https://dashboard.webshare.io/proxy/list); or upgrade to Private → Dedicated → Static Residential for lower block rates — [What can I do if the proxies are blocked?](https://help.webshare.io/en/articles/8370530-what-can-i-do-if-the-proxies-are-blocked).
- **YouTube Proxies (paid, separate product):** Dedicated endpoint, port 30000, session ID in username for a new IP per video. Contact [Sales](https://www.webshare.io/youtube-proxy). Worth trying only if Proxy Server (above) still fails for YouTube at volume. Marketed for YouTube; in practice it is an HTTP proxy so it may work for other yt-dlp targets too — confirm with Webshare if you need Vimeo/SoundCloud etc. [YouTube Proxies](https://help.webshare.io/en/articles/11432234-youtube-proxies).
- **Rotating without interruptions:** Prefer **Backbone Connection** over plain Rotating Endpoint when you need stable sessions while IPs change in the background — [Connection types](https://help.webshare.io/en/articles/8375305-understanding-proxy-connection-types-direct-rotating-and-backbone), [Rotating without interruptions](https://help.webshare.io/en/articles/9735479-how-to-use-rotating-proxies-without-interruptions).
- **Scraping best practices (general):** Use random delays between requests, rotate User-Agent to realistic browser values, and ensure credentials/bandwidth/subscription are valid — [Troubleshooting](https://help.webshare.io/en/articles/8370531-proxies-are-not-working-troubleshooting-common-issues). We apply a **random 2–6 s delay before each proxy retry** (in mcp-ytptube) so the retry does not hit the target immediately.

## Reference

- [Rotating Proxy Endpoint](https://help.webshare.io/en/articles/8375645-how-to-connect-through-a-rotating-proxy-endpoint)
- [Connection types](https://help.webshare.io/en/articles/8375305-understanding-proxy-connection-types-direct-rotating-and-backbone)
