import {
  PUBLIC_OPERATION_CONTRACT_DIGEST_V1,
  PUBLIC_OPERATION_CONTRACT_V1,
} from '../wp1Spike/publicOperationContracts';

export const HOSTED_AGENT_FAST_V2_PROTOCOL_VERSION = 'fast-agent-v2' as const;
// Whole-timeline bulk edits should be byte/timeout-bound, not stopped by the
// former eight-call batching default. Keep a finite fail-closed ceiling.
export const HOSTED_AGENT_FAST_V2_MAX_TOOL_CALLS_PER_ROUND = 256 as const;
export const HOSTED_AGENT_FAST_V2_EDITOR_TOOL_CATALOG_DIGEST =
  'sha256:d1a075975a98160f7997d592ab7e019e4516ca98a80503f6d9c59efdb7a74277' as const;
export const HOSTED_AGENT_FAST_V2_EXECUTION_CONTRACT_VERSION =
  PUBLIC_OPERATION_CONTRACT_V1.contractVersion;
export const HOSTED_AGENT_FAST_V2_EXECUTION_CONTRACT_DIGEST =
  PUBLIC_OPERATION_CONTRACT_DIGEST_V1;
export const HOSTED_AGENT_FAST_V2_SERVICE_ENVELOPE_VERSION = 1 as const;
export const HOSTED_AGENT_FAST_V2_PROMPT_VERSION =
  'fast-v2-prompt-unbounded-keyframe-sequences-2026-08-03' as const;
export const HOSTED_AGENT_FAST_V2_CAPABILITY_BUNDLE_VERSION =
  'fast-v2-transcript-assembly-2026-08-03' as const;
export const HOSTED_AGENT_FAST_V2_MODEL_POLICY_VERSION =
  'fast-v2-model-policy-2026-08-02' as const;
export const HOSTED_AGENT_FAST_V2_BUDGET_POLICY_VERSION =
  'fast-v2-budget-policy-large-session-2026-08-03' as const;
export const HOSTED_AGENT_FAST_V2_MAXIMUM_ITERATIONS = 24 as const;
export const HOSTED_AGENT_FAST_V2_MAXIMUM_SPEND_CREDITS = 2_000 as const;
// Large projects still cross one finite browser/edge/kernel boundary. Keep the
// byte and structural ceilings aligned with the private contract so future
// split-heavy timelines have substantial headroom without admitting binaries.
export const HOSTED_AGENT_FAST_V2_MAX_START_BYTES = 8 * 1024 * 1024;
export const HOSTED_AGENT_FAST_V2_MAX_SNAPSHOT_JSON_NODES = 2_000_000 as const;
export const HOSTED_AGENT_FAST_V2_MAX_SNAPSHOT_ARRAY_ITEMS = 250_000 as const;

const IDENTIFIER_PATTERN = /^[A-Za-z0-9._:-]+$/;
const SHA256_PATTERN = /^sha256:[a-f0-9]{64}$/;
const FORBIDDEN_JSON_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
const START_REQUEST_KEYS = [
  'clientInstanceId',
  'compactSnapshot',
  'conversationRef',
  'editorBuildId',
  'editorToolCatalog',
  'executionContractDigest',
  'executionContractVersion',
  'executionProfile',
  'protocolVersion',
  'request',
  'requestedExecutionMode',
  'requestedModelClass',
  'runSource',
  'turnId',
  'userPreferences',
  'visualReferences',
] as const;

export type HostedAgentFastV2RunSource = 'bridge' | 'mcp' | 'ui';
export type HostedAgentFastV2RequestedExecutionMode = 'normal' | 'plan' | 'read-only';
export type HostedAgentFastV2RequestedModelClass = 'very-fast' | 'fast' | 'slow';
export type HostedAgentFastV2ExecutionProfile = 'fast' | 'verified';

export type HostedAgentFastV2EditorToolRisk = 'destructive' | 'mutating' | 'read-only';

export interface HostedAgentFastV2EditorTool {
  description: string;
  name: string;
  parameters: Record<string, unknown>;
  risk: HostedAgentFastV2EditorToolRisk;
}

export interface HostedAgentFastV2EditorToolCatalog {
  digest: typeof HOSTED_AGENT_FAST_V2_EDITOR_TOOL_CATALOG_DIGEST;
  schemaVersion: 1;
  tools: HostedAgentFastV2EditorTool[];
}

export interface HostedAgentFastV2CompactSnapshot {
  payload: Record<string, unknown>;
  schemaVersion: 1;
  stateFingerprint: string;
  timelineRevision: number;
}

export interface HostedAgentFastV2VisualReference {
  id: string;
  mediaType: string;
  role: 'initial';
  source: string;
  transport: 'authenticated-ref' | 'data-url';
}

export interface HostedAgentFastV2StartRequest {
  clientInstanceId: string;
  compactSnapshot: HostedAgentFastV2CompactSnapshot;
  conversationRef?: string;
  editorBuildId: string;
  editorToolCatalog?: HostedAgentFastV2EditorToolCatalog;
  executionContractDigest: typeof HOSTED_AGENT_FAST_V2_EXECUTION_CONTRACT_DIGEST;
  executionContractVersion: typeof HOSTED_AGENT_FAST_V2_EXECUTION_CONTRACT_VERSION;
  executionProfile?: HostedAgentFastV2ExecutionProfile;
  protocolVersion: typeof HOSTED_AGENT_FAST_V2_PROTOCOL_VERSION;
  request: string;
  requestedExecutionMode?: HostedAgentFastV2RequestedExecutionMode;
  requestedModelClass?: HostedAgentFastV2RequestedModelClass;
  runSource: HostedAgentFastV2RunSource;
  turnId: string;
  userPreferences?: Record<string, string | number | boolean>;
  visualReferences: HostedAgentFastV2VisualReference[];
}

export interface HostedAgentFastV2EdgePins {
  budgetPolicyVersion: typeof HOSTED_AGENT_FAST_V2_BUDGET_POLICY_VERSION;
  capabilityBundleVersion: typeof HOSTED_AGENT_FAST_V2_CAPABILITY_BUNDLE_VERSION;
  executionProfile: HostedAgentFastV2ExecutionProfile;
  maximumIterations: number;
  maxTurnSpendCredits: number;
  modelPolicyVersion: typeof HOSTED_AGENT_FAST_V2_MODEL_POLICY_VERSION;
  promptVersion: typeof HOSTED_AGENT_FAST_V2_PROMPT_VERSION;
  schemaVersion: typeof HOSTED_AGENT_FAST_V2_SERVICE_ENVELOPE_VERSION;
  sessionId: string;
}

export interface HostedAgentFastV2ServiceEnvelope {
  browserRequest: HostedAgentFastV2StartRequest;
  edge: HostedAgentFastV2EdgePins;
}

export interface HostedAgentFastV2AssertionClaims {
  aud: 'masterselects-hosted-agent';
  browserRequestDigest: string;
  budgetPolicyVersion: typeof HOSTED_AGENT_FAST_V2_BUDGET_POLICY_VERSION;
  capabilityBundleVersion: typeof HOSTED_AGENT_FAST_V2_CAPABILITY_BUNDLE_VERSION;
  clientInstanceId: string;
  editorBuildId: string;
  executionContractDigest: typeof HOSTED_AGENT_FAST_V2_EXECUTION_CONTRACT_DIGEST;
  executionContractVersion: typeof HOSTED_AGENT_FAST_V2_EXECUTION_CONTRACT_VERSION;
  executionProfile?: HostedAgentFastV2ExecutionProfile;
  exp: number;
  iat: number;
  iss: 'masterselects-cloudflare-kernel-proxy';
  maximumIterations: number;
  maxTurnSpendCredits: number;
  modelPolicyVersion: typeof HOSTED_AGENT_FAST_V2_MODEL_POLICY_VERSION;
  nonce: string;
  promptVersion: typeof HOSTED_AGENT_FAST_V2_PROMPT_VERSION;
  protocolVersion: typeof HOSTED_AGENT_FAST_V2_PROTOCOL_VERSION;
  sessionId: string;
  snapshotStateFingerprint: string;
  snapshotTimelineRevision: number;
  sub: string;
  turnId: string;
}

export class HostedAgentFastV2ContractError extends Error {
  readonly code = 'invalid_fast_v2_start_request';

  constructor(message: string) {
    super(message);
    this.name = 'HostedAgentFastV2ContractError';
  }
}

/**
 * Resolves the legacy missing-profile case without accepting any other
 * implicit or invalid profile value.
 */
export function resolveHostedAgentFastV2ExecutionProfile(
  value: unknown,
): HostedAgentFastV2ExecutionProfile {
  if (value === undefined) return 'fast';
  if (value === 'fast' || value === 'verified') return value;
  throw new HostedAgentFastV2ContractError(
    'executionProfile must be fast or verified when explicitly provided.',
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function hasOnlyKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const allowed = new Set(keys);
  return Object.keys(value).every((key) => allowed.has(key));
}

function validIdentifier(value: unknown, maximumLength: number): value is string {
  return typeof value === 'string'
    && value.length > 0
    && value.length <= maximumLength
    && IDENTIFIER_PATTERN.test(value);
}

function validJsonValue(
  value: unknown,
  depth = 0,
  budget: { nodes: number } = { nodes: 0 },
): boolean {
  budget.nodes += 1;
  if (budget.nodes > HOSTED_AGENT_FAST_V2_MAX_SNAPSHOT_JSON_NODES || depth > 40) return false;
  if (value === null || typeof value === 'boolean') return true;
  if (typeof value === 'number') return Number.isFinite(value);
  if (typeof value === 'string') {
    return value.length <= 100_000 && !/^\s*data:/i.test(value);
  }
  if (Array.isArray(value)) {
    return value.length <= HOSTED_AGENT_FAST_V2_MAX_SNAPSHOT_ARRAY_ITEMS
      && value.every((item) => validJsonValue(item, depth + 1, budget));
  }
  if (!isRecord(value) || Object.keys(value).length > 2_000) return false;
  return Object.entries(value).every(([key, item]) => (
    key.length > 0
    && key.length <= 200
    && !FORBIDDEN_JSON_KEYS.has(key)
    && validJsonValue(item, depth + 1, budget)
  ));
}

function parseSnapshot(value: unknown): HostedAgentFastV2CompactSnapshot {
  if (
    !isRecord(value)
    || !hasOnlyKeys(value, ['payload', 'schemaVersion', 'stateFingerprint', 'timelineRevision'])
    || value.schemaVersion !== 1
    || typeof value.timelineRevision !== 'number'
    || !Number.isInteger(value.timelineRevision)
    || value.timelineRevision < 0
    || typeof value.stateFingerprint !== 'string'
    || !SHA256_PATTERN.test(value.stateFingerprint)
    || !isRecord(value.payload)
    || !validJsonValue(value.payload)
  ) {
    throw new HostedAgentFastV2ContractError(
      'compactSnapshot must contain bounded complete semantic timeline state with a revision and SHA-256 fingerprint.',
    );
  }
  return value as unknown as HostedAgentFastV2CompactSnapshot;
}

function parseVisualReferences(value: unknown): HostedAgentFastV2VisualReference[] {
  if (!Array.isArray(value) || value.length > 8) {
    throw new HostedAgentFastV2ContractError('visualReferences must contain at most eight items.');
  }
  const references = value.map((reference) => {
    if (
      !isRecord(reference)
      || !hasOnlyKeys(reference, ['id', 'mediaType', 'role', 'source', 'transport'])
      || !validIdentifier(reference.id, 200)
      || typeof reference.mediaType !== 'string'
      || !/^image\/(?:gif|jpeg|png|webp)$/.test(reference.mediaType)
      || reference.role !== 'initial'
      || typeof reference.source !== 'string'
      || reference.source.length === 0
      || reference.source.length > 1_250_000
      || (reference.transport !== 'authenticated-ref' && reference.transport !== 'data-url')
      || (reference.transport === 'data-url' && !/^data:image\/(?:gif|jpeg|png|webp);base64,/i.test(reference.source))
      || (reference.transport === 'authenticated-ref' && /^\s*data:/i.test(reference.source))
    ) {
      throw new HostedAgentFastV2ContractError('A visual reference is invalid or unbounded.');
    }
    return reference as unknown as HostedAgentFastV2VisualReference;
  });
  if (new Set(references.map((reference) => reference.id)).size !== references.length) {
    throw new HostedAgentFastV2ContractError('Visual reference ids must be unique.');
  }
  return references;
}

function parseEditorToolCatalog(
  value: unknown,
): HostedAgentFastV2EditorToolCatalog | undefined {
  if (value === undefined) return undefined;
  if (
    !isRecord(value)
    || !hasOnlyKeys(value, ['digest', 'schemaVersion', 'tools'])
    || value.digest !== HOSTED_AGENT_FAST_V2_EDITOR_TOOL_CATALOG_DIGEST
    || value.schemaVersion !== 1
    || !Array.isArray(value.tools)
    || value.tools.length === 0
    || value.tools.length > 256
  ) {
    throw new HostedAgentFastV2ContractError('editorToolCatalog is invalid or incompatible.');
  }
  const toolNames = new Set<string>();
  for (const rawTool of value.tools) {
    if (
      !isRecord(rawTool)
      || !hasOnlyKeys(rawTool, ['description', 'name', 'parameters', 'risk'])
      || !validIdentifier(rawTool.name, 120)
      || toolNames.has(rawTool.name)
      || typeof rawTool.description !== 'string'
      || rawTool.description.length === 0
      || rawTool.description.length > 4_000
      || !isRecord(rawTool.parameters)
      || !validJsonValue(rawTool.parameters)
      || !['destructive', 'mutating', 'read-only'].includes(String(rawTool.risk))
    ) {
      throw new HostedAgentFastV2ContractError('An editor tool catalog entry is invalid.');
    }
    toolNames.add(rawTool.name);
  }
  return value as unknown as HostedAgentFastV2EditorToolCatalog;
}

function parseUserPreferences(value: unknown): Record<string, string | number | boolean> | undefined {
  if (value === undefined) return undefined;
  if (!isRecord(value) || Object.keys(value).length > 32) {
    throw new HostedAgentFastV2ContractError('userPreferences must be a bounded scalar record.');
  }
  const preferences: Record<string, string | number | boolean> = {};
  for (const [key, item] of Object.entries(value)) {
    if (
      !validIdentifier(key, 80)
      || !['boolean', 'number', 'string'].includes(typeof item)
      || (typeof item === 'number' && !Number.isFinite(item))
      || (typeof item === 'string' && item.length > 2_000)
    ) {
      throw new HostedAgentFastV2ContractError('userPreferences contains an invalid entry.');
    }
    preferences[key] = item as string | number | boolean;
  }
  return preferences;
}

/**
 * Parses the browser-owned V2 data envelope. Unknown keys are rejected so a
 * client cannot smuggle provider instructions, tools, settings, or budgets.
 */
export function parseHostedAgentFastV2StartRequest(
  value: unknown,
): HostedAgentFastV2StartRequest {
  if (!isRecord(value) || !hasOnlyKeys(value, START_REQUEST_KEYS)) {
    throw new HostedAgentFastV2ContractError(
      'The Fast V2 start request contains an unknown or forbidden field.',
    );
  }
  const executionProfile = value.executionProfile === undefined
    ? undefined
    : resolveHostedAgentFastV2ExecutionProfile(value.executionProfile);
  if (
    value.protocolVersion !== HOSTED_AGENT_FAST_V2_PROTOCOL_VERSION
    || !validIdentifier(value.turnId, 160)
    || !validIdentifier(value.clientInstanceId, 200)
    || !validIdentifier(value.editorBuildId, 120)
    || value.executionContractVersion !== HOSTED_AGENT_FAST_V2_EXECUTION_CONTRACT_VERSION
    || value.executionContractDigest !== HOSTED_AGENT_FAST_V2_EXECUTION_CONTRACT_DIGEST
    || typeof value.request !== 'string'
    || value.request.trim().length === 0
    || value.request.length > 100_000
    || !['bridge', 'mcp', 'ui'].includes(String(value.runSource))
    || (value.conversationRef !== undefined && !validIdentifier(value.conversationRef, 200))
    || (value.requestedModelClass !== undefined
      && !['very-fast', 'fast', 'slow'].includes(String(value.requestedModelClass)))
    || (value.requestedExecutionMode !== undefined
      && !['normal', 'plan', 'read-only'].includes(String(value.requestedExecutionMode)))
  ) {
    throw new HostedAgentFastV2ContractError('The Fast V2 start request is invalid.');
  }

  const compactSnapshot = parseSnapshot(value.compactSnapshot);
  const editorToolCatalog = parseEditorToolCatalog(value.editorToolCatalog);
  const visualReferences = parseVisualReferences(value.visualReferences);
  const userPreferences = parseUserPreferences(value.userPreferences);
  const parsed: HostedAgentFastV2StartRequest = {
    clientInstanceId: value.clientInstanceId,
    compactSnapshot,
    ...(value.conversationRef === undefined ? {} : { conversationRef: value.conversationRef }),
    editorBuildId: value.editorBuildId,
    ...(editorToolCatalog === undefined ? {} : { editorToolCatalog }),
    executionContractDigest: HOSTED_AGENT_FAST_V2_EXECUTION_CONTRACT_DIGEST,
    executionContractVersion: HOSTED_AGENT_FAST_V2_EXECUTION_CONTRACT_VERSION,
    ...(executionProfile === undefined ? {} : { executionProfile }),
    protocolVersion: HOSTED_AGENT_FAST_V2_PROTOCOL_VERSION,
    request: value.request.trim(),
    ...(value.requestedExecutionMode === undefined
      ? {}
      : { requestedExecutionMode: value.requestedExecutionMode as HostedAgentFastV2RequestedExecutionMode }),
    ...(value.requestedModelClass === undefined
      ? {}
      : { requestedModelClass: value.requestedModelClass as HostedAgentFastV2RequestedModelClass }),
    runSource: value.runSource as HostedAgentFastV2RunSource,
    turnId: value.turnId,
    ...(userPreferences === undefined ? {} : { userPreferences }),
    visualReferences,
  };
  if (new TextEncoder().encode(JSON.stringify(parsed)).byteLength
    > HOSTED_AGENT_FAST_V2_MAX_START_BYTES) {
    throw new HostedAgentFastV2ContractError(
      'The Fast V2 start request exceeds the canonical total byte bound.',
    );
  }
  return parsed;
}

function stableJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map((key) => (
    `${JSON.stringify(key)}:${stableJson(record[key])}`
  )).join(',')}}`;
}

export async function digestHostedAgentFastV2BrowserRequest(
  request: HostedAgentFastV2StartRequest,
): Promise<string> {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(stableJson(request)),
  );
  return `sha256:${Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')}`;
}

export function hostedAgentFastV2RoundIdempotencyKey(
  turnId: string,
  roundIndex: number,
): string {
  return `hosted-agent-v2:${turnId}:${roundIndex}`;
}
