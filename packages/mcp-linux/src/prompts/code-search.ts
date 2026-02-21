/**
 * MCP Prompt: Code Search
 *
 * When to use codebase_search for semantic code exploration.
 */

export const CODE_SEARCH_PROMPT = {
  name: 'code_search',
  description: 'When and how to use codebase_search for semantic code exploration',
  content: `# Code Search (codebase_search)

Use **codebase_search** to find code by meaning, not just keywords. It uses semantic search over the workspace index.

## When to use

- **Before** reading specific files when you do not know where something is implemented
- Exploring unfamiliar codebases or new workspaces
- Finding "where is X done?", "how does Y work?", "where do we handle Z?"

## Usage

- **query**: Natural language in English (e.g. "user authentication and password hashing", "database connection setup")
- **path** (optional): Limit to a subdirectory (e.g. \`src\`, \`src/auth\`)
- **workspace**: Workspace name (default: "default")

## Tips

- Phrase queries as questions or short descriptions; reuse the user's wording when it fits
- After codebase_search, use read_workspace_file with the returned file paths to read full content
- If the workspace has no index yet, the first codebase_search will index it (may take a moment)
`,
};
