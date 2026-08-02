import { getToolPolicy } from '../../aiTools/policy';
import { ATOMIC_EDITOR_TOOL_DEFINITIONS } from '../../aiTools/editorToolCatalog';
import {
  HOSTED_AGENT_FAST_V2_EDITOR_TOOL_CATALOG_DIGEST,
  HOSTED_AGENT_FAST_V2_MAX_TOOL_CALLS_PER_ROUND,
  type HostedAgentFastV2EditorToolCatalog,
  type HostedAgentFastV2EditorToolRisk,
} from './fastV2StartContract';

export interface KernelEditorToolRequest {
  args: Record<string, unknown>;
  toolName: string;
}

function riskForTool(toolName: string): HostedAgentFastV2EditorToolRisk | undefined {
  const policy = getToolPolicy(toolName);
  if (
    !policy
    || !policy.allowedCallers.includes('chat')
    || policy.localFileAccess
    || policy.sensitiveDataAccess
  ) return undefined;
  if (policy.readOnly) return 'read-only';
  return policy.riskLevel === 'high' ? 'destructive' : 'mutating';
}

function canonicalCatalogPayload(): Omit<HostedAgentFastV2EditorToolCatalog, 'digest'> {
  const names = new Set<string>();
  return {
    schemaVersion: 1,
    tools: ATOMIC_EDITOR_TOOL_DEFINITIONS.flatMap((tool) => {
      const name = tool.function.name;
      const risk = riskForTool(name);
      if (!risk) return [];
      if (names.has(name)) throw new Error(`Duplicate editor tool in Fast V2 catalog: ${name}`);
      names.add(name);
      return [{
        description: tool.function.description,
        name,
        parameters: structuredClone(tool.function.parameters) as Record<string, unknown>,
        risk,
      }];
    }),
  };
}

export function buildHostedAgentFastV2EditorToolCatalog(): HostedAgentFastV2EditorToolCatalog {
  return {
    ...canonicalCatalogPayload(),
    digest: HOSTED_AGENT_FAST_V2_EDITOR_TOOL_CATALOG_DIGEST,
  };
}

export function canonicalHostedAgentFastV2EditorToolCatalog(): string {
  return JSON.stringify(canonicalCatalogPayload());
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function parseKernelEditorToolRequest(value: unknown): KernelEditorToolRequest | null {
  if (!isRecord(value) || !Object.hasOwn(value, 'toolName') || !Object.hasOwn(value, 'args')) {
    return null;
  }
  if (
    Object.keys(value).some((key) => key !== 'toolName' && key !== 'args')
    || typeof value.toolName !== 'string'
    || !isRecord(value.args)
  ) {
    return null;
  }
  const catalog = buildHostedAgentFastV2EditorToolCatalog();
  const known = catalog.tools.some((tool) => tool.name === value.toolName);
  return known ? { args: value.args, toolName: value.toolName } : null;
}

export function parseKernelEditorToolBatch(value: unknown): KernelEditorToolRequest[] | null {
  if (
    !isRecord(value)
    || Object.keys(value).length !== 1
    || !Object.hasOwn(value, 'requests')
    || !Array.isArray(value.requests)
    || value.requests.length === 0
    || value.requests.length > HOSTED_AGENT_FAST_V2_MAX_TOOL_CALLS_PER_ROUND
  ) return null;
  const parsed = value.requests.map(parseKernelEditorToolRequest);
  return parsed.every((request): request is KernelEditorToolRequest => request !== null)
    ? parsed
    : null;
}

export function getKernelEditorToolRisk(
  toolName: string,
): HostedAgentFastV2EditorToolRisk | undefined {
  return riskForTool(toolName);
}
