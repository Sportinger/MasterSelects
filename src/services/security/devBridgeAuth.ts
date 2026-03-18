// Dev Bridge Authentication Helpers
// Used by vite.config.ts to validate bridge requests and by the browser app
// to attach the dev bridge token on in-app requests.

declare const __DEV_BRIDGE_TOKEN__: string | undefined;

/**
 * Check if an origin header represents a localhost origin.
 */
export function isLocalhostOrigin(origin: string): boolean {
  try {
    const url = new URL(origin);
    return url.hostname === 'localhost' || url.hostname === '127.0.0.1';
  } catch {
    return false;
  }
}

export function getDevBridgeToken(): string {
  return typeof __DEV_BRIDGE_TOKEN__ === 'string' ? __DEV_BRIDGE_TOKEN__ : '';
}

export function hasDevBridgeToken(): boolean {
  return getDevBridgeToken().length > 0;
}

export function withDevBridgeAuthHeaders(headers?: HeadersInit): Headers {
  const nextHeaders = new Headers(headers);
  const token = getDevBridgeToken();
  if (token) {
    nextHeaders.set('Authorization', `Bearer ${token}`);
  }
  return nextHeaders;
}

export async function fetchWithDevBridgeAuth(
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<Response> {
  return fetch(input, {
    ...init,
    headers: withDevBridgeAuthHeaders(init?.headers),
  });
}
