import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { TimelineClip } from '../../../types';
import type { MediaFile } from '../../../stores/mediaStore/types';
import type { ClipStemSeparationJobState } from '../../../stores/timeline/types';
import { formatStemJobPhase, isActiveStemJobPhase } from '../../../stores/timeline/helpers/stemSeparationJobPhases';
import { EMPTY_STEM_CHOICES } from '../components/ClipStemDisplay';
import { ClipStemSwitcher } from '../components/ClipStemSwitcher';

export interface ClipStemSwitcherState {
  showActiveStemSeparation: boolean;
  activeStemProgressPercent: number;
  activeStemStatusTitle?: string;
  isDownloadingStemModel: boolean;
  stemSwitcherNode: ReactNode;
}

export function useClipStemSwitcher(input: {
  clip: TimelineClip;
  clips: readonly TimelineClip[];
  mediaFiles: readonly MediaFile[];
  clipStemSeparationJob?: ClipStemSeparationJobState | null;
  setClipSourceToStem: (clipId: string, stemMediaFileId: string) => void;
  prewarmStemSourceMediaFiles: (mediaFileIds: string[]) => void;
}): ClipStemSwitcherState {
  const [stemMenuOpen, setStemMenuOpen] = useState(false);
  const stemMenuCloseTimerRef = useRef<number | null>(null);
  const activeStemSeparationJob = input.clipStemSeparationJob &&
    isActiveStemJobPhase(input.clipStemSeparationJob.phase)
    ? input.clipStemSeparationJob
    : null;
  const activeStemProgressPercent = activeStemSeparationJob
    ? Math.round(Math.max(0, Math.min(1, activeStemSeparationJob.progress)) * 100)
    : 0;
  const activeStemStatusLabel = activeStemSeparationJob
    ? activeStemSeparationJob.message ?? formatStemJobPhase(activeStemSeparationJob.phase)
    : '';
  const activeStemStatusTitle = activeStemSeparationJob
    ? `${activeStemStatusLabel}: ${activeStemProgressPercent}%`
    : undefined;
  const isDownloadingStemModel = activeStemSeparationJob?.phase === 'downloading-model';
  const completedStemChoices = !activeStemSeparationJob && input.clipStemSeparationJob?.phase === 'complete'
    ? input.clipStemSeparationJob.stems ?? EMPTY_STEM_CHOICES
    : EMPTY_STEM_CHOICES;
  const hasCompletedStemChoices = completedStemChoices.length > 0;
  let stemSourceMediaFileId = input.clipStemSeparationJob?.sourceMediaFileId ?? null;
  if (!stemSourceMediaFileId) {
    for (const stem of completedStemChoices) {
      const sourceMediaFileId = input.mediaFiles.find(file => file.id === stem.mediaFileId)?.stemInfo?.sourceMediaFileId;
      if (sourceMediaFileId) {
        stemSourceMediaFileId = sourceMediaFileId;
        break;
      }
    }
  }
  const hasStemSourceChoice = Boolean(
    stemSourceMediaFileId &&
    input.mediaFiles.some(file => file.id === stemSourceMediaFileId && file.type === 'audio')
  );
  const stemSourceClip = input.clipStemSeparationJob
    ? input.clips.find(candidate => candidate.id === input.clipStemSeparationJob?.clipId)
    : input.clip;
  const activeStemMediaFileId = stemSourceClip?.source?.mediaFileId ?? stemSourceClip?.mediaFileId;

  const clearStemMenuCloseTimer = useCallback(() => {
    if (stemMenuCloseTimerRef.current === null) return;
    window.clearTimeout(stemMenuCloseTimerRef.current);
    stemMenuCloseTimerRef.current = null;
  }, []);

  const prewarmCompletedStemSources = useCallback(() => {
    if (!hasCompletedStemChoices) return;
    const mediaFileIds = completedStemChoices.map(stem => stem.mediaFileId);
    if (stemSourceMediaFileId) {
      mediaFileIds.unshift(stemSourceMediaFileId);
    }
    input.prewarmStemSourceMediaFiles(mediaFileIds);
  }, [
    completedStemChoices,
    hasCompletedStemChoices,
    input.prewarmStemSourceMediaFiles,
    stemSourceMediaFileId,
  ]);

  useEffect(() => clearStemMenuCloseTimer, [clearStemMenuCloseTimer]);

  const handleStemControlMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
  }, []);

  const handleStemBadgeClick = useCallback((e: React.MouseEvent<HTMLButtonElement>) => {
    e.preventDefault();
    e.stopPropagation();
    clearStemMenuCloseTimer();
    if (!hasCompletedStemChoices) return;
    setStemMenuOpen(open => {
      const nextOpen = !open;
      if (nextOpen) {
        prewarmCompletedStemSources();
      }
      return nextOpen;
    });
  }, [clearStemMenuCloseTimer, hasCompletedStemChoices, prewarmCompletedStemSources]);

  const handleStemChoiceClick = useCallback((stemMediaFileId: string) => (e: React.MouseEvent<HTMLButtonElement>) => {
    e.preventDefault();
    e.stopPropagation();
    input.setClipSourceToStem(input.clip.id, stemMediaFileId);
  }, [input.clip.id, input.setClipSourceToStem]);

  const handleStemSwitcherMouseEnter = useCallback(() => {
    clearStemMenuCloseTimer();
    prewarmCompletedStemSources();
  }, [clearStemMenuCloseTimer, prewarmCompletedStemSources]);

  const handleStemSwitcherMouseLeave = useCallback(() => {
    if (!stemMenuOpen) return;
    clearStemMenuCloseTimer();
    stemMenuCloseTimerRef.current = window.setTimeout(() => {
      setStemMenuOpen(false);
      stemMenuCloseTimerRef.current = null;
    }, 320);
  }, [clearStemMenuCloseTimer, stemMenuOpen]);

  const stemSwitcherNode = useMemo(() => hasCompletedStemChoices ? (
    <ClipStemSwitcher
      stemMenuOpen={stemMenuOpen}
      completedStemChoices={completedStemChoices}
      hasStemSourceChoice={hasStemSourceChoice}
      stemSourceMediaFileId={stemSourceMediaFileId}
      activeStemMediaFileId={activeStemMediaFileId}
      onMouseEnter={handleStemSwitcherMouseEnter}
      onMouseLeave={handleStemSwitcherMouseLeave}
      onControlMouseDown={handleStemControlMouseDown}
      onBadgeClick={handleStemBadgeClick}
      onChoiceClick={handleStemChoiceClick}
    />
  ) : null, [
    activeStemMediaFileId,
    completedStemChoices,
    handleStemBadgeClick,
    handleStemChoiceClick,
    handleStemControlMouseDown,
    handleStemSwitcherMouseEnter,
    handleStemSwitcherMouseLeave,
    hasCompletedStemChoices,
    hasStemSourceChoice,
    stemMenuOpen,
    stemSourceMediaFileId,
  ]);

  return {
    showActiveStemSeparation: Boolean(activeStemSeparationJob),
    activeStemProgressPercent,
    activeStemStatusTitle,
    isDownloadingStemModel,
    stemSwitcherNode,
  };
}
