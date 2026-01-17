#!/bin/bash
# Integration test script for MCP Calculator Server
# Run from workspace root: npm run test:integration

set -e

# Get script directory and workspace root
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# Script is in packages/mcp-calculator/test, so go up 2 levels to get workspace root
WORKSPACE_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"

echo "🔍 MCP Calculator Integration Test"
echo "=================================="
echo ""

# Colors
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Test 1: Health endpoint
echo "1. Testing health endpoint..."
if curl -s -f http://localhost:3000/health > /dev/null 2>&1; then
    echo -e "${GREEN}✓${NC} Health endpoint is accessible"
    curl -s http://localhost:3000/health | jq . 2>/dev/null || curl -s http://localhost:3000/health
else
    echo -e "${YELLOW}⚠${NC} Health endpoint is not accessible"
fi
echo ""

# Test 2: Check if server is in Docker network
echo "2. Checking Docker network connectivity..."
if command -v docker &> /dev/null; then
    if docker ps --format "{{.Names}}" | grep -qE "mcp-calculator|prod-mcp-calculator"; then
        CONTAINER_NAME=$(docker ps --format "{{.Names}}" | grep -E "mcp-calculator|prod-mcp-calculator" | head -1)
        echo -e "${GREEN}✓${NC} MCP Calculator container is running: $CONTAINER_NAME"
        CONTAINER_IP=$(docker inspect -f '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}' "$CONTAINER_NAME" 2>/dev/null || echo "")
        if [ -n "$CONTAINER_IP" ]; then
            echo "   Container IP: $CONTAINER_IP"
        fi
    else
        echo -e "${YELLOW}⚠${NC} MCP Calculator container is not running"
    fi
else
    echo -e "${YELLOW}⚠${NC} Docker not available, skipping network check"
fi
echo ""

# Test 3: Check LibreChat configuration
echo "3. Checking LibreChat configuration..."
LIBRECHAT_CONFIG="$WORKSPACE_ROOT/packages/librechat-init/config/librechat.yaml"
if [ -f "$LIBRECHAT_CONFIG" ]; then
    if grep -q "mcp-calculator" "$LIBRECHAT_CONFIG"; then
        echo -e "${GREEN}✓${NC} MCP Calculator is configured in LibreChat"
        if grep -A 5 "calculator:" "$LIBRECHAT_CONFIG" | grep -q "type: streamable-http"; then
            echo -e "${GREEN}✓${NC} Streamable HTTP transport is configured"
        else
            echo -e "${RED}✗${NC} Streamable HTTP transport not found in configuration"
        fi
    else
        echo -e "${RED}✗${NC} MCP Calculator not found in LibreChat configuration"
    fi
else
    echo -e "${YELLOW}⚠${NC} LibreChat config file not found: $LIBRECHAT_CONFIG"
fi
echo ""

# Test 4: Check network connectivity from LibreChat container
echo "4. Testing network connectivity from LibreChat..."
if command -v docker &> /dev/null; then
    # Try different LibreChat container name patterns
    LIBRECHAT_CONTAINER=$(docker ps --format "{{.Names}}" | grep -iE "librechat|api" | grep -v "init" | head -1)
    if [ -n "$LIBRECHAT_CONTAINER" ]; then
        # Check if curl or wget is available in container
        if docker exec "$LIBRECHAT_CONTAINER" sh -c "command -v curl >/dev/null 2>&1" 2>/dev/null; then
            if docker exec "$LIBRECHAT_CONTAINER" curl -s -f http://mcp-calculator:3000/health > /dev/null 2>&1; then
                echo -e "${GREEN}✓${NC} LibreChat can reach MCP Calculator"
            else
                echo -e "${RED}✗${NC} LibreChat cannot reach MCP Calculator"
                echo "   Check Docker network configuration"
            fi
        elif docker exec "$LIBRECHAT_CONTAINER" sh -c "command -v wget >/dev/null 2>&1" 2>/dev/null; then
            if docker exec "$LIBRECHAT_CONTAINER" wget -q -O- --timeout=5 http://mcp-calculator:3000/health > /dev/null 2>&1; then
                echo -e "${GREEN}✓${NC} LibreChat can reach MCP Calculator"
            else
                echo -e "${RED}✗${NC} LibreChat cannot reach MCP Calculator"
                echo "   Check Docker network configuration"
            fi
        else
            echo -e "${YELLOW}⚠${NC} No HTTP client available in LibreChat container, skipping connectivity test"
        fi
    else
        echo -e "${YELLOW}⚠${NC} LibreChat container not found, skipping connectivity test"
    fi
else
    echo -e "${YELLOW}⚠${NC} Docker not available, skipping connectivity test"
fi
echo ""

# Test 5: Check logs for errors
echo "5. Checking for errors in logs..."
if command -v docker &> /dev/null; then
    CONTAINER_NAME=$(docker ps --format "{{.Names}}" | grep -E "mcp-calculator|prod-mcp-calculator" | head -1)
    if [ -n "$CONTAINER_NAME" ]; then
        ERROR_COUNT=$(docker logs "$CONTAINER_NAME" 2>&1 | grep -i "error" | grep -v "level.*error" | wc -l)
        if [ "$ERROR_COUNT" -eq 0 ]; then
            echo -e "${GREEN}✓${NC} No errors found in logs"
        else
            echo -e "${YELLOW}⚠${NC} Found $ERROR_COUNT error(s) in logs"
            echo "   Check with: docker logs $CONTAINER_NAME"
        fi
    else
        echo -e "${YELLOW}⚠${NC} MCP Calculator container not running, skipping log check"
    fi
else
    echo -e "${YELLOW}⚠${NC} Docker not available, skipping log check"
fi
echo ""

echo "=================================="
echo -e "${GREEN}Integration test completed${NC}"
echo ""
echo "Next steps:"
echo "1. Start LibreChat and verify MCP Calculator appears in agent configuration"
echo "2. Create an agent and enable the calculator MCP server"
echo "3. Test calculations in a chat conversation"
