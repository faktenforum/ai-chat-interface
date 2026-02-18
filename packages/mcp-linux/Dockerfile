FROM ubuntu:24.04

ENV DEBIAN_FRONTEND=noninteractive

# System packages: user management, shells, dev tools, runtimes
RUN apt-get update && apt-get install -y --no-install-recommends \
    bash \
    curl \
    wget \
    git \
    git-lfs \
    ca-certificates \
    gnupg \
    sudo \
    openssh-client \
    python3 \
    python3-pip \
    python3-venv \
    build-essential \
    cmake \
    meson \
    ninja-build \
    autoconf \
    automake \
    libtool \
    gdb \
    valgrind \
    strace \
    ripgrep \
    tree \
    jq \
    less \
    vim-tiny \
    nano \
    fontconfig \
    fonts-dejavu-core \
    fonts-dejavu \
    fonts-dejavu-extra \
    && rm -rf /var/lib/apt/lists/*

# Python development libraries (headers/libs for common Python packages)
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3-dev \
    libpython3-dev \
    pkg-config \
    libxml2-dev \
    libxslt1-dev \
    libssl-dev \
    libffi-dev \
    libcairo2-dev \
    libpango1.0-dev \
    libgdk-pixbuf2.0-dev \
    libgirepository1.0-dev \
    libjpeg-dev \
    libpng-dev \
    libtiff-dev \
    libwebp-dev \
    libfreetype6-dev \
    liblcms2-dev \
    libopenblas-dev \
    liblapack-dev \
    zlib1g-dev \
    libbz2-dev \
    libreadline-dev \
    libsqlite3-dev \
    && rm -rf /var/lib/apt/lists/*

# Media conversion and document tools (headless, no LibreOffice/texlive)
RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg \
    imagemagick \
    pandoc \
    && rm -rf /var/lib/apt/lists/*

# Database client libraries & CLI tools (for Python/Node.js)
RUN apt-get update && apt-get install -y --no-install-recommends \
    postgresql-client \
    libpq-dev \
    default-mysql-client \
    default-libmysqlclient-dev \
    sqlite3 \
    libsqlite3-dev \
    redis-tools \
    && rm -rf /var/lib/apt/lists/*

# Install uv globally (modern Python package/tool manager)
RUN curl -LsSf https://astral.sh/uv/install.sh | sh -s -- --prefix /usr/local

# ImageMagick: allow PDF read/write (disabled by default security policy)
RUN if [ -f /etc/ImageMagick-6/policy.xml ]; then \
      sed -i 's/<policy domain="coder" rights="none" pattern="PDF"/<policy domain="coder" rights="read|write" pattern="PDF"/' /etc/ImageMagick-6/policy.xml; \
    fi

# Typst: install latest release binary (lightweight PDF/document engine)
RUN TYPST_VERSION=$(curl -sL https://api.github.com/repos/typst/typst/releases/latest | jq -r .tag_name) \
    && curl -sL "https://github.com/typst/typst/releases/download/${TYPST_VERSION}/typst-x86_64-unknown-linux-musl.tar.xz" \
    | tar -xJ --strip-components=1 -C /usr/local/bin/ --wildcards '*/typst'

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
