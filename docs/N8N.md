# n8n Setup Notes

## Owner Account Creation

The owner account is automatically created via an init container (`n8n-init`) that calls n8n's `/owner/setup` API endpoint after n8n is ready.

### Automatic Setup (Recommended)

When `N8N_OWNER_EMAIL` and `N8N_OWNER_PASSWORD` are provided, the init container will:

1. Wait for n8n to be ready (checks `/healthz` endpoint)
2. Call the `/owner/setup` API to create the owner account
3. Exit successfully (or skip if owner already exists)

**Configuration:**

- `N8N_OWNER_EMAIL` - Email for the owner account (auto-generated if empty via `setup-env.ts`)
- `N8N_OWNER_PASSWORD` - Password for the owner account (auto-generated if empty via `setup-env.ts`)
- `N8N_OWNER_FIRST_NAME` - Owner's first name (default: "Admin")
- `N8N_OWNER_LAST_NAME` - Owner's last name (default: "User")

When you run `npm run setup` (or `setup:dev`/`setup:prod`), the script will:
1. Generate `N8N_OWNER_EMAIL` and `N8N_OWNER_PASSWORD` if they're empty
2. The generated credentials will be saved in your `.env.local`, `.env.dev`, or `.env.prod` file
3. On first startup, the `n8n-init` container will automatically create the owner account

### Manual Setup (Fallback)

If `N8N_OWNER_EMAIL` or `N8N_OWNER_PASSWORD` are not set, the init container will skip owner creation and you must create the owner manually:

1. Start n8n: `docker compose -f docker-compose.local.yml up -d n8n`
2. Wait for n8n to be ready (check logs: `docker compose logs n8n`)
3. Open the n8n UI: `http://n8n.localhost` (or your configured domain)
4. Complete the owner setup wizard in the web UI

### Security

- Only users with valid owner credentials can authenticate
- The owner account has full administrative access
- Additional users can be invited by the owner through the UI

### Reset Owner Setup

If you need to reset the owner setup (e.g., for testing):

```bash
docker exec n8n n8n user-management:reset
```

After resetting, restart the stack and the init container will create a new owner if credentials are provided.

## Portainer Deployment

The init container works the same way in Portainer. Ensure `N8N_OWNER_EMAIL` and `N8N_OWNER_PASSWORD` are set in your environment variables (from `.env.dev` or `.env.prod`). The init container will run automatically before n8n starts.
