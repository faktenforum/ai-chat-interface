# MCP YTPTube

YTPTube-backed MCP server. Video URL → transcript (YTPTube fetches audio; Scaleway transcribes). Prod/dev: Traefik exposes only `/api/download` for YTPTube; MCP is internal.

## Tools

**Request pattern:** Both `request_video_transcript` and `request_download_link` check if the result exists; if yes they return it (transcript or link); if not they start the job and return status. Use `get_status` to poll; when finished, call the same request tool again for transcript or link.

| Tool | Args | Behavior |
|------|------|----------|
| `request_video_transcript` | video_url, preset?, language_hint? | **Transcript.** Resolve by URL; if finished → transcript; else status or POST + queued. **language_hint** (ISO-639-1) forces language; omit → `language=unknown` + `language_instruction` (ask user, re-call if wrong). Prefer platform subtitles; fallback: audio + Scaleway. Optional: `YTPTUBE_PROXY`, `YTPTUBE_SUB_LANGS`. |
| `request_download_link` | video_url, type? (default video), preset? | For **download link** (video or audio). Resolve by URL. If finished → download_url. If not → result=status. If not found → POST (video or audio per type), return queued. Requires `YTPTUBE_PUBLIC_DOWNLOAD_BASE_URL`. |
| `get_status` | video_url?, job_id? (one required) | **Unified status** for any YTPTube item (transcript or download). Use **job_id** (internal UUID from prior response) or **video_url** for lookup. When finished, call the same request tool again for transcript or link. |
| `list_recent_downloads` | limit? (default 10), status_filter? (all\|finished\|queue) | Last N history items (queue/done) with title, status, optional `download_url` when finished. Use `request_download_link` for a direct link when status=finished. |
| `get_video_info` | video_url | Metadata (title, duration, extractor) for a URL without downloading – preview before download. |
| `get_thumbnail_url` | video_url | Link to the video thumbnail (from yt-dlp info; for preview/UI). |

## Response format

Key=value header lines; high information density:

- **Transcript:** (1) metadata: `result=transcript`, `url`, `job_id`, `status_url?`, `transcript_source`, `language?` (ISO-639-1 or `unknown`), `language_instruction?`, `relay`; (2) transcript text. `transcript_source`: `platform_subtitles` or `transcription`. Single-block clients may repeat `[transcript_source=…]` on first line.
- **Status:** `result=status`, `status=…`, `job_id?`, `url?`, `status_url?`, `progress?`, `reason?`, `language?`, `language_instruction?`, `relay`. Use `job_id` or `url`/`status_url` with `get_status`.
- **Error:** `result=error`, `relay=`.

## Transcript language

- **Without `language_hint`:** No language sent to Scaleway; responses include `language=unknown` and `language_instruction`. LLM tells user language was unspecified and may be wrong; if wrong, ask for correct language and re-call with `language_hint` (e.g. `"de"`).
- **With `language_hint`:** Sent as `language` to API; improves accuracy when user already indicated video language.

## LibreChat and status polling

No automatic MCP polling. LLM instructs user to ask for status (e.g. "What is the status?"); then calls `get_status` and replies. Do not promise to monitor or check back automatically.

## Dependencies

- **YTPTube** – queues URLs, serves audio via HTTP (no shared volume). Local: Web UI at `http://ytptube.{DOMAIN}`; prod/dev: only `https://ytptube.{DOMAIN}/api/download/*` exposed via Traefik (download-only router). Set `YTPTUBE_PUBLIC_DOWNLOAD_BASE_URL=https://ytptube.${DOMAIN}` in Portainer so `request_download_link` returns valid links. [GitHub](https://github.com/ArabCoders/ytptube)
- **yt-dlp** – YTPTube uses yt-dlp for metadata and downloads. We keep the submodule at `dev/yt-dlp` as **reference only** (we do not build from it; YTPTube uses its own yt-dlp dependency). The **full list of supported sites** is in [dev/yt-dlp/supportedsites.md](dev/yt-dlp/supportedsites.md). Theoretically YTPTube supports all sites listed there; in practice some extractors may be broken, geo-restricted, or require cookies/netrc.
- **Scaleway** – `SCALEWAY_BASE_URL` + `SCALEWAY_API_KEY`, OpenAI-compatible `/audio/transcriptions` (e.g. whisper-large-v3). Omit `language_hint` → no language sent; responses include `language=unknown` and `language_instruction`. With `language_hint` → sent as `language` to API.

## Platform support (yt-dlp)

YTPTube delegates URL handling to **yt-dlp** ([dev/yt-dlp](dev/yt-dlp), submodule). So **(theoretically) every site in yt-dlp’s supportedsites.md is supported** for `get_video_info`, `get_thumbnail_url`, `request_video_transcript`, and `request_download_link`. The canonical list is [dev/yt-dlp/supportedsites.md](dev/yt-dlp/supportedsites.md); sites and extractors change with yt-dlp updates.

**Notable extractors** (from supportedsites.md; subset):

| Category | Extractors (examples) |
|----------|------------------------|
| **Video** | youtube, vimeo, dailymotion, twitch (vod, clips, stream), facebook, facebook:reel, instagram (post, story, tag), tiktok, vm.tiktok, bilibili, pbs, archive.org, vk, twitter/x, nico, niconico, naver, etc. |
| **Audio** | soundcloud, soundcloud:set, bandcamp, audiomack, etc. |
| **Other** | Generic embed, many broadcasters (BBC, PBS, ARD, etc.), course/learning sites, paywalled (some need netrc). |

**Caveats:** Some entries are marked "(Currently broken)" in supportedsites.md; others require auth (netrc/cookies). MCP canonical URL matching is implemented for YouTube, Instagram, TikTok, Facebook; other platforms rely on YTPTube’s `archive_id` API. For test URLs and URL-matching examples, see yt-dlp’s [test/test_all_urls.py](dev/yt-dlp/test/test_all_urls.py) (e.g. youtu.be, vimeo channel/video, pbs, soundcloud set, facebook).

## Env (MCP + Compose)

**YTPTube service** (docker-compose.ytptube.yml): `YTP_OUTPUT_TEMPLATE` and `YTP_OUTPUT_TEMPLATE_CHAPTER` are set to bounded values (`%(id)s.%(ext)s`, `%(id)s - %(section_number)s.%(ext)s`) so temp and final filenames stay short and avoid "File name too long" (e.g. Facebook long titles). Override in compose if you need title-based filenames.

| Var | Description |
|-----|-------------|
| `YTPTUBE_URL` | Base URL (default `http://ytptube:8081`). |
| `YTPTUBE_API_KEY` | Optional; Base64(username:password) when YTPTube uses auth. Required for download links when YTPTube has auth. |
| `YTPTUBE_PUBLIC_DOWNLOAD_BASE_URL` | Optional. Public base URL for download links (e.g. `https://ytptube.${DOMAIN}`). Set in prod/dev so `request_download_link` returns working links. |
| `YTPTUBE_SUB_LANGS` | Optional. Comma-separated subtitle language codes for `--sub-langs` when using platform subtitles (e.g. `en,en-US,en-GB`). |
| `YTPTUBE_PROXY` | Optional. Proxy URL for yt-dlp (e.g. for Hetzner IP blocking). Appended as `--proxy <value>` to POST /api/history cli. Precedence over Webshare env. |
| `WEBSHARE_PROXY_USERNAME`, `WEBSHARE_PROXY_PASSWORD` | Optional. Webshare fixed proxy (Rotating/Backbone). Used when `YTPTUBE_PROXY` unset; same vars used by mcp-youtube-transcript. |
| `WEBSHARE_PROXY_PORT` | Optional; default 80. Port for `p.webshare.io` (80, 1080, 3128, or 9999–29999). |
| `SCALEWAY_BASE_URL`, `SCALEWAY_API_KEY` | Required for transcription. |
| `MCP_YTPTUBE_PORT` / `PORT` | HTTP port (default 3010). |
| `MCP_YTPTUBE_LOG_LEVEL` / `LOG_LEVEL` | Log level (default `info`). At `debug`, each tool invocation is logged with `tool`, `video_url?`, `job_id?` (no full payload) for correlation. |
| `MCP_YTPTUBE_DEBUG_API` | Set to `1` or `true` to log full YTPTube API responses and **each item's keys/sample**. Set **`MCP_YTPTUBE_LOG_LEVEL=debug`** (or `LOG_LEVEL=debug`) so those logs appear. Use for URL normalization and API response debugging (e.g. `archive_id`, `id`, `url`). |

## Webshare proxy (fixed URL)

Use **Rotating Proxy Endpoint** or **Backbone** in [Webshare Proxy List](https://dashboard.webshare.io/proxy/list) (Connection Method dropdown). Set `WEBSHARE_PROXY_USERNAME` and `WEBSHARE_PROXY_PASSWORD` (and optionally `WEBSHARE_PROXY_PORT`, default 80). Same vars used by mcp-youtube-transcript. See [docs/WEBSHARE_PROXY.md](WEBSHARE_PROXY.md) for setup.

## Download and transcript path resolution

For **finished** items, the YTPTube History API may return `filename` (and `folder`). When present, the MCP uses them first:

- **Download link:** `folder` + `filename` → build download URL directly (no file-browser call). If `filename` is missing, the MCP falls back to file-browser listing and title/slug matching.
- **Transcript:** If `item.filename` has extension `.vtt` or `.mp3`, that path is used for subtitle download or audio transcription. Otherwise the MCP uses file-browser resolution.

**Video-only items:** If a URL was only **downloaded as video** (e.g. via `request_download_link`), the folder contains only the video file. Calling `request_video_transcript` for that URL will **start a new transcript job** (subs or audio) and return `status=queued` with relay *"Item was video-only; started transcript job. Use get_status; when finished request transcript again."* No error is thrown; poll with `get_status` and call `request_video_transcript` again when finished.

**Before testing after deployment:** Clear old downloads in YTPTube if you want to avoid legacy paths; **restart the MCP server** after code changes and **reload MCP in Cursor** so the client uses the updated server.

## URL matching

Items are matched by URL, by YTPTube identifiers on the item, or by **archive_id** from the YTPTube API so that **all platforms** (including those without MCP canonical key rules) work:

- **From item (queue/history):** `archive_id` (e.g. `"youtube jNQXAC9IVRw"`, `"Facebook 1678716196448181"`) → normalized to `extractor:video_id`. Fallbacks: `extractor_key`, then `extractor` + `video_id`/`id`.
- **From request URL:** Canonical key for known platforms (YouTube, Instagram, TikTok, Facebook); otherwise normalized origin+pathname (www stripped). **Facebook:** both `www.facebook.com/reel/ID` and `m.facebook.com/watch/?v=ID` (as stored by YTPTube/yt-dlp) normalize to `facebook:ID` so `get_status(video_url)` finds the job.
- **Fallback for any URL:** If URL/item match fails, MCP calls **POST /api/yt-dlp/archive_id/** with the video URL. YTPTube returns the canonical `archive_id` for that URL (any platform). MCP normalizes it and matches items by that key. No platform-specific rules needed; works for Facebook, Vimeo, etc.

POST /api/history may return the existing item when the video is already in YTPTube; MCP uses that (and single-item fallback) to return transcript or status without failing.

**Debugging:** `get_status(video_url)` returns `not_found` → check URL normalization (e.g. Facebook www vs m) or API timing.

- **MCP tools:** **list_recent_downloads** to see stored URLs; **get_status(video_url=...)** to reproduce. See [MCP YTPTube Verification](MCP_YTPTUBE_VERIFICATION.md).
- **Docker:** `docker logs mcp-ytptube`, `docker logs <ytptube-container>`. Set `MCP_YTPTUBE_DEBUG_API=1` and `MCP_YTPTUBE_LOG_LEVEL=debug` for full API/item keys.

## Example videos for manual testing

Use these URLs to exercise tools across platforms. All are public, short or well-known; availability may change.

| Platform | URL | Note |
|----------|-----|------|
| **YouTube** | `https://www.youtube.com/watch?v=jNQXAC9IVRw` | "Me at the zoo" – first YouTube video; very short. |
| **YouTube** | `https://youtu.be/jNQXAC9IVRw` | Same video, short form (tests URL normalization). |
| **YouTube** | `https://www.youtube.com/watch?v=wqs8n5Uk5OM` | GopherCon 2020 – Functional Programming with Go; has subtitles. |
| **YouTube** | `https://www.youtube.com/watch?v=gvyTB4aMI4o` | NDC Oslo 2020 – Functional Programming with C# (from agents/test.md). |
| **YouTube** | `https://www.youtube.com/watch?v=dQw4w9WgXcQ` | Short music video; used in ytptube test_ytdlp_utils.py (thumbnail). |
| **YouTube** | `http://youtu.be/BaW_jenozKc` | Used in yt-dlp test_all_urls.py (URL matching). |
| **YouTube** (playlist) | `https://www.youtube.com/playlist?list=PL12345` | Example playlist ID from ytptube tasks schema; for feed/task testing, not single-video `get_video_info`. |
| **Dailymotion** | `https://www.dailymotion.com/video/xczg00` | Used in librechat-init agents.json. |
| **Vimeo** | `https://vimeo.com/76979871` | Used in librechat-init agents.json. |
| **Vimeo** | `https://vimeo.com/channels/31259/53576664` | Channel video from yt-dlp test_all_urls.py. |
| **PBS** | `https://www.pbs.org/video/how-fantasy-reflects-our-world-picecq/` | PBS video (from agents.json); may be geo-restricted. |
| **PBS** | `http://video.pbs.org/viralplayer/2365173446/` | From yt-dlp test_all_urls.py. |
| **SoundCloud** (set) | `http://soundcloud.com/floex/sets/gone-ep` | Set/playlist from yt-dlp test_all_urls.py. |
| **Facebook** | `https://www.facebook.com/…/photo.php?v=10153317450565268` | Photo/video URL format from yt-dlp test_all_urls.py (replace … with page). |
| **Twitch** (VOD) | `https://www.twitch.tv/videos/111` | Non-existent VOD – use to test upstream error handling (e.g. "Video 111 does not exist"). From ytptube test_twitch_handler. |
| **Twitch** (channel) | `https://www.twitch.tv/testchannel` | Channel URL format from ytptube test_twitch_handler; for channel/feed handling, not single-video. |
| **Invalid** (validation) | `not-a-valid-url` | Use to test MCP input validation (Invalid URL). |

**Sources:** Repo – `dev/yt-dlp` (supportedsites.md; test_all_urls.py: youtu.be, vimeo channel/video, pbs, soundcloud set, facebook), `dev/ytptube` (tests: test_twitch_handler, test_rss_handler, test_ytdlp_utils, test_itemdto; schema: tasks.json; embedable: Instagram, TikTok, Facebook, Vimeo, Twitch, Dailymotion, Bilibili, Spotify), `dev/agents`, `dev/mcp-youtube-transcript`, `packages/librechat-init`, MCP test runs.

**Platforms without concrete test URLs in repo:** Instagram (`/p/ID`, `/reel/ID`), TikTok (`tiktok.com/@user/video/ID`), Bilibili (`bilibili.com/video/BV…`), Spotify – all listed in [dev/yt-dlp/supportedsites.md](dev/yt-dlp/supportedsites.md) and/or YTPTube UI embed patterns (`dev/ytptube/ui/app/utils/embedable.ts`). Use public URLs from those sites to test; some may require auth or be geo-restricted.

## Recommended test scenarios

Use these to validate behaviour (e.g. after code changes or deployment). Prefer the [example videos](#example-videos-for-manual-testing) above for URLs.

1. **Read-only:** `list_recent_downloads` with `status_filter=all`, `queue`, `finished`; confirm `job_id` is a UUID (36-char hex with hyphens). `get_video_info` / `get_thumbnail_url` with the same YouTube URL in long form and youtu.be form (e.g. jNQXAC9IVRw); one invalid or non-existent URL for error path.
2. **Transcript flow:** `request_video_transcript` with a YouTube URL that has subs. Then `get_status(job_id=<UUID from response>)` until status is finished; then `request_video_transcript` again and confirm transcript is returned. Also `get_status(video_url=…)` with the same URL and confirm it finds the job.
3. **Download flow:** `request_download_link` (type=video or audio) for a URL not yet in history; poll with `get_status(job_id=<UUID>)` or `get_status(video_url=…)`; when finished, call `request_download_link` again and confirm `download_url` is returned.
4. **Multiple items:** Trigger 3–5 different videos so queue/history have several entries. Then `list_recent_downloads` with different filters and `get_status(job_id)` / `get_status(video_url)` for each to ensure lookups work.
5. **Error cases:** `get_video_info` with invalid URL (validation error) and with non-existent video URL (upstream error message). `get_status(job_id=<UUID>)` must use the UUID from prior responses, not the platform video id.
6. **Video-only transcript:** For a URL that was only downloaded (e.g. via `request_download_link`), call `request_video_transcript`; it should start a transcript job and return `status=queued` (no error). Poll with `get_status`; when finished, call `request_video_transcript` again for the transcript.

## Troubleshooting

- **After code changes:** Restart the MCP server (e.g. container or process) so new logic is active. Reload MCP in Cursor (disconnect/reconnect or Reload Window) so the client talks to the updated server.
- **Item not found / 404:** URL format, item not in queue yet, or wrong YTPTube URL. Tool resolves via queue then done; check YTPTube logs if it persists.
- **POST ok but item not in queue yet:** Tool still returns `result=status` with `url=` (the video URL you sent); use that as `video_url` in `get_status` to poll until the download appears.
- **get_status(job_id) not_found:** `job_id` must be the **internal item ID (UUID)** returned in status/list responses. Use that UUID with `get_status(job_id=…)`; or use `video_url` (exact `url` or `status_url` from prior response).
- **status=error, reason=No formats:** yt-dlp found no downloadable formats (e.g. geo-restricted, login-only, or private). Try another URL or source.
- **get_video_info without duration:** `duration` is optional; some platforms or embeds do not expose it.
- **URL mismatch:** Set `MCP_YTPTUBE_DEBUG_API=1` and `LOG_LEVEL=debug`, then inspect `docker logs mcp-ytptube` for API item keys/sample to extend `canonicalKeyFromItem()` if needed.

## Further improvements (optional)

- **List pagination:** If YTPTube API supports `page`/`per_page` for `GET /api/history?type=done`, fetch multiple pages when `limit` > single-page size.
- **MCP tool instructions:** Keep server `instructions` and tool `description` fields in sync with [MCP_YTPTUBE.md](MCP_YTPTUBE.md) and Cursor MCP folder `INSTRUCTIONS.md` so LLMs get consistent guidance (job_id = UUID, video-only behaviour, relay).

## Future (not in v1)

- **Stream-through:** Pipe YTPTube download → Scaleway request to avoid buffering full audio.
- **Chunking:** If model has length limits, split by silence/duration, transcribe segments, concatenate.
- **MCP progress:** Use `progressToken` / `notifications/progress` while waiting on YTPTube ([spec](https://modelcontextprotocol.io/specification/2025-03-26/basic/utilities/progress)).
- **More YTPTube features:** Package is named mcp-ytptube to allow adding further YTPTube-specific tools later.
