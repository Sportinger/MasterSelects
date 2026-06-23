import type {
  ElevenLabsCreateSpeechParams,
  ElevenLabsModel,
  ElevenLabsVoiceSearchResult,
} from '../elevenLabsService';

export type AuthProvider = 'google' | 'magic_link';
export type BillingPlanId = 'free' | 'starter' | 'pro' | 'studio';

export interface ApiErrorResponse {
  error?: string;
  message?: string;
  [key: string]: unknown;
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
  destination?: 'checkout' | 'portal';
  id: string;
  planId: BillingPlanId | string;
  priceId: string | null;
}

export interface PortalResponse {
  id: string;
  portalUrl: string;
}

export type CreditClaimStatus = 'available' | 'claimed' | 'expired' | 'invalid' | 'revoked';

export interface CreditClaimStatusResponse {
  claim: {
    amount: number;
    claimable: boolean;
    claimedAt: string | null;
    createdAt: string;
    description: string | null;
    emailLocked: boolean;
    expiresAt: string | null;
    status: CreditClaimStatus;
    title: string;
  };
  ok: boolean;
  session: {
    authenticated: boolean;
    email: string | null;
  };
}

export interface CreditClaimRedeemResponse {
  amount: number;
  claimedAt: string | null;
  creditBalance: number;
  error?: string;
  ledgerEntryId: string | null;
  message?: string;
  ok: boolean;
  status: CreditClaimStatus | 'redeemed';
}

export interface CloudAiGatewayError {
  code: string;
  details?: Record<string, unknown> | null;
  message: string;
}

export type CloudAiGatewayKind = 'ai.audio' | 'ai.chat' | 'ai.video';
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
    imageInputs?: string[];
    mode?: string;
    multiPrompt?: Array<{ index: number; prompt: string; duration: number }>;
    multiShots?: boolean;
    outputFormat?: 'jpeg' | 'png' | 'webp';
    outputType?: 'image' | 'video';
    provider?: string;
    prompt?: string;
    referenceMedia?: Array<{
      fileName?: string;
      label?: string;
      mediaType: 'audio' | 'image' | 'video';
      mimeType?: string;
      source: string;
    }>;
    resolution?: string;
    sound?: boolean;
    startImageUrl?: string;
  };
  taskId?: string;
}

export interface CloudAiAudioSpeechRequest {
  idempotencyKey?: string;
  params: ElevenLabsCreateSpeechParams;
}

export interface CloudAiAudioMusicRequest {
  action: 'music';
  idempotencyKey?: string;
  params: {
    audioWeight?: number;
    customMode?: boolean;
    instrumental?: boolean;
    model?: string;
    negativeTags?: string;
    outputType?: 'audio';
    prompt: string;
    provider?: string;
    style?: string;
    styleWeight?: number;
    title?: string;
    vocalGender?: 'm' | 'f';
    weirdnessConstraint?: number;
  };
}

export interface CloudAiAudioTranscriptionRequest {
  action: 'transcription';
  idempotencyKey?: string;
  params: {
    audioBase64: string;
    fileName?: string;
    language?: string;
    mimeType?: string;
  };
}

export interface CloudAiAudioMusicCreateResponse {
  outputType: 'audio';
  provider: string;
  taskId: string;
}

export interface CloudAiAudioTranscriptionResponse {
  durationSeconds: number;
  model: string;
  words: Array<{ word: string; start: number; end: number }>;
}

export interface CloudAiAudioModelsResponse {
  models: ElevenLabsModel[];
}

export type CloudAiAudioVoicesResponse = ElevenLabsVoiceSearchResult;

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
  imageUrl?: string;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  videoUrl?: string;
}

export interface HostedVideoCreateResponse {
  creditBalance: number;
  creditsCharged: number;
  outputType?: 'image' | 'video';
  provider: string;
  taskId: string;
}

export interface HostedVideoInfoResponse {
  creditBalance: number;
  enabled: boolean;
  provider: string;
}
