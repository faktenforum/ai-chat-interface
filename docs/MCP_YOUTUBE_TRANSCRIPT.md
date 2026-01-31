# MCP YouTube Transcript

YouTube Transcript MCP server. Fetches transcripts for YouTube video URLs via [youtube-transcript-api](https://github.com/jdepoix/youtube-transcript-api). Submodule: `dev/mcp-youtube-transcript`. [Upstream](https://github.com/jkawamoto/mcp-youtube-transcript).

## Tools

| Tool | Args | Behavior |
|------|------|----------|
| `get_transcript` | url, lang? (default en), next_cursor? | Transcript text. Use `next_cursor` for long videos (responses split at ~50k chars). |
| `get_timed_transcript` | url, lang?, next_cursor? | Transcript with timestamps. |
| `get_video_info` | url | Video metadata (title, etc.). |

## Env (optional)

| Var | Description |
|-----|-------------|
| `WEBSHARE_PROXY_USERNAME`, `WEBSHARE_PROXY_PASSWORD` | Webshare fixed proxy (Rotating/Backbone); same vars as mcp-ytptube. |
| `WEBSHARE_PROXY_PORT` | Optional; default 80. Port for `p.webshare.io`. |
| `HTTP_PROXY`, `HTTPS_PROXY` | Generic proxy (or `--http-proxy` / `--https-proxy`). |

In this stack the service uses the same proxy env as mcp-ytptube. See [WEBSHARE_PROXY.md](WEBSHARE_PROXY.md). Used when YouTube blocks requests ([youtube-transcript-api: IP bans](https://github.com/jdepoix/youtube-transcript-api?tab=readme-ov-file#working-around-ip-bans-requestblocked-or-ipblocked-exception)).

## Response pagination

Long transcripts are split (default ~50k chars). Response may include `next_cursor`; pass it to get the next chunk. Adjust with `--response-limit` if needed.
