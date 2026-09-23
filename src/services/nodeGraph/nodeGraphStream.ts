/** Versioned text framing only. No inference from prose and no JavaScript evaluation. */
export const NODE_GRAPH_STREAM_TOOLS = [
  'addEffect', 'updateEffect', 'removeEffect', 'addFlockNode', 'updateFlockNode',
  'removeFlockNodes', 'connectFlockPorts', 'disconnectFlockEdge',
  'createImageNodeGraph', 'editOperatorGraph',
] as const;

export const NODE_GRAPH_STREAM_PROTOCOL = {
  schemaVersion: 1, transport: 'Codex Direct assistant text deltas', fence: 'ms-nodegraph-v1',
  framing: 'One JSON record per newline inside the exact fenced block. One block per turn.',
  begin: { op: 'begin', schemaVersion: 1, clipId: '<existing active-timeline clip ID>' },
  operation: { op: 'tool', seq: 1, ref: '<unique result alias>', tool: '<allowed tool>', args: {} },
  end: { op: 'end', lastSeq: '<last operation sequence number>' },
  resultReference: { $ref: '<earlier result alias>', field: '<top-level result.data field, e.g. nodeId or effectId>' },
  allowedTools: NODE_GRAPH_STREAM_TOOLS,
  ownership: 'begin pins the existing clip. Operation args omit clipId; the browser supplies it. A new clip must already exist before begin.',
  execution: 'Complete records execute immediately in sequence through normal editor policy and undo. Incomplete records never execute. On error/cancel prior completed operations remain undoable; later operations stop. Reload does not replay a stream.',
  limits: { operations: 128, lineCharacters: 65536, streamCharacters: 1048576 },
} as const;

export type NodeGraphStreamRecord =
  | { op: 'begin'; schemaVersion: 1; clipId: string }
  | { op: 'tool'; seq: number; ref: string; tool: string; args: Record<string, unknown> }
  | { op: 'end'; lastSeq: number };

function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
function keys(value: Record<string, unknown>, allowed: string[]): boolean {
  return Object.keys(value).every(key => allowed.includes(key));
}

export class NodeGraphStreamParser {
  private buffer = '';
  private state: 'outside' | 'begin' | 'operations' | 'close' | 'done' = 'outside';
  private nextSequence = 1;
  private aliases = new Set<string>();
  private characters = 0;
  private otherFence = false;
  active = false;

  private readonly receive: (record: NodeGraphStreamRecord) => void;
  constructor(receive: (record: NodeGraphStreamRecord) => void) { this.receive = receive; }

  push(delta: string): void {
    this.buffer += delta;
    let newline: number;
    while ((newline = this.buffer.indexOf('\n')) >= 0) {
      const line = this.buffer.slice(0, newline).replace(/\r$/, '');
      this.buffer = this.buffer.slice(newline + 1);
      this.line(line);
    }
    if (this.buffer.length > 65536) throw new Error('Node stream line exceeds the size limit.');
  }

  finish(): void {
    if (this.buffer) { this.line(this.buffer.replace(/\r$/, '')); this.buffer = ''; }
    if (this.active && this.state !== 'done') throw new Error('Node stream is incomplete: end record and closing fence required.');
  }

  private line(line: string): void {
    if (line.length > 65536) throw new Error('Node stream line exceeds the size limit.');
    if (this.state === 'outside') {
      if (line === '```ms-nodegraph-v1' && !this.otherFence) {
        this.state = 'begin'; this.active = true;
      } else if (line.startsWith('```')) this.otherFence = !this.otherFence;
      return;
    }
    if (this.state === 'done') {
      if (line === '```ms-nodegraph-v1') throw new Error('Only one node stream is allowed per turn.');
      return;
    }
    this.characters += line.length + 1;
    if (this.characters > 1048576) throw new Error('Node stream exceeds the size limit.');
    if (this.state === 'close') {
      if (line !== '```') throw new Error('Expected the node stream closing fence.');
      this.state = 'done'; return;
    }
    let value: unknown;
    try { value = JSON.parse(line); } catch { throw new Error('Invalid node stream JSON record.'); }
    if (!object(value)) throw new Error('Expected a node stream object.');
    if (this.state === 'begin') {
      if (value.op !== 'begin' || value.schemaVersion !== 1 || typeof value.clipId !== 'string'
        || !value.clipId || value.clipId.length > 200 || !keys(value, ['op', 'schemaVersion', 'clipId'])) {
        throw new Error('Node stream must begin with schemaVersion 1 and an existing clipId.');
      }
      this.state = 'operations';
    } else if (value.op === 'end') {
      if (value.lastSeq !== this.nextSequence - 1 || !keys(value, ['op', 'lastSeq'])) throw new Error('Node stream end sequence mismatch.');
      this.state = 'close';
    } else {
      if (value.op !== 'tool' || value.seq !== this.nextSequence || this.nextSequence > 128
        || typeof value.tool !== 'string' || !NODE_GRAPH_STREAM_TOOLS.includes(value.tool as typeof NODE_GRAPH_STREAM_TOOLS[number])
        || typeof value.ref !== 'string' || !/^[a-zA-Z][a-zA-Z0-9_-]{0,63}$/.test(value.ref) || this.aliases.has(value.ref)
        || !object(value.args) || 'clipId' in value.args || !keys(value, ['op', 'seq', 'ref', 'tool', 'args'])) {
        throw new Error('Invalid node operation, sequence, alias or clip ownership.');
      }
      this.aliases.add(value.ref); this.nextSequence++;
    }
    this.receive(value as NodeGraphStreamRecord);
  }
}

export function resolveNodeGraphStreamReferences(value: unknown, results: Map<string, unknown>, depth = 0): unknown {
  if (depth > 16) throw new Error('Node stream arguments are too deeply nested.');
  if (Array.isArray(value)) return value.map(v => resolveNodeGraphStreamReferences(v, results, depth + 1));
  if (!object(value)) return value;
  if ('$ref' in value) {
    if (!keys(value, ['$ref', 'field']) || typeof value.$ref !== 'string' || typeof value.field !== 'string'
      || ['__proto__', 'constructor', 'prototype', 'clipId'].includes(value.field)) throw new Error('Invalid node result reference.');
    const result = results.get(value.$ref);
    if (!object(result) || !Object.hasOwn(result, value.field)) throw new Error('Node result reference is missing.');
    const field = result[value.field];
    if (!['string', 'number', 'boolean'].includes(typeof field)) throw new Error('Node result references must resolve to scalar fields.');
    return field;
  }
  if (Object.keys(value).some(k => ['__proto__', 'prototype', 'constructor'].includes(k))) throw new Error('Invalid node argument key.');
  return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, resolveNodeGraphStreamReferences(v, results, depth + 1)]));
}
