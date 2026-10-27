// Watches the boot phases that are not owned by the project boot itself: GPU ready/failed, the
// timeline becoming visible and the first rendered preview frame. Marks go to phoneBootTimeline.
// It only observes; nothing here waits for the GPU or delays the project.

import { useEffect } from 'react';
import { renderHostPort } from '../../../services/render/renderHostPort';
import { useEngineStore } from '../../../stores/engineStore';
import { PHONE_TEST_IDS } from '../contracts';
import { markPhoneBootPhase } from './phoneBootTimeline';

/** Stop looking for a first preview frame after this long (an empty project may never draw one). */
const FIRST_FRAME_WATCH_MS = 120_000;

export function usePhoneBootTimings(bootPending: boolean, projectOpen: boolean): void {
  const engineReady = useEngineStore((state) => state.isEngineReady);
  const engineFailed = useEngineStore((state) => state.engineInitFailed);
  const engineError = useEngineStore((state) => state.engineInitError);

  useEffect(() => {
    if (engineReady) markPhoneBootPhase('gpu-ready');
    else if (engineFailed) markPhoneBootPhase('gpu-failed', engineError ?? undefined);
  }, [engineReady, engineFailed, engineError]);

  // Timeline visible: the phone timeline element is in the document after the boot resolved.
  useEffect(() => {
    if (bootPending || !projectOpen || typeof document === 'undefined') return undefined;
    const selector = `[data-testid="${PHONE_TEST_IDS.timeline}"]`;
    if (document.querySelector(selector)) {
      markPhoneBootPhase('timeline-visible');
      return undefined;
    }
    const observer = new MutationObserver(() => {
      if (!document.querySelector(selector)) return;
      markPhoneBootPhase('timeline-visible');
      observer.disconnect();
    });
    observer.observe(document.body, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, [bootPending, projectOpen]);

  // First preview frame: the render host holds a rendered texture.
  useEffect(() => {
    if (!engineReady || typeof requestAnimationFrame !== 'function') return undefined;
    const startedAt = performance.now();
    let handle = 0;
    const check = () => {
      let rendered = false;
      try {
        rendered = renderHostPort.getLastRenderedTexture() !== null;
      } catch {
        rendered = false;
      }
      if (rendered) {
        markPhoneBootPhase('first-preview-frame');
        return;
      }
      if (performance.now() - startedAt > FIRST_FRAME_WATCH_MS) return;
      handle = requestAnimationFrame(check);
    };
    handle = requestAnimationFrame(check);
    return () => cancelAnimationFrame(handle);
  }, [engineReady]);
}
