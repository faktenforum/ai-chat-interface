/**
 * MCP Prompt: Workspaces
 *
 * How workspaces work: concept, setup, and git workflow.
 * Replaces the former workspace_setup and git_workflow prompts.
 */

export const WORKSPACES_PROMPT = {
  name: 'workspaces',
  description: 'How workspaces work: setup and git workflow',
  content: `# Workspaces

As per server instructions: list_workspaces first when choosing/creating; get_workspaces(workspace) for git status and workspace-root AGENTS.md. Workspaces live under \`~/workspaces/\`; one workspace = one task context. Paths in terminal and file tools are relative to the workspace root.

## Creating a workspace (examples)

list_workspaces first, then create_workspace:
- Empty repo: \`create_workspace(name: "my-project")\`
- Clone: \`create_workspace(name: "my-project", git_url: "git@github.com:org/repo.git")\` — submodules checked out recursively

## Project setup (terminal)

**Node.js:** \`npm install\`, \`npm run dev\`, \`npm test\`, \`npm run build\`
**Python:** \`python3 -m venv .venv\`, \`source .venv/bin/activate\`, \`pip install -r requirements.txt\`, \`python3 -m pytest\`
**General:** \`tree -L 2 -I node_modules\`, \`cat README.md\`, \`cat package.json | jq '.scripts'\`, \`du -sh *\`

## Git workflow (terminal)

Git is pre-installed. SSH access to GitHub is configured via a shared machine user key. **Use SSH URLs only** for GitHub: remotes must be \`git@github.com:org/repo.git\`. Do not set origin (or any remote) to HTTPS with token or password; push/pull use the configured SSH key. If the remote is HTTPS, fix it: \`git remote set-url origin git@github.com:org/repo.git\`. Default branch is \`main\`. **Shared workspace:** When handing off to another agent, your changes are already in the workspace — no need to copy or re-push files.

**Basic:** \`git status\`, \`git add path/to/file\`, \`git commit -m "message"\`, \`git push origin main\`, \`git pull origin main\`
**Branching:** \`git checkout -b feature/my-feature\`, \`git checkout main\`, \`git branch -a\`
**Viewing:** \`git diff\`, \`git diff --cached\`, \`git log --oneline -20\`, \`git show <hash>\`
**Merge/Rebase:** \`git merge feature/my-feature\`, \`git rebase main\`, \`git add . && git rebase --continue\`
**Remotes:** \`git remote add origin git@github.com:org/repo.git\`, \`git remote -v\`, \`git fetch origin\`, \`git push -u origin feature/my-feature\`
**Stashing:** \`git stash\`, \`git stash pop\`, \`git stash list\`

**Before commit/push:** Only stage and push files that **belong in the repo**. Do **not** push helper scripts, temp files, or one-off artifacts. Remove or unstage them: \`git restore --staged <file>\`, \`rm <file>\`, then commit and push.
`,
};
