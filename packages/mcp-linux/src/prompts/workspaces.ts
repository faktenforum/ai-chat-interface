/**
 * MCP Prompt: Workspaces
 *
 * How workspaces work: concept, plan and tasks for handoffs, setup, and git workflow.
 * Replaces the former workspace_setup and git_workflow prompts.
 */

export const WORKSPACES_PROMPT = {
  name: 'workspaces',
  description: 'How workspaces work: plan and tasks for handoffs, setup, and git workflow',
  content: `# Workspaces

Each user has persistent **workspaces** under \`~/workspaces/\`. Each workspace is a git repository. Use the workspace tools to list, create, delete, and inspect them. **One workspace = one task context**; when multiple agents work on the same task, they share the same workspace (via handoff). All paths in terminal and file tools are relative to the workspace root.

## Plan and tasks (handoffs)

Workspaces can store a **plan** (goal/context) and **tasks** (concrete steps) so the next agent can continue the work.

- **Read:** \`get_workspace_status\` returns \`plan\` and \`tasks\` in addition to git status. When you **start** work or **receive a handoff**, call \`get_workspace_status\` for that workspace and follow the plan and tasks.
- **Write:** Use \`set_workspace_plan\` to set or update \`plan\` (string) and/or \`tasks\` (array of \`{ title, done }\`). When **handing off** to another agent, update plan and tasks so the next agent has current context; always pass the workspace name in the handoff instructions.

## Creating a workspace

Use the \`create_workspace\` tool:
- Empty repo: create_workspace(name: "my-project")
- Clone: create_workspace(name: "my-project", git_url: "git@github.com:org/repo.git")

## Project setup (terminal)

**Node.js:** \`npm install\`, \`npm run dev\`, \`npm test\`, \`npm run build\`
**Python:** \`python3 -m venv .venv\`, \`source .venv/bin/activate\`, \`pip install -r requirements.txt\`, \`python3 -m pytest\`
**General:** \`tree -L 2 -I node_modules\`, \`cat README.md\`, \`cat package.json | jq '.scripts'\`, \`du -sh *\`

List workspaces with \`list_workspaces\`; pass the \`workspace\` parameter to terminal and file tools; check status with \`get_workspace_status\`.

## Git workflow (terminal)

Git is pre-installed. SSH access to GitHub is configured via a shared machine user key. Default branch is \`main\`. **Shared workspace:** When handing off to another agent, your changes are already in the workspace — no need to copy or re-push files.

**Basic:** \`git status\`, \`git add path/to/file\`, \`git commit -m "message"\`, \`git push origin main\`, \`git pull origin main\`
**Branching:** \`git checkout -b feature/my-feature\`, \`git checkout main\`, \`git branch -a\`
**Viewing:** \`git diff\`, \`git diff --cached\`, \`git log --oneline -20\`, \`git show <hash>\`
**Merge/Rebase:** \`git merge feature/my-feature\`, \`git rebase main\`, \`git add . && git rebase --continue\`
**Remotes:** \`git remote add origin git@github.com:org/repo.git\`, \`git remote -v\`, \`git fetch origin\`, \`git push -u origin feature/my-feature\`
**Stashing:** \`git stash\`, \`git stash pop\`, \`git stash list\`

**Before commit/push:** Only stage and push files that **belong in the repo**. Do **not** push helper scripts, temp files, or one-off artifacts. Remove or unstage them: \`git restore --staged <file>\`, \`rm <file>\`, then commit and push.
`,
};
