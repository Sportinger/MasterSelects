export interface KernelHealthResponse {
  [key: string]: unknown;
}

export interface KernelRunRequest {
  request: unknown;
  seed?: number;
}

export interface KernelRunResponse {
  [key: string]: unknown;
}

export interface KernelValidateRequest {
  request: unknown;
  seed?: number;
  snapshot: unknown;
}

export interface KernelValidateResponse {
  [key: string]: unknown;
}

export interface KernelManifestsResponse {
  [key: string]: unknown;
}

export interface KernelRunStatusResponse {
  [key: string]: unknown;
}

export interface KernelServiceSuccess<T> {
  ok: true;
  status: number;
  data: T;
}

export interface KernelServiceFailure {
  ok: false;
  status: number;
  error: string;
}

export type KernelServiceResult<T> = KernelServiceSuccess<T> | KernelServiceFailure;

export interface KernelRequestOptions {
  timeoutMs?: number;
}

export interface KernelServiceClientOptions {
  authToken: string;
  baseUrl?: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}
