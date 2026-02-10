FROM ubuntu:24.04

ENV DEBIAN_FRONTEND=noninteractive

# System packages: user management, shells, dev tools, runtimes, plotting (matplotlib headless)
RUN apt-get update && apt-get install -y --no-install-recommends \
    bash \
    curl \
    wget \
    git \
    ca-certificates \
    gnupg \
    sudo \
    openssh-client \
    python3 \
    python3-pip \
    python3-venv \
    build-essential \
    ripgrep \
    tree \
    jq \
    less \
    vim-tiny \
    fontconfig \
    fonts-dejavu-core \
    && rm -rf /var/lib/apt/lists/*

# Install Node.js 24 via NodeSource
RUN curl -fsSL https://deb.nodesource.com/setup_24.x | bash - \
    && apt-get install -y nodejs \
    && rm -rf /var/lib/apt/lists/*

# Create app directory
WORKDIR /app

# Copy package files and install dependencies
COPY package.json ./
RUN npm install --production --silent && npm cache clean --force

# Copy TypeScript config and source files
COPY tsconfig.json ./
COPY src ./src
COPY assets ./assets
COPY views ./views
COPY public ./public

# Create persistent data directories
RUN mkdir -p /app/data /run/mcp-workers

# Expose port
EXPOSE 3015

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3015/health', (r) => { process.exit(r.statusCode === 200 ? 0 : 1) }).on('error', () => process.exit(1))"

# Run as root (required for useradd/runuser to manage per-user Linux accounts)
# All user code runs as unprivileged per-user Linux accounts via runuser
CMD ["node", "--experimental-specifier-resolution=node", "--experimental-strip-types", "--experimental-transform-types", "--no-warnings", "src/server.ts"]
