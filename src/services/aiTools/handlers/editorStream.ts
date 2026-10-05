// runEditorStream: run ms-scene-v1 and ms-nodegraph-v1 blocks sent as one text (dev bridge,
// chat, console) through the same parsers and executors as the live FlashBoard stream. Tool
// calls arrive complete, so the text is validated first: nothing runs when any record is
// malformed. Live, record-by-record execution happens where text arrives as model deltas
// (FlashBoard Codex Direct).

import { useTimelineStore } from '../../../stores/timeline';
import { useMediaStore } from '../../../stores/mediaStore';
import type { ToolResult } from '../types';
import { checkToolAccess, type CallerContext } from '../policy';
import { executeToolInternal } from './index';
import { NODE_GRAPH_STREAM_PROTOCOL, NodeGraphStreamParser, type NodeGraphStreamRecord } from '../../nodeGraph/nodeGraphStream';
import type { FencedRecordStreamParser, FencedStreamRejection } from '../../nodeGraph/fencedRecordStream';
import { FlashBoardNodeGraphStream } from '../../flashboard/FlashBoardNodeGraphStream';
import { SCENE_STREAM_PROTOCOL, SceneStreamParser, type SceneStreamRecord } from '../../scenes/sceneStream';
import { SceneStreamExecutor, type SceneRunSummary } from '../../scenes/sceneStreamExecutor';
import { listScenes, readSceneStream } from '../../scenes/sceneDocuments';

type QueuedRecord = { kind: 'scene'; record: SceneStreamRecord } | { kind: 'node'; record: NodeGraphStreamRecord };
type Execute = (tool: string, args: Record<string, unknown>) => Promise<ToolResult>;
interface StreamFailure { stream: string; seq: number; ref: string; tool: string; error: string }

const message = (error: unknown) => error instanceof Error ? error.message : String(error);
const describeRejection = (fence: string, rejection: FencedStreamRejection) =>
  `${fence}${rejection.seq ? ` seq ${rejection.seq}` : ''}${rejection.tool ? ` (${rejection.tool})` : ''}: ${rejection.reason}`;

/** Parsers for both formats plus their executors; records queue in text order and run on drain(). */
class EditorStreamRun {
  readonly queue: QueuedRecord[] = [];
  readonly problems: string[] = [];
  readonly scenes: SceneStreamExecutor;
  readonly nodes: FlashBoardNodeGraphStream;
  stopped: string | undefined;
  private readonly parsers: Array<{ fence: string; dead: boolean; parser: FencedRecordStreamParser<SceneStreamRecord> | FencedRecordStreamParser<NodeGraphStreamRecord> }>;

  constructor(execute: Execute, signal?: AbortSignal) {
    this.scenes = new SceneStreamExecutor(execute, signal);
    this.nodes = new FlashBoardNodeGraphStream((tool, args) => execute(tool, args), signal);
    this.parsers = [
      { fence: 'ms-scene-v1', dead: false, parser: new SceneStreamParser(record => this.queue.push({ kind: 'scene', record }),
        rejection => this.problems.push(describeRejection('ms-scene-v1', rejection))) },
      { fence: 'ms-nodegraph-v1', dead: false, parser: new NodeGraphStreamParser(record => this.queue.push({ kind: 'node', record }),
        rejection => this.problems.push(describeRejection('ms-nodegraph-v1', rejection))) },
    ];
  }

  /** Feed text line by line through both parsers in turn, so interleaved blocks keep their order. */
  feed(text: string): void {
    const lines = text.replace(/\r\n/g, '\n').split('\n');
    lines.forEach((line, index) => {
      const segment = index < lines.length - 1 ? `${line}\n` : line;
      if (segment) this.parse(segment);
    });
  }

  end(): void {
    for (const entry of this.parsers) {
      if (entry.dead) continue;
      try { entry.parser.finish(); } catch (error) { this.problems.push(`${entry.fence}: ${message(error)}`); }
    }
  }

  private parse(segment: string): void {
    for (const entry of this.parsers) {
      if (entry.dead) continue;
      try { entry.parser.push(segment); } catch (error) {
        entry.dead = true;
        this.problems.push(`${entry.fence}: ${message(error)} (at "${segment.trim().slice(0, 120)}")`);
      }
    }
  }

  /** Execute queued records in order; a stop (lost owner, export, cancel) ends the run. */
  async drain(): Promise<number> {
    let ran = 0;
    while (this.queue.length && !this.stopped) {
      const item = this.queue.shift()!;
      try {
        if (item.kind === 'scene') await this.scenes.accept(item.record);
        else await this.nodes.accept(item.record);
        if (item.record.op === 'tool') ran++;
      } catch (error) {
        this.stopped = message(error);
      }
    }
    return ran;
  }

  failures(): StreamFailure[] {
    return [
      ...this.scenes.failures.map(({ seq, ref, tool, error }) => ({ stream: 'ms-scene-v1', seq, ref, tool, error })),
      ...this.nodes.failures.map(({ seq, ref, tool, error }) => ({ stream: 'ms-nodegraph-v1', seq, ref, tool, error })),
    ];
  }

  executed(): number {
    return this.scenes.summaries.reduce((sum, summary) => sum + summary.executed, 0) + this.scenes.openExecuted + this.nodes.completedOperations;
  }
}

function executorFor(callerContext: CallerContext, signal?: AbortSignal): Execute {
  return (tool, args) => {
    const access = checkToolAccess(tool, callerContext);
    if (!access.allowed) return Promise.resolve<ToolResult>({ success: false, error: access.reason });
    return executeToolInternal(tool, args, useTimelineStore.getState(), useMediaStore.getState(), callerContext, signal);
  };
}

/** Parse complete text without running it (tests, dry runs). */
export function parseEditorStream(text: string): { records: QueuedRecord[]; problems: string[] } {
  const run = new EditorStreamRun(() => Promise.resolve({ success: false, error: 'parse only' }));
  run.feed(text);
  run.end();
  return { records: run.queue, problems: run.problems };
}

// ── Tool entry points ───────────────────────────────────────────────────────

export async function handleRunEditorStream(args: Record<string, unknown>, callerContext: CallerContext = 'internal', signal?: AbortSignal): Promise<ToolResult> {
  if (useTimelineStore.getState().isExporting) return { success: false, error: 'Editor streams cannot run while exporting.' };
  let text = typeof args.text === 'string' ? args.text : '';
  if (!text && typeof args.scene === 'string') {
    text = readSceneStream(args.scene.trim()) ?? '';
    if (!text) return { success: false, error: `No stored scene "${args.scene}". Stored scenes: ${listScenes().map(item => item.scene).join(', ') || 'none'}.` };
  }
  if (!text.trim()) return { success: false, error: 'text (stream blocks) or scene (a stored scene name) is required.' };
  if (text.length > 2_000_000) return { success: false, error: 'Stream text is larger than 2 MB; split it into several runs.' };

  const run = new EditorStreamRun(executorFor(callerContext, signal), signal);
  run.feed(text);
  run.end();
  const problems = [...run.problems];
  for (const item of run.queue) {
    if (item.record.op !== 'tool') continue;
    const access = checkToolAccess(item.record.tool, callerContext);
    if (!access.allowed) problems.push(`${item.kind === 'scene' ? 'ms-scene-v1' : 'ms-nodegraph-v1'} seq ${item.record.seq} (${item.record.tool}): ${access.reason}`);
  }
  if (!run.queue.length && !problems.length) {
    problems.push('No ```ms-scene-v1 or ```ms-nodegraph-v1 block found. Each block needs an opening fence line, a begin record, tool records, an end record and a closing ``` line.');
  }
  const records = run.queue.filter(item => item.record.op === 'tool').length;
  if (problems.length) {
    return { success: false, error: `Stream rejected before running anything (${problems.length} problem${problems.length > 1 ? 's' : ''}): ${problems.slice(0, 20).join(' | ')}`,
      data: { executed: 0, problems } };
  }
  if (args.dryRun === true) {
    return { success: true, data: { dryRun: true, blocks: run.queue.filter(item => item.record.op === 'begin').length, records } };
  }

  await run.drain();
  try { run.scenes.finish(); } catch (error) { run.stopped ??= message(error); }
  const failures = run.failures();
  const executed = run.executed();
  const scenes: SceneRunSummary[] = run.scenes.summaries;
  const data = { executed, records, failures, scenes, nodeOperations: run.nodes.completedOperations, ...(run.stopped ? { stopped: run.stopped } : {}) };
  if (run.stopped || failures.length) {
    const reasons = [...(run.stopped ? [`stopped: ${run.stopped}`] : []), ...failures.slice(0, 12).map(failure => `${failure.stream} seq ${failure.seq} ${failure.tool}: ${failure.error}`)];
    return { success: false, error: `${executed}/${records} records ran; ${reasons.join(' | ')}`, data };
  }
  return { success: true, data };
}

export async function handleGetStreamProtocol(args: Record<string, unknown>): Promise<ToolResult> {
  if (args.format === 'ms-scene-v1') return { success: true, data: { protocol: SCENE_STREAM_PROTOCOL } };
  if (args.format === 'ms-nodegraph-v1') return { success: true, data: { protocol: NODE_GRAPH_STREAM_PROTOCOL } };
  return { success: false, error: 'format must be ms-scene-v1 or ms-nodegraph-v1.' };
}

export async function handleListScenes(): Promise<ToolResult> {
  return { success: true, data: { scenes: listScenes() } };
}
