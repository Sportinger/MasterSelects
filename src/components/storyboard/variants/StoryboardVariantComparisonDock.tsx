import { useMemo, useState } from 'react';
import { useMediaStore } from '../../../stores/mediaStore';
import { useStoryboardStore } from '../../../stores/storyboardStore';
import { useTimelineStore } from '../../../stores/timeline';
import {
  captureVariantRangeSnapshot,
  commitTimelineVariantOption,
  createVariantTimelineSourceFromComposition,
  type VariantBoundaryMutationPolicy,
} from '../../../services/storyboard/variants';
import { StoryboardVariantComparisonTray } from './StoryboardVariantComparisonTray';

export interface StoryboardVariantComparisonDockProps {
  isPlaying: boolean;
  loop: boolean;
  playhead: number;
  onPause: () => void;
  onPlay: () => void;
  onSeek: (time: number) => void;
  onToggleLoop: () => void;
}

export function StoryboardVariantComparisonTimelineDock() {
  const isPlaying = useTimelineStore((state) => state.isPlaying);
  const loop = useTimelineStore((state) => state.loopPlayback);
  const playhead = useTimelineStore((state) => state.playheadPosition);
  const onPause = useTimelineStore((state) => state.pause);
  const onPlay = useTimelineStore((state) => state.play);
  const onSeek = useTimelineStore((state) => state.setPlayheadPosition);
  const onToggleLoop = useTimelineStore((state) => state.toggleLoopPlayback);
  return (
    <StoryboardVariantComparisonDock
      isPlaying={isPlaying}
      loop={loop}
      onPause={onPause}
      onPlay={onPlay}
      onSeek={onSeek}
      onToggleLoop={onToggleLoop}
      playhead={playhead}
    />
  );
}

export function StoryboardVariantComparisonDock({
  isPlaying,
  loop,
  playhead,
  onPause,
  onPlay,
  onSeek,
  onToggleLoop,
}: StoryboardVariantComparisonDockProps) {
  const variantSets = useStoryboardStore((state) => state.variantSets);
  const variantOptions = useStoryboardStore((state) => state.variantOptions);
  const candidates = useStoryboardStore((state) => state.candidates);
  const putVariantOption = useStoryboardStore((state) => state.putVariantOption);
  const compositions = useMediaStore((state) => state.compositions);
  const openCompositionTab = useMediaStore((state) => state.openCompositionTab);
  const [selectedOptionId, setSelectedOptionId] = useState<string>();
  const [boundaryPolicy, setBoundaryPolicy] =
    useState<VariantBoundaryMutationPolicy>('preserve');
  const [commitError, setCommitError] = useState<string>();
  const [isCommitting, setIsCommitting] = useState(false);
  const variantSet = useMemo(() => (
    Object.values(variantSets)
      .filter((candidate) => (
        (candidate.status === 'review' || candidate.status === 'building')
        && candidate.optionIds.length > 0
      ))
      .toSorted((left, right) => right.createdAt - left.createdAt)[0]
  ), [variantSets]);
  const options = useMemo(() => (
    variantSet?.optionIds
      .map((optionId) => variantOptions[optionId])
      .filter((option) => option !== undefined) ?? []
  ), [variantOptions, variantSet]);
  if (!variantSet || options.length === 0) return null;
  const activeOptionId = options.some((option) => option.id === selectedOptionId)
    ? selectedOptionId
    : options[0]!.id;

  const selectOption = (optionId: string) => {
    const option = variantOptions[optionId];
    if (!option?.materializedCompositionId || option.state === 'failed') return;
    setSelectedOptionId(optionId);
    void openCompositionTab(option.materializedCompositionId, {
      playFromTime: Math.min(
        variantSet.scope.endTime,
        Math.max(variantSet.scope.startTime, playhead),
      ),
      skipAnimation: true,
    });
  };
  const rejectOption = (optionId: string) => {
    const option = variantOptions[optionId];
    if (!option) return;
    putVariantOption({ ...option, state: 'rejected' });
  };
  const commitOption = async (optionId: string) => {
    const option = variantOptions[optionId];
    const baseComposition = compositions.find(
      (composition) => composition.id === variantSet.baseCompositionId,
    );
    if (!option || !baseComposition?.timelineData || isCommitting) return;
    setCommitError(undefined);
    setIsCommitting(true);
    try {
      const currentRangeSnapshot = captureVariantRangeSnapshot(
        createVariantTimelineSourceFromComposition({
          composition: baseComposition,
          scope: variantSet.scope,
          boundaryPaddingSeconds: 1,
        }),
      );
      await commitTimelineVariantOption({
        variantSet,
        option,
        currentRangeSnapshot,
        boundaryPolicy,
      });
      await openCompositionTab(baseComposition.id, {
        playFromTime: variantSet.scope.startTime,
        skipAnimation: true,
      });
      setSelectedOptionId(undefined);
    } catch (error) {
      setCommitError(
        error instanceof Error ? error.message : 'The selected range could not be committed.',
      );
    } finally {
      setIsCommitting(false);
    }
  };

  return (
    <StoryboardVariantComparisonTray
      activeOptionId={activeOptionId}
      boundaryPolicy={boundaryPolicy}
      candidates={candidates}
      commitError={commitError}
      isPlaying={isPlaying}
      isCommitting={isCommitting}
      loop={loop}
      onAccept={(optionId) => void commitOption(optionId)}
      onAssignPreview={selectOption}
      onBoundaryPolicyChange={setBoundaryPolicy}
      onOptionSelect={selectOption}
      onPlayPause={isPlaying ? onPause : onPlay}
      onRefine={(optionId) => {
        window.dispatchEvent(new CustomEvent('masterselects:storyboard-variant-refine', {
          detail: { optionId, variantSetId: variantSet.id },
        }));
      }}
      onReject={rejectOption}
      onSeek={onSeek}
      onToggleLoop={onToggleLoop}
      options={options}
      playhead={playhead}
      variantSet={variantSet}
    />
  );
}
