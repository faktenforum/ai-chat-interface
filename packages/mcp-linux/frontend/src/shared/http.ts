export function getAuthToken(): string {
  const params = new URLSearchParams(window.location.search || '');
  return params.get('token') || '';
}

export function formatBytes(bytes: number | null | undefined): string {
  if (bytes == null || Number.isNaN(bytes)) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function postJson<TResponse = unknown>(
  url: string,
  body: Record<string, unknown>,
): Promise<Response> {
  const auth = getAuthToken();
  const payload = auth ? { ...body, auth_token: auth } : body;
  return fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
}

export function buildApiUrl(path: string): string {
  const auth = getAuthToken();
  const base = '/status/api/';
  const cleanPath = path.startsWith('/') ? path.slice(1) : path;
  const url = base + cleanPath;
  return auth ? `${url}?token=${encodeURIComponent(auth)}` : url;
}

