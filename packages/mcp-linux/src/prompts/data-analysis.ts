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

1. **Upload** — \`create_upload_session\` → user uploads file → lands in \`uploads/\`.
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
5. **Return image** — \`read_workspace_file(workspace, "uploads/chart.png")\` → image shown in chat. Optionally \`create_download_link\` for the same file.

## Constraints

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

Then: \`read_workspace_file(workspace, "uploads/chart.png")\` to display in chat.

## Data Processing (non-chart)

- **Filter/transform** — Python \`csv\`, \`json\`, \`collections\`, \`statistics\`, or \`pandas\`.
- **Simple tasks** — \`awk\`, \`sed\`, \`grep\`, \`jq\` via bash may suffice.
- **Output files** — save results in workspace, offer \`create_download_link\`.
`,
};
