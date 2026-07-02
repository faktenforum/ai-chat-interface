# Agent file upload guidance

How the Assistant chooses between LibreChat in-chat options and MCP Linux upload/download. Canonical wording: partial [mcp-linux-tools-files-upload.md](../packages/librechat-init/config/agent-instructions/partial_instructions/mcp-linux-tools-files-upload.md), included in the Assistant's instructions.

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

Data viz, format conversion, or document creation: the Assistant uploads the source via `create_upload_session`, processes it in a workspace, and returns the result with `create_download_link`. The file content stays in the workspace and does not need to load into the conversation.

## No router, single agent

The Assistant handles upload and download itself; there is no router chain. It resolves upload state with `list_upload_sessions` and picks a workspace with `list_workspaces` / `get_workspaces` before creating an upload or download link. Work in one workspace stays in that workspace across the turn.
