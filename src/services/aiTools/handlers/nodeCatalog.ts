import { AGENT_NODE_KINDS, getAgentNodeCatalog, summarizeAgentNode } from '../../nodeGraph/agentNodeCatalog';
import type { ToolResult } from '../types';

const fail = (error: string): ToolResult => ({ success: false, error });

export async function handleSearchNodeCatalog(args: Record<string, unknown>): Promise<ToolResult> {
  const allowed = ['query', 'kind', 'context', 'inputType', 'outputType', 'offset', 'limit'];
  if (Object.keys(args).some(key => !allowed.includes(key))) return fail('Unknown catalog search argument.');
  for (const [key, max] of [['query', 200], ['context', 100], ['inputType', 80], ['outputType', 80]] as const) {
    if (args[key] !== undefined && (typeof args[key] !== 'string' || (args[key] as string).length > max)) return fail(`Invalid ${key}.`);
  }
  if (args.kind !== undefined && !AGENT_NODE_KINDS.includes(args.kind as typeof AGENT_NODE_KINDS[number])) return fail('Unknown node kind.');
  const offset = args.offset ?? 0, limit = args.limit ?? 12;
  if (typeof offset !== 'number' || !Number.isInteger(offset) || offset < 0 || offset > 100000
    || typeof limit !== 'number' || !Number.isInteger(limit) || limit < 1 || limit > 30) return fail('Invalid pagination: offset 0..100000 and limit 1..30 must be integers.');
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
  if (Object.keys(args).some(key => key !== 'ids') || !Array.isArray(ids) || ids.length < 1 || ids.length > 8
    || ids.some(id => typeof id !== 'string' || id.length < 1 || id.length > 160) || new Set(ids).size !== ids.length) {
    return fail('ids must contain 1..8 unique exact catalog IDs.');
  }
  const byId = new Map(getAgentNodeCatalog().map(entry => [entry.id, entry]));
  return { success: true, data: { definitions: ids.flatMap(id => byId.has(id) ? [byId.get(id)!] : []),
    missingIds: ids.filter(id => !byId.has(id)) } };
}
