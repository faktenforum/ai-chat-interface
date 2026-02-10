/**
 * MCP Prompt: File Operations
 *
 * Terminal command examples for common file operations.
 */

export const FILE_OPERATIONS_PROMPT = {
  name: 'file_operations',
  description: 'Examples of terminal commands for file operations (read, write, copy, move, delete, permissions)',
  content: `# File Operations via Terminal

All file operations are done through the terminal using standard Linux commands.
Commands execute relative to the active workspace directory.

## Reading Files
\`\`\`bash
# View entire file
cat filename.txt

# View with line numbers
cat -n filename.txt

# View first/last lines
head -20 filename.txt
tail -20 filename.txt

# View specific line range (lines 10-20)
sed -n '10,20p' filename.txt
\`\`\`

## Writing Files
\`\`\`bash
# Create/overwrite file
cat > filename.txt << 'EOF'
file content here
EOF

# Append to file
cat >> filename.txt << 'EOF'
appended content
EOF

# Write single line
echo "content" > filename.txt

# Create empty file
touch filename.txt
\`\`\`

## Listing Directories
\`\`\`bash
# List files
ls -la

# Tree view (with depth limit)
tree -L 2

# List only directories
ls -d */

# List with file sizes (human-readable)
ls -lhS
\`\`\`

## Copying, Moving, Deleting
\`\`\`bash
# Copy file
cp source.txt dest.txt

# Copy directory recursively
cp -r src/ dest/

# Move/rename
mv old.txt new.txt

# Delete file
rm filename.txt

# Delete directory
rm -rf directory/
\`\`\`

## Permissions
\`\`\`bash
# Make executable
chmod +x script.sh

# Set specific permissions
chmod 644 file.txt
chmod 755 script.sh
\`\`\`

## Creating Directories
\`\`\`bash
# Create directory (with parents)
mkdir -p path/to/directory
\`\`\`
`,
};
