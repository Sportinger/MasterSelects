const BYOK_BODY_FIELD_NAMES = new Set([
  'accesskey',
  'apikey',
  'hftoken',
  'secretkey',
]);

const BYOK_PROVIDER_KEY_HEADERS = new Set([
  'anthropic-api-key',
  'api-key',
  'provider-api-key',
  'provider-key',
  'x-access-key',
  'x-api-key',
  'x-evolink-api-key',
  'x-hf-token',
  'x-provider-api-key',
  'x-provider-key',
  'x-secret-key',
  'xi-api-key',
]);

export const BYOK_DISABLED_PAYLOAD = Object.freeze({
  error: 'byok_disabled',
  message:
    'User-supplied AI provider credentials are disabled. Use the authenticated hosted AI service.',
});

function normalizedBodyFieldName(name: string): string {
  return name.toLowerCase().replace(/[-_]/g, '');
}

export function hasByokProviderKeyHeader(headers: Headers): boolean {
  for (const name of BYOK_PROVIDER_KEY_HEADERS) {
    if (headers.has(name)) {
      return true;
    }
  }
  return false;
}

/**
 * Finds credential-bearing JSON fields without treating ordinary values or
 * similarly named metadata (for example apiKeys or accessKeyId) as secrets.
 */
export function hasByokCredentialField(value: unknown): boolean {
  if (typeof value !== 'object' || value === null) {
    return false;
  }

  const pending: object[] = [value];
  const visited = new WeakSet<object>();

  while (pending.length > 0) {
    const current = pending.pop()!;
    if (visited.has(current)) {
      continue;
    }
    visited.add(current);

    if (Array.isArray(current)) {
      for (const item of current) {
        if (typeof item === 'object' && item !== null) {
          pending.push(item);
        }
      }
      continue;
    }

    for (const [name, nested] of Object.entries(current)) {
      if (BYOK_BODY_FIELD_NAMES.has(normalizedBodyFieldName(name))) {
        return true;
      }
      if (typeof nested === 'object' && nested !== null) {
        pending.push(nested);
      }
    }
  }

  return false;
}

export function byokDisabledResponse(status = 400): Response {
  return new Response(JSON.stringify(BYOK_DISABLED_PAYLOAD, null, 2), {
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
    status,
  });
}

export function rejectByokCredentials(input: {
  headers?: Headers;
  payload?: unknown;
  status?: number;
}): Response | null {
  if (
    (input.headers && hasByokProviderKeyHeader(input.headers))
    || (input.payload !== undefined && hasByokCredentialField(input.payload))
  ) {
    return byokDisabledResponse(input.status);
  }
  return null;
}
