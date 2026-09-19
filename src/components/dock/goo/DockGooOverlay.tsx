// Metaball ("goo") drag overlay: while a panel tab is dragged, a WebGL blob
// carries the tab and a second blob grows into the active drop zone — the
// neck between them is the drop affordance. Mounted only during a drag plus
// a short settle animation; costs nothing while idle.

import { useEffect, useRef, useState } from 'react';

import { useDockStore } from '../../../stores/dockStore';
import { findTabGroupById } from '../../../stores/dockStore/layoutTree';
import type { DockDragState, DropTarget } from '../../../types/dock';
import {
  GOO_FOLLOW_DAMPING,
  GOO_FOLLOW_STIFFNESS,
  GOO_MERGE_DAMPING,
  GOO_MERGE_STIFFNESS,
  GOO_SCALE_DAMPING,
  GOO_SCALE_STIFFNESS,
  GOO_SETTLE_DAMPING,
  GOO_SETTLE_STIFFNESS,
  GOO_ZONE_DAMPING,
  GOO_ZONE_STIFFNESS,
  createRectSpring,
  createSpring,
  stepRectSpring,
  stepSpring,
  type RectSpring,
  type Spring,
} from './gooSprings';
import { resolveDropTargetZone, type GooZone } from './gooZones';
import { claimGooStage, releaseGooStage } from './gooStage';
import {
  acquireGooRenderer,
  readGooTheme,
  type GooBlob,
  type GooRenderer,
  type GooTheme,
} from './gooRenderer';

const MERGE_RADIUS_PX = 46;
const LABEL_MARGIN_PX = 3;
const SETTLE_DROP_MS = 300;
const SETTLE_CANCEL_MS = 150;

type GooPhase = 'idle' | 'live' | 'settle';

interface GooLoopState {
  renderer: GooRenderer;
  theme: GooTheme;
  drag: RectSpring;
  scale: Spring;
  zone: RectSpring;
  zoneRadius: Spring;
  merge: Spring;
  zoneTargetKey: string;
  lastZone: GooZone | null;
  labelSize: { w: number; h: number };
  settle: { mode: 'drop' | 'cancel'; started: number; zone: GooZone | null } | null;
  raf: number;
  lastTime: number;
}

const dropTargetKey = (target: DropTarget | null): string => (
  target
    ? `${target.scope ?? 'pane'}|${target.groupId}|${target.position}|${target.tabInsertIndex ?? -1}`
    : ''
);

const clamp01 = (value: number): number => Math.max(0, Math.min(1, value));

export function DockGooOverlay() {
  const [phase, setPhase] = useState<GooPhase>('idle');
  const [labelTitle, setLabelTitle] = useState('');
  const labelRef = useRef<HTMLDivElement | null>(null);
  const stateRef = useRef<GooLoopState | null>(null);
  const phaseRef = useRef<GooPhase>('idle');

  useEffect(() => {
    const getPanelCount = (groupId: string): number | null => {
      const group = findTabGroupById(useDockStore.getState().layout.root, groupId);
      return group ? group.panels.length : null;
    };

    const finishOverlay = () => {
      const state = stateRef.current;
      if (state) {
        cancelAnimationFrame(state.raf);
        if (state.renderer.canvas.isConnected) {
          state.renderer.canvas.remove();
        }
      }
      stateRef.current = null;
      phaseRef.current = 'idle';
      setPhase('idle');
      releaseGooStage('dock');
    };

    const renderFrame = (state: GooLoopState, alpha: number) => {
      const dragBlob: GooBlob = {
        cx: state.drag.cx.value,
        cy: state.drag.cy.value,
        hw: Math.max(state.drag.hw.value * state.scale.value, 2),
        hh: Math.max(state.drag.hh.value * state.scale.value, 2),
        radius: Math.max(Math.min(state.drag.hw.value, state.drag.hh.value) * state.scale.value, 2),
      };
      const blobs = [dragBlob];
      if (state.zone.hw.value > 1.5 && state.zone.hh.value > 1.5) {
        blobs.push({
          cx: state.zone.cx.value,
          cy: state.zone.cy.value,
          hw: state.zone.hw.value,
          hh: state.zone.hh.value,
          radius: Math.max(
            Math.min(state.zoneRadius.value, state.zone.hw.value, state.zone.hh.value),
            1,
          ),
        });
      }
      state.renderer.render({
        blobs,
        mergeRadius: MERGE_RADIUS_PX,
        mergeTint: clamp01(state.merge.value),
        alpha,
        theme: state.theme,
      });

      const label = labelRef.current;
      if (label) {
        const x = state.drag.cx.value - state.labelSize.w / 2;
        const y = state.drag.cy.value - state.labelSize.h / 2;
        label.style.transform = `translate3d(${x}px, ${y}px, 0)`;
        label.style.opacity = String(alpha);
      }
    };

    const frame = (now: number) => {
      const state = stateRef.current;
      if (!state || phaseRef.current === 'idle') return;
      const dt = Math.min(Math.max((now - state.lastTime) / 1000, 0), 0.033);
      state.lastTime = now;

      if (phaseRef.current === 'live') {
        const dragState = useDockStore.getState().dragState;
        const halfW = state.labelSize.w / 2 + LABEL_MARGIN_PX;
        const halfH = state.labelSize.h / 2 + LABEL_MARGIN_PX;
        stepRectSpring(
          state.drag,
          {
            cx: dragState.currentPos.x - dragState.dragOffset.x + halfW,
            cy: dragState.currentPos.y - dragState.dragOffset.y + halfH,
            hw: halfW,
            hh: halfH,
          },
          GOO_FOLLOW_STIFFNESS,
          GOO_FOLLOW_DAMPING,
          dt,
        );
        stepSpring(state.scale, 1, GOO_SCALE_STIFFNESS, GOO_SCALE_DAMPING, dt);

        const key = dropTargetKey(dragState.dropTarget);
        if (key !== state.zoneTargetKey) {
          state.zoneTargetKey = key;
          state.lastZone = dragState.dropTarget
            ? resolveDropTargetZone(dragState.dropTarget, getPanelCount)
            : null;
          // Squash pulse as the goo latches onto (or lets go of) a zone.
          state.scale.velocity -= 1.3;
        }
        const zoneTarget = state.lastZone ?? {
          cx: state.drag.cx.value,
          cy: state.drag.cy.value,
          hw: 0,
          hh: 0,
          radius: 0,
        };
        stepRectSpring(state.zone, zoneTarget, GOO_ZONE_STIFFNESS, GOO_ZONE_DAMPING, dt);
        stepSpring(state.zoneRadius, zoneTarget.radius, GOO_ZONE_STIFFNESS, GOO_ZONE_DAMPING, dt);
        stepSpring(state.merge, state.lastZone ? 1 : 0, GOO_MERGE_STIFFNESS, GOO_MERGE_DAMPING, dt);

        renderFrame(state, 1);
      } else {
        const settle = state.settle;
        if (!settle) {
          finishOverlay();
          return;
        }
        const duration = settle.mode === 'drop' ? SETTLE_DROP_MS : SETTLE_CANCEL_MS;
        const t = Math.min((now - settle.started) / duration, 1);
        const alpha = (1 - t) ** 1.4;

        if (settle.mode === 'drop' && settle.zone) {
          // Pour the carried blob into the zone it was dropped on; the real
          // panel appears underneath via the dock layout transition.
          stepRectSpring(state.drag, settle.zone, GOO_SETTLE_STIFFNESS, GOO_SETTLE_DAMPING, dt);
          stepRectSpring(state.zone, settle.zone, GOO_SETTLE_STIFFNESS, GOO_SETTLE_DAMPING, dt);
          stepSpring(state.merge, 1, GOO_MERGE_STIFFNESS, GOO_MERGE_DAMPING, dt);
        }
        stepSpring(state.scale, 1, GOO_SCALE_STIFFNESS, GOO_SCALE_DAMPING, dt);

        renderFrame(state, alpha);

        if (t >= 1) {
          finishOverlay();
          return;
        }
      }

      state.raf = requestAnimationFrame(frame);
    };

    const beginLive = (dragState: DockDragState) => {
      const renderer = acquireGooRenderer();
      if (!renderer) return;
      // Panel drags own the shared canvas outright; the touch layer yields
      // until finishOverlay releases the stage.
      claimGooStage('dock');
      renderer.resize();
      if (!renderer.canvas.isConnected) {
        document.body.appendChild(renderer.canvas);
      }

      const previous = stateRef.current;
      if (previous) {
        cancelAnimationFrame(previous.raf);
      }

      const scale = createSpring(0.85);
      scale.velocity = 2.4;
      const startCx = dragState.currentPos.x;
      const startCy = dragState.currentPos.y;
      stateRef.current = {
        renderer,
        theme: readGooTheme(),
        drag: createRectSpring({ cx: startCx, cy: startCy, hw: 10, hh: 10 }),
        scale,
        zone: createRectSpring({ cx: startCx, cy: startCy, hw: 0, hh: 0 }),
        zoneRadius: createSpring(0),
        merge: createSpring(0),
        zoneTargetKey: '',
        lastZone: null,
        labelSize: { w: 80, h: 26 },
        settle: null,
        raf: 0,
        lastTime: performance.now(),
      };
      phaseRef.current = 'live';
      setPhase('live');
      setLabelTitle(dragState.draggedPanel?.title ?? '');
      stateRef.current.raf = requestAnimationFrame(frame);
    };

    const beginSettle = (next: DockDragState) => {
      const state = stateRef.current;
      if (!state || phaseRef.current !== 'live') return;
      // Pour into the zone only when the drop really docked; an Escape-cancel
      // over a zone must not pretend it did.
      const dropped = next.lastDropCommitted && state.lastZone !== null;
      state.settle = {
        mode: dropped ? 'drop' : 'cancel',
        started: performance.now(),
        zone: state.lastZone,
      };
      phaseRef.current = 'settle';
      setPhase('settle');
    };

    const unsubscribe = useDockStore.subscribe(
      (s) => s.dragState,
      (dragState, previous) => {
        if (dragState.isDragging && !previous.isDragging) {
          beginLive(dragState);
        } else if (!dragState.isDragging && previous.isDragging) {
          beginSettle(dragState);
        }
      },
    );

    const handleResize = () => {
      stateRef.current?.renderer.resize();
    };
    window.addEventListener('resize', handleResize);

    // The first drag of a session mounts this component mid-drag (support is
    // probed lazily), so the start transition may already be over.
    const initial = useDockStore.getState().dragState;
    if (initial.isDragging) {
      beginLive(initial);
    }

    return () => {
      unsubscribe();
      window.removeEventListener('resize', handleResize);
      finishOverlay();
    };
  }, []);

  useEffect(() => {
    if (phase === 'idle') return;
    const label = labelRef.current;
    const state = stateRef.current;
    if (label && state) {
      state.labelSize = { w: label.offsetWidth, h: label.offsetHeight };
    }
  }, [phase, labelTitle]);

  if (phase === 'idle') return null;

  return (
    <div ref={labelRef} className="dock-goo-label">
      {labelTitle}
    </div>
  );
}
