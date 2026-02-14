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

**Recommended flow:** After a handoff → \`get_workspace_status(workspace)\` (workspace from handoff instructions; use \`default\` if none given). Need a workspace? → \`list_workspaces\` first. Before creating one → \`list_workspaces\` to avoid "already exists". When handing off → \`set_workspace_plan\` then handoff with workspace name in instructions.

Workspaces can store a **plan** (goal/context) and **tasks** (concrete steps) so the next agent can continue the work.

- **Read:** \`get_workspace_status\` returns \`plan\` and \`tasks\` plus git status. Each task has \`title\` and \`status\`. **Status:** pending (not started), in_progress (you are working on it), done (finished), cancelled (skipped or abandoned). When you **start** or **receive a handoff**, call \`get_workspace_status\` for that workspace and follow the plan and tasks. If there is no or empty plan/tasks after a handoff, set an initial plan and tasks with \`set_workspace_plan\` from the handoff instructions, then proceed. **Note:** File lists in status may be summarized/capped (\`staged_count\`, \`truncated\`); use \`read_workspace_file\` with explicit paths (e.g. from \`list_upload_sessions\`) for specific files. Uploads in \`uploads/\` are temporary and may be purged; move or download important outputs.
- **Write:** \`set_workspace_plan\` sets \`plan\` and/or \`tasks\` (you can update only plan, only tasks, or both). **Tasks:** Prefer an array of strings, e.g. \`["Step 1", "Step 2"]\` — each becomes a task with status pending. Or \`[{ title, status? }]\` for per-task status. When **handing off**, call \`set_workspace_plan\` first: mark completed tasks \`done\`, the next task \`in_progress\` or \`pending\`, optionally update the plan summary (what's done, what's next); then hand off with the workspace name in the handoff instructions.

## Creating a workspace

**Call \`list_workspaces\` first** to avoid creating a workspace that already exists. Then use \`create_workspace\`:
- Empty repo: create_workspace(name: "my-project")
- Clone: create_workspace(name: "my-project", git_url: "git@github.com:org/repo.git")

## Project setup (terminal)

**Node.js:** \`npm install\`, \`npm run dev\`, \`npm test\`, \`npm run build\`
**Python:** \`python3 -m venv .venv\`, \`source .venv/bin/activate\`, \`pip install -r requirements.txt\`, \`python3 -m pytest\`
**General:** \`tree -L 2 -I node_modules\`, \`cat README.md\`, \`cat package.json | jq '.scripts'\`, \`du -sh *\`

\`list_workspaces\` first when you need an overview or before creating a workspace (branch, dirty, remote_url, plan_preview). Use \`workspace\` in terminal/file tools; \`get_workspace_status(workspace)\` for full plan and tasks. If no workspace is specified, use \`default\`.

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
