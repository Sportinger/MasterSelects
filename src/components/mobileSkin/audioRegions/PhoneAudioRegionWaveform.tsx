// The waveform strip of the Sound range sheet: the whole clip, the selected range on top and two
// edge handles. Select mode: drag across the sound to pick a range. Move mode: drag the range along
// the clip (the clip itself never moves). The edge handles resize in both modes. A tap without a
// drag changes nothing, so scrolling the sheet cannot replace a range by accident.

import { useEffect, useRef, useState, type PointerEvent } from 'react';

import type { TimelineAudioRegionSelection } from '../../../stores/timeline/types';
import type { TimelineClip } from '../../../types/timeline';
import { drawPhoneClipWaveform, phoneClipHasWaveformData } from '../timeline/usePhoneClipVisuals';
import {
  phoneRegionFromTimes, phoneRegionMoved, phoneRegionPercent, phoneRegionResized, phoneRegionTimeAt,
} from './phoneAudioRegionModel';
import { PHONE_AUDIO_REGION_TEST_IDS as IDS } from './phoneAudioRegionTestIds';

export type PhoneRegionMode = 'select' | 'move';

const DRAG_THRESHOLD_PX = 6;
const STRIP_HEIGHT = 96;

type Drag =
  | { kind: 'select'; pointerId: number; startX: number; anchorTime: number; active: boolean }
  | { kind: 'move'; pointerId: number; startX: number; initial: TimelineAudioRegionSelection; active: boolean }
  | { kind: 'edge'; pointerId: number; edge: 'left' | 'right'; initial: TimelineAudioRegionSelection };

interface Props {
  clip: TimelineClip;
  selection: TimelineAudioRegionSelection | null;
  mode: PhoneRegionMode;
  disabled: boolean;
  onDisabledTap: () => void;
  onChange: (selection: TimelineAudioRegionSelection) => void;
}

export function PhoneAudioRegionWaveform({ clip, selection, mode, disabled, onDisabledTap, onChange }: Props) {
  const stripRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const dragRef = useRef<Drag | null>(null);
  const [painted, setPainted] = useState(false);
  const [width, setWidth] = useState(0);

  useEffect(() => {
    const strip = stripRef.current;
    if (!strip) return undefined;
    const measure = () => setWidth(strip.clientWidth);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(strip);
    return () => observer.disconnect();
  }, []);

  // Repaint when the clip, its edit stack (the editor redraws processed waveforms) or the width change.
  const editCount = clip.audioState?.editStack?.length ?? 0;
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || width <= 0) return;
    if (!phoneClipHasWaveformData(clip)) { setPainted(false); return; }
    const color = getComputedStyle(canvas).getPropertyValue('--phone-accent').trim() || '#5b8def';
    setPainted(drawPhoneClipWaveform(canvas, clip, 0, 1, width, STRIP_HEIGHT, color));
  }, [clip, width, editCount]);

  const xOf = (event: PointerEvent<HTMLElement>) => {
    const rect = stripRef.current?.getBoundingClientRect();
    return { x: event.clientX - (rect?.left ?? 0), width: rect?.width ?? 1 };
  };

  const onStripDown = (event: PointerEvent<HTMLDivElement>) => {
    if (disabled) { onDisabledTap(); return; }
    const { x, width: stripWidth } = xOf(event);
    event.currentTarget.setPointerCapture(event.pointerId);
    if (mode === 'move' && selection) {
      dragRef.current = { kind: 'move', pointerId: event.pointerId, startX: event.clientX, initial: selection, active: false };
    } else {
      dragRef.current = { kind: 'select', pointerId: event.pointerId, startX: event.clientX, anchorTime: phoneRegionTimeAt(clip, x, stripWidth), active: false };
    }
  };

  const onEdgeDown = (edge: 'left' | 'right') => (event: PointerEvent<HTMLSpanElement>) => {
    event.stopPropagation();
    if (disabled) { onDisabledTap(); return; }
    if (!selection) return;
    stripRef.current?.setPointerCapture(event.pointerId);
    dragRef.current = { kind: 'edge', pointerId: event.pointerId, edge, initial: selection };
  };

  const onMove = (event: PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const { x, width: stripWidth } = xOf(event);
    if (drag.kind === 'edge') {
      onChange(phoneRegionResized(clip, drag.initial, drag.edge, phoneRegionTimeAt(clip, x, stripWidth)));
      return;
    }
    if (!drag.active && Math.abs(event.clientX - drag.startX) < DRAG_THRESHOLD_PX) return;
    drag.active = true;
    if (drag.kind === 'select') {
      onChange(phoneRegionFromTimes(clip, drag.anchorTime, phoneRegionTimeAt(clip, x, stripWidth)));
    } else {
      const delta = ((event.clientX - drag.startX) / Math.max(1, stripWidth)) * Math.max(0.001, clip.duration);
      onChange(phoneRegionMoved(clip, drag.initial, delta));
    }
  };

  const onUp = (event: PointerEvent<HTMLDivElement>) => {
    if (dragRef.current?.pointerId === event.pointerId) dragRef.current = null;
  };

  const box = selection ? phoneRegionPercent(clip, selection) : null;

  return (
    <div
      ref={stripRef}
      className="phone-region-wave"
      data-testid={IDS.waveform}
      data-mode={mode}
      data-painted={painted || undefined}
      aria-disabled={disabled || undefined}
      role="group"
      aria-label={mode === 'select' ? 'Drag across the sound to select a range' : 'Drag the range along the clip'}
      onPointerDown={onStripDown}
      onPointerMove={onMove}
      onPointerUp={onUp}
      onPointerCancel={onUp}
    >
      <canvas ref={canvasRef} className="phone-region-wave__canvas" aria-hidden="true" />
      {!painted ? <span className="phone-region-wave__empty">The waveform is still being read. Selecting works already.</span> : null}
      {box ? (
        <div className="phone-region-wave__range" data-testid={IDS.range} style={{ left: `${box.left}%`, width: `${box.width}%` }}>
          <span className="phone-region-wave__handle phone-region-wave__handle--start" data-testid={IDS.handleStart} onPointerDown={onEdgeDown('left')} />
          <span className="phone-region-wave__handle phone-region-wave__handle--end" data-testid={IDS.handleEnd} onPointerDown={onEdgeDown('right')} />
        </div>
      ) : null}
    </div>
  );
}
