# GitHub Machine User

One GitHub account for (1) Git in MCP Linux (SSH key in each user's `~/.ssh/`) and (2) GitHub MCP API (PAT). Same identity for clone/push and for create issue/PR/review.

## Create the account

1. **Account** — Normal sign-up (e.g. `faktenforum-mcp-bot`). Add to org as Member or to repos as Collaborator.
2. **SSH key (ed25519)** — Generate; add public key to account (Settings → SSH and GPG keys).
   ```bash
   ssh-keygen -t ed25519 -C "bot@example.com" -f ~/.ssh/github_machine_user -N ""
   base64 -w0 ~/.ssh/github_machine_user   # single line → MCP_LINUX_GIT_SSH_KEY (no newlines in .env)
   ```
3. **PAT** — Same account: Settings → Developer settings → Personal access tokens. Use **fine-grained**; repository access = All repositories (or select org/repos). Permissions:

| Permission | Access | Used for |
|------------|--------|----------|
| **Metadata** | Read-only | Required. Search repos, list branches/tags/commits, get_file_contents, get_commit. |
| **Contents** | Read and write | create_or_update_file, delete_file, push_files, create_branch. |
| **Issues** | Read and write | create_issue, issue_read, issue_write, add_issue_comment, list_issues. |
| **Pull requests** | Read and write | create/read/update/merge PR, create_review, review comments. |

Optional (if shown in PAT UI): **Releases** Read-only (list_releases, get_latest_release, get_release_by_tag); **Discussions** Read and write (only for repo Discussions). Without Releases, release-read tools may fail; core workflows need only the four above.

**Classic PAT:** Scopes `repo`, `read:org`. Optional: `read:user` (search_users, get_me), `user:email` (resolve email), `write:discussion`, `read:project`. Token prefix: classic `ghp_`, fine-grained `github_pat_`.

## Integrate in the stack

| Credential | Env var | Used by |
|------------|---------|---------|
| Private SSH key (base64) | `MCP_LINUX_GIT_SSH_KEY` | mcp-linux (passed to the container as `GIT_SSH_KEY`, written to `~/.ssh/id_ed25519` per user) |
| Git default name | `MCP_LINUX_GIT_USER_NAME` | mcp-linux (`git config user.name` for new/init repos) |
| Git default email | `MCP_LINUX_GIT_USER_EMAIL` | mcp-linux (`git config user.email` for new/init repos) |
| PAT | `MCP_GITHUB_PAT` | LibreChat API (GitHub MCP headers) **and** mcp-linux (`gh` in every workspace, `~/.config/gh/hosts.yml`) |

Set in `.env.local` / `.env.prod` / `.env.dev`. Never commit secrets; see [environment-variables](../.cursor/rules/environment-variables.mdc). Rotate PAT/key if compromised; restart mcp-linux or API as needed.

**MCP_LINUX_GIT_SSH_KEY:** Must be the **full** base64 string (e.g. `base64 -w0` = one line). If the value in .env is truncated at the first newline, the written key will be invalid (`error in libcrypto`). Use a single line or quote the value. A restart is enough to roll a new key out: mcp-linux rewrites `~/.ssh/` for every existing user on start. `reset_account` is not needed - it wipes the whole home, workspaces included.

**MCP_GITHUB_PAT:** The shared token is written per user on their first request after a restart, not at startup, so that a user with their own `GITHUB_PAT` keeps it. Rotating it therefore takes effect for each user on their next message, without a `reset_account`.

**Host keys:** git in the workspace verifies github.com against the keys shipped in `packages/mcp-linux/src/utils/github-known-hosts.ts` (`StrictHostKeyChecking yes`, own `~/.ssh/known_hosts_github`). When GitHub rotates a host key, update that file - clones fail with `Host key verification failed` until it matches.

## References

- [MCP Linux](MCP_LINUX.md) — Git Access
- [Developer Agents](DEVELOPER_AGENTS.md) — GitHub Assistant, write tools
