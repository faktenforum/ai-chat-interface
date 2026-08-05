# Agent instructions in this repo

Agent context is split by when it is needed, so a session only carries what the current task requires.

| File | Loaded | Holds |
|---|---|---|
| [`AGENTS.md`](../AGENTS.md), aliased as `CLAUDE.md` | every session | what this repo is, the four compose entry points, the footguns |
| `.claude/rules/compose-stacks.md` | when a `docker-compose*.yml` or `env.*.example` is touched | compose conventions, image strategy, networks, Traefik labels |
| `.claude/rules/env-vars.md` | when `scripts/setup-env.ts` or an env example is touched | naming, `AUTO_GENERATED`, `PROMPTS`, `MIGRATIONS`, expansions |
| `.claude/skills/add-service/` | on request | checklist for putting a new service in the stack |
| `.claude/skills/add-mcp-server/` | on request | the five MCP integration patterns, LibreChat wiring, icons |
| `.claude/skills/fork-submodule/` | on request | upstream sync, PR to upstream, building and publishing the image |

The workspace-wide conventions (commits, PRs, tone, submodule discipline) live in the `AGENTS.md` of the
Faktenforum workspace, one directory above this repo, when it is checked out there.

Rules with a `paths:` frontmatter field only enter the context window when a matching file is read. Skills
cost nothing until they are invoked. Both exist so `AGENTS.md` can stay short: a context file is followed
literally, so anything in it that does not apply to the task at hand buys extra work rather than better
work.

## Using them

Ask for the outcome, not the file: *"add a service called X"*, *"integrate an MCP server for Y"*,
*"sync the forks with upstream"*. The matching skill is picked up from the description. Review the diff
before it lands.

This repo previously kept the same content in `.cursor/rules/*.mdc`. Those files are gone; `.cursor/mcp.json`
for local MCP testing stays.
