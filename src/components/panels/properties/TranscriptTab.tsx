// Transcript Tab - View and interact with clip transcription
import { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import { useTimelineStore } from '../../../stores/timeline';
import { useMediaStore } from '../../../stores/mediaStore';
import { useSettingsStore } from '../../../stores/settingsStore';
import { useAccountStore } from '../../../stores/accountStore';
import type {
  TranscriptFusionArtifact,
  TranscriptFusionProviderStatus,
  TranscriptWord,
} from '../../../types/clipMetadata';
import {
  buildTranscriptSpeakerSegments,
  findActiveTranscriptWordIndex,
  findTranscriptTimelineOffset,
  formatTranscriptTimestamp,
  getTranscriptSpeakerTone,
} from './transcriptSegments';
import {
  TranscriptWorkspaceHeader,
  type TranscriptRunView,
  type TranscriptSummaryView,
} from './TranscriptWorkspaceHeader';

interface TranscriptTabProps {
  clipId: string;
  transcript: TranscriptWord[];
  transcriptStatus: 'none' | 'transcribing' | 'ready' | 'error';
  transcriptProgress: number;
  clipStartTime: number;
  clipDuration: number;
  inPoint: number;
  outPoint: number;
  reversed?: boolean;
}

export function TranscriptTab({
  clipId,
  transcript,
  transcriptStatus,
  transcriptProgress,
  clipStartTime,
  clipDuration,
  inPoint,
  outPoint,
  reversed = false,
}: TranscriptTabProps) {
  const [language, setLanguage] = useState(() => localStorage.getItem('transcriptLanguage') || 'auto');
  const [searchQuery, setSearchQuery] = useState('');
  const containerRef = useRef<HTMLDivElement>(null);
  const wordElementsRef = useRef(new Map<number, HTMLButtonElement>());
  const transcriptionProvider = useSettingsStore(state => state.transcriptionProvider);
  const setTranscriptionProvider = useSettingsStore(state => state.setTranscriptionProvider);
  const isSignedIn = useAccountStore(state => Boolean(state.session?.authenticated));
  const activeTranscriptionProvider = isSignedIn
    && !['deepgram', 'hybrid'].includes(transcriptionProvider)
    ? 'openai'
    : transcriptionProvider;
  const isHybridMode = activeTranscriptionProvider === 'hybrid';
  const mediaFileId = useTimelineStore(useCallback((state) => {
    const clip = state.clips.find(candidate => candidate.id === clipId);
    return clip?.source?.mediaFileId || clip?.mediaFileId;
  }, [clipId]));
  const transcriptArtifact = useMediaStore(useCallback(
    state => state.files.find(file => file.id === mediaFileId)?.transcriptArtifact,
    [mediaFileId],
  )) as TranscriptFusionArtifact | undefined;
  const isBestQualityTranscript = Boolean(transcriptArtifact);
  const transcriptFusionProgress = useMediaStore(useCallback(
    state => state.files.find(file => file.id === mediaFileId)?.transcriptFusionProgress,
    [mediaFileId],
  ));

  const orderedTranscript = useMemo(
    () => transcript.toSorted((left, right) => left.start - right.start),
    [transcript],
  );
  const currentWordIndex = useTimelineStore(useCallback((state) => {
    const clipTimelineTime = state.playheadPosition - clipStartTime;
    if (clipTimelineTime < 0 || clipTimelineTime >= clipDuration) return null;

    const initialSpeed = state.getInterpolatedSpeed(clipId, 0);
    const reversePlayback = reversed || initialSpeed < 0;
    const sourceStart = reversePlayback ? outPoint : inPoint;
    const sourceOffset = state.getSourceTimeForClip(clipId, clipTimelineTime);
    const effectiveSourceOffset = reversed && sourceOffset > 0 ? -sourceOffset : sourceOffset;
    const sourceTime = Math.max(
      inPoint,
      Math.min(outPoint, sourceStart + effectiveSourceOffset),
    );
    return findActiveTranscriptWordIndex(orderedTranscript, sourceTime);
  }, [
    clipDuration,
    clipId,
    clipStartTime,
    inPoint,
    orderedTranscript,
    outPoint,
    reversed,
  ]));
  const isPlaying = useTimelineStore(state => state.isPlaying);
  const isDraggingPlayhead = useTimelineStore(state => state.isDraggingPlayhead);
  const {
    getInterpolatedSpeed,
    getSourceTimeForClip,
    setPlayheadPosition,
  } = useTimelineStore.getState();
  const initialSpeed = getInterpolatedSpeed(clipId, 0);
  const reversePlayback = reversed || initialSpeed < 0;
  const sourceStart = reversePlayback ? outPoint : inPoint;
  const getTranscriptSourceOffset = useCallback((timelineOffset: number) => {
    const sourceOffset = getSourceTimeForClip(clipId, timelineOffset);
    return reversed && sourceOffset > 0 ? -sourceOffset : sourceOffset;
  }, [clipId, getSourceTimeForClip, reversed]);

  const speakerSegments = useMemo(
    () => buildTranscriptSpeakerSegments(orderedTranscript),
    [orderedTranscript],
  );
  const normalizedSearchQuery = searchQuery.trim().toLocaleLowerCase();
  const visibleSegments = useMemo(() => {
    return speakerSegments.filter(segment => {
      if (!normalizedSearchQuery) return true;
      const containsActiveWord = currentWordIndex !== null
        && currentWordIndex >= segment.startWordIndex
        && currentWordIndex <= segment.endWordIndex;
      return containsActiveWord || segment.words.some(word =>
        word.text.toLocaleLowerCase().includes(normalizedSearchQuery)
      );
    });
  }, [currentWordIndex, normalizedSearchQuery, speakerSegments]);
  const speakerCount = useMemo(
    () => new Set(speakerSegments.map(segment => segment.speaker)).size,
    [speakerSegments],
  );
  const fusionSummary = useMemo<TranscriptSummaryView | null>(() => {
    if (!transcriptArtifact && !transcriptFusionProgress) return null;
    return {
      providers: transcriptFusionProgress?.providers ?? transcriptArtifact?.providerStatuses,
      stage: transcriptFusionProgress?.stage ?? 'complete',
    };
  }, [transcriptArtifact, transcriptFusionProgress]);

  useEffect(() => {
    if (currentWordIndex === null) return;
    const container = containerRef.current;
    const activeWord = wordElementsRef.current.get(currentWordIndex);
    if (!container || !activeWord) return;

    const containerBounds = container.getBoundingClientRect();
    const activeBounds = activeWord.getBoundingClientRect();
    const safeInset = Math.min(96, containerBounds.height * 0.24);
    const outsideFollowZone = activeBounds.top < containerBounds.top + safeInset
      || activeBounds.bottom > containerBounds.bottom - safeInset;
    if (!outsideFollowZone) return;

    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const targetScrollTop = container.scrollTop
      + activeBounds.top
      - containerBounds.top
      - (containerBounds.height - activeBounds.height) / 2;
    container.scrollTo({
      behavior: reduceMotion || isDraggingPlayhead ? 'auto' : 'smooth',
      top: Math.max(0, targetScrollTop),
    });
  }, [currentWordIndex, isDraggingPlayhead]);

  const registerWordElement = useCallback((wordIndex: number, element: HTMLButtonElement | null) => {
    if (element) {
      wordElementsRef.current.set(wordIndex, element);
    } else {
      wordElementsRef.current.delete(wordIndex);
    }
  }, []);

  const handleWordClick = useCallback((sourceTime: number) => {
    const timelineOffset = findTranscriptTimelineOffset(
      sourceTime,
      sourceStart,
      clipDuration,
      getTranscriptSourceOffset,
    );
    const timelinePosition = clipStartTime + timelineOffset;
    setPlayheadPosition(Math.max(0, timelinePosition));
  }, [
    clipDuration,
    clipStartTime,
    getTranscriptSourceOffset,
    setPlayheadPosition,
    sourceStart,
  ]);

  // Get transcribedRanges from MediaFile for accurate coverage
  const clipCoverage = useMemo(() => {
    if (!transcript.length) return 0;
    const clipDuration = outPoint - inPoint;
    if (clipDuration <= 0) return 0;
    // Look up MediaFile's transcribedRanges
    const clip = useTimelineStore.getState().clips.find(c => c.id === clipId);
    const mediaFileId = clip?.source?.mediaFileId || clip?.mediaFileId;
    const mediaFile = mediaFileId ? useMediaStore.getState().files.find(f => f.id === mediaFileId) : null;
    const ranges = mediaFile?.transcribedRanges ?? [];
    if (ranges.length > 0) {
      let covered = 0;
      for (const [rs, re] of ranges) {
        const s = Math.max(rs, inPoint);
        const e = Math.min(re, outPoint);
        if (s < e) covered += e - s;
      }
      return Math.min(1, covered / clipDuration);
    }
    // Fallback: word envelope for old data
    const wordsInRange = transcript.filter(w => w.end > inPoint && w.start < outPoint);
    if (wordsInRange.length === 0) return 0;
    const minStart = Math.max(inPoint, Math.min(...wordsInRange.map(w => w.start)));
    const maxEnd = Math.min(outPoint, Math.max(...wordsInRange.map(w => w.end)));
    return Math.min(1, (maxEnd - minStart) / clipDuration);
  }, [transcript, inPoint, outPoint, clipId]);

  const isPartial = transcriptStatus !== 'transcribing' && clipCoverage > 0 && clipCoverage < 0.98;
  const liveHybridProgress = useMemo<TranscriptRunView | null>(() => {
    if (!isHybridMode) return null;

    const stage = transcriptFusionProgress?.stage
      ?? (transcriptStatus === 'ready' ? 'complete' : transcriptStatus === 'error' ? 'error' : 'transcribing');
    const providerFallback: TranscriptFusionProviderStatus = transcriptStatus === 'ready'
      ? 'complete'
      : transcriptStatus === 'error'
        ? 'error'
        : 'running';
    const providers = transcriptFusionProgress?.providers ?? {
      deepgram: providerFallback,
      openai: providerFallback,
    };
    const finalStatus: TranscriptFusionProviderStatus = stage === 'complete'
      ? 'complete'
      : stage === 'error'
        ? 'error'
        : stage === 'aligning' || stage === 'finalizing'
          ? 'running'
          : 'waiting';
    const finalProgress = stage === 'complete'
      ? 100
      : transcriptFusionProgress?.mergeProgress
        ?? (stage === 'aligning'
          ? 20
          : stage === 'finalizing'
            ? 90
            : 0);
    const finishedProviderCount = Object.values(providers)
      .filter(status => status === 'complete' || status === 'error').length;
    const measuredProviderProgress = transcriptFusionProgress?.providerProgress
      ? (
          transcriptFusionProgress.providerProgress.deepgram.percent
          + transcriptFusionProgress.providerProgress.openai.percent
        ) / 2
      : null;
    const derivedOverallProgress = stage === 'transcribing' && measuredProviderProgress !== null
      ? Math.round(measuredProviderProgress * 0.9)
      : stage === 'transcribing'
        ? 12 + finishedProviderCount * 24
      : stage === 'aligning'
        ? 68
        : stage === 'finalizing'
          ? 95
          : stage === 'complete'
            ? 100
            : 0;
    const finalDetail = stage === 'transcribing'
      ? 'Starts when both transcripts are ready'
      : stage === 'aligning'
        ? 'Mapping the speaker timeline'
        : stage === 'finalizing'
          ? 'Applying OpenAI speaker separation'
          : stage === 'complete'
          ? 'Speaker separation complete'
            : 'Speaker mapping stopped';

    return {
      finalDetail,
      finalProgress,
      finalStatus,
      overallProgress: Math.max(transcriptProgress, derivedOverallProgress),
      providers,
      providerProgress: transcriptFusionProgress?.providerProgress,
      stage,
    };
  }, [
    isHybridMode,
    transcriptFusionProgress,
    transcriptProgress,
    transcriptStatus,
  ]);

  const handleTranscribe = useCallback(async () => {
    const { transcribeClip } = await import('../../../services/clipTranscriber');
    await transcribeClip(clipId, language);
  }, [clipId, language]);

  const handleContinue = useCallback(async () => {
    const { transcribeClip } = await import('../../../services/clipTranscriber');
    await transcribeClip(clipId, language, { continueMode: true });
  }, [clipId, language]);

  const handleCancel = useCallback(async () => {
    const { cancelTranscription } = await import('../../../services/clipTranscriber');
    cancelTranscription(clipId);
  }, [clipId]);

  const handleDelete = useCallback(async () => {
    const { clearClipTranscript } = await import('../../../services/clipTranscriber');
    clearClipTranscript(clipId);
  }, [clipId]);

  const handleLanguageChange = useCallback((newLanguage: string) => {
    setLanguage(newLanguage);
    localStorage.setItem('transcriptLanguage', newLanguage);
  }, []);

  return (
    <div className="properties-tab-content transcript-tab">
      <TranscriptWorkspaceHeader
        activeProvider={activeTranscriptionProvider}
        clipCoverage={clipCoverage}
        hasTranscript={transcript.length > 0}
        isPartial={isPartial}
        isSignedIn={isSignedIn}
        language={language}
        onCancel={handleCancel}
        onContinue={handleContinue}
        onDelete={handleDelete}
        onLanguageChange={handleLanguageChange}
        onProviderChange={setTranscriptionProvider}
        onSearchChange={setSearchQuery}
        onTranscribe={handleTranscribe}
        run={transcriptStatus === 'transcribing' ? liveHybridProgress : null}
        searchQuery={searchQuery}
        summary={fusionSummary}
        transcriptProgress={transcriptProgress}
        transcriptStatus={transcriptStatus}
      />

      {/* Transcript content */}
      <div
        className="transcript-content-embedded"
        ref={containerRef}
        data-following-playback={isPlaying || isDraggingPlayhead ? 'true' : 'false'}
      >
        {transcript.length === 0 ? (
          <div className="transcript-empty-state">
            {transcriptStatus === 'transcribing' ? 'Transcribing...' : 'No transcript. Click "Transcribe" to generate.'}
          </div>
        ) : visibleSegments.length === 0 ? (
          <div className="transcript-empty-state">
            No matches for “{searchQuery}”
          </div>
        ) : (
          <div className="transcript-segment-list">
            {visibleSegments.map(segment => {
              const isActiveSegment = currentWordIndex !== null
                && currentWordIndex >= segment.startWordIndex
                && currentWordIndex <= segment.endWordIndex;
              const speakerTone = getTranscriptSpeakerTone(segment.speaker);
              return (
                <article
                  className={[
                    'transcript-speaker-segment',
                    `transcript-speaker-tone-${speakerTone}`,
                    isActiveSegment ? 'active' : '',
                  ].filter(Boolean).join(' ')}
                  key={segment.id}
                >
                  <header className="transcript-segment-header">
                    <span className="transcript-segment-speaker">
                      <span className="transcript-speaker-dot" aria-hidden="true" />
                      {segment.speaker}
                    </span>
                    <button
                      className="transcript-segment-time"
                      onClick={() => handleWordClick(segment.startTime)}
                      title="Seek to this speaker turn"
                      type="button"
                    >
                      {formatTranscriptTimestamp(segment.startTime)}
                      <span aria-hidden="true"> – </span>
                      {formatTranscriptTimestamp(segment.endTime)}
                    </button>
                  </header>
                  <div className="transcript-segment-words">
                    {segment.words.map((word, localWordIndex) => {
                      const orderedWordIndex = segment.startWordIndex + localWordIndex;
                      const presentationKey = `${word.id}:${word.start}:${word.end}:${orderedWordIndex}`;
                      const isActive = orderedWordIndex === currentWordIndex;
                      const isHighlighted = normalizedSearchQuery.length > 0
                        && word.text.toLocaleLowerCase().includes(normalizedSearchQuery);
                      const needsReview = !isHybridMode
                        && !isBestQualityTranscript
                        && word.needsReview === true;
                      return (
                        <button
                          aria-current={isActive ? 'true' : undefined}
                          className={[
                            'transcript-word-inline',
                            isActive ? 'active' : '',
                            isHighlighted ? 'highlighted' : '',
                            needsReview ? 'needs-review' : '',
                          ].filter(Boolean).join(' ')}
                          data-transcript-word-id={presentationKey}
                          key={presentationKey}
                          onClick={() => handleWordClick(word.start)}
                          ref={element => registerWordElement(orderedWordIndex, element)}
                          title={[
                            `${formatTranscriptTimestamp(word.start)} – ${formatTranscriptTimestamp(word.end)}`,
                            word.speakerSourceProvider === 'openai'
                              ? 'Speaker separation: OpenAI'
                              : '',
                          ].filter(Boolean).join('\n')}
                          type="button"
                        >
                          {word.text}
                        </button>
                      );
                    })}
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </div>

      {/* Status */}
      {transcriptStatus === 'ready' && (
        <div className="transcript-status-bar">
          <span>
            {transcript.length} words · {speakerCount} {speakerCount === 1 ? 'speaker' : 'speakers'}
          </span>
          <span className={`transcript-follow-status ${isPlaying || isDraggingPlayhead ? 'active' : ''}`}>
            {isDraggingPlayhead
              ? 'Following scrub'
              : isPlaying
                ? 'Following playback'
                : 'Click a word to seek'}
          </span>
        </div>
      )}
    </div>
  );
}
