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

## Python 3 & uv (pre-installed) — RECOMMENDED
**Use uv for all Python dependencies and tools (NO sudo required)**
\`\`\`bash
# Check versions
python3 --version
uv --version

# Run Python scripts
python3 script.py
uv run script.py              # with automatic dependency resolution

# Create project with dependencies
uv init myproject
cd myproject
uv add pandas matplotlib      # adds dependencies to pyproject.toml

# Install CLI tools (alternative to pipx)
uv tool install weasyprint    # HTML to PDF
uv tool install pygments      # syntax highlighting
uv tool install black ruff    # code formatters

# Run tool without installing
uv tool run weasyprint input.html output.pdf
uv tool run black script.py

# Install from requirements.txt
uv pip install -r requirements.txt

# Examples for document creation
uv tool install weasyprint
uv tool run weasyprint input.html output.pdf

# Examples for data analysis
uv add pandas matplotlib seaborn numpy
uv run analysis.py
\`\`\`

**Why uv?**
- ✅ No sudo required
- ✅ Fast (Rust-based, 10-100x faster than pip)
- ✅ Automatic virtual environments
- ✅ No PATH conflicts
- ✅ Tool isolation
- ✅ Compatible with pip/requirements.txt

**NEVER use:**
- ❌ \`sudo pip install\` (requires root)
- ❌ \`sudo apt-get install pipx\` (requires root)
- ❌ \`pip install --user\` (can cause conflicts)

**Legacy alternative (only if uv unavailable):**
\`\`\`bash
# Manual venv (not recommended, use uv instead)
python3 -m venv .venv
source .venv/bin/activate
pip install package-name
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

## Rust & Cargo
\`\`\`bash
# Install Rust via rustup (recommended, no sudo required)
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y
source ~/.cargo/env

# Check version
rustc --version
cargo --version

# Create new project
cargo new myproject
cd myproject

# Build and run
cargo build
cargo run

# Add dependencies (edit Cargo.toml)
cargo add serde tokio

# Update toolchain
rustup update

# Install additional targets
rustup target add wasm32-unknown-unknown
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
