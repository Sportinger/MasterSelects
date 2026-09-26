import { AGENT_NODE_DEFINITION_LEGEND, AGENT_NODE_KINDS, buildAgentNodeCatalogText, compactAgentNodeDefinition, getAgentNodeCatalog, summarizeAgentNode } from '../../nodeGraph/agentNodeCatalog';
import type { ToolResult } from '../types';

const fail = (error: string): ToolResult => ({ success: false, error });

export async function handleSearchNodeCatalog(args: Record<string, unknown>): Promise<ToolResult> {
  const allowed = ['query', 'kind', 'context', 'inputType', 'outputType', 'offset', 'limit', 'list'];
  if (Object.keys(args).some(key => !allowed.includes(key))) return fail('Unknown catalog search argument.');
  if (args.list !== undefined && typeof args.list !== 'boolean') return fail('list must be a boolean.');
  // The whole inventory as one compact text list, fetched only when a turn authors nodes.
  if (args.list === true) return { success: true, data: { catalog: buildAgentNodeCatalogText() } };
  for (const [key, max] of [['query', 200], ['context', 100], ['inputType', 80], ['outputType', 80]] as const) {
    if (args[key] !== undefined && (typeof args[key] !== 'string' || (args[key] as string).length > max)) return fail(`Invalid ${key}.`);
  }
  if (args.kind !== undefined && !AGENT_NODE_KINDS.includes(args.kind as typeof AGENT_NODE_KINDS[number])) return fail('Unknown node kind.');
  const offset = args.offset ?? 0, limit = args.limit ?? 12;
  if (typeof offset !== 'number' || !Number.isSafeInteger(offset) || offset < 0
    || typeof limit !== 'number' || !Number.isSafeInteger(limit) || limit < 1) return fail('Invalid pagination: offset must be a non-negative safe integer and limit a positive safe integer.');
  const query = ((args.query as string | undefined) ?? '').trim().toLowerCase();
  const terms = query.split(/\s+/).filter(Boolean);
  const context = ((args.context as string | undefined) ?? '').trim().toLowerCase();
  const matches = getAgentNodeCatalog().filter(entry => {
    const search = `${entry.id} ${entry.typeId} ${entry.label} ${entry.description} ${entry.category} ${entry.context} ${[...entry.inputs, ...entry.outputs].map(p => `${p.type} ${(p.formats ?? []).join(' ')}`).join(' ')}`.toLowerCase();
    return (!args.kind || entry.kind === args.kind) && entry.context.toLowerCase().includes(context)
      && (!args.inputType || entry.inputs.some(p => p.type === args.inputType))
      && (!args.outputType || entry.outputs.some(p => p.type === args.outputType))
      && terms.every(term => search.includes(term));
  });
  const rank = (entry: typeof matches[number]) => entry.id.toLowerCase() === query ? 0 : entry.label.toLowerCase() === query ? 1 : 2;
  const sorted = matches.toSorted((a, b) => rank(a) - rank(b) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return { success: true, data: { totalMatches: sorted.length, offset,
    nextOffset: offset + limit < sorted.length ? offset + limit : null,
    entries: sorted.slice(offset, offset + limit).map(summarizeAgentNode) } };
}

export async function handleGetNodeDefinitions(args: Record<string, unknown>): Promise<ToolResult> {
  const ids = args.ids;
  if (args.detail !== undefined && args.detail !== 'compact' && args.detail !== 'full') return fail('detail must be compact or full.');
  if (Object.keys(args).some(key => key !== 'ids' && key !== 'detail') || !Array.isArray(ids) || ids.length < 1
    || ids.some(id => typeof id !== 'string' || id.length < 1 || id.length > 160) || new Set(ids).size !== ids.length) {
    return fail('ids must contain unique exact catalog IDs (at least one).');
  }
  const byId = new Map(getAgentNodeCatalog().map(entry => [entry.id, entry]));
  const found = ids.flatMap(id => byId.has(id) ? [byId.get(id)!] : []);
  return { success: true, data: { ...(args.detail === 'full' ? { definitions: found }
    : { legend: AGENT_NODE_DEFINITION_LEGEND, definitions: found.map(compactAgentNodeDefinition) }),
    missingIds: ids.filter(id => !byId.has(id)) } };
}
