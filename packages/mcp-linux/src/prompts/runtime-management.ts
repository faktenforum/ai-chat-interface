/**
 * MCP Prompt: Runtime Management
 *
 * Terminal command examples for managing programming language runtimes.
 */

export const RUNTIME_MANAGEMENT_PROMPT = {
  name: 'runtime_management',
  description: 'How to install and manage programming language runtimes (nvm, pip, Node.js, Python, Deno, Bun)',
  content: `# Runtime Management

The system comes with Node.js, Python 3, and Git pre-installed.
Users can install additional tools in their home directory.

## Node.js (pre-installed)
\`\`\`bash
# Check version
node --version
npm --version

# Run scripts
node script.js
node --experimental-strip-types script.ts

# Install packages
npm init -y
npm install package-name
\`\`\`

## NVM (Node Version Manager)
\`\`\`bash
# Install nvm
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.0/install.sh | bash
source ~/.bashrc

# Install specific Node version
nvm install 22
nvm install 24
nvm use 22
\`\`\`

## Python 3 (pre-installed)
\`\`\`bash
# Check version
python3 --version

# Create virtual environment
python3 -m venv .venv
source .venv/bin/activate

# Install packages
pip install package-name

# Install to user directory (no venv)
pip install --user package-name

# Run scripts
python3 script.py
\`\`\`

## Deno
\`\`\`bash
# Install Deno
curl -fsSL https://deno.land/install.sh | sh
source ~/.bashrc

# Run scripts
deno run script.ts
deno run --allow-all script.ts
\`\`\`

## Bun
\`\`\`bash
# Install Bun
curl -fsSL https://bun.sh/install | bash
source ~/.bashrc

# Run scripts
bun run script.ts
bun install
\`\`\`

## Shell Scripts
\`\`\`bash
# Create and run shell script
cat > script.sh << 'EOF'
#!/bin/bash
echo "Hello from bash"
EOF
chmod +x script.sh
./script.sh
\`\`\`
`,
};
