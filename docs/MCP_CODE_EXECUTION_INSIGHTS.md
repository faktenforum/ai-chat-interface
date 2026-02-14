# Code Execution with MCP: Insights for Our Stack

Summary of [Anthropic: Code execution with MCP](https://www.anthropic.com/engineering/code-execution-with-mcp) and how we apply it to the Linux MCP server, agents, and prompts.

## Article Summary

- **Problem 1:** Loading all tool definitions upfront consumes context and slows agents when many tools/servers are connected.
- **Problem 2:** Intermediate tool results (e.g. full document text, large JSON) pass through the model, wasting tokens and risking context limits.
- **Approach:** Use **code execution** as the primary interface to MCP: agent writes code that calls tools; only load tool definitions on demand; filter/transform in the execution environment before returning to the model.

## How This Maps to Our Setup

We already provide a **code execution environment** via the Linux MCP server (`execute_command` in a real Linux environment). We use **direct tool calls** for all MCP tools (execute_command, read_terminal_output, workspaces, upload, download, read_workspace_file, etc.), so we are affected by:

1. **Tool definition load** — Development specialists (e.g. Code-Recherche) use Linux + GitHub + docs + Stack Overflow + npm (many tools). Each tool’s name, description, and schema are in context.
2. **Intermediate data in context** — Large command output, full file contents, or big API responses are returned to the model before the next step.

We can improve efficiency without changing LibreChat’s “all tools in context” model by: (a) encouraging **batch work in code** and **filter-before-return** in prompts and agent instructions, and (b) keeping tool descriptions concise.

---

## 1. Prefer Code Over Many Tool Calls (Control Flow in Code)

**Insight:** Loops, conditionals, and multi-step logic in a single script are more token-efficient than chaining many tool calls (each round-trip adds tool result tokens).

**What we do:**

- In agent instructions (e.g. Entwickler, Datenanalyse): state that **multi-step workflows should be implemented in a single script** run via `execute_command`, and only use tool calls for I/O boundaries (upload URL, download link, read a final file).
- In MCP prompts (e.g. data_analysis, document_creation): add a short note that **loops and conditionals belong inside the script**, not as repeated tool calls.

---

## 2. Filter / Summarize in the Execution Environment

**Insight:** For large datasets, filter or aggregate in code and only return a summary or sample to the model (e.g. “first 5 rows” or “count of pending orders”), so the context stays small.

**What we do:**

- In the **data_analysis** MCP prompt: explicitly say to **filter or summarize in Python/bash before returning**; avoid passing full result sets through the conversation; use `read_workspace_file` or `create_download_link` for the final artifact or a short summary/sample.
- In the **Datenanalyse** agent instructions: reinforce “process in script, return only summary or sample when data is large.”

---

## 3. State Persistence and Reusable Scripts (Skills)

**Insight:** Saving intermediate results and reusable scripts in the workspace lets the agent resume work and build a small “skill” library (e.g. `./scripts/save-sheet-as-csv.ts`).

**What we do:**

- In docs (e.g. MCP_LINUX.md) and, if useful, in a short MCP prompt or agent line: mention that **scripts can be saved in the workspace** and reused in later turns (e.g. `~/workspaces/default/scripts/`). No need to implement a full “skills” system; documentation and instructions are enough for the model to use the pattern.

---

## 4. Progressive Disclosure (Future / Client-Dependent)

**Insight:** Ideally, the agent loads only the tool definitions it needs (e.g. via a file tree of tools or a `search_tools` tool with detail levels). That reduces upfront context.

**Our situation:** LibreChat today sends all configured tools and their definitions to the model. We cannot switch to on-demand tool loading without client/platform support.

**Options for later:**

- **Shorter tool descriptions** in the Linux MCP server: keep descriptions minimal (one sentence + critical params) to reduce tokens.
- **Lightweight “tool overview” prompt** on MCP Linux: e.g. a prompt that lists tool names and one-line descriptions so agents that support prompt-based discovery can pull a short list instead of relying only on full schemas (if/when the client uses it).
- **Agent splitting:** avoid one agent with “Linux + 5 other MCPs”; keep tool sets smaller per agent where it makes sense.

---

## 5. Privacy / PII Tokenization (Future)

**Insight:** For sensitive data, the harness can tokenize PII before it reaches the model and untokenize when calling tools, so the model never sees raw PII.

**Our situation:** Not implemented. Could be a future improvement for agents that handle user-uploaded or customer data (e.g. Datenanalyse, Dokumenten-Ersteller). Out of scope for the current changes.

---

## Summary Table

| Insight | Action |
|--------|--------|
| Control flow in code | Instruct agents: batch multi-step work in one script; use tools for I/O boundaries. |
| Filter before return | Data-analysis prompt + agent: filter/summarize in script; return summary or sample, not full dataset. |
| State / skills | Document: save scripts in workspace and reuse in later turns. |
| Progressive disclosure | Keep tool descriptions short; optional tool-overview prompt; consider smaller tool sets per agent. |
| PII tokenization | Note as future improvement; not implemented. |
