FROM node:24

WORKDIR /app

# Copy package files
COPY package.json package-lock.json* ./
COPY tsconfig.json ./
COPY config/ ./config/
COPY src/ ./src/
COPY assets/ ./assets/

# Copy config files to locations that won't be overwritten by volumes
# The librechat-config volume mounts to /app/config, so we need to preserve source files
RUN mkdir -p /app/data && \
    cp /app/config/roles.yaml /app/data/roles.yaml && \
    cp /app/config/librechat.yaml /app/data/librechat.yaml && \
    (cp /app/config/librechat.local.yaml /app/data/librechat.local.yaml 2>/dev/null || true) && \
    (cp /app/config/librechat.dev.yaml /app/data/librechat.dev.yaml 2>/dev/null || true) && \
    (cp /app/config/librechat.prod.yaml /app/data/librechat.prod.yaml 2>/dev/null || true) && \
    (cp /app/config/agents.yaml /app/data/agents.yaml 2>/dev/null || echo "agents.yaml not found, skipping") && \
    (cp /app/config/agents.private.yaml /app/data/agents.private.yaml 2>/dev/null || echo "agents.private.yaml not found, skipping") && \
    (cp /app/config/prompts.yaml /app/data/prompts.yaml 2>/dev/null || echo "prompts.yaml not found, skipping") && \
    (cp /app/config/prompts.private.yaml /app/data/prompts.private.yaml 2>/dev/null || echo "prompts.private.yaml not found, skipping")

# Install production dependencies
RUN npm install --production --silent

# Run with TypeScript support (like setup-env.ts)
CMD ["node", "--experimental-strip-types", "--no-warnings", "src/init.ts"]
