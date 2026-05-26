export type ProcessedAudioAnalysisLoadStatus = 'idle' | 'loading' | 'ready' | 'missing' | 'error';

export type AudioAnalysisDisplayStatusKind =
  | 'approximate-source'
  | 'pending'
  | 'missing'
  | 'error';

export interface AudioAnalysisDisplayStatus {
  kind: AudioAnalysisDisplayStatusKind;
  className: string;
  label: string;
  title: string;
}

export interface ResolveProcessedAudioAnalysisDisplayStatusInput {
  artifactLabel: string;
  needsProcessed: boolean;
  processedRef?: string;
  processedReady: boolean;
  fallbackAvailable: boolean;
  loadStatus: ProcessedAudioAnalysisLoadStatus;
  jobActive?: boolean;
  autoGenerateEligible?: boolean;
}

function statusClassName(artifactLabel: string, kind: AudioAnalysisDisplayStatusKind): string {
  return `${artifactLabel}-processed-${kind}`;
}

export function resolveProcessedAudioAnalysisDisplayStatus(
  input: ResolveProcessedAudioAnalysisDisplayStatusInput,
): AudioAnalysisDisplayStatus | null {
  if (!input.needsProcessed || input.processedReady) {
    return null;
  }

  if (input.processedRef) {
    if (input.loadStatus === 'missing') {
      return {
        kind: 'missing',
        className: statusClassName(input.artifactLabel, 'missing'),
        label: 'MISS',
        title: `Processed ${input.artifactLabel} artifact is missing; refresh analysis to update this view.`,
      };
    }

    if (input.loadStatus === 'error') {
      return {
        kind: 'error',
        className: statusClassName(input.artifactLabel, 'error'),
        label: 'ERR',
        title: `Processed ${input.artifactLabel} artifact failed to load; refresh analysis to update this view.`,
      };
    }

    return {
      kind: 'pending',
      className: statusClassName(input.artifactLabel, 'pending'),
      label: 'PEND',
      title: `Processed ${input.artifactLabel} artifact is loading.`,
    };
  }

  if (input.fallbackAvailable) {
    return {
      kind: 'approximate-source',
      className: statusClassName(input.artifactLabel, 'approximate-source'),
      label: 'SRC',
      title: `Showing source ${input.artifactLabel} while processed audio analysis catches up.`,
    };
  }

  if (input.jobActive || input.autoGenerateEligible) {
    return {
      kind: 'pending',
      className: statusClassName(input.artifactLabel, 'pending'),
      label: 'PEND',
      title: `Processed ${input.artifactLabel} analysis is queued or running.`,
    };
  }

  return {
    kind: 'missing',
    className: statusClassName(input.artifactLabel, 'missing'),
    label: 'MISS',
    title: `Processed ${input.artifactLabel} is required but no current artifact is available.`,
  };
}
