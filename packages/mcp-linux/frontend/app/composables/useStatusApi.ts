/**
 * Fetch wrapper for all /status/api/* routes.
 * Automatically appends the auth token from the URL to every request.
 */
export function useStatusApi() {
  const { token } = useAuthToken();
  const config = useRuntimeConfig();
  const baseUrl = config.public.apiBase as string;

  async function apiFetch<T>(path: string, options?: RequestInit): Promise<T> {
    const url = new URL(`${baseUrl}${path}`, window.location.origin);
    if (token.value) url.searchParams.set('token', token.value);

    const res = await fetch(url.toString(), {
      headers: { 'Content-Type': 'application/json' },
      ...options,
    });

    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error((body as { error?: string })?.error ?? `Request failed: ${res.status}`);
    }

    return res.json() as Promise<T>;
  }

  async function postJson<T>(path: string, body: Record<string, unknown>): Promise<T> {
    const payload = token.value ? { ...body, auth_token: token.value } : body;
    return apiFetch<T>(path, {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  }

  return { apiFetch, postJson, token };
}
