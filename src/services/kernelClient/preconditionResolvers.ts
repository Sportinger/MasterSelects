import {
  executeAIToolCalls,
  type AIToolCallExecution,
} from '../aiTools';
import type { KernelMissingPrecondition } from './types';

const POLL_INTERVAL_MS = 2_000;
const TRANSCRIPT_DEADLINE_MS = 30 * 60 * 1_000;

export type ExecuteToolCalls = typeof executeAIToolCalls;

export interface PreconditionResolverContext {
  executeToolCalls: ExecuteToolCalls;
  snapshot: unknown;
  signal?: AbortSignal;
  onProgress?: (detail: string, current?: number, total?: number) => void;
}

export interface PreconditionResolver {
  kind: KernelMissingPrecondition['kind'];
  describe(): string;
  satisfy(context: PreconditionResolverContext): Promise<boolean>;
}

interface MissingTranscriptClip {
  clipId: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** Mirrors transcriptMoments.ts: clips live under videoTracks/audioTracks. */
function clipsMissingTranscript(snapshot: unknown): MissingTranscriptClip[] {
  if (!isRecord(snapshot)) return [];

  const clips: MissingTranscriptClip[] = [];
  const seen = new Set<string>();
  for (const trackKey of ['videoTracks', 'audioTracks']) {
    const tracks = snapshot[trackKey];
    if (!Array.isArray(tracks)) continue;

    for (const track of tracks) {
      if (!isRecord(track) || !Array.isArray(track.clips)) continue;
      for (const clip of track.clips) {
        if (!isRecord(clip) || clip.hasTranscript === true) continue;
        const clipId = typeof clip.id === 'string' ? clip.id.trim() : '';
        if (!clipId || seen.has(clipId)) continue;
        seen.add(clipId);
        clips.push({ clipId });
      }
    }
  }
  return clips;
}

function transcriptionDetail(count: number): string {
  return `Transcribing ${count} ${count === 1 ? 'clip' : 'clips'}`;
}

/** Lets the gateway show the exact work before the resolver starts it. */
export function describeTranscriptPrecondition(snapshot: unknown): string {
  return transcriptionDetail(clipsMissingTranscript(snapshot).length);
}

function waitForPoll(signal?: AbortSignal): Promise<boolean> {
  if (signal?.aborted) return Promise.resolve(false);
  return new Promise((resolve) => {
    const onAbort = () => {
      clearTimeout(timer);
      resolve(false);
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve(true);
    }, POLL_INTERVAL_MS);
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

async function executeOne(
  executeToolCalls: ExecuteToolCalls,
  call: AIToolCallExecution,
): Promise<Record<string, unknown> | undefined> {
  const [execution] = await executeToolCalls([call], 'chat', {
    guidedReplay: false,
    suppressHistory: true,
  });
  if (!execution?.result.success) return undefined;
  return isRecord(execution.result.data) ? execution.result.data : {};
}

const transcriptResolver: PreconditionResolver = {
  kind: 'transcript',
  describe: () => 'Transcribing clips',
  async satisfy(context) {
    const targets = clipsMissingTranscript(context.snapshot);
    if (targets.length === 0) return true;

    try {
      const deadline = Date.now() + TRANSCRIPT_DEADLINE_MS;
      for (const [index, clip] of targets.entries()) {
        if (context.signal?.aborted || Date.now() > deadline) return false;
        const result = await executeOne(context.executeToolCalls, {
          id: `kernel-start-transcription-${index + 1}`,
          tool: 'startClipTranscription',
          args: { clipId: clip.clipId },
        });
        if (!result) return false;
      }

      const pending = new Set(targets.map(({ clipId }) => clipId));
      let completed = 0;
      while (pending.size > 0 && Date.now() <= deadline) {
        if (context.signal?.aborted) return false;

        for (const clipId of [...pending]) {
          if (context.signal?.aborted) return false;
          const result = await executeOne(context.executeToolCalls, {
            id: `kernel-poll-transcription-${clipId}`,
            tool: 'getClipDetails',
            args: { clipId },
          });
          if (!result) return false;
          if (result.hasTranscript === true) {
            pending.delete(clipId);
            completed += 1;
            context.onProgress?.(
              transcriptionDetail(targets.length),
              completed,
              targets.length,
            );
          }
        }

        if (Date.now() > deadline) return false;
        if (pending.size === 0) return true;
        if (Date.now() >= deadline || !await waitForPoll(context.signal)) return false;
      }
    } catch {
      return false;
    }

    return false;
  },
};

export const PRECONDITION_RESOLVERS: PreconditionResolver[] = [transcriptResolver];

export function findPreconditionResolver(kind: string): PreconditionResolver | undefined {
  return PRECONDITION_RESOLVERS.find((resolver) => resolver.kind === kind);
}
