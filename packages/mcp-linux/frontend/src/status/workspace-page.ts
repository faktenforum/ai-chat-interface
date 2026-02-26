import { getAuthToken, postJson } from '../shared/http';
import { escapeHtml, setBanner } from '../shared/dom';
import type { WorkspaceStatusResponse, PlanTask } from '../shared/types';

function getWorkspaceName(): string {
  const path = window.location.pathname || '';
  const parts = path.split('/');
  const name = parts[parts.length - 1] || '';
  try {
    return decodeURIComponent(name);
  } catch {
    return name;
  }
}

const summaryCardBody = document.querySelector<HTMLElement>('#workspaceSummaryCard .card-body');
const codeIndexCardBody = document.querySelector<HTMLElement>('#workspaceCodeIndexCard .card-body');
const planCardBody = document.querySelector<HTMLElement>('#workspacePlanCard .card-body');
const statusBanner = document.getElementById('statusBanner');

interface CodeSearchResult {
  file_path?: string;
  start_line?: number;
  end_line?: number;
  score?: number;
  code_chunk?: string;
}

interface SearchState {
  query: string;
  path: string;
  results: CodeSearchResult[];
  message: string;
}

let lastWorkspaceData: (WorkspaceStatusResponse & { tasks?: PlanTask[] }) | null = null;
let lastSearchState: SearchState | null = null;

function banner(type: 'info' | 'error' | 'success' | '', message: string): void {
  setBanner(statusBanner, type, message);
}

function workspaceApiUrl(): string {
  const auth = getAuthToken();
  const name = getWorkspaceName();
  const encoded = encodeURIComponent(name);
  const base = '/status/api/workspace/' + encoded;
  return auth ? base + '?token=' + encodeURIComponent(auth) : base;
}

function renderSummary(data: WorkspaceStatusResponse): void {
  if (!summaryCardBody) return;
  if (!data) {
    summaryCardBody.innerHTML = '<p class="muted">No workspace information available.</p>';
    return;
  }

  const meta = (data as any).meta || {};
  const git = (data as any).git || {};
  const config = data.config || {};

  let html = '<div class="list"><div class="list-item">';

  html += '<div class="list-item-meta">';
  if (meta.workspace) {
    html += '<span class="badge">Workspace: ' + escapeHtml(meta.workspace) + '</span>';
  }
  if (meta.branch) {
    html += '<span class="badge">Branch: ' + escapeHtml(meta.branch) + '</span>';
  }
  if (git.remote_url) {
    html += '<span class="badge">Remote: ' + escapeHtml(git.remote_url) + '</span>';
  }
  if (typeof git.dirty === 'boolean') {
    html +=
      '<span class="badge">' +
      (git.dirty ? 'Dirty working tree' : 'Clean working tree') +
      '</span>';
  }
  html += '</div>';

  if (git.ahead != null || git.behind != null) {
    html += '<div class="list-item-meta">';
    if (git.ahead != null) {
      html += '<span>Ahead: ' + escapeHtml(String(git.ahead)) + '</span>';
    }
    if (git.behind != null) {
      html += '<span>Behind: ' + escapeHtml(String(git.behind)) + '</span>';
    }
    html += '</div>';
  }

  if ((data as any).submodules) {
    const sub = (data as any).submodules;
    html += '<div class="list-item-meta">';
    html +=
      '<span>Submodules status: ' + escapeHtml(String(sub.status || 'none')) + '</span>';
    if (sub.message) {
      html += '<span>' + escapeHtml(String(sub.message)) + '</span>';
    }
    html += '</div>';
  }

  if (config && typeof config.code_index_enabled !== 'undefined') {
    html += '<div class="list-item-meta">';
    html +=
      '<span>Code index enabled: ' +
      escapeHtml(String(config.code_index_enabled ? 'yes' : 'no')) +
      '</span>';
    html += '</div>';
  }

  if (meta && meta.path) {
    html += '<div class="list-item-meta"><span>Path: ' + escapeHtml(meta.path) + '</span></div>';
  }

  if (meta.workspace && meta.workspace !== 'default') {
    html +=
      '<div class="list-item-meta">' +
      '<button class="pill-button" data-action="delete-workspace" data-workspace="' +
      escapeHtml(meta.workspace) +
      '">Delete workspace</button>' +
      '</div>';
  }

  html += '</div></div>';
  summaryCardBody.innerHTML = html;
}

function renderCodeIndex(data: WorkspaceStatusResponse & { code_index?: any }): void {
  if (!codeIndexCardBody) return;
  const ci = data.code_index || {};
  if (!ci || typeof ci !== 'object') {
    codeIndexCardBody.innerHTML = '<p class="muted">No code index information available.</p>';
    return;
  }

  let html = '<div class="list"><div class="list-item">';
  html += '<div class="list-item-meta">';
  if (typeof ci.enabled !== 'undefined') {
    html += '<span>Enabled: ' + escapeHtml(String(ci.enabled ? 'yes' : 'no')) + '</span>';
  }
  if (ci.status) {
    html += '<span>Status: ' + escapeHtml(String(ci.status)) + '</span>';
  }
  if (ci.files_processed != null && ci.files_total != null) {
    html +=
      '<span>Files: ' +
      escapeHtml(String(ci.files_processed)) +
      ' / ' +
      escapeHtml(String(ci.files_total)) +
      '</span>';
  }
  if (ci.message) {
    html += '<span>' + escapeHtml(String(ci.message)) + '</span>';
  }
  html += '</div>';

  const wsName = getWorkspaceName();
  if (wsName) {
    html +=
      '<div class="list-item-meta">' +
      '<button class="pill-button" data-action="reindex-workspace" data-workspace="' +
      escapeHtml(wsName) +
      '">Rebuild code index</button>' +
      '</div>';
  }

  html +=
    '<div class="code-search">' +
    '<div class="code-search-bar">' +
    '<input id="codeSearchInput" class="code-search-input" type="text" placeholder="Search code (English query, e.g. &quot;HTTP handler&quot;)" />' +
    '<input id="codeSearchPathInput" class="code-search-path" type="text" placeholder="Optional path filter (e.g. src/)" />' +
    '<button class="pill-button" data-action="search-code">Search</button>' +
    '</div>';

  const search = lastSearchState;
  if (search && search.query) {
    html += '<div class="code-search-results">';
    html +=
      '<div class="list-item-meta"><span class="badge">Last search</span><span>' +
      escapeHtml(search.query) +
      (search.path ? ' (in ' + escapeHtml(search.path) + ')' : '') +
      '</span></div>';

    if (search.message && (!search.results || search.results.length === 0)) {
      html += '<div class="muted">' + escapeHtml(search.message) + '</div>';
    }

    if (search.results && search.results.length > 0) {
      for (const r of search.results) {
        const score = typeof r.score === 'number' ? r.score.toFixed(3) : '';
        html += '<div class="code-search-result-item">';
        html += '<div class="code-search-result-header">';
        html +=
          '<div class="code-search-result-path">' +
          escapeHtml(r.file_path || '') +
          '</div>';
        html += '<div class="code-search-result-meta">';
        if (r.start_line != null && r.end_line != null) {
          html +=
            '<span>Lines ' +
            escapeHtml(String(r.start_line)) +
            '-' +
            escapeHtml(String(r.end_line)) +
            '</span>';
        }
        if (score) {
          html += '<span>Score ' + escapeHtml(score) + '</span>';
        }
        html += '</div></div>';
        if (r.code_chunk) {
          const chunk = String(r.code_chunk);
          html +=
            '<div class="code-search-result-snippet">' +
            escapeHtml(chunk.slice(0, 260)) +
            (chunk.length > 260 ? '…' : '') +
            '</div>';
        }
        html += '</div>';
      }
    }

    html += '</div>';
  }

  html += '</div>'; // .code-search

  html += '</div></div>';
  codeIndexCardBody.innerHTML = html;
}

function renderPlan(data: WorkspaceStatusResponse & { tasks?: PlanTask[] }): void {
  if (!planCardBody) return;
  const plan = typeof data.plan === 'string' ? data.plan : '';
  const tasks = Array.isArray(data.tasks) ? data.tasks : [];

  let html = '';

  html += '<div class="plan-section">';
  html += '<div class="list">';
  html += '<div class="list-item">';
  html += '<div class="list-item-meta">';
  html +=
    '<textarea id="planEditorInput" class="plan-editor" rows="4" placeholder="Describe the goal, context, or high-level plan for this workspace...">' +
    escapeHtml(plan) +
    '</textarea>';
  html += '</div>';
  html +=
    '<div class="list-item-meta plan-actions">' +
    '<button class="pill-button" type="button" data-action="save-plan">Save plan</button>' +
    '</div>';
  html += '</div>';
  html += '</div>';
  html += '</div>';

  html += '<div class="task-section">';
  html += '<div class="list">';
  html += '<div class="list-item">';

  if (!tasks || tasks.length === 0) {
    html +=
      '<div class="list-item-meta"><span class="muted">No tasks yet. Add tasks to track progress on this plan.</span></div>';
  } else {
    html += '<div class="task-list">';
    for (let i = 0; i < tasks.length; i++) {
      const t = tasks[i] || ({} as PlanTask);
      const title = t.title || 'Task ' + (i + 1);
      const status = t.status || 'pending';
      html +=
        '<div class="task-item" data-task-index="' +
        String(i) +
        '">' +
        '<span class="task-status-dot task-status-' +
        escapeHtml(status) +
        '"></span>' +
        '<input type="text" class="task-title-input" data-task-index="' +
        String(i) +
        '" value="' +
        escapeHtml(title) +
        '" />' +
        '<select class="task-status-select" data-task-index="' +
        String(i) +
        '">' +
        '<option value="pending"' +
        (status === 'pending' ? ' selected' : '') +
        '>Pending</option>' +
        '<option value="in_progress"' +
        (status === 'in_progress' ? ' selected' : '') +
        '>In progress</option>' +
        '<option value="done"' +
        (status === 'done' ? ' selected' : '') +
        '>Done</option>' +
        '<option value="cancelled"' +
        (status === 'cancelled' ? ' selected' : '') +
        '>Cancelled</option>' +
        '</select>' +
        '<button class="pill-button task-remove-button" type="button" data-action="remove-task" data-task-index="' +
        String(i) +
        '">Remove</button>' +
        '</div>';
    }
    html += '</div>';
  }

  html +=
    '<div class="inline-form task-add-row">' +
    '<input id="newTaskTitle" class="task-title-input-new" type="text" placeholder="New task title" />' +
    '<button class="pill-button" type="button" data-action="add-task">Add task</button>' +
    '</div>';

  html += '</div>'; // .list-item
  html += '</div>'; // .list
  html += '</div>'; // .task-section

  planCardBody.innerHTML = html;
}

function savePlan(): void {
  const input = document.getElementById('planEditorInput') as HTMLTextAreaElement | null;
  if (!input) return;
  const workspaceName = getWorkspaceName();
  const value = input.value || '';
  banner('info', 'Saving plan...');
  postJson('/status/api/update-plan', { name: workspaceName, plan: value })
    .then((res) => {
      if (!res.ok) {
        return res
          .json()
          .catch(() => ({}))
          .then((payload: any) => {
            const msg = (payload && payload.error) || 'Failed to save plan';
            throw new Error(msg);
          });
      }
      return res.json();
    })
    .then((payload: any) => {
      if (lastWorkspaceData && payload) {
        lastWorkspaceData.plan = payload.plan ?? value;
      }
      banner('success', 'Plan saved.');
      refreshWorkspace();
    })
    .catch((err: unknown) => {
      const msg =
        err && typeof err === 'object' && 'message' in err ? String((err as any).message) : undefined;
      banner('error', msg || 'Failed to save plan');
    });
}

function getCurrentTasks(): PlanTask[] {
  if (!lastWorkspaceData || !Array.isArray(lastWorkspaceData.tasks)) return [];
  return lastWorkspaceData.tasks.slice();
}

function addTask(): void {
  const input = document.getElementById('newTaskTitle') as HTMLInputElement | null;
  if (!input) return;
  const title = input.value ? input.value.trim() : '';
  if (!title) {
    banner('error', 'Please enter a task title.');
    return;
  }
  const workspaceName = getWorkspaceName();
  const tasks = getCurrentTasks();
  tasks.push({ title, status: 'pending' });
  banner('info', 'Adding task...');
  postJson('/status/api/update-plan', { name: workspaceName, tasks })
    .then((res) => {
      if (!res.ok) {
        return res
          .json()
          .catch(() => ({}))
          .then((payload: any) => {
            const msg = (payload && payload.error) || 'Failed to add task';
            throw new Error(msg);
          });
      }
      return res.json();
    })
    .then((payload: any) => {
      if (payload && Array.isArray(payload.tasks)) {
        lastWorkspaceData = { ...(lastWorkspaceData as any), tasks: payload.tasks };
      }
      input.value = '';
      banner('success', 'Task added.');
      refreshWorkspace();
    })
    .catch((err: unknown) => {
      const msg =
        err && typeof err === 'object' && 'message' in err ? String((err as any).message) : undefined;
      banner('error', msg || 'Failed to add task');
    });
}

function removeTask(index: number): void {
  const tasks = getCurrentTasks();
  if (index < 0 || index >= tasks.length) return;
  const workspaceName = getWorkspaceName();
  tasks.splice(index, 1);
  banner('info', 'Removing task...');
  postJson('/status/api/update-plan', { name: workspaceName, tasks })
    .then((res) => {
      if (!res.ok) {
        return res
          .json()
          .catch(() => ({}))
          .then((payload: any) => {
            const msg = (payload && payload.error) || 'Failed to remove task';
            throw new Error(msg);
          });
      }
      return res.json();
    })
    .then((payload: any) => {
      if (payload && Array.isArray(payload.tasks)) {
        lastWorkspaceData = { ...(lastWorkspaceData as any), tasks: payload.tasks };
      }
      banner('success', 'Task removed.');
      refreshWorkspace();
    })
    .catch((err: unknown) => {
      const msg =
        err && typeof err === 'object' && 'message' in err ? String((err as any).message) : undefined;
      banner('error', msg || 'Failed to remove task');
    });
}

function updateTaskStatus(index: number, status: PlanTask['status']): void {
  const workspaceName = getWorkspaceName();
  banner('info', 'Updating task status...');
  postJson('/status/api/update-plan', {
    name: workspaceName,
    task_updates: [{ index, status }],
  })
    .then((res) => {
      if (!res.ok) {
        return res
          .json()
          .catch(() => ({}))
          .then((payload: any) => {
            const msg = (payload && payload.error) || 'Failed to update task status';
            throw new Error(msg);
          });
      }
      return res.json();
    })
    .then((payload: any) => {
      if (payload && Array.isArray(payload.tasks)) {
        lastWorkspaceData = { ...(lastWorkspaceData as any), tasks: payload.tasks };
      }
      banner('', '');
      refreshWorkspace();
    })
    .catch((err: unknown) => {
      const msg =
        err && typeof err === 'object' && 'message' in err ? String((err as any).message) : undefined;
      banner('error', msg || 'Failed to update task status');
    });
}

function updateTaskTitle(index: number, title: string): void {
  const tasks = getCurrentTasks();
  if (index < 0 || index >= tasks.length) return;
  const current = tasks[index]!;
  tasks[index] = {
    title,
    status: current.status || 'pending',
  };
  const workspaceName = getWorkspaceName();
  banner('info', 'Updating task...');
  postJson('/status/api/update-plan', { name: workspaceName, tasks })
    .then((res) => {
      if (!res.ok) {
        return res
          .json()
          .catch(() => ({}))
          .then((payload: any) => {
            const msg = (payload && payload.error) || 'Failed to update task';
            throw new Error(msg);
          });
      }
      return res.json();
    })
    .then((payload: any) => {
      if (payload && Array.isArray(payload.tasks)) {
        lastWorkspaceData = { ...(lastWorkspaceData as any), tasks: payload.tasks };
      }
      banner('', '');
      refreshWorkspace();
    })
    .catch((err: unknown) => {
      const msg =
        err && typeof err === 'object' && 'message' in err ? String((err as any).message) : undefined;
      banner('error', msg || 'Failed to update task');
    });
}

function refreshWorkspace(): void {
  banner('info', 'Loading workspace status...');
  fetch(workspaceApiUrl())
    .then((res) => {
      if (!res.ok) {
        throw new Error('Failed to load workspace status: HTTP ' + res.status);
      }
      return res.json() as Promise<WorkspaceStatusResponse>;
    })
    .then((data) => {
      lastWorkspaceData = data as any;
      renderSummary(data);
      renderCodeIndex(data as any);
      renderPlan(data as any);
      banner('', '');
    })
    .catch((err: unknown) => {
      let msg =
        err && typeof err === 'object' && 'message' in err && typeof (err as any).message === 'string'
          ? (err as any).message
          : 'Failed to load workspace status';
      if (String(msg).includes('401') && !getAuthToken()) {
        msg =
          'Open the personal status link from the agent in LibreChat (it contains your access token).';
      }
      banner('error', String(msg));
    });
}

function attachActionHandlers(): void {
  const root = document.body;
  if (!root) return;

  root.addEventListener('click', (e) => {
    const target = e.target as HTMLElement | null;
    if (!target) return;

    const action = target.getAttribute('data-action');
    if (!action) return;

    if (action === 'delete-workspace') {
      const workspace = target.getAttribute('data-workspace');
      if (workspace) {
        if (!window.confirm('Delete workspace "' + workspace + '"? This cannot be undone.')) {
          return;
        }
        banner('info', 'Deleting workspace ' + workspace + '...');
        postJson('/status/api/delete-workspace', { name: workspace })
          .then((res) => {
            if (!res.ok) {
              return res
                .json()
                .catch(() => ({}))
                .then((payload: any) => {
                  const msg = (payload && payload.error) || 'Failed to delete workspace';
                  throw new Error(msg);
                });
            }
            return res.json();
          })
          .then(() => {
            banner('success', 'Workspace deleted.');
            refreshWorkspace();
          })
          .catch((err: unknown) => {
            const msg =
              err && typeof err === 'object' && 'message' in err
                ? String((err as any).message)
                : undefined;
            banner('error', msg || 'Failed to delete workspace');
          });
      }
    } else if (action === 'reindex-workspace') {
      const ws = target.getAttribute('data-workspace');
      if (ws) {
        banner('info', 'Starting code index rebuild for "' + ws + '"...');
        postJson('/status/api/reindex-workspace', { name: ws, force: true })
          .then((res) => {
            if (!res.ok) {
              return res
                .json()
                .catch(() => ({}))
                .then((payload: any) => {
                  const msg =
                    (payload && payload.error) || 'Failed to start code index rebuild';
                  throw new Error(msg);
                });
            }
            return res.json();
          })
          .then(() => {
            banner(
              'success',
              'Code index rebuild started. It may take a while; refresh this page to see updated status.',
            );
            refreshWorkspace();
          })
          .catch((err: unknown) => {
            const msg =
              err && typeof err === 'object' && 'message' in err
                ? String((err as any).message)
                : undefined;
            banner('error', msg || 'Failed to start code index rebuild');
          });
      }
    } else if (action === 'search-code') {
      const input = document.getElementById('codeSearchInput') as HTMLInputElement | null;
      const pathInput = document.getElementById(
        'codeSearchPathInput',
      ) as HTMLInputElement | null;
      const query = input && input.value ? input.value.trim() : '';
      const path = pathInput && pathInput.value ? pathInput.value.trim() : '';
      if (!query) {
        banner('error', 'Please enter a search query.');
        return;
      }
      const workspaceName = getWorkspaceName();
      banner('info', 'Searching code...');
      postJson('/status/api/workspace-search', {
        name: workspaceName,
        query,
        path: path || undefined,
        limit: 10,
      })
        .then((res) => {
          if (!res.ok) {
            return res
              .json()
              .catch(() => ({}))
              .then((payload: any) => {
                const msg = (payload && payload.error) || 'Failed to search code';
                throw new Error(msg);
              });
          }
          return res.json();
        })
        .then((payload: any) => {
          lastSearchState = {
            query,
            path: path || '',
            results: payload && payload.results ? payload.results : [],
            message: payload && payload.message ? payload.message : '',
          };
          if (lastWorkspaceData) {
            renderCodeIndex(lastWorkspaceData as any);
          } else {
            refreshWorkspace();
          }
          banner('', '');
        })
        .catch((err: unknown) => {
          const msg =
            err && typeof err === 'object' && 'message' in err
              ? String((err as any).message)
              : undefined;
          banner('error', msg || 'Failed to search code');
        });
    } else if (action === 'save-plan') {
      savePlan();
    } else if (action === 'add-task') {
      addTask();
    } else if (action === 'remove-task') {
      const idxStr = target.getAttribute('data-task-index');
      const idx = idxStr ? parseInt(idxStr, 10) : -1;
      if (!Number.isNaN(idx) && idx >= 0) {
        removeTask(idx);
      }
    }
  });

  root.addEventListener('change', (e) => {
    const target = e.target as HTMLSelectElement | null;
    if (!target) return;
    if (!(target instanceof HTMLSelectElement)) return;
    if (!target.classList.contains('task-status-select')) return;
    const idxStr = target.getAttribute('data-task-index');
    const idx = idxStr ? parseInt(idxStr, 10) : -1;
    const value = target.value as PlanTask['status'];
    if (!Number.isNaN(idx) && idx >= 0 && value) {
      updateTaskStatus(idx, value);
    }
  });

  root.addEventListener(
    'blur',
    (e) => {
      const target = e.target as HTMLInputElement | null;
      if (!target) return;
      if (!target.classList.contains('task-title-input')) return;
      const idxStr = target.getAttribute('data-task-index');
      const idx = idxStr ? parseInt(idxStr, 10) : -1;
      const value = target.value ? target.value.trim() : '';
      if (!Number.isNaN(idx) && idx >= 0 && value) {
        updateTaskTitle(idx, value);
      }
    },
    true,
  );
}

attachActionHandlers();
refreshWorkspace();

