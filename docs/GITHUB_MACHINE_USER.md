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
| Private SSH key (base64) | `MCP_LINUX_GIT_SSH_KEY` | mcp-linux (written to `~/.ssh/` per user) |
| Git default name | `MCP_LINUX_GIT_USER_NAME` | mcp-linux (`git config user.name` for new/init repos) |
| Git default email | `MCP_LINUX_GIT_USER_EMAIL` | mcp-linux (`git config user.email` for new/init repos) |
| PAT | `MCP_GITHUB_PAT` | LibreChat API (GitHub MCP headers) |

Set in `.env.local` / `.env.prod` / `.env.dev`. Never commit secrets; see [environment-variables](../.cursor/rules/environment-variables.mdc). Rotate PAT/key if compromised; restart mcp-linux or API as needed.

**MCP_LINUX_GIT_SSH_KEY:** Must be the **full** base64 string (e.g. `base64 -w0` = one line). If the value in .env is truncated at the first newline, the written key will be invalid (`error in libcrypto`). Use a single line or quote the value; after changing the key, restart mcp-linux and run `reset_account` (Linux MCP) so the key is rewritten for existing users.

## Key & PAT Rotation

When the SSH key or PAT is compromised (or as routine rotation), follow this procedure. **Order matters** — adding the new key before removing the old one prevents lockout.

### SSH Key Rotation

```bash
# 1. Generate a new key and get the base64 value + public key
./scripts/rotate-github-machine-user-key.sh [comment-email]
```

The script prints:
- **Public key** → add to GitHub (Settings → SSH and GPG keys) **before** removing the old one
- **Base64 private key** → paste into `MCP_LINUX_GIT_SSH_KEY` in `.env.prod` / `.env.dev` / `.env.local`

After updating the env var:

1. **Restart** the mcp-linux container so the new `GIT_SSH_KEY` is picked up:
   ```bash
   docker compose -f docker-compose.prod.yml restart mcp-linux
   ```
2. **Run `reset_account`** (via the Linux MCP `reset_account` tool) so the new key is written to `~/.ssh/` for all existing users. Without this, existing users keep the old (compromised) key until their home is recreated.
3. **Verify** SSH auth works:
   ```bash
   ssh -T git@github.com   # should say "Hi <machine-user>!"
   ```
4. **Remove the old key** from GitHub (Settings → SSH and GPG keys → Delete).

### PAT Rotation

1. Create a new PAT on the machine-user account (Settings → Developer settings → Personal access tokens). Use the same scopes as documented above.
2. Update `MCP_GITHUB_PAT` in `.env.prod` / `.env.dev` / `.env.local`.
3. Restart the mcp-linux container so the new PAT is written to `~/.config/gh/hosts.yml`:
   ```bash
   docker compose -f docker-compose.prod.yml restart mcp-linux
   ```
4. Run `reset_account` (Linux MCP) so existing users get the new PAT.
5. Verify:
   ```bash
   gh api user --jq .login   # should print the machine-user login
   ```
6. Revoke the old PAT on GitHub.

### After rotation: verify both

```bash
ssh -T git@github.com          # SSH key
gh api user --jq .login        # PAT
git -C ~/workspaces/default pull --ff-only   # full clone/push/pull round-trip
```

## References

- [MCP Linux](MCP_LINUX.md) — Git Access
- [Developer Agents](DEVELOPER_AGENTS.md) — GitHub Assistant, write tools
