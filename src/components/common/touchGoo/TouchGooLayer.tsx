// Global touch feedback: every touch pointer grows a glassy metaball droplet
// in the shared goo canvas — swelling on touch-down, trailing the finger like
// a rubber band, merging into necks when fingers come close (pinch reads as
// surface tension). Renders nothing while idle; the dock drag goo overlay
// takes the stage over via gooStage for the duration of a panel drag.
//
// Opt-out for precision surfaces: any element inside
// `[data-touch-goo="off"]` spawns no blob.

import { useEffect, useRef, useState } from 'react';

import { useSettingsStore } from '../../../stores/settingsStore';
import {
  acquireGooRenderer,
  readGooTheme,
  type GooRenderer,
  type GooTheme,
} from '../../dock/goo/gooRenderer';
import { claimGooStage, getGooStageOwner, releaseGooStage } from '../../dock/goo/gooStage';
import { useGooSupport } from '../../dock/goo/useGooSupport';
import {
  createTouchBlobPool,
  stepTouchBlobPool,
  touchPoolAlive,
  touchPoolCancel,
  touchPoolDown,
  touchPoolMove,
  touchPoolUp,
} from './touchBlobPool';

const TOUCH_MERGE_RADIUS_PX = 40;
const TOUCH_FRAME_ALPHA = 0.85;
const TOUCH_SHADE_RADIUS_PX = 20;
const SUPPRESS_SELECTOR = '[data-touch-goo="off"]';

export function TouchGooLayer() {
  const enabled = useSettingsStore((s) => s.touchGooEnabled);
  const [touchSeen, setTouchSeen] = useState(false);
  const gooOk = useGooSupport(touchSeen && enabled);
  const poolRef = useRef(createTouchBlobPool());
  const gooOkRef = useRef(gooOk);
  gooOkRef.current = gooOk;

  useEffect(() => {
    if (!enabled || navigator.maxTouchPoints === 0) return;

    const pool = poolRef.current;
    let raf = 0;
    let running = false;
    let renderer: GooRenderer | null = null;
    let theme: GooTheme | null = null;
    let lastTime = 0;

    const stopRendering = () => {
      if (getGooStageOwner() === 'touch') {
        releaseGooStage('touch');
        if (renderer?.canvas.isConnected) {
          renderer.canvas.remove();
        }
      }
      theme = null;
    };

    const frame = (now: number) => {
      const dt = Math.min(Math.max((now - lastTime) / 1000, 0), 0.033);
      lastTime = now;
      const blobs = stepTouchBlobPool(pool, now, dt);

      if (gooOkRef.current) {
        if (!renderer) {
          renderer = acquireGooRenderer();
          renderer?.resize();
        }
        if (renderer && getGooStageOwner() === null) {
          claimGooStage('touch');
          renderer.resize();
        }
        if (renderer && getGooStageOwner() === 'touch') {
          if (!renderer.canvas.isConnected) {
            document.body.appendChild(renderer.canvas);
          }
          theme ??= readGooTheme();
          renderer.render({
            blobs,
            mergeRadius: TOUCH_MERGE_RADIUS_PX,
            mergeTint: 0,
            alpha: TOUCH_FRAME_ALPHA,
            theme,
            style: 'droplet',
            shadeRadius: TOUCH_SHADE_RADIUS_PX,
          });
        }
      }

      if (!touchPoolAlive(pool)) {
        running = false;
        stopRendering();
        return;
      }
      raf = requestAnimationFrame(frame);
    };

    const startLoop = () => {
      if (running) return;
      running = true;
      lastTime = performance.now();
      raf = requestAnimationFrame(frame);
    };

    const handleDown = (event: PointerEvent) => {
      if (event.pointerType !== 'touch') return;
      setTouchSeen(true);
      const target = event.target;
      if (target instanceof Element && target.closest(SUPPRESS_SELECTOR)) return;
      touchPoolDown(pool, event.pointerId, event.clientX, event.clientY, performance.now());
      startLoop();
    };
    const handleMove = (event: PointerEvent) => {
      if (event.pointerType !== 'touch') return;
      touchPoolMove(pool, event.pointerId, event.clientX, event.clientY);
    };
    const handleUp = (event: PointerEvent) => {
      if (event.pointerType !== 'touch') return;
      touchPoolUp(pool, event.pointerId, performance.now());
    };
    const handleCancel = (event: PointerEvent) => {
      if (event.pointerType !== 'touch') return;
      touchPoolCancel(pool, event.pointerId, performance.now());
    };

    const options = { capture: true, passive: true } as const;
    window.addEventListener('pointerdown', handleDown, options);
    window.addEventListener('pointermove', handleMove, options);
    window.addEventListener('pointerup', handleUp, options);
    window.addEventListener('pointercancel', handleCancel, options);

    // Support flipping mid-touch (lazy WebGL probe on the first touch ever)
    // re-runs this effect; pick the loop back up for fingers still down.
    if (touchPoolAlive(pool)) startLoop();

    return () => {
      window.removeEventListener('pointerdown', handleDown, options);
      window.removeEventListener('pointermove', handleMove, options);
      window.removeEventListener('pointerup', handleUp, options);
      window.removeEventListener('pointercancel', handleCancel, options);
      cancelAnimationFrame(raf);
      running = false;
      stopRendering();
    };
  }, [enabled, gooOk]);

  return null;
}
