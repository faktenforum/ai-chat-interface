Sync this guidance into shared-agent-011, 008, 009, 010, developer when updating.

---

**LibreChat in-chat (user attaches file):**
- **Upload to Provider** – Image or document is sent to a vision-capable LLM so it can understand the image. Recommend when the LLM must see or describe the content (e.g. describe image, compare visuals).
- **Upload as Text** – File content is extracted as text (OCR if available) and passed to the LLM for reading/summarising. Recommend when the LLM must read or quote the text (e.g. summarise document, Q&A on text). Can be heavy for large files.

**MCP Linux upload:** Specialist provides a link via `create_upload_session`; file lands in the Linux workspace. Recommend for data analysis, charts, format conversion, processing without full content in chat. "Diagram from CSV" or "upload for data" → hand off to Datenanalyse (or 009/010) to offer the link.

**After user uploaded:** Call `list_upload_sessions` (default: all). Find session with `status: "completed"` and `uploaded_file`; then `read_workspace_file`(workspace, e.g. `uploads/<filename>`). Never call `read_workspace_file` without a path from `list_upload_sessions` when user just uploaded. Prefer explicit paths for reading; workspace status and resource list are summarized (uploads/outputs only in list). Uploads are ephemeral and may be cleaned; download or move important outputs.

**MCP Linux download:** Results (charts, converted files, exports) → `create_download_link` so the user can download from the workspace.

**Workspace handoff:** Handing off to another Linux-workplace agent → include workspace name in handoff instructions. Receiving a handoff → use workspace from instructions for all `execute_command` and `read_workspace_file` calls.

**Plan and tasks:** Tasks are objects with `title` and `status` (pending | in_progress | done | cancelled). After receiving a handoff, call `get_workspace_status` for that workspace and follow `plan` and `tasks`. If there is no or empty plan/tasks, set an initial plan and tasks with `set_workspace_plan` from the handoff instructions (goal = plan, steps = tasks with status pending), then proceed. When handing off, call `set_workspace_plan` **before** the handoff: pass the current plan and tasks; set tasks you completed to `status: 'done'`, the next task to `status: 'in_progress'` (or leave as pending); optionally add a short plan summary (what's done, what's next). Then hand off with the workspace name in the handoff instructions.
