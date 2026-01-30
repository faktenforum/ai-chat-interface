# Webshare Proxy Setup

Minimal setup for Webshare **fixed proxy URL** (Rotating/Backbone). Used by mcp-ytptube and mcp-youtube-transcript when `YTPTUBE_PROXY` is unset.

## Dashboard

1. [Webshare Proxy List](https://dashboard.webshare.io/proxy/list) → **Connection Method** dropdown.
2. Choose **Rotating Proxy Endpoint** or **Backbone** (fixed URL; rotation handled by Webshare).
3. Note **Proxy Authentication Details** (username, password) and **port** (default 80, or 1080, 3128, 9999–29999). Domain: `p.webshare.io`.

## In this stack

Set in `.env.local` or Portainer env:

| Var | Description |
|-----|-------------|
| `WEBSHARE_PROXY_USERNAME` | Username from Proxy Authentication. |
| `WEBSHARE_PROXY_PASSWORD` | Password. |
| `WEBSHARE_PROXY_PORT` | Optional; default 80. |

Both mcp-ytptube and mcp-youtube-transcript use these vars. Rotation is per request on Webshare’s side.

[Rotating Proxy Endpoint](https://help.webshare.io/en/articles/8375645-how-to-connect-through-a-rotating-proxy-endpoint) · [Connection types](https://help.webshare.io/en/articles/8375305-understanding-proxy-connection-types-direct-rotating-and-backbone)
