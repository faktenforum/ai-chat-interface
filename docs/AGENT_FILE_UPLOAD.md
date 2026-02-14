# Agent file upload guidance

How agents choose between LibreChat in-chat options and MCP Linux upload/download. Canonical wording: [shared-file-upload-types.md](../packages/librechat-init/config/agent-instructions/shared-file-upload-types.md) (synced into 011, 008, 009, 010, developer).

## LibreChat in-chat options

| Option | How | When to recommend |
|--------|-----|--------------------|
| **Upload to Provider** | Image/document sent to a vision-capable LLM; the model can "see" the image. | When the LLM should understand or describe an image (e.g. describe, analyse, compare). Requires a vision-capable agent. |
| **Upload as Text** | File content extracted as text (OCR if configured) and passed to the LLM. | When the LLM should read or quote the text (summarise, extract key points, Q&A on the text). Can be heavy for large files. |

## MCP Linux (workspace)

| Action | How | When |
|--------|-----|------|
| **Upload** | Agent provides a link via `create_upload_session`; file lands in the Linux workspace. | Data analysis, charts, format conversion, processing without loading full content into the conversation. |
| **Download** | Agent creates a temporary URL via `create_download_link`; user downloads the file in the browser. | Processed or generated files (charts, converted files, exports) that the user should receive. |

Data viz / "upload for data" → **Datenanalyse** (or 009/010). Specialists use MCP Linux upload and `create_download_link` for results.

## Router tools (handoff only)

| Router | MCP Linux tools | Use |
|--------|------------------|-----|
| **Universal** | list_upload_sessions, get_workspace_status, create_upload_session | Resolve upload state and workspace before handoff to Datenanalyse/009/010; optionally create upload link in first reply. |
| **Entwickler-Router** | list_workspaces, get_workspace_status | Resolve workspace name when handing off to dev specialists. |

## Workspace handoff

Linux-workplace agents (Datenanalyse, Dateikonverter, Dokumenten-Ersteller, Entwickler, dev specialists): when handing off to another such agent, pass **workspace name** in handoff `instructions`; on receive, use that workspace for all Linux tool calls.
