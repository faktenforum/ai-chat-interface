# LibreChat Administration

## Access

- Portainer: Containers → `LibreChat` → Console → `/bin/sh`
- CLI: `docker exec -it LibreChat /bin/sh`

## User Management

### Creating Administrators

**Normal Way (Recommended):**
- The **first user** who registers in LibreChat automatically becomes an administrator
- This happens when you create the first account via the "Sign up" button on the login page
- The first account should ideally be a local account (email and password)

### All Available Commands

| Command | Description |
|---------|-------------|
| `npm run list-users` | List all users with ID, email, username, role, and creation date |
| `npm run create-user` | Interactive script to create new users |
| `npm run reset-password <email>` | Reset a user's password |
| `npm run delete-user <email>` | Delete a user account |
| `npm run ban-user <email>` | Ban a user account |

## Token Balance

| Command | Description |
|---------|-------------|
| `npm run list-balances` | List all user token balances |
| `npm run add-balance <email> <amount>` | Add tokens to a user's balance |
| `npm run set-balance <email> <amount>` | Set a user's token balance (overwrites existing) |

## Maintenance

| Command | Description |
|---------|-------------|
| `npm run reset-meili-sync` | Reset Meilisearch synchronization |
| `node config/flush-cache.js` | Flush application cache |
| `npm run user-stats` | Display user statistics |

## Alternative: Direct Node.js execution

If `npm run` doesn't work, execute scripts directly:
```bash
node config/list-users.js
node config/create-user.js
```

**Note**: These scripts are built into the LibreChat Docker image under `/app/config/`.
