/**
 * Status card UI resource.
 *
 * Rendered inline in LibreChat from get_status. Buttons post `tool` actions that
 * ask the assistant to run the matching MCP tool (each click is a new chat turn).
 */

import { esc, layout, toolButton } from './html.ts';
import type { StatusOverview, TerminalSummary } from '../status-overview.ts';
import type { SessionInfo } from '../upload/upload-manager.ts';
import type { DownloadSessionInfo } from '../download/download-manager.ts';

function fmtBytes(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.min(units.length - 1, Math.floor(Math.log(n) / Math.log(1024)));
  return `${(n / Math.pow(1024, i)).toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

function fmtDate(value: string | number | undefined): string {
  if (value == null) return '';
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? String(value) : d.toLocaleString();
}

function statusBadge(status: string): string {
  return `<span class="badge">${esc(status)}</span>`;
}

function accountCard(o: StatusOverview): string {
  const u = o.user;
  const facts = [
    u.username ? `<span class="badge">user: ${esc(u.username)}</span>` : '',
    u.diskUsage ? `<span class="badge">disk: ${esc(u.diskUsage)}</span>` : '',
    u.home ? `<span class="badge">home: ${esc(u.home)}</span>` : '',
    u.createdAt ? `<span class="badge">since: ${esc(fmtDate(u.createdAt))}</span>` : '',
  ].join('');

  const runtimes = u.runtimes && Object.keys(u.runtimes).length
    ? `<p class="muted" style="margin-top:.6rem">runtimes</p><div class="row">${Object.entries(u.runtimes)
        .map(([name, ver]) => `<span class="badge">${esc(name)}: ${esc(ver)}</span>`)
        .join('')}</div>`
    : '';

  return `<div class="card">
    <p style="font-weight:600">${esc(u.email)}</p>
    <div class="row">${facts}</div>
    ${runtimes}
  </div>`;
}

function workspacesSection(o: StatusOverview): string {
  if (!o.workspaces.length) return '<h2>Workspaces</h2><p class="muted">No workspaces.</p>';
  const rows = o.workspaces
    .map((name) => {
      const action =
        name === 'default'
          ? '<span class="muted">protected</span>'
          : toolButton({
              label: 'Delete',
              tool: 'delete_workspace',
              params: { name, confirm: true },
              confirm: `Delete workspace "${name}" and all its files?`,
              className: 'danger',
            });
      return `<tr><td><code>${esc(name)}</code></td><td style="text-align:right">${action}</td></tr>`;
    })
    .join('');
  return `<h2>Workspaces</h2><table><tbody>${rows}</tbody></table>`;
}

function uploadSection(sessions: SessionInfo[]): string {
  if (!sessions.length) return '<h2>Upload sessions</h2><p class="muted">None.</p>';
  const rows = sessions
    .map((s) => {
      const file = s.uploaded_file ? `<div class="muted">${esc(s.uploaded_file.name)} (${fmtBytes(s.uploaded_file.size)})</div>` : '';
      const action =
        s.status === 'active'
          ? toolButton({
              label: 'Close',
              tool: 'close_upload_session',
              params: { token: s.token },
              confirm: 'Close this upload session?',
            })
          : '';
      return `<tr>
        <td>${esc(s.workspace)}${file}</td>
        <td>${statusBadge(s.status)}</td>
        <td class="muted">${esc(fmtDate(s.expires_at))}</td>
        <td style="text-align:right">${action}</td>
      </tr>`;
    })
    .join('');
  return `<h2>Upload sessions</h2><table>
    <thead><tr><th>Workspace</th><th>Status</th><th>Expires</th><th></th></tr></thead>
    <tbody>${rows}</tbody></table>`;
}

function downloadSection(sessions: DownloadSessionInfo[]): string {
  if (!sessions.length) return '<h2>Download links</h2><p class="muted">None.</p>';
  const rows = sessions
    .map((s) => {
      const link =
        s.status === 'active'
          ? `<div><a href="${esc(s.download_url)}" target="_blank" rel="noopener">open</a></div><code>${esc(s.download_url)}</code>`
          : '';
      const action =
        s.status === 'active'
          ? toolButton({
              label: 'Revoke',
              tool: 'close_download_link',
              params: { token: s.token },
              confirm: 'Revoke this download link?',
            })
          : '';
      return `<tr>
        <td>${esc(s.filename)}<div class="muted">${esc(s.workspace)} · ${fmtBytes(s.file_size)}</div>${link}</td>
        <td>${statusBadge(s.status)}</td>
        <td class="muted">${esc(fmtDate(s.expires_at))}</td>
        <td style="text-align:right">${action}</td>
      </tr>`;
    })
    .join('');
  return `<h2>Download links</h2><table>
    <thead><tr><th>File</th><th>Status</th><th>Expires</th><th></th></tr></thead>
    <tbody>${rows}</tbody></table>`;
}

function terminalSection(terminals: TerminalSummary[]): string {
  if (!terminals.length) return '<h2>Terminals</h2><p class="muted">None running.</p>';
  const rows = terminals
    .map((t) => {
      const action = toolButton({
        label: 'Kill',
        tool: 'kill_terminal',
        params: { terminal_id: t.terminal_id },
        confirm: `Kill terminal ${t.terminal_id}?`,
        className: 'danger',
      });
      return `<tr>
        <td><code>${esc(t.terminal_id)}</code></td>
        <td>${esc(t.workspace)}</td>
        <td class="muted">${esc(fmtDate(t.created_at))}</td>
        <td style="text-align:right">${action}</td>
      </tr>`;
    })
    .join('');
  return `<h2>Terminals</h2><table>
    <thead><tr><th>ID</th><th>Workspace</th><th>Started</th><th></th></tr></thead>
    <tbody>${rows}</tbody></table>`;
}

/** Renders the interactive account status card as an embedded UI resource. */
export function renderStatusUi(o: StatusOverview): string {
  const refresh = toolButton({ label: 'Refresh', tool: 'get_status', params: {} });
  const body = `
    <div class="between"><h1>Account status</h1>${refresh}</div>
    ${accountCard(o)}
    ${workspacesSection(o)}
    ${uploadSection(o.upload_sessions)}
    ${downloadSection(o.download_sessions)}
    ${terminalSection(o.terminals)}
    <footer>Buttons ask the assistant to act; each click starts a new turn. Generated ${esc(fmtDate(o.generated_at))}.</footer>
  `;
  return layout({ title: 'Account status', body, actions: true });
}
