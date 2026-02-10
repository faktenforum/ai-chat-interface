# MCP Linux Server

Per-user isolated Linux terminal environment with persistent git workspaces, file upload/download, and structured file reading.

## Architecture

- **Central MCP server** runs as root (Express + Streamable HTTP)
- **Per-user worker** processes spawned via `runuser`, running as the user's Linux account
- **IPC** between server and workers via Unix sockets
- **Persistent volumes**: `/home` (user data), `/app/data` (user mapping DB)

User naming: `lc_` + email local part (sanitized). Example: `pascal.garber@correctiv.org` → `lc_pascal_garber`.

## Tools

### Terminal
| Tool | Description |
|------|-------------|
| `execute_command` | Run shell command in workspace context |
| `read_terminal_output` | Read output from active terminal |
| `write_terminal` | Send input to terminal (interactive/REPL) |
| `list_terminals` | List active sessions |
| `kill_terminal` | Terminate a session |

### Workspace
| Tool | Description |
|------|-------------|
| `list_workspaces` | List all workspaces with git status |
| `create_workspace` | Create workspace (empty or from git URL) |
| `delete_workspace` | Delete workspace (not default) |
| `get_workspace_status` | Detailed git status |

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
| `list_upload_sessions` | List active/all upload sessions |
| `close_upload_session` | Revoke an upload session |

Sessions are token-based, single-use (auto-close after upload), and time-limited (default 15 min). Uploaded files land in `~/workspaces/{workspace}/uploads/`.

### File Download
| Tool | Description |
|------|-------------|
| `create_download_link` | Generate temporary download URL for a workspace file |
| `list_download_links` | List active/all download links |
| `close_download_link` | Revoke a download link |

Links are token-based, single-use (auto-close after download), and time-limited (default 60 min). Files are streamed from their original location.

### File Reading
| Tool | Description |
|------|-------------|
| `read_workspace_file` | Read file as structured MCP content (text, image, audio) |

Returns text files inline, images/audio as base64. Large or binary files automatically get a download link instead. Limits: text 1 MB, binary 10 MB.

### MCP Resources

Resource template `workspace://{workspace}/{+path}` exposes workspace files as navigable MCP resources (list + read).

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `MCP_LINUX_PORT` | `3015` | Server port |
| `MCP_LINUX_LOG_LEVEL` | `info` | Log level |
| `MCP_LINUX_WORKER_IDLE_TIMEOUT` | `1800000` | Worker idle timeout (ms) |
| `MCP_LINUX_GIT_SSH_KEY` | *(empty)* | Base64-encoded SSH private key for GitHub machine user |
| `MCP_LINUX_UPLOAD_BASE_URL` | `http://localhost:3015` | Public base URL for upload links |
| `MCP_LINUX_UPLOAD_MAX_FILE_SIZE_MB` | `100` | Max upload file size (MB) |
| `MCP_LINUX_UPLOAD_SESSION_TIMEOUT_MIN` | `15` | Upload session expiry (min) |
| `MCP_LINUX_DOWNLOAD_BASE_URL` | *(falls back to upload URL)* | Public base URL for download links |
| `MCP_LINUX_DOWNLOAD_SESSION_TIMEOUT_MIN` | `60` | Download link expiry (min) |

## Traefik Routing

Upload and download routes are exposed publicly via Traefik (`/upload/*`, `/download/*`). The MCP endpoint (`/mcp`) remains internal (Docker network only). Production base URLs must point to the public Traefik host (e.g. `https://mcp-linux.faktenforum.org`).

## Git Access

Optional: set `MCP_LINUX_GIT_SSH_KEY` to a base64-encoded ed25519 private key from a GitHub machine user. The key is written to each user's `~/.ssh/` on account creation.

## Pre-installed Runtimes

Node.js 24, Python 3, Git, Bash, ripgrep, tree, jq, build-essential, openssh-client. For headless plotting (e.g. Datenanalyse agent): fontconfig, fonts-dejavu-core. See [MCP Linux Data Analysis](MCP_LINUX_DATA_ANALYSIS.md) for CSV→chart workflow and example Python script.

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
