import { useCallback, useEffect, useMemo, useState } from 'react';
import { buildMotionPropertyTargetModel } from '../../services/motionDesign/propertyTargets';
import {
  propertyRegistry,
  resolveClipPropertyAuthoringContext,
  resolveTransformPositionUnitMode,
} from '../../services/properties';
import {
  MOTION_PROPERTY_FAVORITES_CHANGED_EVENT,
  readStoredMotionPropertyFavoritePaths,
} from '../../stores/timeline/viewPreferences';
import type { Keyframe } from '../../types/keyframes';
import type { TimelineClip } from '../../types/timeline';
import type { PropertyAuthoringCompositionLike } from '../../services/properties/propertyAuthoring';
import { GlobalCurveEditor } from './GlobalCurveEditor';
import type { TimelineGraphTarget } from './hooks/useTimelineGraphController';
import type { TimelineTrackProps } from './types';
import {
  buildCurveGraphModel,
  getCurveSeriesId,
  type CurveGraphModel,
  type CurveGraphSeries,
} from './utils/curveGraphModel';

export type { TimelineGraphTarget } from './hooks/useTimelineGraphController';

interface TimelineGlobalCurveSurfaceProps {
  activeComposition: PropertyAuthoringCompositionLike | null;
  applyTimelineEditOperation: NonNullable<TimelineTrackProps['applyTimelineEditOperation']>;
  clipKeyframes: ReadonlyMap<string, readonly Keyframe[]>;
  clips: readonly TimelineClip[];
  height: number;
  onActiveSeriesChange?: (target: TimelineGraphTarget) => void;
  onClose?: () => void;
  onSelectKeyframe: TimelineTrackProps['onSelectKeyframe'];
  pixelToTime: (pixel: number) => number;
  preferredTarget?: TimelineGraphTarget | null;
  primaryClipId?: string | null;
  scrollX: number;
  selectedClipIds: ReadonlySet<string>;
  selectedKeyframeIds: ReadonlySet<string>;
  timeToPixel: (time: number) => number;
  trackHeaderWidth: number;
  width: number;
}

function useMotionPropertyFavorites(): string[] {
  const [favoritePaths, setFavoritePaths] = useState(
    () => readStoredMotionPropertyFavoritePaths([]),
  );

  useEffect(() => {
    const refresh = () => setFavoritePaths(readStoredMotionPropertyFavoritePaths([]));
    window.addEventListener('storage', refresh);
    window.addEventListener(MOTION_PROPERTY_FAVORITES_CHANGED_EVENT, refresh);
    return () => {
      window.removeEventListener('storage', refresh);
      window.removeEventListener(MOTION_PROPERTY_FAVORITES_CHANGED_EVENT, refresh);
    };
  }, []);

  return favoritePaths;
}

function buildVisibleCurveModel(
  model: CurveGraphModel,
  mutedSeriesIds: ReadonlySet<string>,
  activeSeriesId: string | null,
): CurveGraphModel {
  const series = model.series.filter((candidate) => !mutedSeriesIds.has(candidate.id));
  const visibleKeyframeIds = new Set(
    series.flatMap((candidate) => candidate.keyframes.map((keyframe) => keyframe.id)),
  );
  return {
    ...model,
    series,
    activeSeriesId,
    selectedKeyframeIds: new Set(
      [...model.selectedKeyframeIds].filter((keyframeId) => visibleKeyframeIds.has(keyframeId)),
    ),
    renderedKeyframes: series.reduce(
      (total, candidate) => total + candidate.keyframes.length,
      0,
    ),
  };
}

export function TimelineGlobalCurveSurface({
  activeComposition,
  applyTimelineEditOperation,
  clipKeyframes,
  clips,
  height,
  onActiveSeriesChange,
  onClose,
  onSelectKeyframe,
  pixelToTime,
  preferredTarget,
  primaryClipId,
  scrollX,
  selectedClipIds,
  selectedKeyframeIds,
  timeToPixel,
  trackHeaderWidth,
  width,
}: TimelineGlobalCurveSurfaceProps) {
  const favoritePaths = useMotionPropertyFavorites();
  const [mutedSeriesIds, setMutedSeriesIds] = useState<Set<string>>(() => new Set());

  const selectedClips = useMemo(() => {
    const ordered = clips.filter((clip) => selectedClipIds.has(clip.id));
    if (!primaryClipId) return ordered;
    const primaryIndex = ordered.findIndex((clip) => clip.id === primaryClipId);
    if (primaryIndex <= 0) return ordered;
    return [ordered[primaryIndex], ...ordered.slice(0, primaryIndex), ...ordered.slice(primaryIndex + 1)];
  }, [clips, primaryClipId, selectedClipIds]);

  const allSelectedClipKeyframes = useMemo(
    () => selectedClips.flatMap((clip) => [...(clipKeyframes.get(clip.id) ?? [])]),
    [clipKeyframes, selectedClips],
  );
  const selectedTargets = useMemo(() => {
    const targets: Array<{ clipId: string; path: string }> = [];
    const seen = new Set<string>();
    const addTarget = (target: TimelineGraphTarget) => {
      const id = getCurveSeriesId(target.clipId, target.property);
      if (seen.has(id)) return;
      seen.add(id);
      targets.push({ clipId: target.clipId, path: target.property });
    };

    if (preferredTarget && selectedClipIds.has(preferredTarget.clipId)) {
      addTarget(preferredTarget);
    }
    allSelectedClipKeyframes
      .filter((keyframe) => selectedKeyframeIds.has(keyframe.id))
      .forEach((keyframe) => addTarget({
        clipId: keyframe.clipId,
        property: keyframe.property,
      }));
    return targets;
  }, [allSelectedClipKeyframes, preferredTarget, selectedClipIds, selectedKeyframeIds]);
  const animatedByClip = useMemo(() => new Map(
    selectedClips.map((clip) => [clip.id, clipKeyframes.get(clip.id) ?? []] as const),
  ), [clipKeyframes, selectedClips]);
  const propertyTargets = useMemo(() => buildMotionPropertyTargetModel({
    registry: propertyRegistry,
    clips: selectedClips,
    selectedTargets,
    favoritePaths,
    animatedByClip,
  }), [animatedByClip, favoritePaths, selectedClips, selectedTargets]);

  const authoringContextByClipId = useMemo(() => {
    const contexts = new Map();
    if (!activeComposition) return contexts;
    const liveClipIds = clips.map((clip) => clip.id);
    for (const clip of selectedClips) {
      const resolution = resolveClipPropertyAuthoringContext({
        clipId: clip.id,
        compositions: [activeComposition],
        activeCompositionId: activeComposition.id,
        liveClipIds,
        positionUnitMode: resolveTransformPositionUnitMode(clip),
      });
      if (resolution.ok) contexts.set(clip.id, resolution.context);
    }
    return contexts;
  }, [activeComposition, clips, selectedClips]);

  const preferredSeriesId = preferredTarget
    ? getCurveSeriesId(preferredTarget.clipId, preferredTarget.property)
    : null;
  const model = useMemo(() => buildCurveGraphModel({
    propertyTargets: propertyTargets.targets,
    clips: selectedClips,
    clipKeyframes,
    selectedKeyframeIds,
    activeSeriesId: preferredSeriesId,
    authoringContextByClipId,
  }), [
    authoringContextByClipId,
    clipKeyframes,
    preferredSeriesId,
    propertyTargets.targets,
    selectedClips,
    selectedKeyframeIds,
  ]);

  const visibleSeries = model.series.filter((series) => !mutedSeriesIds.has(series.id));
  const effectiveActiveSeriesId = [preferredSeriesId, model.activeSeriesId]
    .find((seriesId) => seriesId && visibleSeries.some((series) => series.id === seriesId))
    ?? visibleSeries[0]?.id
    ?? null;
  const visibleModel = useMemo(
    () => buildVisibleCurveModel(model, mutedSeriesIds, effectiveActiveSeriesId),
    [effectiveActiveSeriesId, model, mutedSeriesIds],
  );

  const notifyActiveSeries = useCallback((series: CurveGraphSeries) => {
    onActiveSeriesChange?.({ clipId: series.clipId, property: series.property });
  }, [onActiveSeriesChange]);
  const activateSeries = useCallback((seriesId: string) => {
    const series = model.series.find((candidate) => candidate.id === seriesId);
    if (!series) return;
    if (mutedSeriesIds.has(series.id)) {
      setMutedSeriesIds((current) => {
        const next = new Set(current);
        next.delete(series.id);
        return next;
      });
    }
    notifyActiveSeries(series);
  }, [model.series, mutedSeriesIds, notifyActiveSeries]);

  const toggleSeriesVisibility = useCallback((series: CurveGraphSeries) => {
    const willMute = !mutedSeriesIds.has(series.id);
    if (willMute && effectiveActiveSeriesId === series.id) {
      const nextActive = model.series.find(
        (candidate) => candidate.id !== series.id && !mutedSeriesIds.has(candidate.id),
      );
      if (nextActive) notifyActiveSeries(nextActive);
    }
    setMutedSeriesIds((current) => {
      const next = new Set(current);
      if (next.has(series.id)) next.delete(series.id);
      else next.add(series.id);
      return next;
    });
  }, [effectiveActiveSeriesId, model.series, mutedSeriesIds, notifyActiveSeries]);

  const showOnlyActiveSeries = useCallback(() => {
    if (!effectiveActiveSeriesId) return;
    setMutedSeriesIds(new Set(
      model.series
        .filter((series) => series.id !== effectiveActiveSeriesId)
        .map((series) => series.id),
    ));
  }, [effectiveActiveSeriesId, model.series]);

  const graphWidth = Math.max(1, width);
  const graphHeight = Math.max(180, height);

  return (
    <div
      className="timeline-global-curve-surface"
      style={{ gridTemplateColumns: `${trackHeaderWidth}px minmax(0, 1fr)` }}
      data-testid="timeline-global-curve-surface"
    >
      <aside className="timeline-global-curve-sidebar" aria-label="Graph parameters">
        <div className="timeline-global-curve-sidebar-header">
          <div>
            <strong>Graph</strong>
            <span>{visibleSeries.length}/{model.series.length}</span>
          </div>
          <div className="timeline-global-curve-sidebar-actions">
            <button
              type="button"
              onClick={() => setMutedSeriesIds(new Set())}
              disabled={mutedSeriesIds.size === 0}
              title="Show all curves"
              aria-label="Show all curves"
            >
              All
            </button>
            <button
              type="button"
              onClick={showOnlyActiveSeries}
              disabled={!effectiveActiveSeriesId || visibleSeries.length <= 1}
              title="Show only the active curve"
              aria-label="Show only the active curve"
            >
              Solo
            </button>
            {onClose && (
              <button type="button" onClick={onClose} title="Close Graph" aria-label="Close Graph">
                ×
              </button>
            )}
          </div>
        </div>
        <div className="timeline-global-curve-series-list" role="tablist" aria-label="Curve series">
          {model.series.map((series) => {
            const isMuted = mutedSeriesIds.has(series.id);
            const isActive = series.id === effectiveActiveSeriesId;
            return (
              <div
                key={series.id}
                className={`timeline-global-curve-series-row${isActive ? ' active' : ''}${isMuted ? ' muted' : ''}`}
              >
                <button
                  type="button"
                  role="tab"
                  aria-selected={isActive}
                  className="timeline-global-curve-series-main"
                  onClick={() => activateSeries(series.id)}
                  title={`${series.clipName} · ${series.property}`}
                >
                  <span
                    className="timeline-global-curve-series-swatch"
                    style={{ backgroundColor: series.color }}
                  />
                  <span className="timeline-global-curve-series-copy">
                    <strong>{series.label}</strong>
                    <span>{series.clipName}{series.unit ? ` · ${series.unit}` : ''}</span>
                  </span>
                </button>
                <button
                  type="button"
                  className="timeline-global-curve-visibility"
                  aria-label={`${isMuted ? 'Show' : 'Hide'} ${series.label} curve`}
                  aria-pressed={!isMuted}
                  title={`${isMuted ? 'Show' : 'Hide'} ${series.label} curve`}
                  onClick={() => toggleSeriesVisibility(series)}
                >
                  <span aria-hidden="true">{isMuted ? '○' : '●'}</span>
                </button>
              </div>
            );
          })}
          {model.series.length === 0 && (
            <div className="timeline-global-curve-sidebar-empty">No animated parameters.</div>
          )}
        </div>
      </aside>
      <div className="timeline-global-curve-editor-pane">
        <GlobalCurveEditor
          model={visibleModel}
          width={graphWidth}
          height={graphHeight}
          timeToPixel={(compositionTime) => timeToPixel(compositionTime) - scrollX}
          pixelToTime={(pixel) => pixelToTime(pixel + scrollX)}
          selectedKeyframeIds={selectedKeyframeIds}
          activeSeriesId={effectiveActiveSeriesId}
          onActiveSeriesChange={activateSeries}
          onSelectKeyframe={onSelectKeyframe}
          applyTimelineEditOperation={applyTimelineEditOperation}
          showLegend={false}
          emptyMessage={model.series.length > 0
            ? 'All curves are hidden.'
            : 'No numeric animated properties to graph.'}
        />
      </div>
    </div>
  );
}
