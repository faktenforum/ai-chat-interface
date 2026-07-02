# MCP Linux – Data Analysis and Plotting

The **Assistant** agent does data analysis directly in a Linux workspace: it uploads or reads a data file, processes it with Python (pandas/matplotlib), renders a chart headlessly, and returns the chart via `read_workspace_file` or a download link. No dedicated data-analysis agent or workspace template is involved - it is one workflow inside the general Assistant.

## Workspace and paths

`execute_command` always runs in the given workspace (each command starts in the workspace root) and returns `workspace`, `cwd` (current working directory after the command), and optionally `cwd_relative_to_workspace`. Paths in commands and in `read_workspace_file` / `create_download_link` are relative to the workspace root. Use the same relative path in the script (e.g. `savefig("chart.png")`) and for the file tools (`read_workspace_file(workspace, "chart.png")`).

## System Dependencies (Docker Image)

The mcp-linux image includes headless plotting support:

| Package            | Purpose                           |
|--------------------|-----------------------------------|
| `fontconfig`       | Font resolution for text in plots |
| `fonts-dejavu-core`| Default fonts for axis labels     |

Python packages (pandas, matplotlib, seaborn) are installed at runtime by the agent (`pip install --user`). See [MCP_LINUX.md](MCP_LINUX.md) for full image details.

## Example: CSV → Bar Chart (reference)

```python
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
```

After running: `read_workspace_file(workspace, "uploads/chart.png")` to display in chat; `create_download_link` for a download URL.
