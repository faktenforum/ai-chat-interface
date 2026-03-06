/**
 * MCP Prompt: Search Files
 *
 * Terminal command examples for searching files and content.
 */

export const SEARCH_FILES_PROMPT = {
  name: 'search_files',
  description: 'Examples of terminal commands for searching files and content (ripgrep, grep, find)',
  content: `# Search via Terminal

Use ripgrep (rg) for most content searches; fall back to grep/find only when needed.

## Search File Content (ripgrep - recommended)
\`\`\`bash
# Basic search
rg "search pattern"

# Case-insensitive
rg -i "pattern"

# Show context lines (before/after)
rg -C 3 "pattern"

# Search specific file types
rg -t js "pattern"
rg -t py "pattern"
rg --type-add 'tsx:*.tsx' -t tsx "pattern"

# Search with glob
rg "pattern" -g "*.ts"

# Regex search
rg "function\\s+\\w+"

# Count matches
rg -c "pattern"

# List matching files only
rg -l "pattern"
\`\`\`

Alternative: \`grep -rni "pattern" .\` (prefer rg when possible).

## Find Files by Name
\`\`\`bash
# Find by name
find . -name "*.ts"

# Find by name (case-insensitive)
find . -iname "*.tsx"

# Find recently modified (last 24h)
find . -mtime -1

# Find by size (larger than 1MB)
find . -size +1M

# Find and exclude directories
find . -not -path "*/node_modules/*" -name "*.ts"
\`\`\`

## File Content Overview
\`\`\`bash
# Count lines in files
wc -l src/**/*.ts

# Show file type
file filename

# Show disk usage
du -sh *
\`\`\`
`,
};
