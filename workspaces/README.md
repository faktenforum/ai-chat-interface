# Agent Workspace Repositories

Persistent workspace repositories for agents that benefit from example collections and templates.

## Purpose

These repos are cloned by agents as MCP Linux workspaces. Agents work on task branches (`task/*`), keeping `main` clean. Examples and templates in each repo serve as reference and inspiration.

## Repositories

- `document-creator` - Typst templates, Pandoc examples, font samples
- `file-converter` - Bash scripts for batch conversions, cheat sheets
- `data-analysis` - Python scripts, sample CSVs, chart patterns
- `linux-expert` - Shell script collection, admin patterns

## Workflow

1. Agent checks if workspace exists (`list_workspaces`)
2. If not present: clone repo (`create_workspace` with git_url)
3. If present: checkout main and pull latest (`git checkout main && git pull`)
4. Create task branch (`git checkout -b task/<description>`)
5. Work on task, reference examples
6. For generally useful improvements: commit, push branch, create PR
7. For user-specific output: work in branch, don't PR

## Structure

Each repo contains:
- `README.md` - Purpose and structure
- `.mcp-linux/plan.json` - Empty plan (resets on main checkout)
- `.gitignore` - Temp files, caches, etc.
- `examples/` - Organized examples by category
- `scripts/` - (File Converter, Linux Expert) Reusable scripts
