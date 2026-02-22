/**
 * MCP Prompt: Code Search
 *
 * When to use codebase_search for semantic code exploration.
 */

export const CODE_SEARCH_PROMPT = {
  name: 'code_search',
  description: 'When and how to use codebase_search for semantic code exploration',
  content: `# Code Search (codebase_search)

As per server instructions: use codebase_search FIRST when exploring unfamiliar code (MUST use before any other search or file exploration in that area). Below: examples and tips only.

## Example parameters

- **query**: Natural language in English (e.g. "user authentication and password hashing", "database connection setup")
- **path** (optional): Limit to a subdirectory (e.g. \`src\`, \`src/auth\`)
- **workspace**: Workspace name (default: "default")

## Example scenarios

- Finding "where is X done?", "how does Y work?", "where do we handle Z?" → codebase_search then read_workspace_file with returned paths
- New workspace or unfamiliar codebase → codebase_search first

## Tips

- Phrase queries as questions or short descriptions; reuse the user's wording when it fits
- If the workspace has no index yet, the first codebase_search will index it (may take a moment)
`,
};
