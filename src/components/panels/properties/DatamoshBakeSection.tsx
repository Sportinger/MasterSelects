import { useMemo, useState } from 'react';
import {
  bakeDatamoshTransition,
  DATAMOSH_PLAYBACK_EXTENSION,
  DATAMOSH_PLAYBACK_MIME_TYPE,
  type DatamoshBakePhase,
} from '../../../services/datamosh';
import { useMediaStore } from '../../../stores/mediaStore';
import { requireMediaFileImportResult } from '../../../stores/mediaStore/helpers/importResult';
import { useTimelineStore } from '../../../stores/timeline';
import type { TimelineClip } from '../../../types/timeline';
import type { TimelineTransition } from '../../../types/timelineCore';
import { DATAMOSH_BAKE_FORMAT } from '../../../transitions';

interface DatamoshBakeSectionProps {
  transition: TimelineTransition;
  outgoingClip: TimelineClip;
  incomingClip: TimelineClip;
  ownerClipId: string;
  edge: 'in' | 'out';
  duration: number;
}

interface BakeProgress {
  phase: DatamoshBakePhase;
  completed: number;
  total: number;
}

function safeFilePart(value: string): string {
  return value.replace(/[\\/:*?"<>|]+/g, '-').trim().slice(0, 48) || 'clip';
}

function progressText(progress: BakeProgress | null): string {
  if (!progress) return '';
  if (progress.phase === 'preparing') return 'Preparing codec...';
  if (progress.phase === 'corrupting') return 'Removing MPEG-4 I-frame...';
  if (progress.phase === 'muxing') return 'Finalizing stream...';
  return `Rendering ${progress.completed} / ${progress.total} frames...`;
}

export function DatamoshBakeSection({
  transition,
  outgoingClip,
  incomingClip,
  ownerClipId,
  edge,
  duration,
}: DatamoshBakeSectionProps) {
  const applyTimelineEditOperation = useTimelineStore(state => state.applyTimelineEditOperation);
  const mediaFiles = useMediaStore(state => state.files);
  const activeComposition = useMediaStore(state => (
    state.compositions.find(candidate => candidate.id === state.activeCompositionId) ?? null
  ));
  const [progress, setProgress] = useState<BakeProgress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [completedMessage, setCompletedMessage] = useState<string | null>(null);
  const bitrateMbps = typeof transition.params?.bitrateMbps === 'number'
    ? transition.params.bitrateMbps
    : 2;
  const bakedMediaFileId = typeof transition.params?.bakedMediaFileId === 'string'
    ? transition.params.bakedMediaFileId
    : '';
  const bakedMediaExists = mediaFiles.some(file => file.id === bakedMediaFileId);
  const frameRate = activeComposition?.frameRate ?? 30;
  const bakeIsCurrent = useMemo(() => {
    const bakedDuration = transition.params?.bakedDuration;
    const bakedBitrate = transition.params?.bakedBitrateMbps;
    return bakedMediaExists
      && typeof bakedDuration === 'number'
      && typeof bakedBitrate === 'number'
      && transition.params?.bakedFormat === DATAMOSH_BAKE_FORMAT
      && Math.abs(bakedDuration - duration) <= 0.5 / frameRate
      && Math.abs(bakedBitrate - bitrateMbps) <= 0.000_001;
  }, [bakedMediaExists, bitrateMbps, duration, frameRate, transition.params]);
  const isBaking = progress !== null;

  const bake = async () => {
    if (!activeComposition || isBaking) return;
    setError(null);
    setCompletedMessage(null);
    setProgress({ phase: 'preparing', completed: 0, total: 1 });

    try {
      const result = await bakeDatamoshTransition({
        outgoingClip,
        incomingClip,
        compositionId: activeComposition.id,
        width: activeComposition.width,
        height: activeComposition.height,
        fps: activeComposition.frameRate,
        duration,
        bitrate: Math.round(bitrateMbps * 1_000_000),
        onProgress: (phase, completed, total) => setProgress({ phase, completed, total }),
      });
      const fileName = [
        'Datamosh',
        safeFilePart(outgoingClip.name),
        'to',
        safeFilePart(incomingClip.name),
        String(Date.now()),
      ].join(' ') + DATAMOSH_PLAYBACK_EXTENSION;
      const mediaState = useMediaStore.getState();
      const folder = mediaState.folders.find(candidate => candidate.name === 'Datamosh' && candidate.parentId === null)
        ?? mediaState.createFolder('Datamosh', null);
      const imported = requireMediaFileImportResult(await mediaState.importFile(
        new File([result.blob], fileName, { type: DATAMOSH_PLAYBACK_MIME_TYPE }),
        folder.id,
        { forceCopyToProject: true, projectFileName: fileName },
      ), 'Datamosh bake');
      if (imported.type !== 'video') {
        throw new Error('The baked datamosh stream was not recognized as video.');
      }

      const operationId = `transition-datamosh-bake:${transition.id}:${Date.now()}`;
      const editResult = applyTimelineEditOperation({
        id: operationId,
        type: 'transition-update-params',
        transactionId: operationId,
        historyBatchId: operationId,
        source: 'ui',
        clipId: ownerClipId,
        edge,
        transitionId: transition.id,
        params: {
          ...(transition.params ?? {}),
          bakedMediaFileId: imported.id,
          bakedDuration: duration,
          bakedBitrateMbps: bitrateMbps,
          bakedFormat: DATAMOSH_BAKE_FORMAT,
        },
      }, {
        source: 'ui',
        historyLabel: bakeIsCurrent ? 'Rebake Datamosh transition' : 'Bake Datamosh transition',
      });
      if (!editResult.success) {
        throw new Error(editResult.warnings.map(warning => warning.message).join(' ') || 'The transition could not be updated.');
      }
      setCompletedMessage(`${result.outputPacketCount} codec packets ready`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setProgress(null);
    }
  };

  return (
    <section className="properties-section datamosh-bake-section">
      <h4>Codec Bake</h4>
      <p className="datamosh-bake-description">
        Real MPEG-4 Part 2 I-frame removal. Bake once; preview and export then play the cached result in real time.
      </p>
      <div className="datamosh-bake-status" aria-live="polite">
        {isBaking
          ? progressText(progress)
          : error ?? completedMessage ?? (bakeIsCurrent ? 'Codec artifact is ready' : 'Bake required')}
      </div>
      <button
        className="datamosh-bake-button"
        type="button"
        disabled={isBaking || !activeComposition}
        onClick={() => void bake()}
        onPointerUp={(event) => event.currentTarget.blur()}
      >
        {isBaking ? 'Baking...' : bakeIsCurrent ? 'Rebake Datamosh' : 'Bake Datamosh'}
      </button>
    </section>
  );
}
