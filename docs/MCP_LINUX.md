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
| `read_workspace_file` | Read a file as structured MCP content (text, image, audio). Text inline with line numbers; images/audio as base64; large or binary files get a download link. Limits: text 1 MB, binary 10 MB. |
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

## MCP transport and sessions

The server uses **Streamable HTTP** (POST for JSON-RPC, GET for SSE). Each client gets a **session** (created on `initialize`); sessions are **in-memory only** and are lost on server restart or process exit.

When a request references a missing session (e.g. after restart), the server returns **404 Not Found** with message "Session not found", as mandated by the MCP spec (2025-11-25 §Session Management). Per the spec the client MUST start a new session by sending a fresh `InitializeRequest` without a session ID.

Sessions that have no activity for **MCP_LINUX_SESSION_IDLE_TIMEOUT_MIN** minutes are evicted periodically (every 5 min) to avoid unbounded growth when clients disconnect without sending DELETE.

### Prod and dev on the same Portainer host

All services already use **STACK_NAME** in names: `container_name: ${STACK_NAME:-prod}-<service>`, networks like `${STACK_NAME:-prod}-app-net`, volumes like `${STACK_NAME:-prod}-mcp-linux-homes`. So set **STACK_NAME=dev** for the dev stack so prod and dev get separate networks/volumes/containers.

If you run **both** stacks on one host they also share the external network `loadbalancer-net` (traefik-net). Any service attached to traefik-net gets the **service name** as DNS alias there, so **both** stacks’ containers would register as e.g. `mcp-linux` → if LibreChat resolves DNS on traefik-net first, it could connect to the wrong container → 404s, session loss, instability.

**Fix:** (1) Deploy the **dev** stack with **STACK_NAME=dev**. (2) Every service that is on **traefik-net** and reached by hostname (mcp-linux, ytptube) uses a **stack-specific alias on traefik-net** only (`${STACK_NAME}-mcp-linux`, `${STACK_NAME}-ytptube`), so the short hostname (`mcp-linux`, `ytptube`) exists only on each stack’s app-net. Other MCPs are only on app-net, so no traefik-net alias is needed.

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `MCP_LINUX_PORT` | `3015` | Server port |
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
| `MCP_LINUX_SESSION_IDLE_TIMEOUT_MIN` | `30` | MCP session idle timeout (min); sessions with no activity are evicted to prevent leak |
| `MCP_LINUX_STATUS_MAX_FILES` | `50` | Max file entries per status category (staged/unstaged/untracked) before capping |
| `MCP_LINUX_STATUS_COLLAPSE_DIRS` | `uploads,venv,.venv` | Comma-separated dirs whose paths are collapsed to one summary line in status |
| `MCP_LINUX_RESOURCE_LIST_DIRS` | `uploads,outputs` | Comma-separated dirs listed in MCP resources (allowlist); only these appear in list |
| `MCP_LINUX_UPLOADS_MAX_AGE_DAYS` | `0` (disabled) | If > 0, server runs daily cleanup of `uploads/` files older than N days |

## Inline UI (MCP-UI)

The server ships small self-contained HTML views as MCP-UI resources (`ui://` text/html) that LibreChat renders inline in the chat. No separate frontend or hosted status page.

- `get_status` returns an interactive **status card**: account, runtimes, workspaces, upload/download sessions, and terminals. Buttons (delete workspace, close upload session, revoke download link, kill terminal, refresh) post `tool` actions back to LibreChat, which arrive as a new user message asking the agent to run the matching tool. The agent places the resource marker (`\ui{id}`) in its reply to render the card.
- `create_upload_session` returns an **upload widget** (drag & drop, progress) plus a browser URL. The widget renders inline; the same widget is served standalone at `GET /upload/:token` for a shareable link.

The upload widget's iframe has an opaque origin, so `POST /upload/:token` and `GET /upload/:token/{config,status}` send permissive CORS headers (the token in the URL is the capability; no cookies are used). Downloads happen via the shared text URL: the chat iframe sandbox has no `allow-downloads`, so links inside the card are also shown as selectable text.

## Traefik Routing

Upload and download routes are exposed publicly via Traefik (`/upload/*`, `/download/*`). The MCP endpoint (`/mcp`) remains internal (Docker network only). Production base URLs must point to the public Traefik host (e.g. `https://mcp-linux.faktenforum.org`).

## Git Access

- **SSH**: Optional `MCP_LINUX_GIT_SSH_KEY` (base64 ed25519 private key) → written to each user's `~/.ssh/` on account creation. Use same account as `MCP_GITHUB_PAT` (see [GitHub Machine User](GITHUB_MACHINE_USER.md)).
- **GitHub CLI**: Optional `MCP_GITHUB_PAT` → authenticates `gh` CLI for all users (PR creation, GitHub operations). Same PAT as GitHub MCP for consistency. Written to each user's `~/.config/gh/hosts.yml` on account creation.
- **Author**: Optional `MCP_LINUX_GIT_USER_NAME` / `MCP_LINUX_GIT_USER_EMAIL` set default `git config user.name` and `user.email` for new and default workspaces. If not set, falls back to the user's global git config (`git config --global user.name` / `user.email`), then to built-in default (Correctiv Team Digital Bot).
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
