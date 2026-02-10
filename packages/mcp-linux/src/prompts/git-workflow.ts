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

## Basic Workflow
\`\`\`bash
# Check status
git status

# Stage all changes
git add .

# Stage specific files
git add file1.ts file2.ts

# Commit
git commit -m "descriptive message"

# Push
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
`,
};
