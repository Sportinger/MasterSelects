/** Versioned text framing only. No inference from prose and no JavaScript evaluation. */
export const NODE_GRAPH_STREAM_TOOLS = [
  'addEffect', 'updateEffect', 'removeEffect', 'addFlockNode', 'updateFlockNode',
  'removeFlockNodes', 'connectFlockPorts', 'disconnectFlockEdge',
  'createImageNodeGraph', 'editOperatorGraph',
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
  effectDefault: 'editOperatorGraph args may omit effectId: it defaults to the graph this block last created (createImageNodeGraph) or named explicitly.',
  order: 'Build in dataflow order, one record per node: each editOperatorGraph add carries its inputs, params and slider fields, and references only nodes added earlier. Do not add all nodes first and wire them afterwards; use separate connect records only for rewiring, feedback or the final output cable.',
  execution: 'Complete records execute immediately in sequence through normal editor policy and undo. Incomplete records never execute. Failed operations and malformed records are skipped, later records continue, and every skipped step is reported back with your next tool result. Failed result aliases remain unavailable. Cancellation or lost ownership stops execution; prior completed operations remain undoable. Reload does not replay a stream.',
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
/** Models occasionally quote sequence numbers; only exact positive integers are accepted. */
function sequenceNumber(value: unknown): number | undefined {
  const number = typeof value === 'string' && /^\d{1,6}$/.test(value) ? Number(value) : value;
  return typeof number === 'number' && Number.isInteger(number) && number > 0 ? number : undefined;
}

/** A skipped record inside an otherwise continuing stream. */
export interface NodeGraphStreamRejection { seq?: number; tool?: string; args?: Record<string, unknown>; reason: string }

export class NodeGraphStreamParser {
  private buffer = '';
  private state: 'outside' | 'begin' | 'operations' | 'close' | 'done' = 'outside';
  private nextSequence = 1;
  private aliases = new Set<string>();
  private otherFence = false;
  private depth = 0;
  private quoted = false;
  private escaped = false;
  active = false;

  private readonly receive: (record: NodeGraphStreamRecord) => void;
  private readonly onRejected?: (rejection: NodeGraphStreamRejection) => void;
  /** Without onRejected every malformed record throws; with it, bad operation records are skipped and reported. */
  constructor(receive: (record: NodeGraphStreamRecord) => void, onRejected?: (rejection: NodeGraphStreamRejection) => void) {
    this.receive = receive; this.onRejected = onRejected;
  }

  push(delta: string): void {
    for (const character of delta) {
      if (this.state === 'begin' || this.state === 'operations') {
        if (!this.buffer && /\s/.test(character)) continue;
        // Models occasionally close a record with one brace too many; the stray `}` (or `]`, `,`)
        // between two records is reported and skipped instead of ending the whole stream.
        if (!this.buffer && this.state === 'operations' && this.onRejected && '}],'.includes(character)) {
          this.onRejected({ reason: `Stray "${character}" between records; it was skipped.` });
          continue;
        }
        if (!this.buffer && character !== '{') throw new Error('Expected a node stream object.');
        this.buffer += character;
        if (this.quoted) {
          if (this.escaped) this.escaped = false;
          else if (character === '\\') this.escaped = true;
          else if (character === '"') this.quoted = false;
        } else if (character === '"') this.quoted = true;
        else if (character === '{' || character === '[') this.depth++;
        else if (character === '}' || character === ']') this.depth--;
        if (this.depth === 0) {
          const complete = this.buffer;
          this.buffer = '';
          this.line(complete);
        }
      } else if (character === '\n') {
        const line = this.buffer.replace(/\r$/, '');
        this.buffer = '';
        // Whitespace between the end record and closing fence is framing.
        if (this.state !== 'close' || line.trim()) this.line(line);
      } else {
        this.buffer += character;
      }
    }
  }

  finish(): void {
    if (this.buffer) { this.line(this.buffer.replace(/\r$/, '')); this.buffer = ''; }
    if (this.active && this.state !== 'done') throw new Error('Node stream is incomplete: end record and closing fence required.');
  }

  private line(line: string): void {
    if (this.state === 'outside') {
      if (line === '```ms-nodegraph-v1' && !this.otherFence) {
        this.state = 'begin'; this.active = true;
      } else if (line.startsWith('```')) this.otherFence = !this.otherFence;
      return;
    }
    if (this.state === 'done') {
      if (line === '```ms-nodegraph-v1') {
        this.state = 'begin'; this.nextSequence = 1; this.aliases.clear();
      }
      return;
    }
    if (this.state === 'close') {
      if (line === '```') { this.state = 'done'; return; }
      if (!this.onRejected) throw new Error('Expected the node stream closing fence.');
      this.state = 'done'; this.line(line); return;
    }
    let value: unknown;
    try { value = JSON.parse(line); } catch {
      if (this.state === 'operations' && this.onRejected) { this.onRejected({ reason: 'Invalid JSON record; it was skipped.' }); return; }
      throw new Error('Invalid node stream JSON record.');
    }
    if (!object(value)) throw new Error('Expected a node stream object.');
    if (this.state === 'begin') {
      if (value.op !== 'begin' || value.schemaVersion !== 1 || typeof value.clipId !== 'string'
        || !value.clipId || value.clipId.length > 200 || !keys(value, ['op', 'schemaVersion', 'clipId'])) {
        throw new Error('Node stream must begin with schemaVersion 1 and an existing clipId.');
      }
      this.state = 'operations';
    } else if (value.op === 'end') {
      const lastSeq = sequenceNumber(value.lastSeq);
      if ((lastSeq !== this.nextSequence - 1 || !keys(value, ['op', 'lastSeq'])) && !this.onRejected) throw new Error('Node stream end sequence mismatch.');
      this.state = 'close';
      value = { op: 'end', lastSeq: this.nextSequence - 1 };
    } else {
      const seq = sequenceNumber(value.seq);
      const ref = value.ref === undefined && seq !== undefined ? `s${seq}` : value.ref;
      const reason = value.op !== 'tool' ? 'Unknown record op.'
        : seq !== this.nextSequence ? `Expected seq ${this.nextSequence}.`
        : typeof value.tool !== 'string' || !NODE_GRAPH_STREAM_TOOLS.includes(value.tool as typeof NODE_GRAPH_STREAM_TOOLS[number]) ? 'Tool is not allowed in a node stream.'
        : typeof ref !== 'string' || !/^[a-zA-Z][a-zA-Z0-9_-]{0,63}$/.test(ref) || this.aliases.has(ref) ? 'Invalid or duplicate ref alias.'
        : !object(value.args) || 'clipId' in value.args ? 'args must be an object without clipId.'
        : !keys(value, ['op', 'seq', 'ref', 'tool', 'args']) ? 'Unknown record field.' : undefined;
      if (reason) {
        if (!this.onRejected) throw new Error('Invalid node operation, sequence, alias or clip ownership.');
        // Resynchronize so one bad record does not cascade into every later sequence number.
        if (seq !== undefined && seq >= this.nextSequence) this.nextSequence = seq + 1;
        this.onRejected({ ...(seq !== undefined ? { seq } : {}), ...(typeof value.tool === 'string' ? { tool: value.tool } : {}),
          ...(object(value.args) ? { args: value.args } : {}), reason });
        return;
      }
      value = { op: 'tool', seq, ref, tool: value.tool, args: value.args };
      this.aliases.add(ref as string); this.nextSequence++;
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
