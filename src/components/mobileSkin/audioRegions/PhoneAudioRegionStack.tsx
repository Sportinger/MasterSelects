// Edit stack of the clip in the Sound range sheet: every range edit as a row with Bypass and
// Remove (the editor's own stack actions, inside the sheet's edit session), a tap on a row selects
// its range again, plus listening: the edited range or the untouched original through the editor's
// AudioEditPreviewService (the desktop audio edit stack's preview).

import { useEffect, useState } from 'react';

import type { TimelineAudioRegionSelection } from '../../../stores/timeline/types';
import type { TimelineClip } from '../../../types/timeline';
import { Logger } from '../../../services/logger';
import { audioEditPreviewService } from '../../../services/audio/AudioEditPreviewService';
import { getInlineAudioEditLabel } from '../../timeline/utils/audioRegionDisplay';
import { blurAfterPointer } from '../audio/PhoneAudioControls';
import { formatPhoneRegionTime, phoneRegionFromTimes } from './phoneAudioRegionModel';
import { PHONE_AUDIO_REGION_TEST_IDS as IDS } from './phoneAudioRegionTestIds';

const log = Logger.create('PhoneAudioRegionStack');

interface Props {
  clip: TimelineClip;
  selection: TimelineAudioRegionSelection | null;
  disabled: boolean;
  onDisabledTap: () => void;
  onSelect: (selection: TimelineAudioRegionSelection) => void;
  onToggle: (operationId: string, enabled: boolean) => void;
  onRemove: (operationId: string) => void;
  onOpenPanel: () => void;
}

type PreviewState = { id: 'stack' | 'source'; phase: string; message?: string } | null;

export function PhoneAudioRegionStack({ clip, selection, disabled, onDisabledTap, onSelect, onToggle, onRemove, onOpenPanel }: Props) {
  const operations = clip.audioState?.editStack ?? [];
  const [preview, setPreview] = useState<PreviewState>(null);

  useEffect(() => () => audioEditPreviewService.stop(), []);

  const listen = async (id: 'stack' | 'source') => {
    if (preview?.id === id) {
      audioEditPreviewService.stop();
      setPreview(null);
      return;
    }
    audioEditPreviewService.stop();
    const from = selection?.startTime ?? clip.startTime;
    const span = selection ? selection.endTime - selection.startTime : clip.duration;
    setPreview({ id, phase: 'rendering', message: 'Preparing the sound' });
    try {
      await audioEditPreviewService.preview({
        clip,
        operations,
        mode: id,
        previewId: id,
        timelineTime: from,
        maxDurationSeconds: Math.max(0.5, Math.min(12, span + 0.25)),
        includeSpectralLayers: true,
        onStatus: (status) => {
          setPreview((current) => {
            if (!current || current.id !== status.previewId) return current;
            if (status.phase === 'stopped') return null;
            return { id: current.id, phase: status.phase, message: status.message ?? status.progress?.message };
          });
        },
      });
    } catch (error) {
      log.warn('Range preview failed', error);
      setPreview({ id, phase: 'error', message: error instanceof Error ? error.message : 'Preview failed' });
    }
  };

  const range = (operation: (typeof operations)[number]) => {
    const start = Number(operation.params.timelineStart);
    const end = Number(operation.params.timelineEnd);
    return Number.isFinite(start) && Number.isFinite(end) ? { start, end } : null;
  };

  return (
    <div className="phone-audio-section" role="tabpanel" aria-label="Edit stack">
      <div className="phone-region-row">
        <button type="button" className="phone-audio-toggle" data-testid={IDS.previewEdited} aria-pressed={preview?.id === 'stack'}
          onPointerUp={blurAfterPointer} onClick={() => { void listen('stack'); }}>
          {preview?.id === 'stack' ? 'Stop' : 'Listen: edited'}
        </button>
        <button type="button" className="phone-audio-toggle" data-testid={IDS.previewSource} aria-pressed={preview?.id === 'source'}
          onPointerUp={blurAfterPointer} onClick={() => { void listen('source'); }}>
          {preview?.id === 'source' ? 'Stop' : 'Listen: original'}
        </button>
      </div>
      <p className="phone-audio-sheet__hint" data-testid={IDS.previewStatus} data-phase={preview?.phase ?? 'idle'}>
        {preview ? `${preview.phase === 'error' ? 'Preview failed' : preview.phase === 'playing' ? 'Playing' : 'Preparing'}${preview.message ? `: ${preview.message}` : ''}` : 'Plays the selected range (or the clip) without moving the playhead.'}
      </p>
      {operations.length === 0 ? (
        <p className="phone-audio-sheet__hint">No range edits on this clip yet.</p>
      ) : (
        <ul className="phone-audio-list">
          {operations.map((operation) => {
            const span = range(operation);
            const enabled = operation.enabled !== false;
            return (
              <li key={operation.id} className="phone-region-stack__row" data-testid={IDS.stackRow} data-op-type={operation.type} data-enabled={enabled}>
                <button type="button" className="phone-region-stack__name" onPointerUp={blurAfterPointer}
                  onClick={() => { if (span) onSelect(phoneRegionFromTimes(clip, span.start, span.end)); }}>
                  <span className="phone-audio-list__name">{getInlineAudioEditLabel(operation.type, operation.params)}</span>
                  <span className="phone-audio-list__meta">{span ? `${formatPhoneRegionTime(span.start)} – ${formatPhoneRegionTime(span.end)}` : 'whole clip'}{enabled ? '' : ' · bypassed'}</span>
                </button>
                <button type="button" className="phone-region-stack__action" data-testid={IDS.stackBypass} aria-pressed={!enabled}
                  aria-disabled={disabled || undefined} onPointerUp={blurAfterPointer}
                  onClick={() => (disabled ? onDisabledTap() : onToggle(operation.id, !enabled))}>
                  {enabled ? 'Bypass' : 'Use'}
                </button>
                <button type="button" className="phone-region-stack__action" data-testid={IDS.stackRemove}
                  aria-disabled={disabled || undefined} onPointerUp={blurAfterPointer}
                  onClick={() => (disabled ? onDisabledTap() : onRemove(operation.id))}>
                  Remove
                </button>
              </li>
            );
          })}
        </ul>
      )}
      <button type="button" className="phone-audio-toggle" data-testid={IDS.stackPanel} onPointerUp={blurAfterPointer} onClick={onOpenPanel}>
        Full edit stack (bake, cleanup)…
      </button>
    </div>
  );
}
