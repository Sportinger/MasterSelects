import {
  HOSTED_AGENT_PROTOCOL_VERSION,
  type HostedAgentServiceAssertionClaims,
} from '../../../src/services/kernelClient/hostedAgent/contracts';
import {
  HOSTED_AGENT_FAST_V2_BUDGET_POLICY_VERSION,
  HOSTED_AGENT_FAST_V2_CAPABILITY_BUNDLE_VERSION,
  HOSTED_AGENT_FAST_V2_EXECUTION_CONTRACT_DIGEST,
  HOSTED_AGENT_FAST_V2_EXECUTION_CONTRACT_VERSION,
  HOSTED_AGENT_FAST_V2_MAXIMUM_ITERATIONS,
  HOSTED_AGENT_FAST_V2_MAXIMUM_SPEND_CREDITS,
  HOSTED_AGENT_FAST_V2_MODEL_POLICY_VERSION,
  HOSTED_AGENT_FAST_V2_PROMPT_VERSION,
  HOSTED_AGENT_FAST_V2_PROTOCOL_VERSION,
  type HostedAgentFastV2AssertionClaims,
  type HostedAgentFastV2EdgePins,
  type HostedAgentFastV2StartRequest,
} from '../../../src/services/kernelClient/hostedAgent/fastV2StartContract';

const ASSERTION_AUDIENCE = 'masterselects-hosted-agent';
const ASSERTION_ISSUER = 'masterselects-cloudflare-kernel-proxy';
const ASSERTION_TTL_SECONDS = 120;
const MINIMUM_SECRET_CHARACTERS = 32;

interface AssertionHeader {
  alg: 'HS256';
  typ: 'JWT';
  v: 1;
}

const ASSERTION_HEADER: AssertionHeader = {
  alg: 'HS256',
  typ: 'JWT',
  v: 1,
};

export class HostedAgentAssertionError extends Error {
  readonly code:
    | 'assertion_expired'
    | 'assertion_invalid'
    | 'assertion_secret_unavailable';

  constructor(
    code:
      | 'assertion_expired'
      | 'assertion_invalid'
      | 'assertion_secret_unavailable',
    message: string,
  ) {
    super(message);
    this.code = code;
    this.name = 'HostedAgentAssertionError';
  }
}

function encodeBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

function encodeJson(value: unknown): string {
  return encodeBase64Url(new TextEncoder().encode(JSON.stringify(value)));
}

function decodeBase64Url(value: string): Uint8Array {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) {
    throw new HostedAgentAssertionError('assertion_invalid', 'The service assertion is malformed.');
  }
  const padded = value.replace(/-/g, '+').replace(/_/g, '/')
    + '='.repeat((4 - value.length % 4) % 4);
  try {
    const binary = atob(padded);
    return Uint8Array.from(binary, (character) => character.charCodeAt(0));
  } catch {
    throw new HostedAgentAssertionError('assertion_invalid', 'The service assertion is malformed.');
  }
}

function decodeJson(value: string): unknown {
  try {
    return JSON.parse(new TextDecoder().decode(decodeBase64Url(value))) as unknown;
  } catch (error) {
    if (error instanceof HostedAgentAssertionError) {
      throw error;
    }
    throw new HostedAgentAssertionError('assertion_invalid', 'The service assertion is malformed.');
  }
}

function exactArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  ) as ArrayBuffer;
}

function validString(value: unknown, maximumLength = 240): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= maximumLength;
}

function isClaims(value: unknown): value is HostedAgentServiceAssertionClaims {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const claims = value as Partial<HostedAgentServiceAssertionClaims>;
  return claims.aud === ASSERTION_AUDIENCE
    && claims.iss === ASSERTION_ISSUER
    && claims.protocolVersion === HOSTED_AGENT_PROTOCOL_VERSION
    && validString(claims.sub)
    && validString(claims.turnId)
    && validString(claims.sessionId)
    && validString(claims.clientInstanceId)
    && validString(claims.model)
    && validString(claims.nonce)
    && (claims.providerProtocol === 'claude-messages'
      || claims.providerProtocol === 'openai-responses')
    && (claims.toolExecutionMode === 'normal'
      || claims.toolExecutionMode === 'plan'
      || claims.toolExecutionMode === 'read-only')
    && typeof claims.iat === 'number'
    && Number.isInteger(claims.iat)
    && typeof claims.exp === 'number'
    && Number.isInteger(claims.exp)
    && typeof claims.maxTurnSpendCredits === 'number'
    && Number.isInteger(claims.maxTurnSpendCredits)
    && claims.maxTurnSpendCredits > 0
    && typeof claims.maximumIterations === 'number'
    && Number.isInteger(claims.maximumIterations)
    && claims.maximumIterations > 0;
}

function isFastV2Claims(value: unknown): value is HostedAgentFastV2AssertionClaims {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  const allowedKeys = new Set([
    'aud',
    'browserRequestDigest',
    'budgetPolicyVersion',
    'capabilityBundleVersion',
    'clientInstanceId',
    'editorBuildId',
    'executionContractDigest',
    'executionContractVersion',
    'executionProfile',
    'exp',
    'iat',
    'iss',
    'maximumIterations',
    'maxTurnSpendCredits',
    'modelPolicyVersion',
    'nonce',
    'promptVersion',
    'protocolVersion',
    'sessionId',
    'snapshotStateFingerprint',
    'snapshotTimelineRevision',
    'sub',
    'turnId',
  ]);
  if (Object.keys(record).some((key) => !allowedKeys.has(key))) return false;
  const claims = record as Partial<HostedAgentFastV2AssertionClaims>;
  const validSha256 = (candidate: unknown): candidate is string => (
    typeof candidate === 'string' && /^sha256:[a-f0-9]{64}$/.test(candidate)
  );
  return claims.aud === ASSERTION_AUDIENCE
    && claims.iss === ASSERTION_ISSUER
    && claims.protocolVersion === HOSTED_AGENT_FAST_V2_PROTOCOL_VERSION
    && claims.promptVersion === HOSTED_AGENT_FAST_V2_PROMPT_VERSION
    && claims.capabilityBundleVersion === HOSTED_AGENT_FAST_V2_CAPABILITY_BUNDLE_VERSION
    && claims.modelPolicyVersion === HOSTED_AGENT_FAST_V2_MODEL_POLICY_VERSION
    && claims.budgetPolicyVersion === HOSTED_AGENT_FAST_V2_BUDGET_POLICY_VERSION
    && claims.executionContractVersion === HOSTED_AGENT_FAST_V2_EXECUTION_CONTRACT_VERSION
    && claims.executionContractDigest === HOSTED_AGENT_FAST_V2_EXECUTION_CONTRACT_DIGEST
    && (
      claims.executionProfile === undefined
      || claims.executionProfile === 'fast'
      || claims.executionProfile === 'verified'
    )
    && validString(claims.sub)
    && validString(claims.turnId, 160)
    && validString(claims.sessionId, 200)
    && validString(claims.clientInstanceId, 200)
    && validString(claims.editorBuildId, 120)
    && validString(claims.nonce)
    && validSha256(claims.browserRequestDigest)
    && validSha256(claims.snapshotStateFingerprint)
    && typeof claims.snapshotTimelineRevision === 'number'
    && Number.isInteger(claims.snapshotTimelineRevision)
    && claims.snapshotTimelineRevision >= 0
    && typeof claims.iat === 'number'
    && Number.isInteger(claims.iat)
    && typeof claims.exp === 'number'
    && Number.isInteger(claims.exp)
    && typeof claims.maxTurnSpendCredits === 'number'
    && Number.isInteger(claims.maxTurnSpendCredits)
    && claims.maxTurnSpendCredits > 0
    && claims.maxTurnSpendCredits <= HOSTED_AGENT_FAST_V2_MAXIMUM_SPEND_CREDITS
    && typeof claims.maximumIterations === 'number'
    && Number.isInteger(claims.maximumIterations)
    && claims.maximumIterations > 0
    && claims.maximumIterations <= HOSTED_AGENT_FAST_V2_MAXIMUM_ITERATIONS;
}

async function hmacKey(secret: string): Promise<CryptoKey> {
  if (secret.length < MINIMUM_SECRET_CHARACTERS) {
    throw new HostedAgentAssertionError(
      'assertion_secret_unavailable',
      'The hosted-agent assertion secret is not configured safely.',
    );
  }
  return crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { hash: 'SHA-256', name: 'HMAC' },
    false,
    ['sign', 'verify'],
  );
}

export function buildHostedAgentAssertionClaims(input: {
  clientInstanceId: string;
  maximumIterations: number;
  maxTurnSpendCredits: number;
  model: string;
  nonce: string;
  now?: Date;
  providerProtocol: HostedAgentServiceAssertionClaims['providerProtocol'];
  sessionId: string;
  toolExecutionMode: HostedAgentServiceAssertionClaims['toolExecutionMode'];
  turnId: string;
  userId: string;
}): HostedAgentServiceAssertionClaims {
  const issuedAt = Math.floor((input.now ?? new Date()).getTime() / 1000);
  return {
    aud: ASSERTION_AUDIENCE,
    clientInstanceId: input.clientInstanceId,
    exp: issuedAt + ASSERTION_TTL_SECONDS,
    iat: issuedAt,
    iss: ASSERTION_ISSUER,
    maximumIterations: input.maximumIterations,
    maxTurnSpendCredits: input.maxTurnSpendCredits,
    model: input.model,
    nonce: input.nonce,
    protocolVersion: HOSTED_AGENT_PROTOCOL_VERSION,
    providerProtocol: input.providerProtocol,
    sessionId: input.sessionId,
    sub: input.userId,
    toolExecutionMode: input.toolExecutionMode,
    turnId: input.turnId,
  };
}

export function buildHostedAgentFastV2AssertionClaims(input: {
  browserRequest: HostedAgentFastV2StartRequest;
  browserRequestDigest: string;
  edge: HostedAgentFastV2EdgePins;
  nonce: string;
  now?: Date;
  userId: string;
}): HostedAgentFastV2AssertionClaims {
  return buildHostedAgentFastV2AssertionClaimsFromBinding({
    browserRequestDigest: input.browserRequestDigest,
    clientInstanceId: input.browserRequest.clientInstanceId,
    edge: input.edge,
    editorBuildId: input.browserRequest.editorBuildId,
    executionContractDigest: input.browserRequest.executionContractDigest,
    executionContractVersion: input.browserRequest.executionContractVersion,
    nonce: input.nonce,
    ...(input.now === undefined ? {} : { now: input.now }),
    snapshotStateFingerprint: input.browserRequest.compactSnapshot.stateFingerprint,
    snapshotTimelineRevision: input.browserRequest.compactSnapshot.timelineRevision,
    turnId: input.browserRequest.turnId,
    userId: input.userId,
  });
}

export function buildHostedAgentFastV2AssertionClaimsFromBinding(input: {
  browserRequestDigest: string;
  clientInstanceId: string;
  edge: HostedAgentFastV2EdgePins;
  editorBuildId: string;
  executionContractDigest: HostedAgentFastV2AssertionClaims['executionContractDigest'];
  executionContractVersion: HostedAgentFastV2AssertionClaims['executionContractVersion'];
  nonce: string;
  now?: Date;
  snapshotStateFingerprint: string;
  snapshotTimelineRevision: number;
  turnId: string;
  userId: string;
}): HostedAgentFastV2AssertionClaims {
  const issuedAt = Math.floor((input.now ?? new Date()).getTime() / 1000);
  return {
    aud: ASSERTION_AUDIENCE,
    browserRequestDigest: input.browserRequestDigest,
    budgetPolicyVersion: input.edge.budgetPolicyVersion,
    capabilityBundleVersion: input.edge.capabilityBundleVersion,
    clientInstanceId: input.clientInstanceId,
    editorBuildId: input.editorBuildId,
    executionContractDigest: input.executionContractDigest,
    executionContractVersion: input.executionContractVersion,
    executionProfile: input.edge.executionProfile,
    exp: issuedAt + ASSERTION_TTL_SECONDS,
    iat: issuedAt,
    iss: ASSERTION_ISSUER,
    maximumIterations: input.edge.maximumIterations,
    maxTurnSpendCredits: input.edge.maxTurnSpendCredits,
    modelPolicyVersion: input.edge.modelPolicyVersion,
    nonce: input.nonce,
    promptVersion: input.edge.promptVersion,
    protocolVersion: HOSTED_AGENT_FAST_V2_PROTOCOL_VERSION,
    sessionId: input.edge.sessionId,
    snapshotStateFingerprint: input.snapshotStateFingerprint,
    snapshotTimelineRevision: input.snapshotTimelineRevision,
    sub: input.userId,
    turnId: input.turnId,
  };
}

export async function signHostedAgentServiceAssertion(
  claims: HostedAgentServiceAssertionClaims | HostedAgentFastV2AssertionClaims,
  secret: string,
): Promise<string> {
  const encodedHeader = encodeJson(ASSERTION_HEADER);
  const encodedClaims = encodeJson(claims);
  const signingInput = `${encodedHeader}.${encodedClaims}`;
  const signature = await crypto.subtle.sign(
    'HMAC',
    await hmacKey(secret),
    new TextEncoder().encode(signingInput),
  );
  return `${signingInput}.${encodeBase64Url(new Uint8Array(signature))}`;
}

async function verifyHostedAgentAssertionPayload(
  assertion: string,
  secret: string,
  now = new Date(),
): Promise<unknown> {
  const segments = assertion.split('.');
  if (segments.length !== 3) {
    throw new HostedAgentAssertionError('assertion_invalid', 'The service assertion is malformed.');
  }
  const [encodedHeader, encodedClaims, encodedSignature] = segments;
  const header = decodeJson(encodedHeader);
  if (
    typeof header !== 'object'
    || header === null
    || (header as Partial<AssertionHeader>).alg !== 'HS256'
    || (header as Partial<AssertionHeader>).typ !== 'JWT'
    || (header as Partial<AssertionHeader>).v !== 1
  ) {
    throw new HostedAgentAssertionError('assertion_invalid', 'The assertion header is unsupported.');
  }

  const signatureIsValid = await crypto.subtle.verify(
    'HMAC',
    await hmacKey(secret),
    exactArrayBuffer(decodeBase64Url(encodedSignature)),
    new TextEncoder().encode(`${encodedHeader}.${encodedClaims}`),
  );
  if (!signatureIsValid) {
    throw new HostedAgentAssertionError('assertion_invalid', 'The service assertion is invalid.');
  }

  const claims = decodeJson(encodedClaims);
  if (typeof claims !== 'object' || claims === null) {
    throw new HostedAgentAssertionError('assertion_invalid', 'The assertion claims are invalid.');
  }
  const temporal = claims as { exp?: unknown; iat?: unknown };
  if (
    typeof temporal.exp !== 'number'
    || !Number.isInteger(temporal.exp)
    || typeof temporal.iat !== 'number'
    || !Number.isInteger(temporal.iat)
  ) {
    throw new HostedAgentAssertionError('assertion_invalid', 'The assertion claims are invalid.');
  }
  const nowSeconds = Math.floor(now.getTime() / 1000);
  if (temporal.exp <= nowSeconds || temporal.iat > nowSeconds + 5) {
    throw new HostedAgentAssertionError('assertion_expired', 'The service assertion has expired.');
  }
  if (temporal.exp - temporal.iat > ASSERTION_TTL_SECONDS) {
    throw new HostedAgentAssertionError('assertion_invalid', 'The assertion lifetime is invalid.');
  }
  return claims;
}

export async function verifyHostedAgentServiceAssertion(
  assertion: string,
  secret: string,
  now = new Date(),
): Promise<HostedAgentServiceAssertionClaims> {
  const claims = await verifyHostedAgentAssertionPayload(assertion, secret, now);
  if (!isClaims(claims)) {
    throw new HostedAgentAssertionError('assertion_invalid', 'The assertion claims are invalid.');
  }
  return claims;
}

export async function verifyHostedAgentFastV2ServiceAssertion(
  assertion: string,
  secret: string,
  now = new Date(),
): Promise<HostedAgentFastV2AssertionClaims> {
  const claims = await verifyHostedAgentAssertionPayload(assertion, secret, now);
  if (!isFastV2Claims(claims)) {
    throw new HostedAgentAssertionError('assertion_invalid', 'The Fast V2 assertion claims are invalid.');
  }
  return claims;
}
