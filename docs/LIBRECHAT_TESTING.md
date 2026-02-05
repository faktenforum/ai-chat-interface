# LibreChat Testing

Run LibreChat unit and E2E tests on the host from `dev/librechat`. For E2E, start the test stack (MongoDB + Meilisearch) first; unit tests use in-memory MongoDB and do not need it. Optionally link `dev/agents` to use your local agents package.

**PR draft:** [wip/PR-feat-librechat-testing.md](wip/PR-feat-librechat-testing.md)

## Table of Contents

- [LibreChat Testing](#librechat-testing)
  - [Table of Contents](#table-of-contents)
  - [Prerequisites](#prerequisites)
  - [Link dev/agents (optional)](#link-devagents-optional)
  - [Test Stack](#test-stack)
  - [Unit Tests](#unit-tests)
  - [E2E Tests](#e2e-tests)
  - [Ports](#ports)
  - [Troubleshooting](#troubleshooting)

---

## Prerequisites

- Node 20, npm, Docker
- Submodules and agents built: `npm run prepare:dev` (see [dev/README.md](../dev/README.md))
- **OpenSSL 1.1 (libcrypto.so.1.1)** for API unit tests: the `mongodb-memory-server` dependency uses an embedded MongoDB binary built against **OpenSSL 1.1.x**. That library must be installed on the **host** where you run the tests. Our test stack (`docker-compose.librechat-tests.yml`) only runs MongoDB and Meilisearch; Jest runs on the host, so the host needs libcrypto.so.1.1. Upstream CI uses `ubuntu-latest`, where compatible libs are available. On Fedora: `dnf install openssl1.1`; on Debian/Ubuntu: `apt install libssl1.1`. If `openssl1.1` is no longer in Fedora repos: install the RPM from [Fedora archives](https://archives.fedoraproject.org/pub/archive/fedora/linux/releases/36/Everything/x86_64/os/Packages/o/) (e.g. `openssl1.1-1.1.1n-1.fc36.x86_64.rpm`), or use a COPR such as [copart/compat-openssl](https://copr.fedorainfracloud.org/coprs/copart/compat-openssl), or [build OpenSSL 1.1.1 from source](https://gist.github.com/Rusydy/bfc7d0a9b8bdd4aaff64f6b667d36e52) (e.g. on Fedora 41 / CentOS 9 when no package exists).

---

## Link dev/agents (optional)

LibreChat uses `@librechat/agents` from `node_modules` (registry). To use your local `dev/agents` instead, link it before running tests.

**From repo root:**

```bash
npm run test:librechat:link-agents
```

**Manual:**

```bash
cd dev/agents
npm run build
npm link
cd ../librechat
npm link @librechat/agents
```

**Restore registry version when done:**

```bash
npm run test:librechat:unlink-agents
# or: cd dev/librechat && npm unlink @librechat/agents && npm install
```

---

## Test Stack

MongoDB and Meilisearch only. **Required for E2E** (the app connects to this MongoDB and Meilisearch). API unit tests use MongoMemoryServer (in-memory) and do not use this stack; start it only when running E2E or when running the app against it.

**One-time:** From repo root: `cp env.librechat-tests.example .env.librechat-tests`

**Start / stop:**

```bash
npm run test:librechat:stack:up
npm run test:librechat:stack:down
```

Or: `docker compose -p librechat-tests -f docker-compose.librechat-tests.yml --env-file .env.librechat-tests up -d` / `down`.

---

## Unit Tests

From `dev/librechat` (optionally [link](#link-devagents-optional) for local agents). The test stack is not used by unit tests; they use MongoMemoryServer (in-memory). You need OpenSSL 1.1 on the host for API tests (see [Prerequisites](#prerequisites)).

Build steps match upstream: [backend-review](../dev/librechat/.github/workflows/backend-review.yml) (API/packages) and [frontend-review](../dev/librechat/.github/workflows/frontend-review.yml) (client). Run:

```bash
cd dev/librechat
npm ci
npm run build:packages
mkdir -p api/data && echo '{}' > api/data/auth.json
cp api/test/.env.test.example api/test/.env.test
```

Optional (CI does this): in `packages/data-provider`, `npm run rollup:api` and confirm no "Circular dependency" in the output.

Run unit tests:

```bash
npm run test:client
npm run test:api
npm run test:packages:api
npm run test:packages:data-provider
npm run test:packages:data-schemas
npm run test:all
```

From repo root: `npm run test:librechat:unit`

---

## E2E Tests

**Test stack must be running** (this is the only case that uses it). Optionally [link](#link-devagents-optional) for local agents. In `dev/librechat`: `.env`, `librechat.yaml`, `e2e/config.local.ts` (from examples). In `.env`: `MONGO_URI=mongodb://127.0.0.1:27018/LibreChat`, `MEILI_HOST=http://127.0.0.1:7701`.

Per [CONTRIBUTING](../dev/librechat/.github/CONTRIBUTING.md), E2E needs the client app built. Build everything with `npm run frontend` (packages + client app), then run Playwright:

```bash
cd dev/librechat
npm ci
npm run frontend
cp e2e/config.local.example.ts e2e/config.local.ts
cp .env.example .env   # then set MONGO_URI, MEILI_HOST as above
cp librechat.example.yaml librechat.yaml
npx playwright install
npm run e2e
```

Start the app (backend + frontend) in another terminal before `npm run e2e` if your E2E config points at a local server.

From repo root: `npm run test:librechat:e2e`

---

## Ports

| Service     | Port | |
|-------------|------|---|
| MongoDB     | 27018 | `MONGO_URI=mongodb://127.0.0.1:27018/...` |
| Meilisearch | 7701  | `MEILI_HOST=http://127.0.0.1:7701` |

---

## Troubleshooting

- **`libcrypto.so.1.1` missing / "Instance failed to start because a library is missing or cannot be opened":** API unit tests use `mongodb-memory-server`, which requires OpenSSL 1.1.x on the **host** (tests are not run inside Docker). Install it per [Prerequisites](#prerequisites): `dnf install openssl1.1` or `apt install libssl1.1`; if no package exists, use Fedora archive RPM, a COPR, or [build from source](https://gist.github.com/Rusydy/bfc7d0a9b8bdd4aaff64f6b667d36e52).
- **Connection refused (E2E or app):** Test stack not running or ports in use. Start with `npm run test:librechat:stack:up`. API unit tests use in-memory MongoDB and do not need the stack.
- **Mongoose buffering timed out:** Usually appears together with in-memory MongoDB failures (MongoMemoryServer failed to start). Fix the `libcrypto.so.1.1` / mongodb-memory-server issue above; API unit tests use in-memory MongoDB and do not use the test stack.
- **Wrong agents code:** Ensure you ran link from `dev/librechat` and built `dev/agents` first.
- **E2E failures:** Verify `e2e/config.local.ts`, `.env`, `librechat.yaml` and that `MONGO_URI` / `MEILI_HOST` use 27018 and 7701.
