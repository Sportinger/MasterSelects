import { useCallback, useMemo, useState } from 'react';
import { useAccountStore } from '../../../stores/accountStore';
import { useMediaStore } from '../../../stores/mediaStore';
import { useSettingsStore, type TranscriptionProvider } from '../../../stores/settingsStore';
import { useTimelineStore } from '../../../stores/timeline';
import type {
  TranscriptFusionArtifact,
  TranscriptFusionProgress,
  TranscriptFusionProviderStatus,
  TranscriptStatus,
  TranscriptWord,
} from '../../../types/clipMetadata';
import type { TranscriptRunView, TranscriptSummaryView } from './TranscriptWorkspaceHeader';

interface UseTranscriptWorkspaceControllerInput {
  clipId: string;
  inPoint: number;
  outPoint: number;
  transcript: readonly TranscriptWord[];
  transcriptProgress: number;
  transcriptStatus: TranscriptStatus;
}

export interface TranscriptWorkspaceController {
  activeProvider: TranscriptionProvider;
  clipCoverage: number;
  isPartial: boolean;
  isSignedIn: boolean;
  language: string;
  onCancel: () => void;
  onClear: () => void;
  onContinue: () => void;
  onLanguageChange: (language: string) => void;
  onProviderChange: (provider: TranscriptionProvider) => void;
  onSearchChange: (query: string) => void;
  onTranscribe: () => void;
  run: TranscriptRunView | null;
  searchQuery: string;
  summary: TranscriptSummaryView | null;
}

function coverageForRanges(
  ranges: readonly [number, number][] | undefined,
  transcript: readonly TranscriptWord[],
  inPoint: number,
  outPoint: number,
): number {
  const duration = outPoint - inPoint;
  if (duration <= 0 || transcript.length === 0) return 0;
  if (ranges && ranges.length > 0) {
    const covered = ranges.reduce((total, [start, end]) => (
      total + Math.max(0, Math.min(end, outPoint) - Math.max(start, inPoint))
    ), 0);
    return Math.min(1, covered / duration);
  }
  const words = transcript.filter(word => word.end > inPoint && word.start < outPoint);
  if (words.length === 0) return 0;
  const start = Math.max(inPoint, Math.min(...words.map(word => word.start)));
  const end = Math.min(outPoint, Math.max(...words.map(word => word.end)));
  return Math.min(1, Math.max(0, end - start) / duration);
}

function buildRun(
  provider: TranscriptionProvider,
  progress: number,
  status: TranscriptStatus,
  fusionProgress: Pick<
    TranscriptFusionProgress,
    'mergeProgress' | 'providerProgress' | 'providers' | 'stage'
  > | undefined,
): TranscriptRunView | null {
  if (provider !== 'hybrid') return null;
  const stage = fusionProgress?.stage ?? (status === 'ready' ? 'complete' : status === 'error' ? 'error' : 'transcribing');
  const fallback: TranscriptFusionProviderStatus = status === 'ready'
    ? 'complete'
    : status === 'error' ? 'error' : 'running';
  const providers = fusionProgress?.providers ?? { deepgram: fallback, openai: fallback };
  const finalStatus: TranscriptFusionProviderStatus = stage === 'complete'
    ? 'complete'
    : stage === 'error' ? 'error'
      : stage === 'aligning' || stage === 'finalizing' ? 'running' : 'waiting';
  const finalProgress = stage === 'complete'
    ? 100
    : fusionProgress?.mergeProgress
      ?? (stage === 'aligning' ? 20 : stage === 'finalizing' ? 90 : 0);
  const finished = Object.values(providers).filter(item => item === 'complete' || item === 'error').length;
  const measuredProviderProgress = fusionProgress?.providerProgress
    ? (
        fusionProgress.providerProgress.deepgram.percent
        + fusionProgress.providerProgress.openai.percent
      ) / 2
    : null;
  const derivedProgress = stage === 'transcribing' && measuredProviderProgress !== null
    ? Math.round(measuredProviderProgress * 0.9)
    : stage === 'transcribing' ? 12 + finished * 24
    : stage === 'aligning' ? 68 : stage === 'finalizing' ? 95 : stage === 'complete' ? 100 : 0;
  const finalDetail = stage === 'transcribing' ? 'Starts when both transcripts are ready'
    : stage === 'aligning' ? 'Mapping the speaker timeline'
      : stage === 'finalizing' ? 'Applying OpenAI speaker separation'
        : stage === 'complete' ? 'Speaker separation complete' : 'Speaker mapping stopped';
  return {
    finalDetail,
    finalProgress,
    finalStatus,
    overallProgress: Math.max(progress, derivedProgress),
    providers,
    providerProgress: fusionProgress?.providerProgress,
    stage,
  };
}

/** Shared transient controls for Transcript and Analysis; transcript artifacts remain media-owned. */
export function useTranscriptWorkspaceController({
  clipId,
  inPoint,
  outPoint,
  transcript,
  transcriptProgress,
  transcriptStatus,
}: UseTranscriptWorkspaceControllerInput): TranscriptWorkspaceController {
  const [language, setLanguage] = useState(() => localStorage.getItem('transcriptLanguage') || 'auto');
  const [searchQuery, setSearchQuery] = useState('');
  const provider = useSettingsStore(state => state.transcriptionProvider);
  const setProvider = useSettingsStore(state => state.setTranscriptionProvider);
  const isSignedIn = useAccountStore(state => Boolean(state.session?.authenticated));
  const activeProvider = isSignedIn && !['deepgram', 'hybrid'].includes(provider) ? 'openai' : provider;
  const mediaFileId = useTimelineStore(state => {
    const clip = state.clips.find(candidate => candidate.id === clipId);
    return clip?.source?.mediaFileId || clip?.mediaFileId;
  });
  const mediaState = useMediaStore(state => state.files.find(file => file.id === mediaFileId));
  const fusionProgress = mediaState?.transcriptFusionProgress;
  const artifact = mediaState?.transcriptArtifact as TranscriptFusionArtifact | undefined;
  const coverage = useMemo(
    () => coverageForRanges(mediaState?.transcribedRanges, transcript, inPoint, outPoint),
    [inPoint, mediaState?.transcribedRanges, outPoint, transcript],
  );
  const isPartial = transcriptStatus !== 'transcribing' && coverage > 0 && coverage < 0.98;
  const run = useMemo(
    () => buildRun(activeProvider, transcriptProgress, transcriptStatus, fusionProgress),
    [activeProvider, fusionProgress, transcriptProgress, transcriptStatus],
  );
  const summary = useMemo<TranscriptSummaryView | null>(
    () => artifact || fusionProgress
      ? {
          providers: fusionProgress?.providers ?? artifact?.providerStatuses,
          stage: fusionProgress?.stage ?? 'complete',
        }
      : null,
    [artifact, fusionProgress],
  );
  const onTranscribe = useCallback(() => {
    void import('../../../services/clipTranscriber').then(({ transcribeClip }) => transcribeClip(clipId, language));
  }, [clipId, language]);
  const onContinue = useCallback(() => {
    void import('../../../services/clipTranscriber').then(({ transcribeClip }) => (
      transcribeClip(clipId, language, { continueMode: true })
    ));
  }, [clipId, language]);
  const onCancel = useCallback(() => {
    void import('../../../services/clipTranscriber').then(({ cancelTranscription }) => cancelTranscription(clipId));
  }, [clipId]);
  const onClear = useCallback(() => {
    void import('../../../services/clipTranscriber').then(({ clearClipTranscript }) => clearClipTranscript(clipId));
  }, [clipId]);
  const onLanguageChange = useCallback((nextLanguage: string) => {
    setLanguage(nextLanguage);
    localStorage.setItem('transcriptLanguage', nextLanguage);
  }, []);

  return {
    activeProvider,
    clipCoverage: coverage,
    isPartial,
    isSignedIn,
    language,
    onCancel,
    onClear,
    onContinue,
    onLanguageChange,
    onProviderChange: setProvider,
    onSearchChange: setSearchQuery,
    onTranscribe,
    run,
    searchQuery,
    summary,
  };
}
