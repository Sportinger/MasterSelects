import {
  executeAIToolCalls,
  type AIToolCallExecution,
} from '../aiTools';
import {
  transcriptClips,
  type TranscriptMomentExecutor,
} from './transcriptMoments';
import type { KernelSilenceRange } from './types';

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function readFiniteNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function readString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

export async function buildSilenceRanges(
  snapshot: unknown,
  executor: TranscriptMomentExecutor = executeAIToolCalls,
): Promise<KernelSilenceRange[]> {
  const ranges: KernelSilenceRange[] = [];
  const seenRanges = new Set<string>();

  try {
    for (const clip of transcriptClips(snapshot)) {
      try {
        const execution: AIToolCallExecution = {
          id: `kernel-silence-${clip.clipId}`,
          tool: 'findSilentSections',
          args: { clipId: clip.clipId, minDuration: 0.2 },
        };
        const [result] = await executor([execution], 'chat', {
          guidedReplay: false,
          suppressHistory: true,
        });
        if (!result?.result.success || !isRecord(result.result.data)) continue;

        const data = result.result.data;
        if (!Array.isArray(data.silentSections)) continue;
        const detectionSource = readString(data.detectionSource);

        for (const section of data.silentSections) {
          if (!isRecord(section)) continue;

          const startSeconds = readFiniteNumber(section.sourceStart);
          const endSeconds = readFiniteNumber(section.sourceEnd);
          if (startSeconds === undefined || endSeconds === undefined || endSeconds <= startSeconds) {
            continue;
          }

          const key = JSON.stringify([clip.mediaId, startSeconds, endSeconds]);
          if (seenRanges.has(key)) continue;
          seenRanges.add(key);

          const confidence = readFiniteNumber(section.meanProbability);
          ranges.push({
            mediaId: clip.mediaId,
            startSeconds,
            endSeconds,
            ...(confidence === undefined ? {} : { confidence }),
            ...(detectionSource === undefined ? {} : { detectionSource }),
          });
        }
      } catch {
        // Missing analysis for one clip must not block compilation.
      }
    }
  } catch {
    // Evidence collection is optional and must not block compilation.
  }

  return ranges;
}