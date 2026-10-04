import { FencedRecordStreamParser, hasOnlyKeys, resolveStreamReferences, type FencedStreamFormat, type FencedStreamRejection } from './fencedRecordStream';

/** Versioned text framing only. No inference from prose and no JavaScript evaluation. */
export const NODE_GRAPH_STREAM_TOOLS = [
  'addEffect', 'updateEffect', 'removeEffect', 'addFlockNode', 'updateFlockNode',
  'removeFlockNodes', 'connectFlockPorts', 'disconnectFlockEdge',
  'createImageNodeGraph', 'editOperatorGraph', 'addKeyframe',
] as const;

export const NODE_GRAPH_STREAM_PROTOCOL = {
  schemaVersion: 1, transport: 'Codex Direct assistant text deltas', fence: 'ms-nodegraph-v1',
  framing: 'JSON object records inside the exact fenced block. Separate records with whitespace (newlines recommended). Each record executes at its closing brace, without waiting for a newline, closing fence or response end. Multiple sequential blocks are supported; each begins with fresh sequence numbers and result aliases.',
  begin: { op: 'begin', schemaVersion: 1, clipId: '<existing active-timeline clip ID>' },
  operation: { op: 'tool', seq: 1, ref: 'uniqueAlias', tool: '<allowed tool>', args: {} },
  end: { op: 'end', lastSeq: 1 },
  fields: 'seq and lastSeq are integers counting from 1 per block. ref is a unique alias (letters, digits, _ or -) needed to reference that result later with resultReference; a missing ref defaults to s<seq>. Node IDs in args start with a letter and use only letters, digits, _ and - (no dots).',
  resultReference: { $ref: '<earlier result alias>', field: '<top-level result.data field, e.g. nodeId or effectId>' },
  allowedTools: NODE_GRAPH_STREAM_TOOLS,
  ownership: 'begin pins the existing clip. Operation args omit clipId; the browser supplies it. A new clip must already exist before begin.',
  effectTools: 'addEffect args: { effectType: "<catalog typeId, e.g. pixel-particle-disintegrate>", params? }. updateEffect args: { effectId: "<effect instance ID>", params }. removeEffect args: { effectId }. No other fields are accepted. addKeyframe args: { effectId, param, keys: [{ time, value, easing? }] } animates one effect or exposed graph parameter in one record (time in clip-local seconds; effectId may be {"$ref":"<addEffect or createImageNodeGraph alias>","field":"effectId"}); { property, value, time, easing? } sets a single key on any animatable property.',
  effectDefault: 'editOperatorGraph args may omit effectId: it defaults to the graph this block last created (createImageNodeGraph) or named explicitly.',
  order: 'Build in dataflow order, one record per node: each editOperatorGraph add carries its inputs, params and slider fields, and references only nodes added earlier. Do not add all nodes first and wire them afterwards; use separate connect records only for rewiring, feedback or the final output cable.',
  execution: 'Complete records execute immediately in sequence through normal editor policy and undo. Incomplete records never execute. Failed operations and malformed records are skipped, later records continue, and every skipped step is reported back with your next tool result. Failed result aliases remain unavailable. Cancellation or lost ownership stops execution; prior completed operations remain undoable. Reload does not replay a stream.',
} as const;

export type NodeGraphStreamRecord =
  | { op: 'begin'; schemaVersion: 1; clipId: string }
  | { op: 'tool'; seq: number; ref: string; tool: string; args: Record<string, unknown> }
  | { op: 'end'; lastSeq: number };

/** A skipped record inside an otherwise continuing stream. */
export type NodeGraphStreamRejection = FencedStreamRejection;

export const NODE_GRAPH_STREAM_FORMAT: FencedStreamFormat = {
  fence: 'ms-nodegraph-v1',
  label: 'Node stream',
  allowedTools: NODE_GRAPH_STREAM_TOOLS,
  aliasField: 'ref',
  forbiddenArgKeys: ['clipId'],
  invalidOperation: 'Invalid node operation, sequence, alias or clip ownership.',
  begin: value => value.op !== 'begin' || value.schemaVersion !== 1 || typeof value.clipId !== 'string'
    || !value.clipId || value.clipId.length > 200 || !hasOnlyKeys(value, ['op', 'schemaVersion', 'clipId'])
    ? { error: 'Node stream must begin with schemaVersion 1 and an existing clipId.' }
    : { record: { op: 'begin', schemaVersion: 1, clipId: value.clipId } },
};

export class NodeGraphStreamParser extends FencedRecordStreamParser<NodeGraphStreamRecord> {
  constructor(receive: (record: NodeGraphStreamRecord) => void, onRejected?: (rejection: NodeGraphStreamRejection) => void) {
    super(NODE_GRAPH_STREAM_FORMAT, receive, onRejected);
  }
}

export function resolveNodeGraphStreamReferences(value: unknown, results: Map<string, unknown>): unknown {
  return resolveStreamReferences(value, results, 'Node');
}
