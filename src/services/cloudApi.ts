import type { ElevenLabsVoiceSearchParams } from './elevenLabsService';
import type {
  AuthProvider,
  BillingPlanId,
  BillingSummaryResponse,
  CallbackResponse,
  CheckoutResponse,
  CloudAiAudioModelsResponse,
  CloudAiAudioMusicCreateResponse,
  CloudAiAudioMusicRequest,
  CloudAiAudioSpeechRequest,
  CloudAiAudioVoicesResponse,
  CloudAiCapabilitiesResponse,
  CloudAiChatRequest,
  CloudAiGatewayEnvelope,
  CloudAiVideoRequest,
  CloudMeResponse,
  CloudSessionUser,
  CreditClaimRedeemResponse,
  CreditClaimStatusResponse,
  HostedVideoCreateResponse,
  HostedVideoInfoResponse,
  HostedVideoStatusResponse,
  LoginResponse,
  PortalResponse,
} from './cloud/apiContracts';
import {
  AI_CHAT_REQUEST_TIMEOUT_MS,
  requestBinary,
  requestJson,
  requestResponse,
} from './cloud/transport';

export type {
  ApiErrorResponse,
  AuthProvider,
  BillingPlanId,
  BillingSummaryResponse,
  CallbackResponse,
  CheckoutResponse,
  CloudAiAudioModelsResponse,
  CloudAiAudioMusicCreateResponse,
  CloudAiAudioMusicRequest,
  CloudAiAudioSpeechRequest,
  CloudAiAudioVoicesResponse,
  CloudAiCapabilitiesResponse,
  CloudAiChatMessage,
  CloudAiChatRequest,
  CloudAiGatewayEnvelope,
  CloudAiGatewayError,
  CloudAiGatewayKind,
  CloudAiGatewayMode,
  CloudAiGatewayStatus,
  CloudAiVideoRequest,
  CloudMeResponse,
  CloudSessionUser,
  CreditClaimRedeemResponse,
  CreditClaimStatus,
  CreditClaimStatusResponse,
  HostedVideoCreateResponse,
  HostedVideoInfoResponse,
  HostedVideoStatusResponse,
  LoginResponse,
  PortalResponse,
} from './cloud/apiContracts';

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
      planId?: BillingPlanId | string;
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
  credits: {
    claimStatus(code: string): Promise<CreditClaimStatusResponse> {
      const url = new URL('/api/credits/claim', window.location.origin);
      url.searchParams.set('code', code);
      return requestJson<CreditClaimStatusResponse>(url.toString(), { method: 'GET' });
    },
    redeemClaim(body: { code: string; email: string }): Promise<CreditClaimRedeemResponse> {
      return requestJson<CreditClaimRedeemResponse>('/api/credits/claim', {
        body: JSON.stringify(body),
        method: 'POST',
      });
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
          timeoutMs: AI_CHAT_REQUEST_TIMEOUT_MS,
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
    audio: {
      capabilities(): Promise<CloudAiCapabilitiesResponse> {
        const url = new URL('/api/ai/audio', window.location.origin);
        url.searchParams.set('action', 'capabilities');
        return requestJson<CloudAiCapabilitiesResponse>(url.toString(), { method: 'GET' });
      },
      models(): Promise<CloudAiGatewayEnvelope<CloudAiAudioModelsResponse>> {
        const url = new URL('/api/ai/audio', window.location.origin);
        url.searchParams.set('action', 'models');
        return requestJson<CloudAiGatewayEnvelope<CloudAiAudioModelsResponse>>(url.toString(), { method: 'GET' });
      },
      voices(params: ElevenLabsVoiceSearchParams = {}): Promise<CloudAiGatewayEnvelope<CloudAiAudioVoicesResponse>> {
        const url = new URL('/api/ai/audio', window.location.origin);
        url.searchParams.set('action', 'voices');

        if (params.nextPageToken) url.searchParams.set('nextPageToken', params.nextPageToken);
        if (params.pageSize !== undefined) url.searchParams.set('pageSize', String(params.pageSize));
        if (params.search) url.searchParams.set('search', params.search);
        if (params.sort) url.searchParams.set('sort', params.sort);
        if (params.sortDirection) url.searchParams.set('sortDirection', params.sortDirection);
        if (params.voiceType) url.searchParams.set('voiceType', params.voiceType);
        if (params.category) url.searchParams.set('category', params.category);
        if (params.fineTuningState) url.searchParams.set('fineTuningState', params.fineTuningState);
        if (params.collectionId) url.searchParams.set('collectionId', params.collectionId);
        if (params.includeTotalCount !== undefined) url.searchParams.set('includeTotalCount', String(params.includeTotalCount));
        for (const voiceId of params.voiceIds ?? []) {
          url.searchParams.append('voiceIds', voiceId);
        }

        return requestJson<CloudAiGatewayEnvelope<CloudAiAudioVoicesResponse>>(url.toString(), { method: 'GET' });
      },
      speech(body: CloudAiAudioSpeechRequest, signal?: AbortSignal): Promise<{ blob: Blob; response: Response }> {
        return requestBinary('/api/ai/audio', {
          body: JSON.stringify(body),
          headers: {
            'Content-Type': 'application/json',
          },
          method: 'POST',
          signal,
        });
      },
      music(body: CloudAiAudioMusicRequest, signal?: AbortSignal): Promise<CloudAiGatewayEnvelope<CloudAiAudioMusicCreateResponse>> {
        return requestJson<CloudAiGatewayEnvelope<CloudAiAudioMusicCreateResponse>>('/api/ai/audio', {
          body: JSON.stringify(body),
          method: 'POST',
          signal,
        });
      },
      musicStatus(taskId: string): Promise<CloudAiGatewayEnvelope> {
        const url = new URL('/api/ai/audio', window.location.origin);
        url.searchParams.set('action', 'status');
        url.searchParams.set('taskId', taskId);
        return requestJson<CloudAiGatewayEnvelope>(url.toString(), { method: 'GET' });
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
        timeoutMs: AI_CHAT_REQUEST_TIMEOUT_MS,
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
