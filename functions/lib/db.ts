import type { AppContext, AppUser } from './env';

interface JsonOptions extends ResponseInit {
  headers?: HeadersInit;
}

export function json(data: unknown, init: JsonOptions = {}): Response {
  const headers = new Headers(init.headers);
  headers.set('Content-Type', 'application/json; charset=utf-8');

  return new Response(JSON.stringify(data, null, 2), {
    ...init,
    headers,
  });
}

export function methodNotAllowed(allowed: string[]): Response {
  return json(
    { allowed, error: 'method_not_allowed' },
    {
      headers: { Allow: allowed.join(', ') },
      status: 405,
    },
  );
}

export function hasTrustedOrigin(request: Request): boolean {
  const origin = request.headers.get('Origin');
  if (!origin) {
    return true;
  }

  try {
    return new URL(origin).origin === new URL(request.url).origin;
  } catch {
    return false;
  }
}

export function notImplemented(feature: string): Response {
  return json(
    {
      error: 'not_implemented',
      feature,
      message: 'This route is part of the hosted AI and billing foundation and is not implemented yet.',
    },
    { status: 501 },
  );
}

export async function parseJson<T>(request: Request): Promise<T | null> {
  const contentType = request.headers.get('Content-Type') ?? '';
  if (!contentType.includes('application/json')) {
    return null;
  }

  try {
    return (await request.json()) as T;
  } catch {
    return null;
  }
}

export function buildRequestId(request: Request): string {
  return request.headers.get('cf-ray') ?? crypto.randomUUID();
}

export function getCurrentUser(context: AppContext): AppUser | null {
  return context.data.user ?? null;
}
