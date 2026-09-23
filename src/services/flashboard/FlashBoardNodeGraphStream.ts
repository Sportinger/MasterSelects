import { useTimelineStore } from '../../stores/timeline';
import { EFFECT_REGISTRY } from '../../effects';
import type { ToolResult } from '../aiTools/types';
import { resolveNodeGraphStreamReferences, type NodeGraphStreamRecord } from '../nodeGraph/nodeGraphStream';

type Execute = (tool: string, args: Record<string, unknown>, id: string) => Promise<ToolResult>;

/** Executes explicit stream records through the same audited tool boundary as tool calls. */
export class FlashBoardNodeGraphStream {
  private clipId = '';
  private results = new Map<string, unknown>();
  private stopped = false;
  completedOperations = 0;
  private readonly execute: Execute;
  private readonly signal?: AbortSignal;
  constructor(execute: Execute, signal?: AbortSignal) { this.execute = execute; this.signal = signal; }
  stop(): void { this.stopped = true; }

  async accept(record: NodeGraphStreamRecord): Promise<void> {
    if (this.stopped || this.signal?.aborted) throw new Error('Node stream stopped.');
    if (record.op === 'end') return;
    if (record.op === 'begin') {
      this.clipId = record.clipId;
      await this.checked('focusNodeGraph', { clipId: this.clipId }, 'begin');
      return;
    }
    const state = useTimelineStore.getState();
    const clip = state.clips.find(c => c.id === this.clipId);
    if (!clip || state.isExporting || state.tracks.find(t => t.id === clip.trackId)?.locked) {
      throw new Error('Node stream owner is missing, locked or exporting.');
    }
    const args = resolveNodeGraphStreamReferences(record.args, this.results) as Record<string, unknown>;
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
    const result = await this.checked(record.tool, { ...args, clipId: this.clipId }, String(record.seq));
    this.results.set(record.ref, result.data);
    this.completedOperations++;
    // Let the graph projection paint between already-buffered operations as well.
    await new Promise<void>(resolve => setTimeout(resolve, 0));
  }

  private async checked(tool: string, args: Record<string, unknown>, sequence: string): Promise<ToolResult> {
    const result = await this.execute(tool, args, `node-stream:${sequence}`);
    if (!result.success) { this.stopped = true; throw new Error(result.error ?? `Node stream ${tool} failed.`); }
    return result;
  }
}
