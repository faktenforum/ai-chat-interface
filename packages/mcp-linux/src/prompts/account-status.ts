/**
 * MCP Prompt: Account Status Page
 *
 * Tells the LLM to use get_status for the user's status page URL (with token)
 * and when to refer users there.
 */

const PORT = parseInt(process.env.PORT || '3015', 10);

function getStatusPageUrl(): string {
  const explicit = process.env.MCP_LINUX_STATUS_PAGE_URL?.trim();
  if (explicit) {
    return explicit.replace(/\/+$/, '');
  }

  const base =
    process.env.MCP_LINUX_UPLOAD_BASE_URL ||
    process.env.MCP_LINUX_DOWNLOAD_BASE_URL ||
    `http://localhost:${PORT}`;
  const normalized = base.replace(/\/+$/, '');
  return normalized + '/status';
}

export const STATUS_PAGE_URL = getStatusPageUrl();

export const ACCOUNT_STATUS_PROMPT = {
  name: 'account_status',
  description:
    'URL of the status page where users can manage workspaces, upload/download sessions, and terminals',
  content: `# Account Status Page

Users have a web interface to view and manage their Linux account.

**How to give the user the link:** Call \`get_status\` and use the \`status_page_url\` from the result. That URL includes a time-limited token for the current user. Give that exact URL to the user when they want to manage things themselves.

## When to refer the user

- They want to close an upload session or revoke a download link themselves.
- They want to see all their workspaces, open upload/download sessions, or active terminals.
- They want to delete a workspace or kill a terminal from a browser.
- They ask where they can "see my workspaces" or "manage my sessions".

Tell them to open the status URL (from get_status) in a new tab.
`,
};
