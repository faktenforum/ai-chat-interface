#!/bin/bash

# Configuration
SOURCE_FILE="docker-compose.prod.yml"
OUTPUT_FILE="docker-compose.portainer.yml"

echo "Generating Portainer-compatible stack file..."
echo "Note: Use .env.prod for environment variables (generated via: npm run setup:prod)"

# Check if source file exists
if [ ! -f "$SOURCE_FILE" ]; then
    echo "Error: $SOURCE_FILE not found."
    exit 1
fi

# Flatten into a single file without interpolating environment variable values
docker compose -f "$SOURCE_FILE" config --no-interpolate > "$OUTPUT_FILE"

# Clean up the output:
# 1. Remove the 'include' block at the top
# 2. Remove any 'env_file' blocks (Portainer handles these via UI/Advanced mode)
# 3. Use an indentation-aware approach to remove env_file and its contents
temp_file=$(mktemp)
grep -v "^include:" "$OUTPUT_FILE" | grep -v "^  - docker-compose\." | \
sed '/env_file:/,+2d' > "$temp_file"
mv "$temp_file" "$OUTPUT_FILE"

if [ $? -eq 0 ]; then
    echo "Successfully generated $OUTPUT_FILE"
    echo "You can now copy the contents of this file into Portainer's Web Editor."
    echo "Don't forget to copy .env.prod values into Portainer's Advanced Mode environment section."
else
    echo "Error: Failed to generate $OUTPUT_FILE"
    exit 1
fi
