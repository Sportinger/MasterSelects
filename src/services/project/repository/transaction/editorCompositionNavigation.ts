import type { MediaState } from '../../../../stores/mediaStore/types';
import type { TimelineStore } from '../../../../stores/timeline/types';
import { RepositoryError } from '../contracts';
import { getRepositoryStore, withRepositoryHydration } from './storeMutationBoundary';
import { getEditorRepositorySession, getEditorRepositoryWorkspace, queueEditorRepositoryView } from './editorMutationRuntime';
import { blockEditorContentPublication, publishEditorContentProjection, readEditorContentPublication } from './editorPublication';
import { stageEditorTimeline } from './editorTimelineRestore';
import { isExclusiveTimelineMutationLeaseActive } from '../../../../stores/timeline/exclusiveMutationLease';
import { playheadState, stopInternalPosition, updateInternalPosition } from '../../../layerBuilder/PlayheadState';
import { stopTimelineAudioPlayback } from '../../../audio/timelineAudioPlaybackStopper';
import { syncHistoryRehydratedTimelineRuntimeResources } from '../../../timeline/historyRuntimeRehydration';
import { layerBuilder } from '../../../layerBuilder';
import { renderHostPort } from '../../../render/renderHostPort';
import { Logger } from '../../../logger';

const log = Logger.create('CompositionNavigation');

/** Tab navigation uses the installed content projection, without re-reading the project. */
export async function navigateEditorComposition(id: string | null): Promise<void> {
  const session = getEditorRepositorySession();
  if (!session) return;
  const mediaStore = getRepositoryStore('media'), timelineStore = getRepositoryStore('timeline');
  if (!mediaStore || !timelineStore) throw new RepositoryError('ownership', 'Editor stores are not initialized');
  const media = mediaStore.getState() as MediaState, timeline = timelineStore.getState() as TimelineStore;
  if (id === media.activeCompositionId) return;
  const composition = media.compositions.find(comp => comp.id === id);
  if (id !== null && !composition) throw new RepositoryError('ownership', 'Composition is not in the installed project');
  const publication = readEditorContentPublication();
  if (timeline.isExporting || isExclusiveTimelineMutationLeaseActive() || publication.blocked) {
    throw new RepositoryError('ownership', 'Cannot switch composition during content activation or export');
  }
  const started = performance.now();
  const position = playheadState.isUsingInternalPosition ? playheadState.position : timeline.playheadPosition;
  if (media.activeCompositionId) {
    for (const [field, value] of Object.entries({ playheadPosition: position, zoom: timeline.zoom, scrollX: timeline.scrollX })) {
      queueEditorRepositoryView(`timeline/${media.activeCompositionId}/${field}`, value);
    }
  }
  const workspace = getEditorRepositoryWorkspace() as Record<string, unknown>;
  const view = { playheadPosition: 0, zoom: 50, scrollX: 0 };
  for (const field of ['playheadPosition', 'zoom', 'scrollX'] as const) {
    const value = workspace[`timeline/${id}/${field}`];
    if (typeof value === 'number' && Number.isFinite(value)) view[field] = value;
  }
  blockEditorContentPublication();
  let staged: Awaited<ReturnType<typeof stageEditorTimeline>> | null = null;
  let swapped = false;
  const current = () => getEditorRepositorySession() === session;
  try {
    stopInternalPosition();
    withRepositoryHydration(stopTimelineAudioPlayback);
    staged = await stageEditorTimeline(timeline, media, composition, new AbortController().signal, patch => {
      if (current() && (timelineStore.getState() as TimelineStore).timelineSessionId === staged?.state.timelineSessionId) {
        withRepositoryHydration(() => timelineStore.setState(patch));
      }
    }, () => timelineStore.getState() as TimelineStore);
    if (!current()) throw new RepositoryError('cancelled', 'Project session changed during composition switch');
    swapped = true;
    withRepositoryHydration(() => {
      mediaStore.setState({ activeCompositionId: id });
      timelineStore.setState({ ...staged!.state, ...view, isDraggingPlayhead: false,
        clipAnimationPhase: 'idle', compositionSwitchSourceTracks: null, compositionSwitchTargetTracks: null });
    });
    staged.activate();
    updateInternalPosition(view.playheadPosition);
    syncHistoryRehydratedTimelineRuntimeResources((timelineStore.getState() as TimelineStore).clips);
    layerBuilder.invalidateCache();
    renderHostPort.clearCaches();
    publishEditorContentProjection(publication);
    renderHostPort.requestNewFrameRender();
    queueEditorRepositoryView('media/activeCompositionId', id);
    log.info('Composition switched', { compositionId: id, durationMs: Math.round(performance.now() - started) });
  } catch (error) {
    staged?.abandon();
    if (current()) {
      if (swapped) withRepositoryHydration(() => { mediaStore.setState(media); timelineStore.setState(timeline); });
      updateInternalPosition(position);
      syncHistoryRehydratedTimelineRuntimeResources(timeline.clips);
      layerBuilder.invalidateCache();
      renderHostPort.clearCaches();
      publishEditorContentProjection(publication);
      renderHostPort.requestNewFrameRender();
    }
    throw error;
  }
}
