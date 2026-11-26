export class ApiError extends Error {
  status: number;
  data: Record<string, unknown>;

  constructor(message: string, status: number, data: Record<string, unknown> = {}) {
    super(message);
    this.status = status;
    this.data = data;
  }
}

export async function apiFetch<T>(
  path: string,
  options: RequestInit = {}
): Promise<T> {
  const headers = new Headers(options.headers);
  headers.set('X-Requested-With', 'XMLHttpRequest');
  if (options.body && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }

  let res: Response;
  try {
    res = await fetch(path, {
      ...options,
      credentials: 'include',
      headers,
    });
  } catch {
    throw new ApiError(
      'Unable to reach the server. It may be waking up — please retry in a moment.',
      0
    );
  }

  const contentType = res.headers.get('content-type') || '';
  const data = contentType.includes('application/json')
    ? ((await res.json().catch(() => ({}))) as Record<string, unknown>)
    : {};

  if (!res.ok) {
    const msg =
      typeof data.error === 'string' && data.error
        ? data.error
        : res.status === 502 || res.status === 503 || res.status === 504
        ? 'Server is starting up. Retrying shortly...'
        : `Request failed (${res.status})`;
    throw new ApiError(msg, res.status, data);
  }

  return data as T;
}
