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

### Workspace
| Tool | Description |
|------|-------------|
| `list_workspaces` | Call first to see all workspaces before creating or choosing one. Returns branch, dirty, remote_url, plan_preview. Use `get_workspace_status(workspace)` for full plan and tasks. |
| `create_workspace` | Create workspace (empty or from git URL). Call list_workspaces first if unsure whether the name exists. |
| `delete_workspace` | Delete workspace (not default) |
| `get_workspace_status` | Full git status plus plan and tasks (each task: title, status). First call after every handoff: use workspace from handoff instructions (default if none). Plan and tasks are the source of truth for what to do next. File lists may be truncated/collapsed (see **Status capping** below). |
| `set_workspace_plan` | Set plan and/or tasks. Call before every handoff and at end of your turn so the next agent sees current state; if you omit this, context is lost. Pass full task list with updated statuses, or partial updates via `task_updates: [{ index, status }]` (0-based index from get_workspace_status). Tasks: `{ title, status? }` or string[]; status: pending, in_progress, done, cancelled. |
| `clean_workspace_uploads` | Delete files in workspace `uploads/` older than N days (default 7; use 0 to delete all). Use to free space; uploads are ephemeral. |

#### When to use list_workspaces vs get_workspace_status

- **`list_workspaces`** — Overview only: all workspace names, branch, dirty flag, remote_url, short plan_preview. Use when: choosing or creating a workspace, checking if a name exists, or deciding which workspace to pass in a handoff. When handing off to a workspace specialist, put the chosen workspace name in the handoff instructions so they call `get_workspace_status(workspace)` first.
- **`get_workspace_status(workspace)`** — Full detail for **one** workspace: full plan, all tasks (title + status), git status (with capping). Use when: after a handoff (to read plan/tasks), before/after `set_workspace_plan`, or when you need task-level context. Do not use for "list all workspaces".

#### Plan and tasks

Workspaces store a **plan** (goal/context) and **tasks** (steps) as the **single source of truth** for continuity across handoffs. Stored in `.mcp-linux/plan.json` per workspace. Each task has `title` and `status` (pending | in_progress | done | cancelled). **Flow:** After a handoff use `get_workspace_status(workspace)` (workspace from handoff instructions; use `default` if none). If there is no or empty plan/tasks, set an initial plan and tasks from the handoff then continue. **Always** call `set_workspace_plan` before every handoff or when finishing your part so the next agent has current state; otherwise context is lost. To update only some statuses, use `task_updates` with 0-based indices from get_workspace_status (e.g. `task_updates: [{ index: 0, status: 'done' }, { index: 1, status: 'in_progress' }]`). Handoff instructions should contain the **workspace name** and optionally one short hint (e.g. "Continue from plan/tasks"); do not duplicate the full plan or task list in handoff text. Before creating a workspace call `list_workspaces` to avoid "already exists". Prefer tasks as string array (e.g. `["Step 1", "Step 2"]`); or `[{ title, status? }]`.

#### Status capping

`get_workspace_status` returns bounded file lists to avoid context overflow: paths under bulk dirs (e.g. `uploads/`, `venv/`) are collapsed to one summary line per dir; remaining paths are capped per category. Response includes `staged_count`, `unstaged_count`, `untracked_count` and `truncated: true` when lists were reduced. For full details use `execute_command('git status')` or file tools with explicit paths. Prefer `read_workspace_file` with explicit paths (e.g. from `list_upload_sessions`) rather than relying on the full status payload.

### Account
| Tool | Description |
|------|-------------|
| `get_account_info` | Username, home, disk usage, runtimes |
| `reset_account` | Wipe and re-create home |
| `get_system_info` | Available runtime versions |

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

### File Reading
| Tool | Description |
|------|-------------|
| `read_workspace_file` | Read file as structured MCP content (text, image, audio) |

Returns text files inline, images/audio as base64. Large or binary files automatically get a download link instead. Limits: text 1 MB, binary 10 MB.

### MCP Resources

Resource template `workspace://{workspace}/{+path}` exposes workspace files as navigable MCP resources (list + read). **List is limited to allowlisted dirs** (`uploads/`, `outputs/` by default) so only intentionally usable paths (user uploads, script outputs) appear; other workspace paths are not listed. Read access via resource or `read_workspace_file` still works for any path when given explicitly.

### State and reusable scripts

Workspaces are persistent. Agents can save scripts (e.g. under `scripts/` in a workspace) and run them again in later turns. See [MCP Code Execution Insights](MCP_CODE_EXECUTION_INSIGHTS.md) for context-efficiency guidance (batch work in code, filter before return).

### Agent Linux Expert

The **Linux Expert** agent (id: `shared-agent-linux-expert`) is a general Linux assistant with full MCP Linux tool access. It handles: general Linux questions, shell commands, scripts, file operations; plus MCP Linux account/workspace administration (status, cleanup, reset, sessions). Users can select it directly or be routed from Main Assistant. It hands off to Code Assistant (code implementation), Data Analysis, File Converter, or Document Creator for those domains.

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

## Traefik Routing

Upload and download routes are exposed publicly via Traefik (`/upload/*`, `/download/*`). The MCP endpoint (`/mcp`) remains internal (Docker network only). Production base URLs must point to the public Traefik host (e.g. `https://mcp-linux.faktenforum.org`).

## Git Access

- **SSH**: Optional `MCP_LINUX_GIT_SSH_KEY` (base64 ed25519 private key) → written to each user's `~/.ssh/` on account creation. Use same account as `MCP_GITHUB_PAT` (see [GitHub Machine User](GITHUB_MACHINE_USER.md)).
- **GitHub CLI**: Optional `MCP_GITHUB_PAT` → authenticates `gh` CLI for all users (PR creation, GitHub operations). Same PAT as GitHub MCP for consistency. Written to each user's `~/.config/gh/hosts.yml` on account creation.
- **Author**: Optional `MCP_LINUX_GIT_USER_NAME` / `MCP_LINUX_GIT_USER_EMAIL` set default `git config user.name` and `user.email` for new and default workspaces. If not set, falls back to the user's global git config (`git config --global user.name` / `user.email`), then to built-in default (Correctiv Team Digital Bot).
- **Default .gitignore**: When a workspace is created (empty or default), a minimal `.gitignore` is added if missing (`uploads/`, `venv/`, `.venv/`) so git does not report hundreds of ephemeral files in status.

## Pre-installed Runtimes

Node.js 24, Python 3, Git, Bash, ripgrep, tree, jq, build-essential, openssh-client, **GitHub CLI (gh)**. For headless plotting (e.g. Data Analysis agent): fontconfig, fonts-dejavu-core. See [MCP Linux Data Analysis](MCP_LINUX_DATA_ANALYSIS.md) for CSV→chart workflow and example Python script.

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
