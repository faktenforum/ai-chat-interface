# Overlay our built @librechat/agents onto the LibreChat base image.
# The base image must be built and loaded as librechat:base in a prior step.
FROM librechat:base

COPY dev/agents/dist /app/node_modules/@librechat/agents/dist
COPY dev/agents/package.json /app/node_modules/@librechat/agents/package.json
