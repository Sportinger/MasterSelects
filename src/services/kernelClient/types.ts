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

export interface KernelResolvedCall {
  stepId: string;
  tool: string;
  args: Record<string, unknown>;
}

export interface KernelCompileRequest {
  request: string;
  snapshot: unknown;
  seed?: string;
}

export interface KernelCompileCompiledResponse {
  runId: string;
  status: 'compiled';
  taskContract: unknown;
  plan: unknown;
  resolvedCalls: KernelResolvedCall[];
  /** Source-ordered simulated segment ids for runtime id mapping. */
  segments?: { simulatedVideoClipIds: string[] };
  expectedFingerprint: unknown;
  summary: unknown;
}

export interface KernelCompileStoppedResponse {
  runId: string;
  status: 'aborted' | 'failed';
  failures: unknown;
}

export type KernelCompileResponse =
  | KernelCompileCompiledResponse
  | KernelCompileStoppedResponse;

export interface KernelRunCompleteRequest {
  finalSnapshot: unknown;
}

export interface KernelFingerprintAssert {
  committed?: string;
  matches: boolean;
  simulated?: string;
  [key: string]: unknown;
}

export interface KernelRunCompleteResponse {
  status: 'succeeded' | 'failed';
  fingerprintAssert: KernelFingerprintAssert;
  verificationReport: unknown;
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
