import { useEffect, useMemo, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';

import {
  assessStoryboardDuration,
  evaluateStoryboardCoverage,
  resolveStoryboardEvidenceRefs,
  type StoryboardCoverageEvaluation,
  type StoryboardEvidenceResolution,
} from '../../../../services/storyboard/coverage';
import {
  selectLatestStoryboardGenerationBrief,
} from '../../../../services/storyboard/generation/briefRevisions';
import {
  projectStoryboardTimelineClips,
  selectStoryboardProjectState,
  useStoryboardStore,
} from '../../../../stores/storyboardStore';
import { useMediaStore } from '../../../../stores/mediaStore';
import { useTimelineStore } from '../../../../stores/timeline';
import type { StoryboardEvidenceRef } from '../../../../services/storyboard/contracts';
import { StoryboardCoverageSummary } from './StoryboardCoverageSummary';
import { StoryboardDurationBadge } from './StoryboardDurationBadge';
import { StoryboardEvidenceChips } from './StoryboardEvidenceChips';
import './StoryboardSceneInsights.css';

export function StoryboardSceneInsights({ clipId }: { readonly clipId: string }) {
  const storyboardStore = useStoryboardStore(state => state);
  const { clips, selectClip, setPlayheadPosition } = useTimelineStore(useShallow(state => ({
    clips: state.clips,
    selectClip: state.selectClip,
    setPlayheadPosition: state.setPlayheadPosition,
  })));
  const { mediaFiles, setSelection } = useMediaStore(useShallow(state => ({
    mediaFiles: state.files,
    setSelection: state.setSelection,
  })));
  const [coverageState, setCoverageState] = useState<{
    sceneId: string;
    evaluation: StoryboardCoverageEvaluation | null;
    error: string | null;
  } | null>(null);
  const sceneClip = clips.find(clip => clip.id === clipId);
  const projectState = useMemo(
    () => projectStoryboardTimelineClips(
      selectStoryboardProjectState(storyboardStore),
      clips,
    ),
    [clips, storyboardStore],
  );
  const sceneId = sceneClip?.storyboardProperties?.sceneId;
  const scene = sceneId ? projectState.scenes[sceneId] : undefined;
  const evidenceRefs = (
    scene?.evidenceRefIds ?? sceneClip?.storyboardProperties?.evidenceRefIds ?? []
  )
    .map(id => projectState.evidenceRefs[id])
    .filter((ref): ref is StoryboardEvidenceRef => !!ref);
  const evidence = resolveStoryboardEvidenceRefs({
    refs: evidenceRefs,
    mediaFiles,
    candidates: projectState.candidates,
  });
  const latestBrief = sceneId
    ? selectLatestStoryboardGenerationBrief(projectState, sceneId)
    : undefined;
  const duration = sceneClip
    ? assessStoryboardDuration({ sceneClip, clips })
    : null;

  useEffect(() => {
    if (!sceneId || !scene) return;
    let cancelled = false;
    void evaluateStoryboardCoverage({
      state: projectState,
      sceneId,
      mediaFiles,
      evaluatedAt: Date.now(),
    }).then((result) => {
      if (!cancelled) {
        setCoverageState({ sceneId, evaluation: result, error: null });
      }
    }).catch((error: unknown) => {
      if (!cancelled) {
        setCoverageState({
          sceneId,
          evaluation: null,
          error: error instanceof Error ? error.message : 'Coverage calculation failed.',
        });
      }
    });
    return () => {
      cancelled = true;
    };
  }, [mediaFiles, projectState, scene, sceneId]);
  const currentCoverageState = coverageState?.sceneId === sceneId
    ? coverageState
    : null;

  const openEvidence = (resolution: StoryboardEvidenceResolution) => {
    if (resolution.mediaFileId) setSelection([resolution.mediaFileId]);
    if (resolution.mediaFileId && resolution.startSeconds !== undefined) {
      const sourceClip = clips.find(clip =>
        clip.source?.type !== 'storyboard' &&
        (clip.source?.mediaFileId ?? clip.mediaFileId) === resolution.mediaFileId
      );
      if (sourceClip) {
        const speed = Math.max(0.001, Math.abs(sourceClip.speed ?? 1));
        const timelineTime = sourceClip.startTime +
          Math.max(0, resolution.startSeconds - sourceClip.inPoint) / speed;
        selectClip(sourceClip.id);
        setPlayheadPosition(Math.min(sourceClip.startTime + sourceClip.duration, timelineTime));
      }
    }
    window.dispatchEvent(new CustomEvent('storyboard-evidence-open', {
      detail: { sceneId, resolution },
    }));
  };

  const repairEvidence = (resolution: StoryboardEvidenceResolution) => {
    window.dispatchEvent(new CustomEvent('storyboard-evidence-repair-request', {
      detail: {
        sceneId,
        evidenceRefId: resolution.ref.id,
        currentRef: resolution.ref,
        suggestedRef: resolution.suggestedRef,
      },
    }));
  };

  if (!sceneClip?.storyboardProperties || !sceneId) return null;
  return (
    <div className="storyboard-scene-insights">
      <StoryboardCoverageSummary
        coverage={currentCoverageState?.evaluation?.coverage ?? null}
        loading={!currentCoverageState}
        error={currentCoverageState?.error}
      />
      <StoryboardEvidenceChips
        evidence={evidence}
        latestBrief={latestBrief}
        onOpenEvidence={openEvidence}
        onRepairEvidence={repairEvidence}
      />
      {(sceneClip.storyboardProperties.filledClipIds?.length ?? 0) > 0 && duration && (
        <StoryboardDurationBadge assessment={duration} />
      )}
    </div>
  );
}
