import type { ClipAudioEditOperation, TimelineClip } from '../../types';

export interface AudioRepairSuggestionOperationInput {
  id: string;
  kind: string;
  label: string;
  severity?: string;
  confidence?: number;
  reason?: string;
  operation: {
    editType: Extract<ClipAudioEditOperation['type'], 'repair' | 'mono-sum'>;
    params?: ClipAudioEditOperation['params'];
  };
  evidence?: ClipAudioEditOperation['params'];
}

export interface CreateAudioRepairSuggestionOperationOptions {
  id: string;
  createdAt: number;
}

export function getClipAudioSourceRange(clip: TimelineClip): { start: number; end: number } {
  const sourceStart = clip.inPoint ?? 0;
  const sourceEnd = clip.outPoint ?? sourceStart + Math.max(0, clip.duration);
  return {
    start: Math.min(sourceStart, sourceEnd),
    end: Math.max(sourceStart, sourceEnd),
  };
}

export function serializeAudioRepairSuggestionEvidence(
  evidence: AudioRepairSuggestionOperationInput['evidence'],
): string | undefined {
  if (!evidence || Object.keys(evidence).length === 0) {
    return undefined;
  }

  return JSON.stringify(evidence);
}

export function createAudioRepairSuggestionOperation(
  clip: TimelineClip,
  suggestion: AudioRepairSuggestionOperationInput,
  options: CreateAudioRepairSuggestionOperationOptions,
): ClipAudioEditOperation | null {
  const sourceRange = getClipAudioSourceRange(clip);
  if (sourceRange.end - sourceRange.start <= 0.0005) {
    return null;
  }

  const evidence = serializeAudioRepairSuggestionEvidence(suggestion.evidence);

  return {
    id: options.id,
    type: suggestion.operation.editType,
    enabled: true,
    params: {
      ...(suggestion.operation.params ?? {}),
      label: suggestion.operation.params?.label ?? suggestion.label,
      timelineStart: clip.startTime,
      timelineEnd: clip.startTime + clip.duration,
      preserveClipDuration: true,
      repairSuggestionId: suggestion.id,
      repairSuggestionKind: suggestion.kind,
      ...(suggestion.severity ? { repairSuggestionSeverity: suggestion.severity } : {}),
      ...(typeof suggestion.confidence === 'number' ? { repairSuggestionConfidence: suggestion.confidence } : {}),
      ...(suggestion.reason ? { repairSuggestionReason: suggestion.reason } : {}),
      ...(evidence ? { repairSuggestionEvidence: evidence } : {}),
    },
    timeRange: sourceRange,
    createdAt: options.createdAt,
  };
}
