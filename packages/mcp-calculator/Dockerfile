FROM node:24-alpine

# Create non-root user for security
RUN addgroup -g 1001 -S appgroup && \
    adduser -S -u 1001 -G appgroup appuser

WORKDIR /app

# Copy package files
COPY package.json ./

# Copy TypeScript config
COPY tsconfig.json ./

# Copy source files
COPY src ./src

# Install only production dependencies
RUN npm install --production --silent && \
    npm cache clean --force

# Change ownership to non-root user
RUN chown -R appuser:appgroup /app

# Switch to non-root user
USER appuser

# Expose port
EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=10s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3000/health', (r) => { process.exit(r.statusCode === 200 ? 0 : 1) })"

# Run with TypeScript support (like librechat-init)
CMD ["node", "--experimental-specifier-resolution=node", "--experimental-strip-types", "--experimental-transform-types", "--no-warnings", "src/server.ts"]
