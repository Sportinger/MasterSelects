export type AuthProvider = 'google' | 'magic_link';
export type BillingPlanId = 'free' | 'starter' | 'pro' | 'studio';

export interface ApiErrorResponse {
  error?: string;
  message?: string;
  [key: string]: unknown;
}

interface ApiErrorShape {
  code?: string;
  message?: string;
}

export interface CloudSessionUser {
  email: string;
  id: string;
}

export interface CloudMeResponse {
  billing?: {
    klingGenerationEnabled: boolean;
    label: string;
    monthlyCredits: number;
  };
  creditBalance: number;
  entitlements: Record<string, string>;
  hostedAIEnabled: boolean;
  plan: BillingPlanId | string;
  session: {
    authenticated: boolean;
    expiresAt?: string;
    provider?: AuthProvider | string;
  };
  user: CloudSessionUser | null;
}

export interface BillingSummaryResponse {
  creditBalance: number;
  entitlements: Record<string, string>;
  hostedAIEnabled: boolean;
  plan: {
    id: BillingPlanId | string;
    label: string;
    monthlyCredits: number;
  };
  recentCredits: Array<{
    amount: number;
    balance_after: number;
    created_at: string;
    description: string | null;
    entry_type: string;
    id: string;
    source: string;
  }>;
  stripeCustomerId: string | null;
  subscription: null | {
    cancelAtPeriodEnd: boolean;
    currentPeriodEnd: string | null;
    currentPeriodStart: string | null;
    id: string;
    planId: BillingPlanId | string;
    status: string;
    stripeSubscriptionId: string;
    updatedAt: string;
  };
  usage: {
    byFeature: Array<{
      completedCount: number;
      creditCost: number;
      feature: string;
      failedCount: number;
      pendingCount: number;
    }>;
    completedCount: number;
    creditCost: number;
    failedCount: number;
    pendingCount: number;
    since: string;
  };
  user: CloudSessionUser & {
    avatarUrl: string | null;
    displayName: string;
  } | null;
}

export interface CheckoutResponse {
  checkoutUrl: string | null;
  id: string;
  planId: BillingPlanId | string;
  priceId: string;
}

export interface PortalResponse {
  id: string;
  portalUrl: string;
}

export interface CloudAiGatewayError {
  code: string;
  details?: Record<string, unknown> | null;
  message: string;
}

export type CloudAiGatewayKind = 'ai.chat' | 'ai.video';
export type CloudAiGatewayMode = 'byo' | 'hosted';
export type CloudAiGatewayStatus =
  | 'accepted'
  | 'byo_required'
  | 'completed'
  | 'error'
  | 'processing'
  | 'queued'
  | 'ready'
  | 'requires_auth'
  | 'requires_billing'
  | 'unsupported';

export interface CloudAiGatewayEnvelope<TData = unknown> {
  byoRequired?: boolean;
  capability?: Record<string, unknown>;
  creditBalance?: number | null;
  creditsCharged?: number | null;
  data?: TData | null;
  error?: CloudAiGatewayError | null;
  kind: CloudAiGatewayKind;
  mode: CloudAiGatewayMode;
  next?: 'auth' | 'poll' | 'pricing' | 'upgrade';
  ok: boolean;
  provider: string;
  requestId: string | null;
  session?: {
    authenticated: boolean;
    email?: string | null;
    provider?: string | null;
  } | null;
  status: CloudAiGatewayStatus;
  streaming?: boolean;
}

export interface CloudAiChatMessage {
  content: unknown;
  name?: string;
  role: 'assistant' | 'developer' | 'system' | 'tool' | 'user';
  tool_call_id?: string;
}

export interface CloudAiChatRequest {
  max_completion_tokens?: number;
  idempotencyKey?: string;
  max_tokens?: number;
  messages: CloudAiChatMessage[];
  model?: string;
  response_format?: Record<string, unknown>;
  stream?: boolean;
  tool_choice?: unknown;
  tools?: unknown;
  temperature?: number;
  top_p?: number;
}

export interface CloudAiVideoRequest {
  action?: 'generate' | 'status';
  idempotencyKey?: string;
  params?: {
    aspectRatio?: string;
    duration?: number;
    endImageUrl?: string;
    mode?: 'pro' | 'std';
    prompt?: string;
    sound?: boolean;
    startImageUrl?: string;
  };
  taskId?: string;
}

export interface CloudAiCapabilitiesResponse {
  byoRequired?: boolean;
  capability?: Record<string, unknown>;
  creditBalance?: number | null;
  data?: {
    capabilities?: Record<string, unknown>;
    feature: string;
    modes: string[];
    pollingSupported?: boolean;
    streamSupported?: boolean;
  };
  kind: CloudAiGatewayKind;
  mode: CloudAiGatewayMode;
  ok: boolean;
  provider: string;
  requestId: string | null;
  session?: {
    authenticated: boolean;
    email?: string | null;
    provider?: string | null;
  } | null;
  status: CloudAiGatewayStatus;
}

import { APP_VERSION } from '../version';

const HOSTED_CLOUD_API_ROUTES = [
  '/api/me',
  '/api/auth',
  '/api/billing',
  '/api/stripe',
  '/api/ai/chat',
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

async function requestResponse(path: string, init: RequestInit = {}): Promise<Response> {
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

export interface LoginResponse {
  authorizationUrl?: string;
  delivery?: 'debug_link' | 'email_sent';
  expiresAt?: string;
  message?: string;
  nextStep: string;
  ok?: boolean;
  provider: AuthProvider;
  redirectTo?: string;
  state: string;
  verificationUrl?: string;
}

export interface CallbackResponse {
  nextStep: string;
  ok: boolean;
  redirectTo?: string;
  session?: CloudMeResponse['session'];
  user?: CloudSessionUser & {
    avatarUrl?: string | null;
    displayName?: string;
  };
}

export interface HostedVideoStatusResponse {
  completedAt?: string;
  createdAt: string;
  error?: string;
  id: string;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  videoUrl?: string;
}

export interface HostedVideoCreateResponse {
  creditBalance: number;
  creditsCharged: number;
  provider: string;
  taskId: string;
}

export interface HostedVideoInfoResponse {
  creditBalance: number;
  enabled: boolean;
  provider: string;
}

async function requestJson<T>(path: string, init: RequestInit = {}): Promise<T> {
  let response: Response;

  try {
    response = await fetch(path, {
      credentials: 'include',
      ...init,
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        'X-App-Version': APP_VERSION,
        ...(init.headers ?? {}),
      },
    });
  } catch (error) {
    if (isLocalViteOrigin() && isHostedCloudApiRoute(path)) {
      throw getLocalHostedApiError(path);
    }

    throw error;
  }

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

export const cloudApi = {
  auth: {
    callback(state: string): Promise<CallbackResponse> {
      const url = new URL('/api/auth/callback', window.location.origin);
      url.searchParams.set('state', state);
      return requestJson<CallbackResponse>(url.toString(), { method: 'GET' });
    },
    login(body: { email: string; provider: AuthProvider; redirectTo?: string }): Promise<LoginResponse> {
      return requestJson<LoginResponse>('/api/auth/login', {
        body: JSON.stringify(body),
        method: 'POST',
      });
    },
    devLogin(body: { email?: string; plan?: string } = {}): Promise<{
      nextStep: string;
      ok: boolean;
      plan: string;
      session: CloudMeResponse['session'];
      user: CloudSessionUser;
    }> {
      return requestJson('/api/auth/dev-login', {
        body: JSON.stringify(body),
        method: 'POST',
      });
    },
    logout(): Promise<{ ok: boolean }> {
      return requestJson<{ ok: boolean }>('/api/auth/logout', { method: 'POST' });
    },
    me(): Promise<CloudMeResponse> {
      return requestJson<CloudMeResponse>('/api/me', { method: 'GET' });
    },
  },
  billing: {
    checkout(body: {
      cancelUrl?: string;
      customerEmail?: string;
      metadata?: Record<string, string | undefined>;
      planId?: BillingPlanId | string;
      priceId?: string;
      quantity?: number;
      successUrl?: string;
    }): Promise<CheckoutResponse> {
      return requestJson<CheckoutResponse>('/api/billing/checkout', {
        body: JSON.stringify(body),
        method: 'POST',
      });
    },
    portal(body: { returnUrl?: string }): Promise<PortalResponse> {
      return requestJson<PortalResponse>('/api/billing/portal', {
        body: JSON.stringify(body),
        method: 'POST',
      });
    },
    summary(): Promise<BillingSummaryResponse> {
      return requestJson<BillingSummaryResponse>('/api/billing/summary', { method: 'GET' });
    },
  },
  ai: {
    chat: {
      capabilities(): Promise<CloudAiCapabilitiesResponse> {
        return requestJson<CloudAiCapabilitiesResponse>('/api/ai/chat', { method: 'GET' });
      },
      create(body: CloudAiChatRequest): Promise<CloudAiGatewayEnvelope> {
        return requestJson<CloudAiGatewayEnvelope>('/api/ai/chat', {
          body: JSON.stringify(body),
          method: 'POST',
        });
      },
      stream(body: CloudAiChatRequest): Promise<Response> {
        return requestResponse('/api/ai/chat', {
          body: JSON.stringify({
            ...body,
            stream: true,
          }),
          headers: {
            Accept: 'text/event-stream',
            'Content-Type': 'application/json',
          },
          method: 'POST',
        });
      },
    },
    video: {
      capabilities(): Promise<CloudAiCapabilitiesResponse> {
        return requestJson<CloudAiCapabilitiesResponse>('/api/ai/video', { method: 'GET' });
      },
      create(body: CloudAiVideoRequest): Promise<CloudAiGatewayEnvelope> {
        return requestJson<CloudAiGatewayEnvelope>('/api/ai/video', {
          body: JSON.stringify(body),
          method: 'POST',
        });
      },
      status(taskId: string): Promise<CloudAiGatewayEnvelope> {
        const url = new URL('/api/ai/video', window.location.origin);
        url.searchParams.set('taskId', taskId);
        return requestJson<CloudAiGatewayEnvelope>(url.toString(), { method: 'GET' });
      },
    },
    chatLegacy(body: Record<string, unknown>): Promise<unknown> {
      return requestJson<unknown>('/api/ai/chat', {
        body: JSON.stringify(body),
        method: 'POST',
      });
    },
    videoCreate(body: {
      idempotencyKey?: string;
      params: {
        aspectRatio?: string;
        duration: number;
        endImageUrl?: string;
        mode?: string;
        prompt: string;
        provider?: string;
        sound?: boolean;
        startImageUrl?: string;
      };
    }): Promise<HostedVideoCreateResponse> {
      return requestJson<HostedVideoCreateResponse>('/api/ai/video', {
        body: JSON.stringify(body),
        method: 'POST',
      });
    },
    videoInfo(): Promise<HostedVideoInfoResponse> {
      return requestJson<HostedVideoInfoResponse>('/api/ai/video', { method: 'GET' });
    },
    videoStatus(taskId: string): Promise<HostedVideoStatusResponse> {
      const url = new URL('/api/ai/video', window.location.origin);
      url.searchParams.set('taskId', taskId);
      return requestJson<HostedVideoStatusResponse>(url.toString(), { method: 'GET' });
    },
  },
};
