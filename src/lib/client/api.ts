'use client';
/** Browser fetch helper: attaches the CSRF double-submit token and parses JSON errors. */
export function csrfToken() {
  return document.cookie.split('; ').find((c) => c.startsWith('fc_csrf='))?.split('=')[1] ?? '';
}
export async function apiCall<T = unknown>(url: string, opts: { method?: string; body?: unknown; form?: FormData } = {}): Promise<T> {
  const res = await fetch(url, {
    method: opts.method ?? (opts.body || opts.form ? 'POST' : 'GET'),
    headers: { 'x-csrf-token': csrfToken(), ...(opts.body ? { 'Content-Type': 'application/json' } : {}) },
    body: opts.form ?? (opts.body ? JSON.stringify(opts.body) : undefined),
    credentials: 'same-origin',
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as { message?: string; error?: string }).message ?? (data as { error?: string }).error ?? `HTTP ${res.status}`);
  return data as T;
}
