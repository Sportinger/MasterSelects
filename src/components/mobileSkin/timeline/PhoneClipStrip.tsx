// Clip tiles of one phone timeline lane. Tiles are DOM elements positioned in content
// coordinates (t * zoom); the navigation hook moves the whole layer, so panning never re-renders
// tiles. Only the portion of a clip inside the rendered time window is laid out, which bounds
// filmstrip images and waveform canvases to viewport + overscan.
// During a clip edit gesture the strip draws the phone-local preview geometry: the trimmed tile,
// a dimmed drag source and the dragged ghost in its target lane. The primary selected clip gets
// trim handles (PhoneTrimHandles).

import { memo, useEffect, useRef, useState, type KeyboardEvent } from 'react';

import { useTimelineStore } from '../../../stores/timeline';
import type { TimelineClip } from '../../../types/timeline';
import { PHONE_TEST_IDS } from '../contracts';
import { selectPhoneClip } from '../actions/phoneCutActions';
import { phoneClipAccessibleName, type PhoneLaneLayout, type PhoneTimeWindow } from './phoneTimelineGeometry';
import { PhoneTrimHandles } from './PhoneTrimHandles';
import { usePhoneClipEditPreviewStore, type PhoneClipEditPreview } from './usePhoneClipEditGesture';
import {
  PHONE_RASTER_MAX_CSS_WIDTH,
  drawPhoneClipWaveform,
  getPhoneClipThumbnails,
  phoneClipHasWaveformData,
} from './usePhoneClipVisuals';

export type PhoneLaneKind = 'video' | 'audio' | 'other';

export interface PhoneLane extends PhoneLaneLayout {
  name: string;
  kind: PhoneLaneKind;
  main: boolean;
}

interface PhoneClipStripProps {
  lane: PhoneLane;
  clips: readonly TimelineClip[];
  selectedClipIds: ReadonlySet<string>;
  zoom: number;
  timeWindow: PhoneTimeWindow;
  /** Bumps when cached thumbnails/waveforms change. */
  visualsVersion: number;
  thumbnailAspect: number;
  /** Source label colour per clip id (hex); clips without one are missing. */
  labelColors?: ReadonlyMap<string, string>;
  /** The editor's thumbnailsEnabled / waveformsEnabled (Timeline → View). */
  thumbnails?: boolean;
  waveforms?: boolean;
}

const TILE_INSET_Y = 2;

function withPreview(clip: TimelineClip, preview: PhoneClipEditPreview): TimelineClip {
  return {
    ...clip,
    trackId: preview.trackId,
    startTime: preview.startTime,
    duration: preview.duration,
    inPoint: preview.inPoint,
    outPoint: preview.outPoint,
  };
}

export function PhoneClipStrip({
  lane, clips, selectedClipIds, zoom, timeWindow, visualsVersion, thumbnailAspect, labelColors, thumbnails = true, waveforms = true,
}: PhoneClipStripProps) {
  const preview = usePhoneClipEditPreviewStore((state) => state.preview);
  const primaryId = useTimelineStore((state) => state.primarySelectedClipId);
  const ghostSource = useTimelineStore((state) => (preview?.kind === 'move' && preview.trackId === lane.trackId
    ? state.clips.find((clip) => clip.id === preview.clipId)
    : undefined));
  const ghost = ghostSource && preview ? withPreview(ghostSource, preview) : null;
  const ghostVisible = ghost !== null && ghost.startTime < timeWindow.end && ghost.startTime + ghost.duration > timeWindow.start;

  const displayClips = clips.map((clip) => (preview?.kind === 'trim' && preview.clipId === clip.id ? withPreview(clip, preview) : clip));
  const handleClip = preview?.kind === 'move'
    ? undefined
    : displayClips.find((clip) => clip.id === primaryId && selectedClipIds.has(clip.id));

  return (
    <>
      <div
        className={`phone-clip-strip phone-clip-strip--${lane.kind}${lane.main ? ' phone-clip-strip--main' : ''}`}
        role="listbox"
        aria-label={lane.main ? `${lane.name} (main track)` : lane.name}
        aria-multiselectable="true"
        data-track-id={lane.trackId}
        style={{ top: lane.top, height: lane.height }}
      >
        {displayClips.map((clip) => (
          <PhoneClipTile
            key={clip.id}
            clip={clip}
            lane={lane}
            selected={selectedClipIds.has(clip.id)}
            dragSource={preview?.kind === 'move' && preview.clipId === clip.id}
            zoom={zoom}
            windowStart={timeWindow.start}
            windowEnd={timeWindow.end}
            visualsVersion={visualsVersion}
            thumbnailAspect={thumbnailAspect}
            labelColor={labelColors?.get(clip.id) ?? null}
            thumbnails={thumbnails}
            waveforms={waveforms}
          />
        ))}
        {ghost && ghostVisible && (
          <PhoneClipTile
            key={`ghost-${ghost.id}`}
            clip={ghost}
            lane={lane}
            selected
            ghost
            zoom={zoom}
            windowStart={timeWindow.start}
            windowEnd={timeWindow.end}
            visualsVersion={visualsVersion}
            thumbnailAspect={thumbnailAspect}
            labelColor={labelColors?.get(ghost.id) ?? null}
            thumbnails={thumbnails}
            waveforms={waveforms}
          />
        )}
      </div>
      {handleClip && (
        <div className="phone-trim-layer" style={{ top: lane.top, height: lane.height }}>
          <PhoneTrimHandles
            clip={handleClip}
            zoom={zoom}
            laneHeight={lane.height}
            windowStart={timeWindow.start}
            windowEnd={timeWindow.end}
            activeEdge={preview?.kind === 'trim' && preview.clipId === handleClip.id ? preview.edge : undefined}
          />
        </div>
      )}
    </>
  );
}

interface PhoneClipTileProps {
  clip: TimelineClip;
  lane: PhoneLane;
  selected: boolean;
  /** Original position of a clip that is being dragged (drawn dimmed). */
  dragSource?: boolean;
  /** The dragged clip at its preview position: not focusable, not hit-testable. */
  ghost?: boolean;
  zoom: number;
  windowStart: number;
  windowEnd: number;
  visualsVersion: number;
  thumbnailAspect: number;
  labelColor: string | null;
  thumbnails: boolean;
  waveforms: boolean;
}

const PhoneClipTile = memo(function PhoneClipTile({
  clip, lane, selected, dragSource = false, ghost = false, zoom, windowStart, windowEnd, visualsVersion, thumbnailAspect,
  labelColor, thumbnails, waveforms,
}: PhoneClipTileProps) {
  const clipEnd = clip.startTime + clip.duration;
  const portionStart = Math.max(clip.startTime, windowStart);
  const portionEnd = Math.min(clipEnd, windowEnd);
  const duration = Math.max(1e-6, clip.duration);
  const startRatio = Math.max(0, (portionStart - clip.startTime) / duration);
  const endRatio = Math.min(1, (portionEnd - clip.startTime) / duration);
  const left = portionStart * zoom;
  const width = Math.max(2, (portionEnd - portionStart) * zoom);
  const height = Math.max(8, lane.height - TILE_INSET_Y * 2);
  const cutLeft = portionStart > clip.startTime + 1e-6;
  const cutRight = portionEnd < clipEnd - 1e-6;

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    event.stopPropagation();
    selectPhoneClip(selected ? null : clip.id);
  };

  return (
    <div
      className={[
        'phone-clip',
        `phone-clip--${lane.kind}`,
        selected ? 'phone-clip--selected' : '',
        cutLeft ? 'phone-clip--cut-left' : '',
        cutRight ? 'phone-clip--cut-right' : '',
        dragSource ? 'phone-clip--drag-source' : '',
        ghost ? 'phone-clip--ghost' : '',
      ].filter(Boolean).join(' ')}
      role={ghost ? undefined : 'option'}
      tabIndex={ghost ? undefined : 0}
      aria-selected={ghost ? undefined : selected}
      aria-hidden={ghost ? true : undefined}
      aria-label={ghost ? undefined : phoneClipAccessibleName(clip)}
      data-testid={ghost ? 'phone-clip-ghost' : PHONE_TEST_IDS.clip}
      data-clip-id={clip.id}
      data-track-id={clip.trackId}
      data-label-color={labelColor ?? undefined}
      data-parent-id={clip.parentClipId ?? undefined}
      style={{ left, width, top: TILE_INSET_Y, height }}
      onKeyDown={ghost ? undefined : onKeyDown}
    >
      {labelColor && <span className="phone-clip__label-stripe" style={{ background: labelColor }} aria-hidden="true" />}
      {lane.kind === 'video' && thumbnails && (
        <PhoneFilmstrip
          clip={clip}
          startRatio={startRatio}
          endRatio={endRatio}
          width={width}
          height={height}
          aspect={thumbnailAspect}
          version={visualsVersion}
        />
      )}
      {lane.kind === 'audio' && waveforms && (
        <PhoneWaveform clip={clip} startRatio={startRatio} endRatio={endRatio} width={width} height={height} version={visualsVersion} />
      )}
      {width >= 60 && <span className="phone-clip__label">{clip.name}</span>}
    </div>
  );
});

interface VisualProps {
  clip: TimelineClip;
  startRatio: number;
  endRatio: number;
  width: number;
  height: number;
  version: number;
}

function PhoneFilmstrip({ clip, startRatio, endRatio, width, height, aspect, version }: VisualProps & { aspect: number }) {
  const thumbWidth = Math.max(16, height * (aspect > 0 ? aspect : 16 / 9));
  const count = Math.max(1, Math.ceil(width / thumbWidth));
  // `version` is part of the inputs so cache arrivals re-read the URLs.
  void version;
  const urls = getPhoneClipThumbnails(clip, startRatio, endRatio, count);
  if (urls.length === 0 || urls.every((url) => url === null)) return null;
  return (
    <div className="phone-clip__filmstrip" aria-hidden="true">
      {urls.map((url, index) => (url
        ? <img key={index} className="phone-clip__thumb" src={url} alt="" draggable={false} style={{ width: thumbWidth }} />
        : <span key={index} className="phone-clip__thumb phone-clip__thumb--missing" style={{ width: thumbWidth }} />))}
    </div>
  );
}

function PhoneWaveform({ clip, startRatio, endRatio, width, height, version }: VisualProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const hasData = phoneClipHasWaveformData(clip);
  const [painted, setPainted] = useState(false);
  const cssWidth = Math.min(PHONE_RASTER_MAX_CSS_WIDTH, width);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !hasData) return;
    const color = getComputedStyle(canvas).color || '#7ee0a8';
    const ok = drawPhoneClipWaveform(canvas, clip, startRatio, endRatio, cssWidth, height, color);
    setPainted((previous) => (previous === ok ? previous : ok));
  }, [clip, cssWidth, endRatio, hasData, height, startRatio, version]);

  if (!hasData) return null;
  return (
    <canvas
      ref={canvasRef}
      className={`phone-clip__waveform${painted ? '' : ' phone-clip__waveform--empty'}`}
      aria-hidden="true"
    />
  );
}
