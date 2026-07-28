// Pure hysteresis segmentation over per-frame speech probabilities. No ONNX
// or worker imports so it stays fully unit-testable in jsdom.

import type { AudioSpan, VoiceActivityConfig } from '../audioIntelligencePayloadTypes';

interface FrameSpan {
  startFrame: number;
  endFrame: number;
  probabilitySum: number;
  // Speech frames only; merged spans exclude bridged silence frames so the
  // confidence stays the mean probability of the detected speech.
  speechFrameCount: number;
}

function meanConfidence(span: FrameSpan): number {
  return span.speechFrameCount > 0 ? span.probabilitySum / span.speechFrameCount : 0;
}

function collectRawSpans(
  probabilities: Float32Array,
  threshold: number,
  negThreshold: number,
): FrameSpan[] {
  const spans: FrameSpan[] = [];
  let current: FrameSpan | null = null;

  for (let frame = 0; frame < probabilities.length; frame += 1) {
    const probability = probabilities[frame] ?? 0;
    if (!current) {
      if (probability >= threshold) {
        current = {
          startFrame: frame,
          endFrame: frame + 1,
          probabilitySum: probability,
          speechFrameCount: 1,
        };
      }
      continue;
    }

    if (probability < negThreshold) {
      spans.push(current);
      current = null;
      continue;
    }

    current.endFrame = frame + 1;
    current.probabilitySum += probability;
    current.speechFrameCount += 1;
  }

  if (current) {
    spans.push(current);
  }
  return spans;
}

function mergeShortSilences(spans: FrameSpan[], minSilenceFrames: number): FrameSpan[] {
  const merged: FrameSpan[] = [];
  for (const span of spans) {
    const previous = merged[merged.length - 1];
    if (previous && span.startFrame - previous.endFrame < minSilenceFrames) {
      previous.endFrame = span.endFrame;
      previous.probabilitySum += span.probabilitySum;
      previous.speechFrameCount += span.speechFrameCount;
      continue;
    }
    merged.push({ ...span });
  }
  return merged;
}

export function segmentSpeechProbabilities(
  probabilities: Float32Array,
  frameDurationSeconds: number,
  config: Pick<VoiceActivityConfig, 'threshold' | 'negThreshold' | 'minSpeechMs' | 'minSilenceMs' | 'padMs'>,
  exactDurationSeconds: number,
  offsetSeconds = 0,
): AudioSpan[] {
  if (!Number.isFinite(frameDurationSeconds) || frameDurationSeconds <= 0) {
    throw new Error('frameDurationSeconds must be a positive finite number.');
  }
  if (!Number.isFinite(exactDurationSeconds) || exactDurationSeconds < 0) {
    throw new Error('exactDurationSeconds must be a non-negative finite number.');
  }

  const minSilenceFrames = (config.minSilenceMs / 1000) / frameDurationSeconds;
  const minSpeechSeconds = config.minSpeechMs / 1000;
  const padSeconds = config.padMs / 1000;
  const totalDuration = exactDurationSeconds;

  const spans = mergeShortSilences(
    collectRawSpans(probabilities, config.threshold, config.negThreshold),
    minSilenceFrames,
  ).filter((span) => (span.endFrame - span.startFrame) * frameDurationSeconds >= minSpeechSeconds);

  return spans.map((span, index) => {
    const rawStart = span.startFrame * frameDurationSeconds;
    const rawEnd = span.endFrame * frameDurationSeconds;
    const previous = spans[index - 1];
    const next = spans[index + 1];

    // Pad each side, splitting the raw gap between neighbors when padding
    // would otherwise overlap. max/min naturally reduce to the plain padded
    // bound whenever the gap is at least twice the pad.
    let start = Math.max(0, rawStart - padSeconds);
    if (previous) {
      start = Math.max(start, (previous.endFrame * frameDurationSeconds + rawStart) / 2);
    }
    let end = Math.min(totalDuration, rawEnd + padSeconds);
    if (next) {
      end = Math.min(end, (rawEnd + next.startFrame * frameDurationSeconds) / 2);
    }

    return {
      start: start + offsetSeconds,
      end: end + offsetSeconds,
      confidence: meanConfidence(span),
    };
  });
}
