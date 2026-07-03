import { APP_VERSION } from '../../version';
import type { ApiErrorResponse } from './apiContracts';

interface ApiErrorShape {
  code?: string;
  message?: string;
}

const HOSTED_CLOUD_API_ROUTES = [
  '/api/me',
  '/api/auth',
  '/api/billing',
  '/api/credits',
  '/api/stripe',
  '/api/ai/chat',
  '/api/ai/audio',
  '/api/ai/video',
];

function isLocalViteOrigin(): boolean {
  if (typeof window === 'undefined') {
    return false;
  }

  const { hostname, port } = window.location;
  return (hostname === 'localhost' || hostname === '127.0.0.1') && port === '5173';
}

function isHostedCloudApiRoute(path: string): boolean {
  return HOSTED_CLOUD_API_ROUTES.some((route) => (
    path === route
    || path.startsWith(`${route}/`)
    || path.startsWith(`${route}?`)
  ));
}

function isHtmlPayload(response: Response, text: string): boolean {
  const contentType = response.headers.get('Content-Type') ?? response.headers.get('content-type') ?? '';
  const trimmed = text.trimStart().toLowerCase();

  return contentType.includes('text/html')
    || trimmed.startsWith('<!doctype html')
    || trimmed.startsWith('<html');
}

function isLocalHostedApiMisconfigured(path: string, response: Response, text: string): boolean {
  if (!isLocalViteOrigin() || !isHostedCloudApiRoute(path)) {
    return false;
  }

  return response.status === 404 || isHtmlPayload(response, text);
}

function getLocalHostedApiError(path: string): Error {
  return new Error(
    `Hosted API route ${path} is not available on the Vite dev server. Start the backend with "npm run dev:api" or run both with "npm run dev:full".`,
  );
}

function isFetchNetworkError(error: unknown): boolean {
  return error instanceof TypeError && /failed to fetch|networkerror|load failed/i.test(error.message);
}

function getHostedApiNetworkError(path: string): Error {
  return new Error(
    `Network error while contacting MasterSelects Cloud (${path}). Check the connection and try again.`,
  );
}

function getApiErrorMessage(error: ApiErrorResponse, status: number): string {
  if (typeof error.message === 'string' && error.message.trim().length > 0) {
    return error.message;
  }

  if (typeof error.error === 'string' && error.error.trim().length > 0) {
    return error.error;
  }

  const nestedError = error.error as ApiErrorShape | undefined;
  if (nestedError && typeof nestedError.message === 'string' && nestedError.message.trim().length > 0) {
    return nestedError.message;
  }

  return `Request failed with status ${status}`;
}

export async function requestResponse(path: string, init: RequestInit = {}): Promise<Response> {
  let response: Response;

  try {
    response = await fetch(path, {
      credentials: 'include',
      ...init,
      headers: {
        'X-App-Version': APP_VERSION,
        ...(init.headers ?? {}),
      },
    });
  } catch (error) {
    if (isLocalViteOrigin() && isHostedCloudApiRoute(path)) {
      throw getLocalHostedApiError(path);
    }

    if (isHostedCloudApiRoute(path) && isFetchNetworkError(error)) {
      throw getHostedApiNetworkError(path);
    }

    throw error;
  }

  if (isLocalViteOrigin() && isHostedCloudApiRoute(path)) {
    const text = await response.clone().text().catch(() => '');
    if (isLocalHostedApiMisconfigured(path, response, text)) {
      throw getLocalHostedApiError(path);
    }
  }

  return response;
}

export interface ApiRequestInit extends RequestInit {
  timeoutMs?: number;
}

const DEFAULT_JSON_REQUEST_TIMEOUT_MS = 10_000;
export const AI_CHAT_REQUEST_TIMEOUT_MS = 90_000;

function createRequestController(signal?: AbortSignal | null, timeoutMs?: number): {
  cleanup: () => void;
  didTimeout: () => boolean;
  signal: AbortSignal | undefined;
} {
  if (!signal && (!timeoutMs || timeoutMs <= 0)) {
    return {
      cleanup: () => undefined,
      didTimeout: () => false,
      signal: undefined,
    };
  }

  const controller = new AbortController();
  let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
  let timedOut = false;
  const abortFromParent = () => controller.abort(signal?.reason);

  if (signal) {
    if (signal.aborted) {
      controller.abort(signal.reason);
    } else {
      signal.addEventListener('abort', abortFromParent, { once: true });
    }
  }

  if (timeoutMs && timeoutMs > 0) {
    timeoutHandle = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, timeoutMs);
  }

  return {
    cleanup: () => {
      if (timeoutHandle) {
        clearTimeout(timeoutHandle);
      }
      if (signal) {
        signal.removeEventListener('abort', abortFromParent);
      }
    },
    didTimeout: () => timedOut,
    signal: controller.signal,
  };
}

function getApiTimeoutError(path: string, timeoutMs: number): Error {
  if (isLocalViteOrigin() && isHostedCloudApiRoute(path)) {
    return new Error(
      `Hosted API route ${path} did not respond within ${Math.round(timeoutMs / 1000)}s. Check that "npm run dev:api" is healthy and restart the local backend if needed.`,
    );
  }

  return new Error(`Request to ${path} timed out after ${timeoutMs}ms.`);
}

export async function requestJson<T>(path: string, init: ApiRequestInit = {}): Promise<T> {
  const { timeoutMs = DEFAULT_JSON_REQUEST_TIMEOUT_MS, ...requestInit } = init;
  const requestController = createRequestController(requestInit.signal, timeoutMs);
  let response: Response;

  try {
    response = await fetch(path, {
      credentials: 'include',
      ...requestInit,
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        'X-App-Version': APP_VERSION,
        ...(requestInit.headers ?? {}),
      },
      signal: requestController.signal,
    });
  } catch (error) {
    requestController.cleanup();

    if (requestController.didTimeout()) {
      throw getApiTimeoutError(path, timeoutMs);
    }

    if (isLocalViteOrigin() && isHostedCloudApiRoute(path)) {
      throw getLocalHostedApiError(path);
    }

    if (isHostedCloudApiRoute(path) && isFetchNetworkError(error)) {
      throw getHostedApiNetworkError(path);
    }

    throw error;
  }

  requestController.cleanup();
  const text = await response.text();

  if (isLocalHostedApiMisconfigured(path, response, text)) {
    throw getLocalHostedApiError(path);
  }

  let data: T;

  try {
    data = text ? (JSON.parse(text) as T) : ({} as T);
  } catch (error) {
    if (isLocalViteOrigin() && isHostedCloudApiRoute(path)) {
      throw getLocalHostedApiError(path);
    }

    throw error;
  }

  if (!response.ok) {
    const error = data as T & ApiErrorResponse;
    throw new Error(getApiErrorMessage(error, response.status));
  }

  return data;
}

export async function requestBinary(path: string, init: RequestInit = {}): Promise<{ blob: Blob; response: Response }> {
  const response = await requestResponse(path, {
    ...init,
    headers: {
      Accept: 'audio/mpeg',
      ...(init.headers ?? {}),
    },
  });

  if (!response.ok) {
    const text = await response.text();
    let message = `Request failed with status ${response.status}`;

    if (text.trim()) {
      try {
        message = getApiErrorMessage(JSON.parse(text) as ApiErrorResponse, response.status);
      } catch {
        message = text.trim();
      }
    }

    throw new Error(message);
  }

  return {
    blob: await response.blob(),
    response,
  };
}
