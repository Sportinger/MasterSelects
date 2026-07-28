import type {
  KernelCompileRequest,
  KernelCompileResponse,
  KernelHealthResponse,
  KernelManifestsResponse,
  KernelRequestOptions,
  KernelRunCompleteRequest,
  KernelRunCompleteResponse,
  KernelRunRequest,
  KernelRunResponse,
  KernelRunStatusResponse,
  KernelServiceClientOptions,
  KernelServiceFailure,
  KernelServiceResult,
  KernelValidateRequest,
  KernelValidateResponse,
} from './types';

export type {
  KernelCompileAbortReason,
  KernelCompileCompiledResponse,
  KernelCompileRequest,
  KernelCompileResponse,
  KernelCompileSetup,
  KernelCompileStoppedResponse,
  KernelFingerprintAssert,
  KernelHealthResponse,
  KernelManifestsResponse,
  KernelRequestOptions,
  KernelResolvedCall,
  KernelRunCompleteRequest,
  KernelRunCompleteResponse,
  KernelRunRequest,
  KernelRunResponse,
  KernelRunStatusResponse,
  KernelServiceClientOptions,
  KernelServiceFailure,
  KernelServiceResult,
  KernelServiceSuccess,
  KernelSilenceRange,
  KernelTranscriptMoment,
  KernelValidateRequest,
  KernelValidateResponse,
} from './types';

const DEFAULT_BASE_URL = 'http://127.0.0.1:8787';
const DEFAULT_TIMEOUT_MS = 30_000;
// Story compiles include provider planning rounds plus the director run.
const COMPILE_TIMEOUT_MS = 180_000;
const AVAILABILITY_TIMEOUT_MS = 2_000;

function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.replace(/\/+$/, '');
}

function errorMessage(error: unknown): string {
  if (error instanceof Error && error.message) {
    return error.message;
  }

  return 'Kernel service request failed.';
}

function responseError(payload: unknown, status: number): string {
  if (payload && typeof payload === 'object') {
    const error = (payload as { error?: unknown }).error;
    if (typeof error === 'string' && error.trim()) {
      return error;
    }

    if (error && typeof error === 'object') {
      const nestedMessage = (error as { message?: unknown }).message;
      if (typeof nestedMessage === 'string' && nestedMessage.trim()) {
        return nestedMessage;
      }
    }

    const message = (payload as { message?: unknown }).message;
    if (typeof message === 'string' && message.trim()) {
      return message;
    }
  }

  return `Kernel service request failed with status ${status}.`;
}

async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return {};
  }
}

export class KernelServiceClient {
  private readonly authToken: string;
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;

  constructor({
    authToken,
    baseUrl = DEFAULT_BASE_URL,
    fetchImpl,
    timeoutMs = DEFAULT_TIMEOUT_MS,
  }: KernelServiceClientOptions) {
    this.authToken = authToken;
    this.baseUrl = normalizeBaseUrl(baseUrl);
    this.fetchImpl = fetchImpl ?? globalThis.fetch.bind(globalThis);
    this.timeoutMs = timeoutMs;
  }

  health(options?: KernelRequestOptions): Promise<KernelServiceResult<KernelHealthResponse>> {
    return this.request('/kernel/health', false, { method: 'GET' }, options);
  }

  run(
    input: KernelRunRequest,
    options?: KernelRequestOptions,
  ): Promise<KernelServiceResult<KernelRunResponse>> {
    return this.request('/kernel/run', true, {
      method: 'POST',
      body: JSON.stringify(input),
    }, options);
  }

  compile(
    input: KernelCompileRequest,
    options?: KernelRequestOptions,
  ): Promise<KernelServiceResult<KernelCompileResponse>> {
    return this.request('/kernel/compile', true, {
      method: 'POST',
      body: JSON.stringify({ ...input }),
    }, { timeoutMs: COMPILE_TIMEOUT_MS, ...options });
  }

  completeRun(
    id: string,
    input: KernelRunCompleteRequest,
    options?: KernelRequestOptions,
  ): Promise<KernelServiceResult<KernelRunCompleteResponse>> {
    return this.request(`/kernel/runs/${encodeURIComponent(id)}/complete`, true, {
      method: 'POST',
      body: JSON.stringify(input),
    }, options);
  }

  validate(
    input: KernelValidateRequest,
    options?: KernelRequestOptions,
  ): Promise<KernelServiceResult<KernelValidateResponse>> {
    return this.request('/kernel/validate', true, {
      method: 'POST',
      body: JSON.stringify(input),
    }, options);
  }

  manifests(options?: KernelRequestOptions): Promise<KernelServiceResult<KernelManifestsResponse>> {
    return this.request('/kernel/manifests', true, { method: 'GET' }, options);
  }

  getRun(
    id: string,
    options?: KernelRequestOptions,
  ): Promise<KernelServiceResult<KernelRunStatusResponse>> {
    return this.request(`/kernel/runs/${encodeURIComponent(id)}`, true, { method: 'GET' }, options);
  }

  private async request<T>(
    path: string,
    authenticated: boolean,
    init: RequestInit,
    options?: KernelRequestOptions,
  ): Promise<KernelServiceResult<T>> {
    const timeoutMs = options?.timeoutMs ?? this.timeoutMs;
    const controller = new AbortController();
    const timeoutHandle = timeoutMs > 0
      ? setTimeout(() => controller.abort(), timeoutMs)
      : undefined;
    const headers: Record<string, string> = {
      Accept: 'application/json',
    };

    if (init.body !== undefined) {
      headers['Content-Type'] = 'application/json';
    }
    if (authenticated) {
      headers.Authorization = `Bearer ${this.authToken}`;
    }

    try {
      const response = await this.fetchImpl(`${this.baseUrl}${path}`, {
        ...init,
        headers,
        signal: controller.signal,
      });
      const payload = await readJson(response);

      if (!response.ok) {
        return {
          ok: false,
          status: response.status,
          error: responseError(payload, response.status),
        };
      }

      return {
        ok: true,
        status: response.status,
        data: payload as T,
      };
    } catch (error) {
      const failure: KernelServiceFailure = {
        ok: false,
        status: 0,
        error: controller.signal.aborted && timeoutMs > 0
          ? `Kernel service request timed out after ${timeoutMs}ms.`
          : errorMessage(error),
      };
      return failure;
    } finally {
      if (timeoutHandle !== undefined) {
        clearTimeout(timeoutHandle);
      }
    }
  }
}

export async function isKernelServiceAvailable(client: KernelServiceClient): Promise<boolean> {
  const result = await client.health({ timeoutMs: AVAILABILITY_TIMEOUT_MS });
  return result.ok;
}
