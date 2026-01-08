#!/bin/bash
set -e

echo "🧪 Testing Production Setup Locally"
echo "===================================="
echo ""

# 1. Generate fresh .env.prod
echo "1. Generating .env.prod..."
npm run setup:prod:yes

# 2. Load vars from .env.prod
echo "2. Loading environment from .env.prod..."
set -a
source .env.prod
set +a

# 3. Validate compose config
echo "3. Validating docker-compose.prod.yml..."
docker compose -f docker-compose.prod.yml config > /tmp/prod-config-test.yml

# 4. Check critical services have networks
echo "4. Checking networks configuration..."
SERVICES="api mongodb meilisearch"
for service in $SERVICES; do
    if grep -A 20 "^  $service:" /tmp/prod-config-test.yml | grep -q "networks:"; then
        echo "   ✓ $service has networks"
    else
        echo "   ✗ $service MISSING networks!"
        exit 1
    fi
done

# 5. Start with fresh volumes (simulate Portainer)
echo ""
echo "5. Starting containers with FRESH volumes (simulates Portainer)..."
docker compose -f docker-compose.prod.yml down -v
docker compose -f docker-compose.prod.yml up -d

# 6. Wait for startup
echo ""
echo "6. Waiting for containers to start..."
sleep 10

# 7. Test DNS resolution
echo ""
echo "7. Testing DNS resolution in LibreChat container..."
docker exec LibreChat sh -c "
    echo 'Testing mongodb DNS...'
    getent hosts mongodb || echo '✗ MongoDB DNS FAILED!'
    echo 'Testing meilisearch DNS...'
    getent hosts meilisearch || echo '✗ Meilisearch DNS FAILED!'
    echo 'Testing connectivity...'
    nc -zv mongodb 27017 2>&1 || echo '✗ MongoDB CONNECTION FAILED!'
    nc -zv meilisearch 7700 2>&1 || echo '✗ Meilisearch CONNECTION FAILED!'
"

# 8. Check logs for errors
echo ""
echo "8. Checking logs for critical errors..."
docker logs LibreChat 2>&1 | grep -E "(error|Error|ERROR)" | tail -5 || echo "   ✓ No recent errors"

echo ""
echo "=========================================="
echo "✅ Production setup test complete!"
echo ""
echo "Cleanup: docker compose -f docker-compose.prod.yml down -v"
echo "Or keep running and test at: http://localhost:3080"
