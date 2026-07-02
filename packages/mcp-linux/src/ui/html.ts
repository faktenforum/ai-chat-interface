/**
 * Framework-free HTML building blocks for MCP-UI resources and standalone pages.
 *
 * Embedded resources render inside a sandboxed iframe (allow-scripts, no
 * allow-same-origin). The renderer injects nothing, so pages must size themselves
 * by posting `ui-size-change` (RESIZE_JS). Buttons drive the assistant by posting
 * `tool`/`prompt` actions (ACTIONS_JS); LibreChat turns each into a new chat turn.
 * External assets are blocked by the sandbox, so all CSS/JS is inline.
 */

/** MCP embedded-resource content item for a tool result. */
export interface UiResourceContent {
  type: 'resource';
  resource: { uri: string; mimeType: 'text/html'; text: string };
}

/** Escapes a value for safe interpolation into HTML text or attributes. */
export function esc(value: unknown): string {
  return String(value).replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string,
  );
}

const BASE_CSS = `
:root{color-scheme:light dark;--bg:#fff;--fg:#1f2937;--muted:#6b7280;--border:#e5e7eb;--card:#f9fafb;--accent:#2563eb;--danger:#dc2626;--danger-fg:#fff;--badge:#e5e7eb;--badge-fg:#374151;}
@media (prefers-color-scheme:dark){:root{--bg:#0b0f14;--fg:#e5e7eb;--muted:#9ca3af;--border:#1f2937;--card:#111827;--accent:#3b82f6;--danger:#ef4444;--badge:#1f2937;--badge-fg:#d1d5db;}}
*{box-sizing:border-box}
body{margin:0;padding:14px;font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;font-size:14px;line-height:1.45;background:var(--bg);color:var(--fg);}
h1{font-size:1.05rem;margin:0 0 .75rem;}
h2{font-size:.8rem;text-transform:uppercase;letter-spacing:.05em;color:var(--muted);margin:1.1rem 0 .35rem;}
p{margin:.4rem 0;}
.card{background:var(--card);border:1px solid var(--border);border-radius:10px;padding:.85rem 1rem;}
.row{display:flex;flex-wrap:wrap;gap:.4rem;align-items:center;}
.between{display:flex;align-items:center;justify-content:space-between;gap:.5rem;}
table{width:100%;border-collapse:collapse;}
th,td{text-align:left;padding:.4rem .5rem;border-bottom:1px solid var(--border);vertical-align:top;}
th{font-weight:600;color:var(--muted);font-size:.78rem;text-transform:uppercase;letter-spacing:.03em;}
.badge{display:inline-block;background:var(--badge);color:var(--badge-fg);border-radius:999px;padding:.1rem .5rem;font-size:.75rem;}
.muted{color:var(--muted);}
code{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:.82em;word-break:break-all;}
.btn{font:inherit;cursor:pointer;border:1px solid var(--border);background:transparent;color:var(--fg);border-radius:7px;padding:.3rem .6rem;}
.btn:hover{border-color:var(--accent);}
.btn.primary{background:var(--accent);border-color:var(--accent);color:#fff;}
.btn.danger{color:var(--danger-fg);background:var(--danger);border-color:var(--danger);}
.btn:disabled{opacity:.5;cursor:default;}
footer{margin-top:1.2rem;font-size:.78rem;color:var(--muted);}
`;

const RESIZE_JS = `
(function(){
  function post(){
    var b=document.body?document.body.scrollHeight:0;
    var h=Math.max(document.documentElement.scrollHeight,b);
    window.parent.postMessage({type:'ui-size-change',payload:{width:document.documentElement.scrollWidth,height:h}},'*');
  }
  if(window.ResizeObserver){var ro=new ResizeObserver(post);ro.observe(document.documentElement);if(document.body)ro.observe(document.body);}
  window.addEventListener('load',post);window.addEventListener('resize',post);setTimeout(post,60);post();
})();`;

const ACTIONS_JS = `
function uiTool(name,params,confirmMsg){
  if(confirmMsg&&!window.confirm(confirmMsg))return;
  window.parent.postMessage({type:'tool',payload:{toolName:name,params:params||{}}},'*');
}
function uiPrompt(text){window.parent.postMessage({type:'prompt',payload:{prompt:text}},'*');}`;

/** Wraps body HTML into a self-contained document with inline CSS and the resize/action scripts. */
export function layout(opts: {
  title: string;
  body: string;
  actions?: boolean;
  extraCss?: string;
  extraJs?: string;
}): string {
  const js = RESIZE_JS + (opts.actions ? ACTIONS_JS : '') + (opts.extraJs ?? '');
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(opts.title)}</title>
<style>${BASE_CSS}${opts.extraCss ?? ''}</style>
</head>
<body>
${opts.body}
<script>${js}</script>
</body>
</html>`;
}

/** Builds an MCP embedded-resource content item from a ui:// uri and HTML string. */
export function uiResource(uri: string, html: string): UiResourceContent {
  return { type: 'resource', resource: { uri, mimeType: 'text/html', text: html } };
}

/**
 * Renders a button that asks the assistant to run an MCP tool. The whole onclick
 * expression is JSON-encoded then attribute-escaped, so tool names, params, and
 * the confirm message are safe regardless of their content.
 */
export function toolButton(opts: {
  label: string;
  tool: string;
  params: Record<string, unknown>;
  confirm?: string;
  className?: string;
}): string {
  const call = `uiTool(${JSON.stringify(opts.tool)},${JSON.stringify(opts.params)},${
    opts.confirm ? JSON.stringify(opts.confirm) : 'null'
  })`;
  return `<button class="btn ${opts.className ?? ''}" onclick="${esc(call)}">${esc(opts.label)}</button>`;
}
