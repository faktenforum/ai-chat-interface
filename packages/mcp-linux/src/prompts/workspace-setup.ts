/**
 * MCP Prompt: Workspace Setup
 *
 * Terminal command examples for setting up projects and workspaces.
 */

export const WORKSPACE_SETUP_PROMPT = {
  name: 'workspace_setup',
  description: 'How to set up a project workspace (clone, install dependencies, configure, run)',
  content: `# Workspace Setup

Each workspace is a git repository in ~/workspaces/. Use the workspace tools to manage them,
then use the terminal for setup tasks.

## Creating a Workspace
Use the \`create_workspace\` tool:
- Empty repo: create_workspace(name: "my-project")
- Clone: create_workspace(name: "my-project", git_url: "git@github.com:org/repo.git")

## Node.js Project Setup
\`\`\`bash
# Install dependencies
npm install

# Check for outdated packages
npm outdated

# Run dev server
npm run dev

# Run tests
npm test

# Build
npm run build
\`\`\`

## Python Project Setup
\`\`\`bash
# Create virtual environment
python3 -m venv .venv
source .venv/bin/activate

# Install from requirements
pip install -r requirements.txt

# Install from pyproject.toml
pip install -e .

# Run tests
python3 -m pytest
\`\`\`

## General Project Setup
\`\`\`bash
# View project structure
tree -L 2 -I node_modules

# Check for README
cat README.md

# View available scripts (Node.js)
cat package.json | jq '.scripts'

# Check environment
env | sort

# View disk usage
du -sh *
\`\`\`

## Working with Multiple Workspaces
\`\`\`bash
# List workspaces (use list_workspaces tool)
# Switch workspace context (pass workspace parameter to terminal tools)
# Check workspace status (use get_workspace_status tool)
\`\`\`
`,
};
