import { useTimelineStore } from '../../stores/timeline';
import { EFFECT_REGISTRY } from '../../effects';
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
    if (record.tool.endsWith('Effect')) {
      const effect = record.tool === 'addEffect' ? undefined : clip.effects.find(e => e.id === args.effectId);
      if (record.tool !== 'addEffect' && !effect) throw new Error('Effect does not belong to the stream clip.');
      const definition = EFFECT_REGISTRY.get(record.tool === 'addEffect' ? String(args.effectType) : effect!.type);
      if (!definition) throw new Error('Unknown stream effect type.');
      const allowed = record.tool === 'addEffect' ? ['effectType', 'params'] : record.tool === 'updateEffect' ? ['effectId', 'params'] : ['effectId'];
      if (Object.keys(args).some(k => !allowed.includes(k))) throw new Error('Unknown stream effect argument.');
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
    const result = await this.execute(record.tool, { ...args, clipId: this.clipId }, this.operationId(String(record.seq)));
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
