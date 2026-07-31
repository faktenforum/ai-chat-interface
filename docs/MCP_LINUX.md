# MCP Linux Server

Per-user isolated Linux terminal environment with persistent git workspaces, file upload/download, and structured file reading.

## Architecture

- **Central MCP server** runs as root (Express + Streamable HTTP)
- **Per-user worker** processes spawned via `runuser`, running as the user's Linux account
- **IPC** between server and workers via Unix sockets
- **Persistent volumes**: `/home` (user data), `/app/data` (user mapping DB)

User naming: `lc_` + email local part (sanitized). Example: `pascal.garber@correctiv.org` → `lc_pascal_garber`.

### Multi-user (shared session)

LibreChat can use one app-level MCP connection (`startup: true`), so one MCP session is shared by all users. User identity is taken from the **current request**: each tool invocation uses `X-User-Email` (and related headers) from that request’s HTTP headers, not from a session-scoped map. That avoids last-writer-wins races when multiple users use the Linux MCP at the same time.

## Tools

### Terminal
| Tool | Description |
|------|-------------|
| `execute_command` | Run shell command in workspace context. Commands always run in the given workspace (start in workspace root); response includes `workspace`, `cwd`, and optionally `cwd_relative_to_workspace`. Paths in the command and in `read_workspace_file` / `create_download_link` are relative to the workspace root—use the same relative path for script output and file tools. |
| `read_terminal_output` | Read output from active terminal |
| `write_terminal` | Send input to terminal (interactive/REPL) |
| `list_terminals` | List active sessions |
| `kill_terminal` | Terminate a session |

Terminal output is capped per call (`MCP_LINUX_MAX_OUTPUT_CHARS`, default 40000): head two thirds, tail one third, with the omitted character count. Uncapped output was re-sent with every model call for the rest of the turn, which is what exhausts a provider's tokens-per-minute quota. Page the middle with `read_terminal_output` using `offset`/`length`.

### Background jobs
| Tool | Description |
|------|-------------|
| `start_job` | Run a command detached; returns `job_id` immediately and survives the turn |
| `job_status` | State, exit code, output size, finish time |
| `read_job_output` | Combined stdout/stderr, capped by default, pageable |
| `wait_for_job` | Block until the job ends, reporting progress so the call does not time out |
| `list_jobs` | Jobs newest first, including ones from earlier turns |
| `kill_job` | SIGTERM to the process group |

See [Background Jobs](#background-jobs) for how it works and what push notifications cannot do.

A workspace is a plain per-project directory under `~/workspaces/`. Git is available on demand (init, clone, commit, push) but not required; a workspace can just hold files. One workspace = one task context.

### Workspace
| Tool | Description |
|------|-------------|
| `list_workspaces` | Call first to see all workspaces before creating or choosing one. Returns branch, dirty, remote_url. Use `get_workspaces(workspace)` for full git status. |
| `create_workspace` | Create a workspace (empty repo or clone from git URL). When cloning, submodules are checked out recursively. Call list_workspaces first if unsure whether the name exists. |
| `delete_workspace` | Delete a workspace (not `default`; requires `confirm: true`). |
| `get_workspaces` | Full git status and **submodules** status for one workspace. Returns workspace-root `AGENTS.md` content as `instructions` when present. Pass `summary_only: true` for the same overview without the full file lists. File lists may be truncated/collapsed (see **Status capping** below). |
| `clean_workspace_uploads` | Delete files in workspace `uploads/` older than N days (default 7; use 0 to delete all). Use to free space; uploads are ephemeral. |

#### When to use list_workspaces vs get_workspaces

- **`list_workspaces`** — Overview only: all workspace names, branch, dirty flag, remote_url. Use when choosing or creating a workspace, or checking whether a name exists.
- **`get_workspaces(workspace)`** — Full detail for **one** workspace: git status (with capping), optional instructions (from workspace-root `AGENTS.md`), submodules status. Pass `summary_only: true` for the overview without full file lists. Do not use for "list all workspaces".

#### Submodules in get_workspaces

- **`submodules`** — Submodule checkout status: `none` (no .gitmodules), `idle`, `updating`, `done`, or `error`; optional `message` on error.

#### Status capping

`get_workspaces` returns bounded file lists to avoid context overflow: paths under bulk dirs (e.g. `uploads/`, `venv/`) are collapsed to one summary line per dir; remaining paths are capped per category. Response includes `staged_count`, `unstaged_count`, `untracked_count` and `truncated: true` when lists were reduced. For full details use `execute_command('git status')` or file tools with explicit paths. Prefer `read_workspace_file` with explicit paths (e.g. from `list_upload_sessions`) rather than relying on the full status payload.

### Account
| Tool | Description |
|------|-------------|
| `get_status` | Account, runtimes, workspaces, sessions, terminals; returns an interactive status card (UI resource) |
| `reset_account` | Wipe and re-create home |

### File Upload
| Tool | Description |
|------|-------------|
| `create_upload_session` | Generate unique upload URL; user opens it in browser |
| `list_upload_sessions` | List all upload sessions by default (active, completed, expired, closed). Completed sessions include `uploaded_file` (name, size, path) for use with `read_workspace_file`. |
| `close_upload_session` | Revoke an upload session |

Sessions are token-based, single-use (auto-close after upload), and time-limited (default 15 min). Uploaded files land in `~/workspaces/{workspace}/uploads/`. **Uploads are ephemeral:** files in `uploads/` may be deleted by scheduled cleanup (see `MCP_LINUX_UPLOADS_MAX_AGE_DAYS`) or via `clean_workspace_uploads`. Move or download important outputs before they are purged.

### File Download
| Tool | Description |
|------|-------------|
| `create_download_link` | Generate temporary download URL for a workspace file |
| `list_download_links` | List active (or all) download links. Use to find stale links that should be closed. |
| `close_download_link` | Revoke an active download link. Use to clean up after the user has downloaded or when links are no longer needed. |

Links are token-based, single-use (auto-close after download), and time-limited (default 60 min). Files are streamed from their original location. **Cleanup:** Periodically check `list_download_links` (e.g. after creating new links or at end of a task) and call `close_download_link` for links that are unused—keeps exposure minimal and follows security best practice.

### Files

First-class file tools (opencode-style) run in the per-user worker, so file ownership is correct and routine file work does not go through `execute_command`. All paths are relative to the workspace root.

| Tool | Description |
|------|-------------|
| `read_workspace_file` | Read a file as structured MCP content (text, image, audio). Text inline with line numbers, first 1200 lines by default - page further with `offset`/`limit`, or ask for exact `line_ranges`; the header states which lines of how many were returned. Images/audio as base64; large or binary files get a download link. Limits: text 1 MB, binary 10 MB. |
| `list_workspace_files` | List files in a workspace directory; more effective than `ls` for exploring structure. |
| `write` | Create (with parent dirs) or overwrite a file. Prefer over echoing content through `execute_command`. |
| `edit` | Replace an exact string in an existing file. `old_string` must match exactly and be unique unless `replace_all: true`. |
| `grep` | Search file contents by regex (ripgrep). Returns matching files, line numbers, and line text. Narrow with `path` and `glob`. |
| `glob` | Find files by glob pattern (e.g. `**/*.py`). Returns paths relative to the workspace root. |

### Task tracking
| Tool | Description |
|------|-------------|
| `todowrite` | Maintain a structured todo list for the current multi-step task. Statuses: `pending`, `in_progress`, `completed`; keep exactly one item `in_progress`. The list lives in the model's context, not on the server. |

### MCP Resources

Resource template `workspace://{workspace}/{+path}` exposes workspace files as navigable MCP resources (list + read). **List is limited to allowlisted dirs** (`uploads/`, `outputs/` by default) so only intentionally usable paths (user uploads, script outputs) appear; other workspace paths are not listed. Read access via resource or `read_workspace_file` still works for any path when given explicitly.

### State and reusable scripts

Workspaces are persistent. Agents can save scripts (e.g. under `scripts/` in a workspace) and run them again in later turns. See [MCP Code Execution Insights](MCP_CODE_EXECUTION_INSIGHTS.md) for context-efficiency guidance (batch work in code, filter before return).

### Which agent uses this

The **Assistant** agent (id: `shared-agent-assistant`) uses these tools. It is the universal agent for coding, Linux/shell, files, data analysis, documents, file conversion, research, and GitHub. There is no router and no multi-agent handoff chain; the Assistant does the work itself and hands off (one hop) only to the three specialists (Faktencheck, Travel and Location, Image Generation) when the request is outside its scope.

For searching code in a workspace, use the `grep` and `glob` file tools above.

## Mail (IMAP/SMTP) at /mcp/mail

The same container also serves a **separate MCP server** for the user's own mailbox, at `/mcp/mail`. LibreChat lists it as its own server ("E-Mail") with its own tool list and its own credentials.

Why one container and two endpoints:

- LibreChat gates credentials **per server**. Mail needs an address and a password before any of its tools mean anything; requiring them on the Linux server would hide the terminal tools from everyone who has not set up mail.
- Attachments cross over. `save_attachment` writes into `~/workspaces/<workspace>/mail/` as the user, and `send_message` attaches files from the same place - so "fetch the invoice from my mail and convert it" is one conversation. That only works because both servers share the per-user Linux accounts.

### Credentials

Each user enters them once in the LibreChat server settings; LibreChat stores them encrypted and sends them as headers on every request. **Nothing is written to disk and nothing is cached between requests**, so a changed or revoked password takes effect on the next call. The agent is instructed never to ask for a password in the chat.

| Variable | Required | Meaning |
|---|---|---|
| `MAIL_ADDRESS` | yes | The address to send from and the mailbox to read |
| `MAIL_PASSWORD` | yes | Mailbox password, or an app password where the provider offers one |
| `MAIL_LOGIN` | no | Only when the login name is not the address |
| `MAIL_IMAP` | no | `host[:port]`, overrides `MCP_MAIL_IMAP` |
| `MAIL_SMTP` | no | `host[:port]`, overrides `MCP_MAIL_SMTP` |
| `MAIL_FROM_NAME` | no | Display name recipients see |

Hosts are **not** hardcoded to one provider. Set `MCP_MAIL_IMAP` and `MCP_MAIL_SMTP` and the whole company only fills in address and password; anyone with a different provider overrides them. The format accepts `host`, `host:port`, and an explicit scheme when the port is unusual: `imaps://host:993` for TLS from the first byte, `imap://host:143` for STARTTLS. Without a scheme the port decides, the way every mail client does it - 993 and 465 are TLS, everything else is upgraded.

### Tools

| Tool | Purpose |
|---|---|
| `list_mailboxes` | Folder paths with message and unread counts. Start here: names differ per provider and language. |
| `list_messages` | Envelopes only (uid, subject, from, date, flags, attachment_count), newest first, `offset` to page back |
| `search_messages` | Server-side search over the whole mailbox: sender, subject, body text, date range, unread |
| `read_message` | Body text plus the attachment list. HTML-only mail is converted. Does not mark as read unless asked. |
| `send_message` | Send or reply (`reply_to_uid` sets the threading headers, the `Re:` prefix and the answered flag), attach workspace files, filed in Sent |
| `set_message_flags` | Read/unread, star, answered |
| `move_message` | Move to another folder |
| `delete_message` | To the trash folder the server names itself; `permanent: true` is irreversible |
| `save_attachment` | Writes one attachment into the workspace and returns its path |

Bodies are capped at `MCP_MAIL_MAX_BODY_CHARS` characters (default 8000) with the omitted count reported, for the same reason terminal output is capped: the model pays for every character again on each tool round, and the provider quota is what runs out first.

### Testing

`test/mail.ts` drives the endpoint through the official MCP SDK client against a real IMAP/SMTP server, credentials in headers included:

```bash
podman run -d --rm --name greenmail-test \
  -p 127.0.0.1:3025:3025 -p 127.0.0.1:3143:3143 \
  -e GREENMAIL_OPTS="-Dgreenmail.setup.test.all -Dgreenmail.hostname=0.0.0.0 -Dgreenmail.users=mailtest:secret@example.org" \
  docker.io/greenmail/standalone:2.1.9

cd packages/mcp-linux && npm run test:mail
```

Each run tags its own messages, so it can run repeatedly against the same mailbox. `MCP_MAIL_TLS_INSECURE=true` relaxes certificate checks and the STARTTLS requirement for that test server - never set it against a real mailbox.

## Calendar (CalDAV) at /mcp/calendar

A third MCP server on the same container, for the user's calendars. Separate from mail for the same reason mail is separate from the Linux tools: different credentials, and LibreChat gates them per server.

Written against **RFC 4791**, not against one provider's API, so Nextcloud, Radicale, Baikal and Fastmail all work. Discovery follows the standard chain - well-known URI, `current-user-principal`, `calendar-home-set`, then the collections in that home - because none of those paths can be guessed: Nextcloud puts calendars under `/remote.php/dav/calendars/`, Radicale under a bare user path, and both are configurable. The base URL of the instance is enough.

### Credentials

| Variable | Required | Meaning |
|---|---|---|
| `CALDAV_USERNAME` | yes | Login on the calendar server |
| `CALDAV_PASSWORD` | yes | App password. On Nextcloud: Settings → Security → new app password. |
| `CALDAV_URL` | no | Base URL, overrides `MCP_CALDAV_URL` |

The URL must be `https` unless it points at localhost - the password travels with every request. As with mail, nothing is stored on disk and nothing is cached between requests.

### Tools

| Tool | Purpose |
|---|---|
| `list_calendars` | Discovers the calendars with their URLs, colours and whether they are writable. Start here. |
| `list_events` | Events in a window, all calendars or one, with a text filter. Repeating events are expanded per occurrence. |
| `read_event` | One event in full, including the raw iCalendar |
| `create_event` | Timed or all-day, with description, location and attendees |
| `update_event` | Partial change; keeps alarms, attendee replies and repeat rules, and refuses to overwrite a concurrent edit |
| `delete_event` | Removes an event, or the whole series of a repeating one |
| `find_free_time` | The gaps of at least N minutes in a window, merging overlaps, all-day events counting as busy all day |

Design notes worth knowing:

- **Recurrence is expanded on the client**, with `ical.js`. The CalDAV `expand` element is optional and servers disagree about it, while every server returns the `RRULE`. Expansion is capped at 200 occurrences per event.
- **Events are addressed by URL**, not by id. That is how CalDAV works, and handing the URL back is what lets a later update or delete hit the right object without a second lookup.
- **`update_event` reads before it writes** and sends `If-Match`, so a change someone else made in between produces an error instead of being silently overwritten.
- **Writing iCalendar is done by hand**, with explicit RFC 5545 escaping and 75-octet line folding (counted in bytes, never splitting a multi-byte character). Reading goes through `ical.js`, which is where TZID references and floating times actually need handling.

### Testing

`test/calendar.ts` drives the endpoint through the official MCP SDK client against a real CalDAV server:

```bash
mkdir -p /tmp/radicale/config /tmp/radicale/data
printf 'caltest:secret\n' > /tmp/radicale/config/users
printf '[server]\nhosts = 0.0.0.0:5232\n[auth]\ntype = htpasswd\nhtpasswd_filename = /config/users\nhtpasswd_encryption = plain\n[storage]\nfilesystem_folder = /data/collections\n' > /tmp/radicale/config/config
podman run -d --rm --name radicale-test -p 127.0.0.1:5232:5232 \
  -v /tmp/radicale/config:/config:ro,Z -v /tmp/radicale/data:/data:Z \
  docker.io/tomsquest/docker-radicale:latest

cd packages/mcp-linux && npm run test:calendar
```

Each run creates its own calendar collection, so it can run repeatedly.

## MCP transport and sessions

The server uses **Streamable HTTP** (POST for JSON-RPC, GET for SSE). Each client gets a **session** (created on `initialize`); sessions are **in-memory only** and are lost on server restart or process exit.

When a request references a missing session (e.g. after restart), the server returns **404 Not Found** with message "Session not found", as mandated by the MCP spec (2025-11-25 §Session Management). Per the spec the client MUST start a new session by sending a fresh `InitializeRequest` without a session ID.

Sessions that have no activity for **MCP_LINUX_SESSION_IDLE_TIMEOUT_MIN** minutes are evicted periodically (every 5 min) to avoid unbounded growth when clients disconnect without sending DELETE.

**A client holding its SSE stream open is never evicted**, however long ago it last sent a request. LibreChat opens that stream once and then keeps it, so measuring idleness as "time since the last request" used to evict live connections: prod logged `404 with active session - session lost, triggering reconnection` for every user every 35 minutes (30 min timeout + the 5 min cleanup tick), followed by two failed reconnects before the client rebuilt the transport. `/health` reports `openStreams` so this is observable from outside.

### Prod and dev on the same Portainer host

All services already use **STACK_NAME** in names: `container_name: ${STACK_NAME:-prod}-<service>`, networks like `${STACK_NAME:-prod}-app-net`, volumes like `${STACK_NAME:-prod}-mcp-linux-homes`. So set **STACK_NAME=dev** for the dev stack so prod and dev get separate networks/volumes/containers.

If you run **both** stacks on one host they also share the external network `loadbalancer-net` (traefik-net). Any service attached to traefik-net gets the **service name** as DNS alias there, so **both** stacks’ containers would register as e.g. `mcp-linux` → if LibreChat resolves DNS on traefik-net first, it could connect to the wrong container → 404s, session loss, instability.

**Fix:** (1) Deploy the **dev** stack with **STACK_NAME=dev**. (2) Every service that is on **traefik-net** and reached by hostname (mcp-linux, ytptube) uses a **stack-specific alias on traefik-net** only (`${STACK_NAME}-mcp-linux`, `${STACK_NAME}-ytptube`), so the short hostname (`mcp-linux`, `ytptube`) exists only on each stack’s app-net. Other MCPs are only on app-net, so no traefik-net alias is needed.

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `MCP_LINUX_PORT` | `3015` | Server port; serves both `/mcp` and `/mcp/mail` |
| `MCP_MAIL_IMAP` | - | Default IMAP `host[:port]` for the mail server, overridable per user |
| `MCP_MAIL_SMTP` | - | Default SMTP `host[:port]` for the mail server, overridable per user |
| `MCP_MAIL_MAX_BODY_CHARS` | `8000` | Cap on the message body handed to the model |
| `MCP_MAIL_TLS_INSECURE` | - | `true` relaxes TLS for a test server. Never in production. |
| `MCP_CALDAV_URL` | - | Default CalDAV base URL, overridable per user |
| `MCP_LINUX_LOG_LEVEL` | `info` | Log level |
| `MCP_LINUX_WORKER_IDLE_TIMEOUT` | `1800000` | Worker idle timeout (ms) |
| `MCP_LINUX_WORKER_REQUEST_TIMEOUT_MS` | `120000` | Max time (ms) for a single worker request (e.g. `create_workspace` git clone). Increase if clones time out. |
| `MCP_LINUX_GIT_SSH_KEY` | *(empty)* | Base64-encoded SSH private key for GitHub machine user |
| `MCP_LINUX_GIT_USER_NAME` | *(user git config)* | Default Git author name for new/init repos. Falls back to user's `git config --global user.name`, then built-in default. |
| `MCP_LINUX_GIT_USER_EMAIL` | *(user git config)* | Default Git author email for new/init repos. Falls back to user's `git config --global user.email`, then built-in default. |
| `MCP_LINUX_UPLOAD_BASE_URL` | `http://localhost:3015` | Public base URL for upload links |
| `MCP_LINUX_UPLOAD_MAX_FILE_SIZE_MB` | `100` | Max upload file size (MB) |
| `MCP_LINUX_UPLOAD_SESSION_TIMEOUT_MIN` | `15` | Upload session expiry (min) |
| `MCP_LINUX_DOWNLOAD_BASE_URL` | *(falls back to upload URL)* | Public base URL for download links |
| `MCP_LINUX_DOWNLOAD_SESSION_TIMEOUT_MIN` | `60` | Download link expiry (min) |
| `MCP_LINUX_SESSION_IDLE_TIMEOUT_MIN` | `30` | Idle timeout (min) for sessions with **no open SSE stream**; a connected client is exempt |
| `MCP_LINUX_STATUS_MAX_FILES` | `50` | Max file entries per status category (staged/unstaged/untracked) before capping |
| `MCP_LINUX_STATUS_COLLAPSE_DIRS` | `uploads,venv,.venv` | Comma-separated dirs whose paths are collapsed to one summary line in status |
| `MCP_LINUX_RESOURCE_LIST_DIRS` | `uploads,outputs` | Comma-separated dirs listed in MCP resources (allowlist); only these appear in list |
| `MCP_LINUX_UPLOADS_MAX_AGE_DAYS` | `0` (disabled) | If > 0, server runs daily cleanup of `uploads/` files older than N days |
| `MCP_LINUX_MAX_OUTPUT_CHARS` | `40000` | Cap on terminal output returned per call (head 2/3 + tail 1/3, middle dropped). Uncapped output is re-sent with every model call for the rest of the turn and burns the provider's tokens-per-minute quota; `read_terminal_output` with an explicit `length` still pages the full text |

## Inline UI (MCP-UI)

The server ships small self-contained HTML views as MCP-UI resources (`ui://` text/html) that LibreChat renders inline in the chat. No separate frontend or hosted status page.

- `get_status` returns an interactive **status card**: account, runtimes, workspaces, upload/download sessions, and terminals. Buttons (delete workspace, close upload session, revoke download link, kill terminal, refresh) post `tool` actions back to LibreChat, which arrive as a new user message asking the agent to run the matching tool. The agent places the resource marker (`\ui{id}`) in its reply to render the card.
- `create_upload_session` returns an **upload widget** (drag & drop, progress) plus a browser URL. The widget renders inline; the same widget is served standalone at `GET /upload/:token` for a shareable link.

The upload widget's iframe has an opaque origin, so `POST /upload/:token` and `GET /upload/:token/{config,status}` send permissive CORS headers (the token in the URL is the capability; no cookies are used). Downloads happen via the shared text URL: the chat iframe sandbox has no `allow-downloads`, so links inside the card are also shown as selectable text.

## Background Jobs

`execute_command` must answer inside the MCP call timeout, so anything that takes minutes (installs, builds, test suites) needs a different shape. `start_job` spawns the command detached and returns a `job_id` immediately; the job survives both the tool call and the end of the conversation turn.

| Tool | Purpose |
|------|---------|
| `start_job` | Start a command in the background, returns `job_id` + `pid` |
| `job_status` | State (`running`, `finished`, `failed`, `unknown`), exit code, output size |
| `read_job_output` | Combined stdout/stderr, capped by default, pageable with `offset`/`length` |
| `wait_for_job` | Blocks until the job ends, emitting `notifications/progress` every 2s |
| `list_jobs` | All jobs, newest first - finds jobs started in an earlier turn |
| `kill_job` | SIGTERM to the process group; output stays readable |

State is files, not memory, so a worker restart does not lose a running job: `~/.mcp_jobs/<id>.json` (metadata), `<id>.log` (output), `<id>.exit` (exit code). The command runs in a subshell so that a `exit N` inside it still lets the wrapper record the code.

**Why `wait_for_job` can run for minutes:** the MCP client resets its tool-call timeout on every progress notification (LibreChat sets `resetTimeoutOnProgress: true`). Verified with the official SDK client: a 6-second job returned successfully through a **4-second** client timeout, with 3 progress callbacks. This requires SSE responses, so the transport runs with `enableJsonResponse: false` - a JSON response is one body with no room for notifications.

**What is not possible:** nothing wakes the agent between turns. LibreChat registers exactly one server-initiated notification handler (`notifications/resources/list_changed`, which only refreshes the resource list), and its agent loop has no entry point for an unsolicited event - a finished run cannot be resumed. So "notify me when the build is done" works *within* a turn via `wait_for_job`, or by the agent checking `list_jobs` when the user writes again. A real push would need LibreChat to consume MCP notifications and re-invoke the agent (upstream does not handle even `tools/list_changed` yet, see danny-avila/LibreChat#7117).

## Traefik Routing

Upload and download routes are exposed publicly via Traefik (`/upload/*`, `/download/*`). The MCP endpoint (`/mcp`) remains internal (Docker network only). Production base URLs must point to the public Traefik host (e.g. `https://mcp-linux.faktenforum.org`).

## Git Access

- **SSH**: Optional `MCP_LINUX_GIT_SSH_KEY` (base64 ed25519 private key) → written to each user's `~/.ssh/` on account creation. Use same account as `MCP_GITHUB_PAT` (see [GitHub Machine User](GITHUB_MACHINE_USER.md)).
- **GitHub CLI**: Optional `MCP_GITHUB_PAT` → authenticates `gh` CLI for all users (PR creation, GitHub operations). Same PAT as GitHub MCP for consistency. Written to each user's `~/.config/gh/hosts.yml` on account creation.
- **Author**: Optional `MCP_LINUX_GIT_USER_NAME` / `MCP_LINUX_GIT_USER_EMAIL` set default `git config user.name` and `user.email` for new and default workspaces. If not set, falls back to the user's global git config (`git config --global user.name` / `user.email`), then to built-in default (Correctiv Team Digital Bot).
- **Own token per user**: the `linux` server declares `GITHUB_PAT` as an *optional* `customUserVar` and forwards it as `X-User-Github-Pat`. Unset, the header is not sent and everything stays on the shared account - the server's tools remain available either way (that is what `optional` means, see the LibreChat fork). Set, the token replaces the bot for that user: written to their `~/.config/gh/hosts.yml` with `git_protocol: https` and to `~/.git-credentials`, with `url.https://github.com/.insteadOf git@github.com:` so remotes cloned as SSH keep working, and `user.name` / `user.email` switched to their GitHub login and `<id>+<login>@users.noreply.github.com` so commits are attributed to them. Removing the token reverts exactly those keys (tracked by the `faktenforum.ownCredentials` marker) and nothing set by hand.
- The token arrives with every request; a change is applied on the next one, and unchanged requests touch no files. Container restarts re-apply the shared setup first, then the user's token on their next request.
- **Default .gitignore**: When a workspace is created (empty or default), a minimal `.gitignore` is added if missing (`uploads/`, `venv/`, `.venv/`) so git does not report hundreds of ephemeral files in status.

## Pre-installed Runtimes

Node.js 24, Python 3, Git, Bash, ripgrep, tree, jq, build-essential, openssh-client, **GitHub CLI (gh)**. For headless plotting: fontconfig, fonts-dejavu-core. See [MCP Linux Data Analysis](MCP_LINUX_DATA_ANALYSIS.md) for the CSV→chart workflow and an example Python script.

Media conversion and document tools (no LibreOffice/texlive):
- **FFmpeg** — audio/video conversion (MP3, OGG, FLAC, OPUS, MP4, WEBM, etc.)
- **ImageMagick** — image conversion and manipulation (PNG, JPG, WEBP, GIF, TIFF, SVG, PDF, etc.)
- **Pandoc** — markup document conversion (Markdown, HTML, ODT, DOCX, EPUB, RST)
- **Typst** — modern PDF/document engine (markup-based typesetting, single binary)

## Docker

- Image: `ghcr.io/faktenforum/mcp-linux`
- Port: `3015`
- Volumes: `mcp_linux_homes` (user data), `mcp_linux_data` (mapping)
- Resource limits: 2 CPU, 2G RAM
