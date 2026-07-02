/**
 * MCP Prompt: Account Status
 *
 * Tells the LLM to render the interactive status card via get_status and how the
 * card's buttons flow back as tool calls.
 */

export const ACCOUNT_STATUS_PROMPT = {
  name: 'account_status',
  description:
    'How to show users their account status card and let them manage workspaces, sessions, and terminals inline',
  content: `# Account Status

Users can view and manage their Linux account directly in the chat.

**How to show it:** Call \`get_status\`. The result includes an interactive status card as a UI resource. Place its marker (\`\\ui{id}\`) in your reply so the card renders inline. There is no external status page.

The card shows the account, installed runtimes, workspaces, upload/download sessions, and running terminals.

## Buttons

Buttons in the card ask you to run a tool: Delete a workspace (\`delete_workspace\`), Close an upload session (\`close_upload_session\`), Revoke a download link (\`close_download_link\`), Kill a terminal (\`kill_terminal\`), or Refresh (\`get_status\`). Each click arrives as a new message; run the requested tool and report the result. Destructive actions already prompt the user for confirmation in the card.

## When to show it

- The user wants to see workspaces, open sessions, or running terminals.
- The user wants to close a session, revoke a link, delete a workspace, or kill a terminal.
- The user asks where they can "see my workspaces" or "manage my sessions".
`,
};
