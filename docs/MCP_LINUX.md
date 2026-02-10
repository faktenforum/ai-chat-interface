# MCP Linux Server

Per-user isolated Linux terminal environment with persistent git workspaces.

## Overview

Each LibreChat user gets a dedicated Linux account inside a Docker container (Ubuntu 24.04). The MCP server manages accounts automatically based on the `X-User-Email` header. Users have their own home directory, bash history, SSH config, and git-backed workspaces.

## Architecture

- **Central MCP server** runs as root (Express + Streamable HTTP)
- **Per-user worker** processes spawned via `runuser`, running as the user's Linux account
- **IPC** between server and workers via Unix sockets
- **Persistent volumes**: `/home` (user data), `/app/data` (user mapping DB)

## User Naming

`lc_` + email local part (sanitized). Example: `pascal.garber@correctiv.org` → `lc_pascal_garber`.

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

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `MCP_LINUX_PORT` | `3015` | Server port |
| `MCP_LINUX_LOG_LEVEL` | `info` | Log level |
| `MCP_LINUX_WORKER_IDLE_TIMEOUT` | `1800000` | Worker idle timeout (ms) |
| `MCP_LINUX_GIT_SSH_KEY` | *(empty)* | Base64-encoded SSH private key for GitHub machine user |

## Git Access

Optional: set `MCP_LINUX_GIT_SSH_KEY` to a base64-encoded ed25519 private key from a GitHub machine user (e.g. `faktenforum-agent`). The key is written to each user's `~/.ssh/` on account creation. Add the machine user as collaborator to repos the agent should access.

## Pre-installed Runtimes

Node.js 24, Python 3, Git, Bash, ripgrep, tree, jq, build-essential, openssh-client. Users can install additional tools locally (nvm, pip --user, Deno, Bun).

## Docker

- Image: `ghcr.io/faktenforum/mcp-linux`
- Port: `3015`
- Volumes: `mcp_linux_homes` (user data), `mcp_linux_data` (mapping)
- Resource limits: 2 CPU, 2G RAM
