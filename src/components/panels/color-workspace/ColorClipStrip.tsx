import { useMemo, useState, type MouseEvent } from 'react';

import { getClipMediaFileId } from '../../../services/mediaArtifacts/mediaSourceArtifacts';
import {
  createPrimaryMediaObjectUrl,
  getPrimaryMediaObjectUrlKey,
  mediaObjectUrlManager,
} from '../../../services/project/mediaObjectUrlManager';
import { requestMediaSourceReveal } from '../../../services/mediaSourceReveal';
import { thumbnailCacheService } from '../../../services/thumbnailCacheService';
import {
  copyLocalColorGradeToRemote,
  copyRemoteColorGradeToLocal,
  setClipColorGradeMode,
} from '../../../services/colorGrades/remoteColorGradeCommands';
import { toColorGradeThumbnailPreview } from '../../../services/colorGrades/colorGradeThumbnailPreview';
import { useDockStore } from '../../../stores/dockStore';
import { useMediaStore } from '../../../stores/mediaStore';
import { parseCodecName } from '../../../stores/mediaStore/helpers/mediaInfoHelpers';
import { useTimelineStore } from '../../../stores/timeline';
import {
  compileRuntimeColorGrade,
  ensureColorCorrectionState,
} from '../../../types/colorCorrection';
import type { TimelineClip } from '../../../types/timeline';
import {
  regenerateClipContextMenuThumbnails,
  resolveClipContextMenuLabelTarget,
} from '../../timeline/utils/clipContextMenu';
import { ColorGradeThumbnail } from '../color/ColorGradeThumbnail';
import {
  ColorClipContextMenu,
  type ColorClipContextMenuPosition,
  type ColorClipMarkerOption,
} from './ColorClipContextMenu';
import './ColorClipStrip.css';

const MARKER_OPTIONS: readonly ColorClipMarkerOption[] = [
  { label: 'Default' },
  { label: 'Red', color: '#e2514c' },
  { label: 'Yellow', color: '#dbb63b' },
  { label: 'Green', color: '#6db849' },
  { label: 'Cyan', color: '#49bce3' },
  { label: 'Blue', color: '#4a90e2' },
  { label: 'Purple', color: '#8b5fc7' },
];

function formatStripTime(seconds: number): string {
  const safeSeconds = Math.max(0, seconds);
  const minutes = Math.floor(safeSeconds / 60);
  const wholeSeconds = Math.floor(safeSeconds % 60);
  const frames = Math.floor((safeSeconds % 1) * 30);
  return `${String(minutes).padStart(2, '0')}:${String(wholeSeconds).padStart(2, '0')}:${String(frames).padStart(2, '0')}`;
}

export function ColorClipStrip() {
  const [contextMenu, setContextMenu] = useState<ColorClipContextMenuPosition | null>(null);
  const [thumbnailsUpdating, setThumbnailsUpdating] = useState(false);
  const clips = useTimelineStore(state => state.clips);
  const tracks = useTimelineStore(state => state.tracks);
  const selectedClipIds = useTimelineStore(state => state.selectedClipIds);
  const primarySelectedClipId = useTimelineStore(state => state.primarySelectedClipId);
  const selectTimelineClip = useTimelineStore(state => state.selectClip);
  const setPlayheadPosition = useTimelineStore(state => state.setPlayheadPosition);
  const mediaFiles = useMediaStore(state => state.files);

  const videoTracks = useMemo(
    () => tracks.filter(track => track.type === 'video'),
    [tracks],
  );
  const videoTrackIds = useMemo(
    () => new Set(videoTracks.map(track => track.id)),
    [videoTracks],
  );
  const trackLabelById = useMemo(
    () => new Map(videoTracks.map((track, index) => [track.id, `V${index + 1}`] as const)),
    [videoTracks],
  );
  const videoClips = useMemo(
    () => clips
      .filter(clip => videoTrackIds.has(clip.trackId) && !clip.source?.cameraSettings)
      .toSorted((left, right) => left.startTime - right.startTime || left.id.localeCompare(right.id)),
    [clips, videoTrackIds],
  );
  const mediaById = useMemo(
    () => new Map(mediaFiles.map(file => [file.id, file] as const)),
    [mediaFiles],
  );
  const focusedClipId = primarySelectedClipId
    && selectedClipIds.has(primarySelectedClipId)
    && videoClips.some(clip => clip.id === primarySelectedClipId)
    ? primarySelectedClipId
    : [...selectedClipIds].find(clipId => videoClips.some(clip => clip.id === clipId))
      ?? videoClips[0]?.id;
  const contextClip = contextMenu
    ? videoClips.find(clip => clip.id === contextMenu.clipId) ?? null
    : null;
  const contextMediaId = contextClip ? getClipMediaFileId(contextClip) : undefined;
  const contextMediaFile = contextMediaId ? mediaById.get(contextMediaId) : undefined;
  const contextColorState = contextClip
    ? ensureColorCorrectionState(contextClip.colorCorrection)
    : null;
  const labelTarget = contextClip
    ? resolveClipContextMenuLabelTarget(contextClip, useMediaStore.getState())
    : { mediaItemId: null, currentColor: 'none' as const };
  const thumbnailMediaFiles = useMemo(() => {
    const mediaIds = new Set(videoClips.map(getClipMediaFileId).filter((id): id is string => Boolean(id)));
    return mediaFiles.filter(file => mediaIds.has(file.id) && (file.type === 'video' || file.type === 'image'));
  }, [mediaFiles, videoClips]);

  const selectClip = (clipId: string, startTime: number) => {
    selectTimelineClip(clipId);
    setPlayheadPosition(startTime);
  };
  const getThumbnail = (clip: TimelineClip) => {
    const mediaId = getClipMediaFileId(clip);
    return clip.thumbnails?.[0] ?? (mediaId ? mediaById.get(mediaId)?.thumbnailUrl : undefined);
  };
  const getFormatLabel = (clip: TimelineClip) => {
    const mediaId = getClipMediaFileId(clip);
    const mediaFile = mediaId ? mediaById.get(mediaId) : undefined;
    if (mediaFile?.codec) return parseCodecName(mediaFile.codec);

    const sourceName = mediaFile?.name ?? clip.file?.name ?? clip.name;
    const extension = sourceName.match(/\.([^.]+)$/)?.[1];
    return extension?.toUpperCase() ?? mediaFile?.container?.toUpperCase() ?? 'VIDEO';
  };
  const openContextMenu = (event: MouseEvent, clipId: string) => {
    event.preventDefault();
    event.stopPropagation();
    selectTimelineClip(clipId);
    setContextMenu({ x: event.clientX, y: event.clientY, clipId });
  };
  const openPanelForClip = (clipId: string, panel: 'color-nodes' | 'clip-properties') => {
    const timeline = useTimelineStore.getState();
    timeline.selectClip(clipId);
    if (panel === 'color-nodes') {
      timeline.setColorViewMode(clipId, 'nodes');
    }
    useDockStore.getState().activatePanelType(panel);
  };
  const updateAllThumbnails = async () => {
    if (thumbnailsUpdating || thumbnailMediaFiles.length === 0) return;
    setThumbnailsUpdating(true);
    const mediaStore = useMediaStore.getState();
    const currentClips = useTimelineStore.getState().clips;

    try {
      await Promise.allSettled(thumbnailMediaFiles.map(async mediaFile => {
        await mediaStore.ensureFileThumbnail(mediaFile.id, { force: true });
        if (mediaFile.type !== 'video') return;
        await regenerateClipContextMenuThumbnails({
          mediaFile,
          clips: currentClips,
          thumbnailCache: thumbnailCacheService,
          getManagedPrimarySourceUrl: mediaFileId => mediaObjectUrlManager.get(
            mediaFileId,
            getPrimaryMediaObjectUrlKey(),
          ),
          createPrimarySourceUrl: (mediaFileId, file) => createPrimaryMediaObjectUrl(mediaFileId, file, {
            revokeExisting: false,
          }),
        });
      }));
    } finally {
      setThumbnailsUpdating(false);
    }
  };

  return (
    <section className="color-clip-strip" aria-label="Color clips">
      <div className="color-grade-clips-list">
        {videoClips.length === 0
          ? <span className="color-grade-clips-empty">No video clips</span>
          : videoClips.map((clip, index) => {
            const thumbnail = getThumbnail(clip);
            const formatLabel = getFormatLabel(clip);
            const selected = clip.id === focusedClipId;
            const compiledGrade = compileRuntimeColorGrade(clip.colorCorrection);
            const graded = Boolean(compiledGrade);
            return (
              <article
                className={`color-grade-clip-tile${selected ? ' selected' : ''}${graded ? ' graded' : ''}`}
                key={clip.id}
              >
                <header className="color-grade-clip-meta">
                  <span className="color-grade-clip-index">{String(index + 1).padStart(2, '0')}</span>
                  <span className="color-grade-clip-track">{trackLabelById.get(clip.trackId)}</span>
                </header>
                <button
                  aria-label={`Open clip ${index + 1}: ${clip.name}`}
                  aria-pressed={selected}
                  className="color-grade-clip"
                  onClick={() => selectClip(clip.id, clip.startTime)}
                  onContextMenu={event => openContextMenu(event, clip.id)}
                  title={`${clip.name} · ${formatStripTime(clip.duration)}`}
                  type="button"
                >
                  <ColorGradeThumbnail
                    className="color-grade-clip-preview"
                    preview={toColorGradeThumbnailPreview(compiledGrade)}
                    sourceUrl={thumbnail}
                  />
                </button>
                <span className="color-grade-clip-name" title={formatLabel}>{formatLabel}</span>
              </article>
            );
          })}
      </div>
      {contextMenu && contextClip && contextColorState && (
        <ColorClipContextMenu
          activeVersionId={contextColorState.activeVersionId}
          canFindMedia={Boolean(contextMediaFile)}
          canManageProxy={contextMediaFile?.type === 'video'}
          canSetLabelColor={Boolean(labelTarget.mediaItemId)}
          canUseRemoteGrade={Boolean(contextMediaFile)}
          canUpdateThumbnails={thumbnailMediaFiles.length > 0}
          clipName={contextClip.name}
          currentLabelColor={labelTarget.currentColor}
          gradeMode={contextClip.colorGradeMode ?? 'local'}
          hasRemoteGrade={Boolean(contextMediaFile?.remoteColorGrade)}
          markerOptions={MARKER_OPTIONS}
          onAddMarker={color => {
            const timeline = useTimelineStore.getState();
            timeline.addMarker(timeline.playheadPosition, undefined, color);
          }}
          onClose={() => setContextMenu(null)}
          onCreateVersion={() => useTimelineStore.getState().duplicateColorVersion(contextClip.id)}
          onFindInMedia={() => {
            if (!contextMediaFile) return;
            useDockStore.getState().activatePanelType('media');
            requestMediaSourceReveal(contextMediaFile.id, 'timeline');
          }}
          onKeepOnlyActiveVersion={() => {
            const timeline = useTimelineStore.getState();
            contextColorState.versions.forEach(version => {
              if (version.id !== contextColorState.activeVersionId) {
                timeline.deleteColorVersion(contextClip.id, version.id);
              }
            });
          }}
          onCopyLocalToRemote={() => { copyLocalColorGradeToRemote(contextClip.id); }}
          onCopyRemoteToLocal={() => { copyRemoteColorGradeToLocal(contextClip.id); }}
          onManageProxy={() => {
            if (!contextMediaFile) return;
            const mediaStore = useMediaStore.getState();
            if (contextMediaFile.proxyStatus === 'generating') {
              mediaStore.cancelProxyGeneration(contextMediaFile.id);
            } else {
              mediaStore.generateProxy(contextMediaFile.id, {
                force: contextMediaFile.proxyStatus === 'ready' || contextMediaFile.proxyStatus === 'error',
              });
            }
          }}
          onOpenNodeGraph={() => openPanelForClip(contextClip.id, 'color-nodes')}
          onSelectVersion={versionId => useTimelineStore.getState().setActiveColorVersion(contextClip.id, versionId)}
          onSetGradeMode={mode => { setClipColorGradeMode(contextClip.id, mode); }}
          onSetLabelColor={color => {
            if (!labelTarget.mediaItemId) return;
            useMediaStore.getState().setLabelColor([labelTarget.mediaItemId], color);
          }}
          onUpdateAllThumbnails={() => { void updateAllThumbnails(); }}
          onViewClipDetails={() => openPanelForClip(contextClip.id, 'clip-properties')}
          position={contextMenu}
          proxyProgress={contextMediaFile?.proxyProgress}
          proxyStatus={contextMediaFile?.proxyStatus}
          thumbnailsUpdating={thumbnailsUpdating}
          versionScopeLabel={contextClip.colorGradeMode === 'remote' ? 'Remote Versions' : 'Local Versions'}
          versions={contextColorState.versions}
        />
      )}
    </section>
  );
}
