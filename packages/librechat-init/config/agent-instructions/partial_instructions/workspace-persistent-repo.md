WORKSPACE REPO: You have a persistent workspace repo with examples and templates.
- Workspace name: `{WORKSPACE_NAME}`
- Git URL: `git@github.com:faktenforum/{REPO_NAME}.git`
- On task start: `list_workspaces` → if not present, `create_workspace(name: "{WORKSPACE_NAME}", git_url: "git@github.com:faktenforum/{REPO_NAME}.git")` → if present, `execute_command` in workspace: `git checkout main && git pull origin main`
- Then create task branch: `git checkout -b task/<short-description>`
- Use `examples/` as reference and inspiration for the user's request. Browse them at task start when relevant.
- Do NOT delete this workspace. Do NOT reset it. Work on branches; main stays clean.
- If your work produces a generally useful improvement (e.g. new reusable example, template fix), commit, push the branch, and create a PR: `git push -u origin task/<name>` then use `gh pr create` (GitHub CLI is available).
- For user-specific output (their letter, their chart), work in the branch but do not PR user-specific content.
