import { useEffect, useMemo, useSyncExternalStore } from 'react';
import {
  IconArrowLeft,
  IconArrowRight,
  IconPlayerPlay,
  IconWand,
} from '@tabler/icons-react';
import { TimelineTranscriptEditor } from '../components/panels/properties/TimelineTranscriptEditor';
import { applyAutomaticAudioFades } from '../services/audio/applyAutomaticCutDeClick';
import {
  collectMissingAudioJunctionFadeTargets,
  DEFAULT_AUTOMATIC_DE_CLICK_FADE_SECONDS,
} from '../services/audio/automaticCutDeClick';
import {
  deleteTranscriptTimelineRange,
  moveTranscriptTimelineRange,
} from '../services/captions/captionTimelineEditing';
import { createTimelineTranscript } from '../services/captions/captionTimelineTranscript';
import {
  getTranscriptReviewOmissions,
  isTranscriptReviewOmissionRemoved,
  restoreTranscriptReviewOmission,
  subscribeTranscriptReviewEdits,
} from '../services/captions/transcriptReviewEdits';
import { layerBuilder } from '../services/layerBuilder';
import { renderHostPort } from '../services/render/renderHostPort';
import { correctTranscriptWordFromCaption } from '../services/transcription/artifactPersistence';
import { useTimelineStore } from '../stores/timeline';
import { ChatReviewTimeline } from './ChatReviewTimeline';
import { LandingReviewPreview } from './LandingReviewPreview';
import type { LandingReviewVariantSummary } from './LandingPageProps';

interface LandingEditReviewProps {
  activeVariantId?: string;
  compositionId?: string;
  compositionName?: string;
  error?: string;
  isRendering?: boolean;
  onOpenEditor?: () => void;
  onRender?: () => Promise<void> | void;
  onSelectVariant?: (variantId: string) => Promise<boolean> | boolean | void;
  presentation?: 'review' | 'sequence';
  variants?: LandingReviewVariantSummary[];
}

function formatDuration(seconds: number): string {
  const totalSeconds = Math.max(0, Math.round(seconds));
  const minutes = Math.floor(totalSeconds / 60);
  const remainingSeconds = totalSeconds % 60;
  return `${minutes}:${remainingSeconds.toString().padStart(2, '0')}`;
}

export function LandingEditReview({
  activeVariantId,
  compositionId,
  compositionName,
  error,
  isRendering = false,
  onOpenEditor,
  onRender,
  onSelectVariant,
  presentation = 'review',
  variants = [],
}: LandingEditReviewProps) {
  const clips = useTimelineStore(state => state.clips);
  const tracks = useTimelineStore(state => state.tracks);
  const playheadPosition = useTimelineStore(state => state.playheadPosition);
  const duration = useTimelineStore(state => state.duration);
  const setPlayheadPosition = useTimelineStore(state => state.setPlayheadPosition);
  const invalidateCache = useTimelineStore(state => state.invalidateCache);
  const clipEnd = Math.max(...clips.map(clip => clip.startTime + clip.duration), 0);
  const editEnd = Math.max(
    0.01,
    clipEnd > 0 && duration > 0 ? Math.min(duration, clipEnd) : clipEnd || duration,
  );
  const events = useMemo(() => createTimelineTranscript({
    clips,
    timelineEnd: editEnd,
    tracks,
  }), [clips, editEnd, tracks]);
  const wordCount = events.filter(event => event.kind === 'word').length;
  const pauseCount = events.length - wordCount;
  const storedOmissions = useSyncExternalStore(
    subscribeTranscriptReviewEdits,
    () => getTranscriptReviewOmissions(compositionId),
    () => getTranscriptReviewOmissions(compositionId),
  );
  const omissions = useMemo(() => {
    return storedOmissions.filter(omission => isTranscriptReviewOmissionRemoved(omission, clips));
  }, [clips, storedOmissions]);
  const activeVariantIndex = Math.max(
    0,
    variants.findIndex(variant => variant.id === activeVariantId),
  );
  const selectVariant = (variantId: string) => {
    if (!onSelectVariant || variantId === activeVariantId) return;
    void Promise.resolve(onSelectVariant(variantId)).catch(() => undefined);
  };

  useEffect(() => {
    if (!compositionId || presentation !== 'review') return;
    const fadeTargets = collectMissingAudioJunctionFadeTargets(
      useTimelineStore.getState().clips,
    );
    const applied = applyAutomaticAudioFades(
      fadeTargets,
      DEFAULT_AUTOMATIC_DE_CLICK_FADE_SECONDS,
    );
    if (applied > 0) {
      layerBuilder.invalidateCache();
      renderHostPort.requestNewFrameRender();
    }
  }, [compositionId, presentation]);

  const isSequencePresentation = presentation === 'sequence';

  return (
    <section className="landing-edit-review" aria-labelledby="landing-edit-review-title">
      <header className="landing-edit-review-heading">
        <div>
          <p className="landing-eyebrow">
            {isSequencePresentation ? 'Selected sequence' : 'Review before render'}
          </p>
          <h2 id="landing-edit-review-title">
            {isSequencePresentation ? compositionName ?? 'Sequence loaded' : 'Your edit is ready'}
          </h2>
        </div>
        <span>
          {!isSequencePresentation && compositionName ? `${compositionName} · ` : ''}
          {formatDuration(editEnd)}
        </span>
      </header>

      {!isSequencePresentation && variants.length > 1 && (
        <nav className="landing-edit-variants" aria-label="Edit versions">
          <button
            aria-label="Previous version"
            disabled={activeVariantIndex === 0 || isRendering}
            type="button"
            onClick={() => selectVariant(variants[activeVariantIndex - 1]!.id)}
          >
            <IconArrowLeft aria-hidden="true" />
          </button>
          <div className="landing-edit-variant-track">
            {variants.map(variant => (
              <button
                aria-current={variant.id === activeVariantId ? 'true' : undefined}
                className={variant.id === activeVariantId ? 'is-active' : ''}
                disabled={isRendering}
                key={variant.id}
                type="button"
                onClick={() => selectVariant(variant.id)}
              >
                <span>{variant.label}</span>
                {variant.status === 'running' && <i className="landing-chat-spinner" aria-label="Updating" />}
                {variant.status === 'failed' && <small>Needs attention</small>}
              </button>
            ))}
          </div>
          <button
            aria-label="Next version"
            disabled={activeVariantIndex >= variants.length - 1 || isRendering}
            type="button"
            onClick={() => selectVariant(variants[activeVariantIndex + 1]!.id)}
          >
            <IconArrowRight aria-hidden="true" />
          </button>
        </nav>
      )}

      <div className="landing-edit-review-workspace">
        <LandingReviewPreview compositionId={compositionId} duration={editEnd} />

        <div className="landing-edit-review-transcript">
          <div className="landing-edit-review-transcript-heading">
            <span>Words & pauses</span>
            <small>
              {wordCount} {wordCount === 1 ? 'word' : 'words'}
              {pauseCount > 0 ? ` · ${pauseCount} ${pauseCount === 1 ? 'pause' : 'pauses'}` : ''}
            </small>
          </div>
          <TimelineTranscriptEditor
            ariaLabel="Editable edit transcript"
            emptyMessage={isSequencePresentation
              ? 'This sequence has no transcript yet. Its timeline is still available below.'
              : 'This edit has no transcript words to review. You can still inspect the timeline or render it.'}
            events={events}
            omissions={omissions}
            helpMessage="Click to select · Shift-click a range · Double-click to correct · Eye hides or restores words and pauses."
            onCorrectWord={(event, text) => {
              const result = correctTranscriptWordFromCaption({
                sourceClipId: event.sourceClipId,
                wordId: event.wordId,
                text,
              });
              if (result.ok) {
                invalidateCache();
                layerBuilder.invalidateCache();
                renderHostPort.requestNewFrameRender();
              }
              return result;
            }}
            onDeleteRange={(event, label) => deleteTranscriptTimelineRange({
              compositionId,
              sourceClipId: event.sourceClipId,
              timelineStart: event.timelineStart,
              timelineEnd: event.timelineEnd,
              transcriptEvent: event,
              label,
            })}
            onMoveRange={({ end, events: rangeEvents, start, targetTime }) => moveTranscriptTimelineRange({
              compositionId,
              sourceClipIds: [...new Set(rangeEvents.map(event => event.sourceClipId))],
              timelineEnd: end,
              timelineStart: start,
              targetTime,
            })}
            onRestoreOmission={(omissionId) => compositionId
              ? restoreTranscriptReviewOmission(compositionId, omissionId)
              : { ok: false, error: 'The active edit version could not be resolved.' }}
            playheadPosition={playheadPosition}
            setPlayheadPosition={setPlayheadPosition}
          />
        </div>
      </div>

      <div
        className="landing-edit-review-timeline"
        data-dock-layout-anim-id="panel:timeline"
        data-dock-layout-sequence-surface="true"
        aria-label="Compact timeline review"
      >
        <ChatReviewTimeline duration={editEnd} />
      </div>

      {error && <p className="landing-edit-review-error" role="alert">{error}</p>}

      {(onOpenEditor || onRender) && <footer className="landing-edit-review-actions">
        {onOpenEditor && (
          <button type="button" className="landing-edit-review-editor" onClick={onOpenEditor}>
            <IconWand aria-hidden="true" />
            <span>Open full editor</span>
            <IconArrowRight aria-hidden="true" />
          </button>
        )}
        {onRender && <button
          type="button"
          className="landing-edit-review-render"
          disabled={isRendering || clips.length === 0}
          onClick={() => void Promise.resolve(onRender?.()).catch(() => undefined)}
        >
          {isRendering ? <span className="landing-chat-spinner" aria-hidden="true" /> : <IconPlayerPlay aria-hidden="true" />}
          <span>{isRendering ? 'Rendering video' : 'Render video'}</span>
        </button>}
      </footer>}
    </section>
  );
}
