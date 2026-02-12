/**
 * MCP Prompt: Git Workflow
 *
 * Terminal command examples for common git workflows.
 */

export const GIT_WORKFLOW_PROMPT = {
  name: 'git_workflow',
  description: 'Examples of terminal commands for common git workflows (commit, push, pull, branch, merge, diff)',
  content: `# Git Workflow via Terminal

Git is pre-installed. SSH access to GitHub is configured via a shared machine user key.
Each workspace is a git repository. The default branch is \`main\`.

## Shared workspace
All dev agents use the same Linux workspace per user. When handing off to another agent, your changes are already there — no need to copy or re-push files.

## Basic Workflow
\`\`\`bash
# Check status
git status

# Stage only relevant repo files (do not stage helper scripts or temp files)
git add path/to/relevant/file1.ts path/to/file2.ts

# Or stage all changes only if no helper/temp files are present
git add .

# Commit
git commit -m "descriptive message"

# Push (only committed, relevant files)
git push origin main

# Pull latest
git pull origin main
\`\`\`

## Branching
\`\`\`bash
# Create and switch to new branch
git checkout -b feature/my-feature

# Switch branches
git checkout main

# List branches
git branch -a

# Delete branch
git branch -d feature/old-branch
\`\`\`

## Viewing Changes
\`\`\`bash
# View unstaged changes
git diff

# View staged changes
git diff --cached

# View commit log
git log --oneline -20

# View specific file history
git log --oneline -10 -- path/to/file

# View changes in a commit
git show <commit-hash>
\`\`\`

## Merging & Rebasing
\`\`\`bash
# Merge branch into current
git merge feature/my-feature

# Rebase onto main
git rebase main

# Resolve conflicts then continue
git add .
git rebase --continue
\`\`\`

## Remote Operations
\`\`\`bash
# Add remote
git remote add origin git@github.com:org/repo.git

# View remotes
git remote -v

# Fetch from remote
git fetch origin

# Push new branch
git push -u origin feature/my-feature
\`\`\`

## Stashing
\`\`\`bash
# Stash changes
git stash

# Apply stash
git stash pop

# List stashes
git stash list
\`\`\`

## Before commit/push
- Only stage and push files that **belong in the repo** and are relevant to the task.
- Do **not** push helper scripts, temp files (e.g. fix.path), or one-off artifacts unless they are part of the project.
- Remove or unstage such files before committing; clean them up if no longer needed: \`git restore --staged <file>\`, \`rm <file>\`, then commit and push.
`,
};
