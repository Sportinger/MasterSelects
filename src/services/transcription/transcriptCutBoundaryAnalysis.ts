import type { TranscriptWord } from '../../types/clipMetadata';
import { proxyFrameCache } from '../proxyFrameCache';
import { findTranscriptCutBoundaries } from '../audio/transcriptCutBoundaries';
import { effectiveWordTiming } from './effectiveWordTiming';

export async function analyzeTranscriptCutBoundaries(
  mediaFileId: string,
  words: readonly TranscriptWord[],
  duration: number,
) {
  const decoded = proxyFrameCache.getCachedAudioBuffer(mediaFileId)
    ?? await proxyFrameCache.warmScrubAudioBuffer(mediaFileId).catch(() => null);
  // Reject a stale/mismatched source buffer rather than projecting its audio onto
  // another source's transcript. Codec padding may differ by a few milliseconds.
  const buffer = decoded && Math.abs(decoded.duration - duration) <= 0.1 ? decoded : null;
  return findTranscriptCutBoundaries(words.map(word => effectiveWordTiming(word)), duration, buffer);
}
