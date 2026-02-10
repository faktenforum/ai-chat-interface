# MCP Linux – Data Analysis and Plotting

## MCP Prompt (canonical source)

The LLM-optimized workflow and constraints for data analysis and chart generation are in the MCP prompt **`data_analysis`**, registered by the mcp-linux server. Agents with access to the linux MCP can retrieve it via `list_prompts` / `get_prompt`.

Source: [`packages/mcp-linux/src/prompts/data-analysis.ts`](../packages/mcp-linux/src/prompts/data-analysis.ts)

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
