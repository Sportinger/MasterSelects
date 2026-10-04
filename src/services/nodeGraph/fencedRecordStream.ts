/**
 * Fenced JSON record streams in assistant text: a ```<fence> block holds a begin record, tool
 * records and an end record. Records execute at their closing brace, before the response ends.
 * Text framing only: no inference from prose and no JavaScript evaluation. The node-graph stream
 * (ms-nodegraph-v1) and the scene stream (ms-scene-v1) are two formats of this parser.
 */

export type FencedStreamRecord =
  | ({ op: 'begin' } & Record<string, unknown>)
  | { op: 'tool'; seq: number; ref: string; tool: string; args: Record<string, unknown> }
  | { op: 'end'; lastSeq: number };

export interface FencedStreamFormat {
  /** Fence info string, e.g. "ms-nodegraph-v1". */
  fence: string;
  /** Name used in messages, e.g. "Node stream". */
  label: string;
  allowedTools: readonly string[];
  /** Record field that names a result alias ("ref" or "key"). */
  aliasField: 'ref' | 'key';
  /** Argument keys a record must not set (the executor supplies them). */
  forbiddenArgKeys: readonly string[];
  /** Validates the begin record: the normalized record or an error message. */
  begin(value: Record<string, unknown>): { record: { op: 'begin' } & Record<string, unknown> } | { error: string };
  /** Thrown for a bad operation record when no rejection handler is supplied. */
  invalidOperation: string;
}

/** A skipped record inside an otherwise continuing stream. */
export interface FencedStreamRejection { seq?: number; tool?: string; args?: Record<string, unknown>; reason: string }

export function isRecordObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
export function hasOnlyKeys(value: Record<string, unknown>, allowed: readonly string[]): boolean {
  return Object.keys(value).every(key => allowed.includes(key));
}
/** Models occasionally quote sequence numbers; only exact positive integers are accepted. */
function sequenceNumber(value: unknown): number | undefined {
  const number = typeof value === 'string' && /^\d{1,6}$/.test(value) ? Number(value) : value;
  return typeof number === 'number' && Number.isInteger(number) && number > 0 ? number : undefined;
}

export class FencedRecordStreamParser<R extends FencedStreamRecord = FencedStreamRecord> {
  private buffer = '';
  private state: 'outside' | 'begin' | 'operations' | 'close' | 'done' = 'outside';
  private nextSequence = 1;
  private aliases = new Set<string>();
  private otherFence = false;
  private depth = 0;
  private quoted = false;
  private escaped = false;
  active = false;

  private readonly format: FencedStreamFormat;
  private readonly lower: string;
  private readonly receive: (record: R) => void;
  private readonly onRejected?: (rejection: FencedStreamRejection) => void;
  /** Without onRejected every malformed record throws; with it, bad operation records are skipped and reported. */
  constructor(format: FencedStreamFormat, receive: (record: R) => void, onRejected?: (rejection: FencedStreamRejection) => void) {
    this.format = format; this.lower = format.label.toLowerCase();
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
        if (!this.buffer && character !== '{') throw new Error(`Expected a ${this.lower} object.`);
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
    if (this.active && this.state !== 'done') throw new Error(`${this.format.label} is incomplete: end record and closing fence required.`);
  }

  private line(line: string): void {
    const opening = '```' + this.format.fence;
    if (this.state === 'outside') {
      if (line === opening && !this.otherFence) {
        this.state = 'begin'; this.active = true;
      } else if (line.startsWith('```')) this.otherFence = !this.otherFence;
      return;
    }
    if (this.state === 'done') {
      if (line === opening) {
        this.state = 'begin'; this.nextSequence = 1; this.aliases.clear();
      }
      return;
    }
    if (this.state === 'close') {
      if (line === '```') { this.state = 'done'; return; }
      if (!this.onRejected) throw new Error(`Expected the ${this.lower} closing fence.`);
      this.state = 'done'; this.line(line); return;
    }
    let value: unknown;
    try { value = JSON.parse(line); } catch {
      if (this.state === 'operations' && this.onRejected) { this.onRejected({ reason: 'Invalid JSON record; it was skipped.' }); return; }
      throw new Error(`Invalid ${this.lower} JSON record.`);
    }
    if (!isRecordObject(value)) throw new Error(`Expected a ${this.lower} object.`);
    if (this.state === 'begin') {
      const begin = this.format.begin(value);
      if ('error' in begin) throw new Error(begin.error);
      this.state = 'operations';
      value = begin.record;
    } else if (value.op === 'end') {
      const lastSeq = sequenceNumber(value.lastSeq);
      if ((lastSeq !== this.nextSequence - 1 || !hasOnlyKeys(value, ['op', 'lastSeq'])) && !this.onRejected) throw new Error(`${this.format.label} end sequence mismatch.`);
      this.state = 'close';
      value = { op: 'end', lastSeq: this.nextSequence - 1 };
    } else {
      const seq = sequenceNumber(value.seq);
      const aliasField = this.format.aliasField;
      const ref = value[aliasField] === undefined && seq !== undefined ? `s${seq}` : value[aliasField];
      const forbidden = this.format.forbiddenArgKeys;
      const args = value.args;
      const reason = value.op !== 'tool' ? 'Unknown record op.'
        : seq !== this.nextSequence ? `Expected seq ${this.nextSequence}.`
        : typeof value.tool !== 'string' || !this.format.allowedTools.includes(value.tool) ? `Tool is not allowed in a ${this.lower}.`
        : typeof ref !== 'string' || !/^[a-zA-Z][a-zA-Z0-9_-]{0,63}$/.test(ref) || this.aliases.has(ref) ? `Invalid or duplicate ${aliasField} alias.`
        : !isRecordObject(args) || forbidden.some(key => key in args)
          ? (forbidden.length ? `args must be an object without ${forbidden.join(', ')}.` : 'args must be an object.')
        : !hasOnlyKeys(value, ['op', 'seq', aliasField, 'tool', 'args']) ? 'Unknown record field.' : undefined;
      if (reason) {
        if (!this.onRejected) throw new Error(this.format.invalidOperation);
        // Resynchronize so one bad record does not cascade into every later sequence number.
        if (seq !== undefined && seq >= this.nextSequence) this.nextSequence = seq + 1;
        this.onRejected({ ...(seq !== undefined ? { seq } : {}), ...(typeof value.tool === 'string' ? { tool: value.tool } : {}),
          ...(isRecordObject(value.args) ? { args: value.args } : {}), reason });
        return;
      }
      value = { op: 'tool', seq, ref, tool: value.tool, args: value.args };
      this.aliases.add(ref as string); this.nextSequence++;
    }
    this.receive(value as R);
  }
}

/** Replace {"$ref": alias, "field": name} with an earlier result's scalar field. */
export function resolveStreamReferences(value: unknown, results: Map<string, unknown>, label = 'Node', depth = 0): unknown {
  if (depth > 16) throw new Error(`${label} stream arguments are too deeply nested.`);
  if (Array.isArray(value)) return value.map(v => resolveStreamReferences(v, results, label, depth + 1));
  if (!isRecordObject(value)) return value;
  if ('$ref' in value) {
    if (!hasOnlyKeys(value, ['$ref', 'field']) || typeof value.$ref !== 'string' || typeof value.field !== 'string'
      || ['__proto__', 'constructor', 'prototype', 'clipId'].includes(value.field)) throw new Error(`Invalid ${label.toLowerCase()} result reference.`);
    const result = results.get(value.$ref);
    if (!isRecordObject(result) || !Object.hasOwn(result, value.field)) throw new Error(`${label} result reference is missing.`);
    const field = result[value.field];
    if (!['string', 'number', 'boolean'].includes(typeof field)) throw new Error(`${label} result references must resolve to scalar fields.`);
    return field;
  }
  if (Object.keys(value).some(k => ['__proto__', 'prototype', 'constructor'].includes(k))) throw new Error(`Invalid ${label.toLowerCase()} argument key.`);
  return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, resolveStreamReferences(v, results, label, depth + 1)]));
}
