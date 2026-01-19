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
    cp /app/config/roles.json /app/data/roles.json && \
    cp /app/config/librechat.yaml /app/data/librechat.yaml

# Install production dependencies
RUN npm install --production --silent

# Run with TypeScript support (like setup-env.ts)
CMD ["node", "--experimental-strip-types", "--no-warnings", "src/init.ts"]
