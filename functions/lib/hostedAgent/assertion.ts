import {
  HOSTED_AGENT_PROTOCOL_VERSION,
  type HostedAgentServiceAssertionClaims,
} from '../../../src/services/kernelClient/hostedAgent/contracts';

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

export async function signHostedAgentServiceAssertion(
  claims: HostedAgentServiceAssertionClaims,
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

export async function verifyHostedAgentServiceAssertion(
  assertion: string,
  secret: string,
  now = new Date(),
): Promise<HostedAgentServiceAssertionClaims> {
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
  if (!isClaims(claims)) {
    throw new HostedAgentAssertionError('assertion_invalid', 'The assertion claims are invalid.');
  }
  const nowSeconds = Math.floor(now.getTime() / 1000);
  if (claims.exp <= nowSeconds || claims.iat > nowSeconds + 5) {
    throw new HostedAgentAssertionError('assertion_expired', 'The service assertion has expired.');
  }
  if (claims.exp - claims.iat > ASSERTION_TTL_SECONDS) {
    throw new HostedAgentAssertionError('assertion_invalid', 'The assertion lifetime is invalid.');
  }
  return claims;
}
