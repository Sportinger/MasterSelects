import { useTimelineStore } from '../../stores/timeline';
import type { FlashBoardExecutedToolCall } from './FlashBoardChatTypes';
import type { NodeStreamFailure } from './FlashBoardNodeGraphStream';

const MAX_LISTED_FAILURES = 12;

function describeFailure(failure: NodeStreamFailure): string {
  const args = failure.args;
  const text = (value: unknown) => typeof value === 'string' && value ? value : undefined;
  const cable = text(args.fromNodeId) && text(args.toNodeId)
    ? `${text(args.fromNodeId)}.${text(args.fromPortId) ?? '?'} -> ${text(args.toNodeId)}.${text(args.toPortId) ?? '?'}` : undefined;
  const target = [text(args.action), text(args.operatorId), cable ? undefined : text(args.nodeId), cable].filter(Boolean).join(' ');
  return `#${failure.seq} ${failure.tool}${target ? ` ${target}` : ''}: ${failure.error}`;
}

/**
 * Streamed node records execute from text deltas, so the model never receives
 * their results. Failures are handed to it once, attached to its next tool result.
 */
export class NodeStreamFeedback {
  private reported = 0;
  private readonly failures: readonly NodeStreamFailure[];
  constructor(failures: readonly NodeStreamFailure[]) { this.failures = failures; }

  get unreported(): number { return this.failures.length - this.reported; }

  takeModelContentItems(): Array<Record<string, unknown>> {
    const fresh = this.failures.slice(this.reported);
    this.reported = this.failures.length;
    if (!fresh.length) return [];
    const text = [
      `Node stream report: ${fresh.length} streamed step(s) failed and were skipped; later steps still ran.`,
      ...fresh.slice(0, MAX_LISTED_FAILURES).map(describeFailure),
      ...(fresh.length > MAX_LISTED_FAILURES ? [`… and ${fresh.length - MAX_LISTED_FAILURES} more.`] : []),
      'Cables to a node that failed to add fail as well. Read getOperatorGraph for each affected effect, repair the gaps, and tell the user about anything that remains incomplete.',
    ].join('\n');
    return [{ text, type: 'inputText' }];
  }
}

/** Effects the turn edited whose saved graph is still paused as incomplete. */
function incompleteEditedGraphs(calls: readonly FlashBoardExecutedToolCall[]): Array<{ name: string; reason: string }> {
  const effectIds = new Set<string>();
  for (const call of calls) {
    try {
      const args = JSON.parse(call.toolCall.arguments) as Record<string, unknown>;
      if (typeof args.effectId === 'string') effectIds.add(args.effectId);
    } catch { /* Arguments are audit data; malformed entries carry no effect. */ }
    const data = call.result.data as Record<string, unknown> | undefined;
    if (typeof data?.effectId === 'string') effectIds.add(data.effectId);
  }
  if (!effectIds.size) return [];
  return useTimelineStore.getState().clips.flatMap(clip => clip.effects.flatMap(effect =>
    effectIds.has(effect.id) && typeof effect.operatorGraph?.incomplete === 'string'
      ? [{ name: effect.name, reason: effect.operatorGraph.incomplete }] : []));
}

/** Visible chat warning, so a final "done" never hides failed streamed edits. */
export function nodeStreamUserNotice(failures: readonly NodeStreamFailure[], feedback: NodeStreamFeedback,
  calls: readonly FlashBoardExecutedToolCall[]): string | undefined {
  if (!failures.length) return undefined;
  const incomplete = incompleteEditedGraphs(calls);
  if (!incomplete.length && !feedback.unreported) return undefined;
  const lines = [`⚠ Node-Stream: ${failures.length} Schritt(e) fehlgeschlagen.`];
  for (const graph of incomplete) lines.push(`„${graph.name}“ ist unvollständig und pausiert: ${graph.reason}`);
  if (!incomplete.length) lines.push('Der Agent hat die Fehler nicht mehr geprüft; bitte den Graphen kontrollieren.');
  return lines.join('\n');
}
