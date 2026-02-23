/**
 * MCP Prompt: Runtime Management
 *
 * Terminal command examples for managing programming language runtimes.
 */

export const RUNTIME_MANAGEMENT_PROMPT = {
  name: 'runtime_management',
  description: 'Reference: install and manage runtimes beyond pre-installed Node.js, Python 3, and Git (nvm, uv, Deno, Bun, Rust)',
  content: `# Runtime Management (reference)

Use for runtimes beyond pre-installed Node.js, Python 3, Git; install tools in user home only (no sudo).

## Node.js (pre-installed)
\`\`\`bash
node --version && npm --version
node script.js
npm init -y && npm install package-name
\`\`\`

## NVM (Node Version Manager)
\`\`\`bash
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.0/install.sh | bash
source ~/.bashrc
nvm install 22 && nvm use 22
\`\`\`

## Python 3 & uv (pre-installed) — RECOMMENDED
Use uv for Python (no sudo). Never use \`sudo pip\` or \`pip install --user\`.
\`\`\`bash
python3 --version && uv --version
uv run script.py
uv init myproject && cd myproject && uv add pandas matplotlib
uv tool install black ruff && uv tool run black script.py
uv pip install -r requirements.txt
\`\`\`
Legacy venv (if uv unavailable): \`python3 -m venv .venv && source .venv/bin/activate && pip install -r requirements.txt\`

## Other runtimes (install in user home)
- **Deno:** \`curl -fsSL https://deno.land/install.sh | sh\` then \`deno run script.ts\`
- **Bun:** \`curl -fsSL https://bun.sh/install | bash\` then \`bun run script.ts\`
- **Rust:** \`curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y\` then \`source ~/.cargo/env\`, \`cargo build\`, \`cargo run\`

## Shell scripts
\`\`\`bash
chmod +x script.sh && ./script.sh
\`\`\`
`,
};
