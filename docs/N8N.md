# n8n Setup Notes

## Owner Account Creation

n8n does not create an owner account from environment variables. The first owner is created through the web UI when the user database is empty. After an owner exists, the setup wizard will not appear again.

## Portainer and Environment Variables

Portainer does not prompt for values. It only injects the environment variables you provide in the stack configuration (or from the generated `.env.dev` / `.env.prod` files). The owner setup prompt is not tied to environment variables.

## Reset User Management

If you need the owner setup wizard again, reset the user management state:

```bash
docker exec n8n n8n user-management:reset
```

After the reset, open the n8n UI and create a new owner.
