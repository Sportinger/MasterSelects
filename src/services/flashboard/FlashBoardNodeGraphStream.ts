import { useTimelineStore } from '../../stores/timeline';
import { EFFECT_REGISTRY, resolveEffectTypeId } from '../../effects';
import type { ToolResult } from '../aiTools/types';
import { resolveNodeGraphStreamReferences, type NodeGraphStreamRecord } from '../nodeGraph/nodeGraphStream';
import { yieldEditorPresentationFrame } from './yieldEditorPresentationFrame';

export interface NodeStreamFailure { seq: number; ref: string; tool: string; args: Record<string, unknown>; error: string; executed: boolean }

type Execute = (tool: string, args: Record<string, unknown>, id: string) => Promise<ToolResult>;

/** Executes explicit stream records through the same audited tool boundary as tool calls. */
export class FlashBoardNodeGraphStream {
  private clipId = '';
  private results = new Map<string, unknown>();
  private stopped = false;
  completedOperations = 0;
  readonly failures: NodeStreamFailure[] = [];
  private block = 0;
  /** Operator-graph edits may omit effectId; they target the graph this block last created or edited. */
  private lastEffectId: string | undefined;
  private readonly execute: Execute;
  private readonly signal?: AbortSignal;
  constructor(execute: Execute, signal?: AbortSignal) { this.execute = execute; this.signal = signal; }
  stop(): void { this.stopped = true; }

  async accept(record: NodeGraphStreamRecord): Promise<NodeStreamFailure | undefined> {
    if (this.stopped || this.signal?.aborted) throw new Error('Node stream stopped.');
    if (record.op === 'end') return;
    if (record.op === 'begin') {
      this.clipId = record.clipId;
      this.results.clear();
      this.lastEffectId = undefined;
      this.block++;
      await this.checked('focusNodeGraph', { clipId: this.clipId }, 'begin');
      return;
    }
    const state = useTimelineStore.getState();
    const clip = state.clips.find(c => c.id === this.clipId);
    if (!clip || state.isExporting || state.tracks.find(t => t.id === clip.trackId)?.locked) {
      throw new Error('Node stream owner is missing, locked or exporting.');
    }
    try {
      return await this.operation(record, clip);
    } catch (error) {
      if (this.stopped || this.signal?.aborted) throw error;
      return this.failed(record, error instanceof Error ? error.message : String(error), false);
    }
  }

  private async operation(record: Extract<NodeGraphStreamRecord, { op: 'tool' }>, clip: ReturnType<typeof useTimelineStore.getState>['clips'][number]): Promise<NodeStreamFailure | undefined> {
    const args = resolveNodeGraphStreamReferences(record.args, this.results) as Record<string, unknown>;
    if (record.tool === 'editOperatorGraph') {
      if (args.effectId === undefined && this.lastEffectId) args.effectId = this.lastEffectId;
      if (typeof args.effectId === 'string') this.lastEffectId = args.effectId;
    }
    if (record.tool === 'addEffect' && typeof args.effectType === 'string') args.effectType = resolveEffectTypeId(args.effectType);
    if (record.tool === 'addEffect' && typeof args.effectType !== 'string') {
      throw new Error(`addEffect needs effectType (the catalog typeId, e.g. "gaussian-blur"); got ${Object.keys(args).join(', ') || 'no fields'}.`);
    }
    if (record.tool.endsWith('Effect')) {
      const effect = record.tool === 'addEffect' ? undefined : clip.effects.find(e => e.id === args.effectId);
      if (record.tool !== 'addEffect' && !effect) throw new Error('Effect does not belong to the stream clip.');
      const definition = EFFECT_REGISTRY.get(record.tool === 'addEffect' ? String(args.effectType) : effect!.type);
      if (!definition) throw new Error(`Unknown effect type: ${String(args.effectType)}. Use the catalog typeId.`);
      const allowed = record.tool === 'addEffect' ? ['effectType', 'params'] : record.tool === 'updateEffect' ? ['effectId', 'params'] : ['effectId'];
      const unknown = Object.keys(args).filter(k => !allowed.includes(k));
      if (unknown.length) throw new Error(`${record.tool} does not accept ${unknown.join(', ')}; allowed: ${allowed.join(', ')}.`);
      if (args.params !== undefined) {
        if (!args.params || typeof args.params !== 'object' || Array.isArray(args.params)) throw new Error('Invalid effect parameters.');
        for (const [key, value] of Object.entries(args.params)) {
          const spec = definition.params[key];
          if (!spec || spec.hidden || typeof value !== typeof spec.default
            || (typeof value === 'number' && (!Number.isFinite(value) || (spec.min !== undefined && value < spec.min) || (spec.max !== undefined && value > spec.max)))
            || (spec.options && !spec.options.some(o => o.value === value))) throw new Error(`Invalid effect parameter: ${key}`);
        }
      }
    }
    const toolArgs = record.tool === 'addKeyframe' ? streamKeyframeArgs(args, this.clipId) : { ...args, clipId: this.clipId };
    const result = await this.execute(record.tool, toolArgs, this.operationId(String(record.seq)));
    if (!result.success) return this.failed(record, result.error ?? `${record.tool} failed.`, true);
    this.results.set(record.ref, result.data);
    const createdEffectId = record.tool === 'createImageNodeGraph' ? (result.data as { effectId?: unknown } | undefined)?.effectId : undefined;
    if (typeof createdEffectId === 'string') this.lastEffectId = createdEffectId;
    this.completedOperations++;
    await yieldEditorPresentationFrame();
  }

  private failed(record: Extract<NodeGraphStreamRecord, { op: 'tool' }>, error: string, executed: boolean): NodeStreamFailure {
    const failure = { seq: record.seq, ref: record.ref, tool: record.tool, args: record.args, error, executed };
    this.failures.push(failure);
    return failure;
  }

  private operationId(sequence: string): string {
    return this.block <= 1 ? `node-stream:${sequence}` : `node-stream:${this.block}:${sequence}`;
  }

  private async checked(tool: string, args: Record<string, unknown>, sequence: string): Promise<ToolResult> {
    const result = await this.execute(tool, args, this.operationId(sequence));
    if (!result.success) { this.stopped = true; throw new Error(result.error ?? `Node stream ${tool} failed.`); }
    return result;
  }
}

/**
 * Stream keyframes: `{ effectId, param, keys }` animates one effect parameter as one
 * atomic addKeyframe sequence; `{ property, value, time, easing? }` sets a single key.
 */
function streamKeyframeArgs(args: Record<string, unknown>, clipId: string): Record<string, unknown> {
  if (args.property !== undefined) {
    const unknown = Object.keys(args).filter(k => !['property', 'value', 'time', 'easing'].includes(k));
    if (unknown.length) throw new Error(`addKeyframe does not accept ${unknown.join(', ')} with property; allowed: property, value, time, easing.`);
    return { ...args, clipId };
  }
  const unknown = Object.keys(args).filter(k => !['effectId', 'param', 'keys'].includes(k));
  if (unknown.length) throw new Error(`addKeyframe does not accept ${unknown.join(', ')}; use { effectId, param, keys } or { property, value, time }.`);
  if (typeof args.effectId !== 'string' || typeof args.param !== 'string' || !Array.isArray(args.keys) || !args.keys.length) {
    throw new Error('addKeyframe needs effectId, param and a non-empty keys array.');
  }
  const property = `effect.${args.effectId}.${args.param}`;
  return { sequence: args.keys.map((key: unknown) => {
    const { time, value, easing } = (key ?? {}) as Record<string, unknown>;
    if (typeof time !== 'number' || typeof value !== 'number') throw new Error('Every addKeyframe key needs numeric time and value.');
    return { clipId, property, time, value, ...(typeof easing === 'string' ? { easing } : {}) };
  }) };
}
