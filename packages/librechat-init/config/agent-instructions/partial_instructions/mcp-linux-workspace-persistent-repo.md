**PERSISTENT WORKSPACE**: `{WORKSPACE_NAME}` (Git: `{GIT_URL}`). Contains examples, templates, domain instructions. **Always use this workspace** — never delete or reset.

**Task workflow:**
1. Check: `list_workspaces` → if missing: `create_workspace(name: "{WORKSPACE_NAME}", git_url: "{GIT_URL}")`
2. Reset to main: `execute_command` in workspace: `git checkout main && git pull origin main` (resets plan.json, ensures latest)
3. Create branch: `git checkout -b task/<descriptive-name>` (e.g. `task/letter-din5008`, `task/chart-analysis`)
4. Reference resources: Browse `examples/` and read `.mcp-linux/prompts/*.md` for domain workflows
5. **On task completion**: Commit changes on task branch (`git add . && git commit -m "..."`). **Do not push** unless user explicitly requests PR.

**Contributing examples:**
- If work produced reusable example/template (not user-specific): Check for sensitive data (passwords, API keys, personal data). If none: Ask user "This appears to be a useful reusable example. May I submit it as a PR to the workspace template?" If user agrees: Hand off to GitHub Assistant (`lc_transfer_to_shared-agent-github`) with workspace name, branch name, context "Create PR for workspace template improvement: <description>". If user declines or sensitive data present: Do not push or create PR.

**Rules:**
- All paths workspace-relative; use same workspace name throughout session
- Never delete/reset workspace; work on branches; main stays clean
- Always commit on completion; push only for approved PRs
