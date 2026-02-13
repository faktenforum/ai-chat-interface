/**
 * MCP Prompt: Data Analysis
 *
 * LLM-optimized workflow for data analysis and CSV-to-chart generation
 * using the headless Linux environment.
 */

export const DATA_ANALYSIS_PROMPT = {
  name: 'data_analysis',
  description: 'Workflow and constraints for data analysis and CSV-to-chart: upload, inspect, script (headless matplotlib), run, return image via read_workspace_file',
  content: `# Data Analysis & Visualization

## Workflow: CSV/JSON → Chart Image

1. **Upload** — If you need a data file and \`list_upload_sessions\` shows no completed upload, **proactively** call \`create_upload_session\` (workspace default), share the upload URL with the user, and ask them to open it and upload their file. Do not only say "please upload the file" without providing the link. Once the user has uploaded (or a session shows completed), file lands in \`uploads/\`.
2. **Inspect** — \`head uploads/data.csv\` or \`read_workspace_file\` to check columns, encoding, row count.
3. **Script** — Write a Python script:
   - Set headless backend **before** importing pyplot:
     \`\`\`python
     import matplotlib
     matplotlib.use("Agg")
     import matplotlib.pyplot as plt
     \`\`\`
   - Load data (stdlib \`csv\` or \`pandas\`).
   - Build plot (\`matplotlib\`, optionally \`seaborn\`).
   - Save to workspace path: \`plt.savefig("uploads/chart.png", dpi=120, bbox_inches="tight")\`.
4. **Run** — \`python3 script.py\` (or \`MPLBACKEND=Agg python3 script.py\`).
5. **Return image** — Use the **same** relative path as in \`savefig\` (e.g. \`chart.png\` or \`outputs/chart.png\`), not a different directory: \`read_workspace_file(workspace, "uploads/chart.png")\` → image shown in chat. Optionally \`create_download_link\` for the same path.

## Constraints

- **Provide upload link when data is missing** — If the user wants a chart or analysis and \`list_upload_sessions\` shows no completed upload, call \`create_upload_session\`, send the URL to the user, and ask them to upload; do not only say "please upload" without the link.
- **Workspace = reference for all paths** — \`execute_command\` runs in the given workspace; paths in the script (e.g. in \`savefig\`) are relative to the workspace root. Use the **same** relative path for \`read_workspace_file(workspace, …)\` and \`create_download_link(workspace, …)\` (e.g. if you save to \`chart.png\`, use \`read_workspace_file(workspace, "chart.png")\`).
- **Headless only** — always use the \`Agg\` backend; no display server available.
- **Save inside workspace** — output path must be within the workspace so \`read_workspace_file\` can access it.
- **Install deps in a venv** — create a virtual environment per workspace to avoid cross-workspace conflicts: \`python3 -m venv .venv && source .venv/bin/activate && pip install pandas matplotlib seaborn\`. Activate before running scripts: \`source .venv/bin/activate && python3 script.py\`.
- **Encoding** — default to UTF-8; handle Latin-1 or other encodings if \`head\` shows garbled text.

## Minimal Example (CSV → Bar Chart)

\`\`\`python
import csv, matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt

with open("uploads/data.csv", newline="", encoding="utf-8") as f:
    rows = list(csv.DictReader(f))

cols = list(rows[0].keys())
labels = [r[cols[0]] for r in rows]
values = [float(r[cols[1]]) for r in rows]

fig, ax = plt.subplots(figsize=(10, 6))
ax.bar(labels, values)
ax.set_xlabel(cols[0]); ax.set_ylabel(cols[1])
plt.xticks(rotation=45, ha="right")
fig.tight_layout()
fig.savefig("uploads/chart.png", dpi=120, bbox_inches="tight")
plt.close()
\`\`\`

Then: \`read_workspace_file(workspace, "uploads/chart.png")\` to display in chat. Use the same path in \`read_workspace_file\` as in \`savefig\`. The \`execute_command\` response includes \`cwd\`; when the script wrote to the current directory, the relative path for \`read_workspace_file\` is that filename (e.g. \`chart.png\` when in workspace root).

## Data Processing (non-chart)

- **Filter/transform** — Python \`csv\`, \`json\`, \`collections\`, \`statistics\`, or \`pandas\`.
- **Simple tasks** — \`awk\`, \`sed\`, \`grep\`, \`jq\` via bash may suffice.
- **Output files** — save results in workspace, offer \`create_download_link\`.

## Context efficiency (code execution with MCP)

- **Filter/summarize in the execution environment** — For large datasets, do filtering, aggregation, or sampling inside your script and only return a summary or a small sample to the user (e.g. \`print(summary); print(first_5_rows)\`). Avoid passing full result sets through the conversation. Use \`read_workspace_file\` or \`create_download_link\` for the final artifact or a short summary; offer full export as download if needed.
- **Control flow in code** — Use loops and conditionals inside a single script (one \`execute_command\` run) instead of multiple tool-call round-trips (e.g. process many files in one script, retry in a loop, branch on output).
`,
};
