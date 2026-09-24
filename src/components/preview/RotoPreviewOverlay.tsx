import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { useTimelineStore } from '../../stores/timeline';
import { useMediaStore } from '../../stores/mediaStore';
import { rotoPreview } from '../../services/roto/rotoPreview';
import { refineRotoEdges } from '../../services/roto/rotoEdges';
import { rotoPreviewProjection, sampleRotoMask } from '../../services/roto/rotoPreviewProjection';
import { surfaceSourceTime } from '../../services/planarTracking/surfaceEffects';
import { getLayerSourceSize } from './maskOverlay/maskOverlayProjectionPlans';
import './RotoPreviewOverlay.css';

export function RotoPreviewOverlay({ displayedCompId, width, height, resolution }: {
  displayedCompId: string | null; width: number; height: number; resolution: { width: number; height: number };
}) {
  const state = useSyncExternalStore(rotoPreview.subscribe, rotoPreview.snapshot);
  const timeline = useTimelineStore();
  const composition = useMediaStore(s => s.activeCompositionId);
  const canvas = useRef<HTMLCanvasElement>(null), pointer = useRef<{ id: number; x: number; y: number } | undefined>(undefined);
  const [cursor, setCursor] = useState({ x: .5, y: .5 }), [keyboard, setKeyboard] = useState(false);
  const clip = timeline.clips.find(c => c.id === state?.clipId);
  const layer = timeline.layers.find(l => l?.sourceClipId === clip?.id);
  const localTime = timeline.playheadPosition - (clip?.startTime ?? 0);
  const visible = !!state && state.compositionId === displayedCompId && composition === displayedCompId
    && !!clip && timeline.selectedClipIds.has(clip.id) && localTime >= 0 && localTime < clip.duration
    && !!layer?.visible && width > 0 && height > 0;
  const sourceTime = clip ? surfaceSourceTime(clip, localTime, timeline.getClipKeyframes(clip.id).filter(k => k.property === 'speed')) : 0;
  const mask = state ? sampleRotoMask(state.session.masks.values(), sourceTime) : undefined;
  const alpha = useMemo(() => mask && state ? refineRotoEdges(mask, state.edges) : undefined, [mask, state?.edges]);
  const mapping = clip && layer ? rotoPreviewProjection(timeline.getInterpolatedTransform(clip.id, localTime),
    getLayerSourceSize(layer, resolution), resolution, { width, height }, layer.sourceRect ?? clip.sourceRect) : undefined;
  const crop = mapping?.crop;
  useEffect(() => {
    const target = canvas.current; if (!target) return;
    const ctx = target.getContext('2d')!;
    target.width = mask?.width ?? 1; target.height = mask?.height ?? 1;
    if (!mask || !alpha || !crop) return;
    const image = ctx.createImageData(mask.width, mask.height);
    for (let i = 0; i < alpha.length; i++) {
      image.data[4 * i] = 50; image.data[4 * i + 1] = 150; image.data[4 * i + 2] = 255;
      image.data[4 * i + 3] = Math.round(alpha[i] * .45);
    }
    const source = document.createElement('canvas'); source.width = mask.width; source.height = mask.height;
    source.getContext('2d')!.putImageData(image, 0, 0);
    ctx.drawImage(source, crop.x * mask.width, crop.y * mask.height, crop.width * mask.width, crop.height * mask.height,
      0, 0, target.width, target.height);
  }, [alpha, mask, visible, crop?.x, crop?.y, crop?.width, crop?.height]);
  if (!visible || !state || !mapping || !clip) return null;
  const blocked = state.busy || timeline.isPlaying || timeline.isExporting || !!timeline.tracks.find(t => t.id === clip.trackId)?.locked;
  const current = state.session.current;
  const editingCurrent = current && current.time === state.pointTime && sourceTime >= current.time - .6e-6 && sourceTime < current.time + current.duration - .6e-6;
  const points = editingCurrent ? state.points : mask ? state.session.anchors.get(mask.time) ?? [] : [];
  const addPoint = (x: number, y: number, exclude: boolean) => {
    const p = mapping.toSource({ x, y }); if (p && !blocked) state.onPoint({ ...p, label: exclude ? 0 : state.label }, sourceTime);
  };
  return <div className="roto-main-preview" style={{ width, height }}>
    <canvas ref={canvas} className="roto-main-mask" style={{ transform: `matrix3d(${mapping.cssMatrix.join(',')})` }} />
    <svg className="roto-main-input" viewBox={`0 0 ${width} ${height}`} tabIndex={0} role="img"
      aria-label="Roto selection in Preview" aria-disabled={blocked} style={{ cursor: blocked ? 'progress' : 'crosshair' }}
      onBlur={() => setKeyboard(false)} onContextMenu={e => { e.preventDefault(); e.stopPropagation(); }}
      onPointerDown={e => {
        e.stopPropagation(); if (e.pointerType !== 'touch') e.preventDefault(); e.currentTarget.blur(); setKeyboard(false);
        pointer.current = { id: e.pointerId, x: e.clientX, y: e.clientY };
      }} onPointerCancel={() => { pointer.current = undefined; }} onPointerUp={e => {
        e.stopPropagation(); const start = pointer.current; pointer.current = undefined;
        if (!start || start.id !== e.pointerId || Math.hypot(e.clientX - start.x, e.clientY - start.y) > 5) return;
        const rect = e.currentTarget.getBoundingClientRect();
        addPoint((e.clientX - rect.left) / rect.width * width, (e.clientY - rect.top) / rect.height * height, e.button === 2 || e.ctrlKey || e.metaKey);
      }} onKeyDown={e => {
        e.stopPropagation(); const step = e.shiftKey ? .01 : .001;
        if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) {
          e.preventDefault(); setKeyboard(true); setCursor(p => ({
            x: Math.max(0, Math.min(1, p.x + (e.key === 'ArrowRight' ? step : e.key === 'ArrowLeft' ? -step : 0))),
            y: Math.max(0, Math.min(1, p.y + (e.key === 'ArrowDown' ? step : e.key === 'ArrowUp' ? -step : 0))),
          }));
        } else if (e.key === 'Enter') { e.preventDefault(); addPoint(cursor.x * width, cursor.y * height, e.ctrlKey || e.metaKey); }
      }}>
      {points.map((p, i) => {
        if (p.x < crop!.x || p.x > crop!.x + crop!.width || p.y < crop!.y || p.y > crop!.y + crop!.height) return null;
        const v = mapping.toDisplay(p); return <circle key={i} cx={v.x} cy={v.y} r={5} fill={p.label ? '#27ae60' : '#e74c3c'} stroke="white" strokeWidth={1.5} />;
      })}
      {keyboard && <path d={`M${cursor.x * width - 8},${cursor.y * height}h16 M${cursor.x * width},${cursor.y * height - 8}v16`} stroke="white" strokeWidth={2} />}
    </svg>
    <span className="roto-main-hint">{state.busy ? 'Roto · processing' : timeline.isPlaying ? 'Roto · pause to select' : 'Roto · click to select · right-click to exclude'}</span>
  </div>;
}
