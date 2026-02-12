# GitHub Machine User

One GitHub account for (1) Git in MCP Linux (SSH key in each user's `~/.ssh/`) and (2) GitHub MCP API (PAT). Same identity for clone/push and for create issue/PR/review.

## Create the account

1. **Account** — Normal sign-up (e.g. `faktenforum-mcp-bot`). Add to org as Member or to repos as Collaborator.
2. **SSH key (ed25519)** — Generate; add public key to account (Settings → SSH and GPG keys).
   ```bash
   ssh-keygen -t ed25519 -C "bot@example.com" -f ~/.ssh/github_machine_user -N ""
   base64 -w0 ~/.ssh/github_machine_user   # output → MCP_LINUX_GIT_SSH_KEY
   ```
3. **PAT** — Same account: Settings → Developer settings → Personal access tokens. Fine-grained: Contents, Pull requests, Issues (Read and write), Metadata (Read). Classic: `repo`, `read:org`, `write:discussion` for reviews.

## Integrate in the stack

| Credential | Env var | Used by |
|------------|---------|---------|
| Private SSH key (base64) | `MCP_LINUX_GIT_SSH_KEY` | mcp-linux (written to `~/.ssh/` per user) |
| Git default name | `MCP_LINUX_GIT_USER_NAME` | mcp-linux (`git config user.name` for new/init repos) |
| Git default email | `MCP_LINUX_GIT_USER_EMAIL` | mcp-linux (`git config user.email` for new/init repos) |
| PAT | `MCP_GITHUB_PAT` | LibreChat API (GitHub MCP headers) |

Set in `.env.local` / `.env.prod` / `.env.dev`. Never commit secrets; see [environment-variables](../.cursor/rules/environment-variables.mdc). Rotate PAT/key if compromised; restart mcp-linux or API as needed.

## References

- [MCP Linux](MCP_LINUX.md) — Git Access
- [Developer Agents](DEVELOPER_AGENTS.md) — GitHub-Assistent, write tools
