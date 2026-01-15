# n8n Setup Notes

## Owner Account Creation

The owner account is automatically created via the `n8n-init` container, which calls n8n's `/rest/owner/setup` API after n8n is ready.

### Automatic Setup

When `N8N_OWNER_EMAIL` and `N8N_OWNER_PASSWORD` are set, the init container:
1. Waits for n8n to be ready (checks `/healthz`)
2. Creates the owner account via API
3. Skips if owner already exists

**Environment Variables:**
- `N8N_OWNER_EMAIL` - Auto-generated if empty via `setup-env.ts`
- `N8N_OWNER_PASSWORD` - Auto-generated if empty via `setup-env.ts`
- `N8N_OWNER_FIRST_NAME` - Default: "Admin"
- `N8N_OWNER_LAST_NAME` - Default: "User"

### Manual Setup

If credentials are not set, create the owner manually via the web UI at `http://n8n.localhost` (or your configured domain).

### Reset Owner

```bash
docker exec n8n n8n user-management:reset
```

After resetting, restart the stack to trigger automatic owner creation if credentials are provided.
