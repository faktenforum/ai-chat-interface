---
paths:
  - "scripts/setup-env.ts"
  - "env.*.example"
---

# Environment variables

Naming is `{SERVICE}_` in UPPER_SNAKE_CASE (`FIRECRAWL_`, `LIBRECHAT_`, `SPEND_MONITOR_`). Recurring
suffixes: `_HOST` `_PORT` `_PROTOCOL` `_URI` `_URL`, `_SECRET_KEY` `_ENCRYPTION_KEY` `_JWT_SECRET`
`_PASSWORD`, `_BASIC_AUTH_USER` `_BASIC_AUTH_PASSWORD` `_API_KEY`, `_SECURE_COOKIE`.

Three example files feed `scripts/setup-env.ts`: `env.local.example` is the base and is required,
`env.prod.example` and `env.dev.example` hold overrides that win over the base. Local mode reads only
the base. **Add a new variable to all three**, with environment-appropriate defaults: `http` and
`localhost` and `SECURE_COOKIE=false` locally, `https` and the real domain and `SECURE_COOKIE=true` for
prod and dev.

## setup-env.ts

`npm run setup` writes `.env.local`, `setup:prod` and `setup:dev` the others, and `--yes` skips every
prompt.

**Auto-generated secrets** go in the `AUTO_GENERATED` map, keyed by variable name with a generator. Three
exist: `genSecret(n)` for a hex string (default 32 bytes), `genPassword(n)` for mixed case with digits
(default 16), and `genUsername(prefix)`. A value that has to be base64 needs its own generator written
first. Generation triggers when the value is missing, empty, contains `change-me`, or
matches a key-specific placeholder in `AUTO_GENERATE_PLACEHOLDERS`. So a secret in an example file
belongs there as `change-me` or empty, never as a real value.

**Values a human has to supply** go in `PROMPTS` as `{ message, type: 'input' | 'password', defaultGen?,
prodOnly? }`. Use `type: 'password'` to mask input, `prodOnly: true` to skip the prompt in local mode,
and `defaultGen: () => ''` for an optional key the user can skip with enter.

**Renames** go in `MIGRATIONS` as `OLD_NAME: NEW_NAME`. The old key's value is copied to the new key and
the old one is dropped from the output. Without an entry the value is silently lost.

`${VAR_NAME}` expansions are resolved iteratively, up to 100 passes, so `FULL_URL=${BASE_URL}/api`
works even when `BASE_URL` is itself an expansion. Define referenced variables before they are used and
keep chains short. An unresolved reference is left as-is for docker-compose to handle at runtime.

Variables already present in an existing `.env.*` are preserved when they are not in an example file,
not auto-generated, not prompted and not a migration target. That is what keeps a hand-added API key
alive across a re-run.

## Comments in example files

Say what the variable controls, the expected format, whether it is required, and whether `setup-env.ts`
generates it. Link external docs where the value comes from someone else's dashboard.

```bash
# Encryption key for the service (auto-generated if empty, via setup-env.ts)
# Format: 32-byte hex string. Required.
SERVICE_ENCRYPTION_KEY=change-me
```

Test with `npm run setup:yes` afterwards to confirm the defaults hold.
