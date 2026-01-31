FROM node:24-alpine

RUN addgroup -g 1001 -S appgroup && \
    adduser -S -u 1001 -G appgroup appuser

WORKDIR /app

COPY package.json ./
COPY tsconfig.json ./
COPY src ./src

RUN npm install --production --silent && \
    npm cache clean --force

RUN chown -R appuser:appgroup /app

USER appuser

EXPOSE 3010

HEALTHCHECK --interval=30s --timeout=10s --start-period=10s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3010/health', (r) => { process.exit(r.statusCode === 200 ? 0 : 1) })"

CMD ["node", "--experimental-specifier-resolution=node", "--experimental-strip-types", "--experimental-transform-types", "--no-warnings", "src/server.ts"]
