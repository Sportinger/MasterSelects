import type { AgentTimelineEvent, AgentTimelineProvenance, NormalizedBox } from '../../../types/agentTimeline/manifest';
import type { OcrRecognition, OcrRecognizedRegion } from '../../../types/agentTimeline/ocr';

interface PendingSpan {
  normalizedText: string;
  originalText: string;
  language?: string;
  box?: NormalizedBox;
  start: number;
  end: number;
  confidenceTotal: number;
  confidenceCount: number;
  bestConfidence: number;
  provenance: AgentTimelineProvenance[];
}

export function normalizeOcrText(value: string): string {
  return value.normalize('NFKC').replace(/\s+/gu, ' ').trim().toLocaleLowerCase();
}

function validConfidence(confidence: number): boolean {
  return Number.isFinite(confidence) && confidence >= 0 && confidence <= 1;
}

function boxKey(box: NormalizedBox | undefined): string {
  if (!box) return 'none';
  return [box.x, box.y, box.width, box.height].map((value) => Math.round(value * 10)).join(':');
}

function cloneBox(box: NormalizedBox | undefined): NormalizedBox | undefined {
  return box ? { ...box } : undefined;
}

function kindFor(region: OcrRecognizedRegion, repeatCount: number): 'subtitle' | 'title' | 'lower-third' | 'sign' | 'unknown' {
  const y = region.box?.y;
  if (y === undefined) return 'unknown';
  if (y >= .78) return 'subtitle';
  if (y >= .58) return 'lower-third';
  if (y <= .28) return 'title';
  return repeatCount > 1 ? 'sign' : 'unknown';
}

function eventId(span: PendingSpan, index: number): string {
  const text = encodeURIComponent(span.normalizedText).slice(0, 96);
  return `ocr:${span.start}:${span.end}:${text}:${index}`;
}

function matchingKey(normalizedText: string, language: string | undefined, box: NormalizedBox | undefined): string {
  return `${normalizedText}\u0000${language ?? ''}\u0000${boxKey(box)}`;
}

function addProvenance(target: AgentTimelineProvenance[], additions: readonly AgentTimelineProvenance[]): void {
  const seen = new Set(target.map((item) => JSON.stringify(item)));
  for (const item of additions) {
    const serialized = JSON.stringify(item);
    if (!seen.has(serialized)) {
      target.push({ ...item });
      seen.add(serialized);
    }
  }
  target.sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right)));
}

/**
 * Converts transient OCR observations into durable text spans. A span is only
 * extended through adjacent sampled candidate intervals, preserving half-open
 * `[start, end)` semantics and avoiding an unsupported claim across a gap.
 */
export function normalizeOcrRecognitions(input: readonly OcrRecognition[]): AgentTimelineEvent[] {
  const spans = new Map<string, PendingSpan>();
  const output: PendingSpan[] = [];
  const repeatCounts = new Map<string, number>();
  const recognitions = [...input].toSorted((left, right) => left.candidate.sourceTime - right.candidate.sourceTime || left.candidate.shotId.localeCompare(right.candidate.shotId));
  for (const recognition of recognitions) {
    const candidate = recognition.candidate;
    if (!Number.isFinite(candidate.sourceTime) || !Number.isFinite(candidate.visibilityEnd) || candidate.visibilityEnd <= candidate.sourceTime) continue;
    for (const region of recognition.regions) {
      const normalizedText = normalizeOcrText(region.text);
      if (!normalizedText || !validConfidence(region.confidence)) continue;
      const key = matchingKey(normalizedText, region.language, region.box);
      const existing = spans.get(key);
      if (existing && existing.end === candidate.sourceTime) {
        existing.end = candidate.visibilityEnd;
        existing.confidenceTotal += region.confidence;
        existing.confidenceCount += 1;
        if (region.confidence > existing.bestConfidence) {
          existing.bestConfidence = region.confidence;
          existing.originalText = region.text;
          existing.box = cloneBox(region.box);
        }
        addProvenance(existing.provenance, recognition.provenance);
      } else {
        const span: PendingSpan = {
          normalizedText,
          originalText: region.text,
          language: region.language,
          box: cloneBox(region.box),
          start: candidate.sourceTime,
          end: candidate.visibilityEnd,
          confidenceTotal: region.confidence,
          confidenceCount: 1,
          bestConfidence: region.confidence,
          provenance: [],
        };
        addProvenance(span.provenance, recognition.provenance);
        output.push(span);
        spans.set(key, span);
      }
      repeatCounts.set(key, (repeatCounts.get(key) ?? 0) + 1);
    }
  }
  return output
    .toSorted((left, right) => left.start - right.start || left.end - right.end || left.normalizedText.localeCompare(right.normalizedText))
    .map((span, index): AgentTimelineEvent => {
      const key = matchingKey(span.normalizedText, span.language, span.box);
      return {
        schemaVersion: 'agent-timeline-event/v1',
        id: eventId(span, index),
        type: 'onscreen-text',
        time: { temporalKind: 'interval', timeDomain: 'source', start: span.start, end: span.end },
        confidence: span.confidenceTotal / span.confidenceCount,
        provenance: span.provenance,
        keyframeSourceTime: span.start,
        data: {
          text: span.normalizedText,
          originalText: span.originalText === span.normalizedText ? undefined : span.originalText,
          language: span.language,
          kind: kindFor({ text: span.originalText, confidence: span.bestConfidence, box: span.box }, repeatCounts.get(key) ?? 1),
          box: cloneBox(span.box),
        },
      };
    });
}
