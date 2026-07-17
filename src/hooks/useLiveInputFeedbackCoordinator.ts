import { useEffect } from 'react';
import { liveInputRuntime } from '../services/mediaRuntime/liveInputRuntime';
import { collectUsedLiveInputIds } from '../services/liveInputTimeline';
import { useMediaStore } from '../stores/mediaStore';
import { useTimelineStore } from '../stores/timeline';

export function useLiveInputFeedbackCoordinator(): void {
  const files = useMediaStore((state) => state.files);
  const compositions = useMediaStore((state) => state.compositions);
  const clips = useTimelineStore((state) => state.clips);

  useEffect(() => {
    const inputs = files.flatMap((file) => file.liveInput?.kind === 'composition-feedback'
      ? [{ id: file.id, source: file.liveInput }]
      : []);
    let frame = 0;
    const sync = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => liveInputRuntime.syncCompositionFeedbackSources(inputs));
    };
    const observer = new MutationObserver(sync);
    observer.observe(document.body, {
      attributes: true,
      attributeFilter: ['data-live-feedback-composition-id'],
      childList: true,
      subtree: true,
    });
    sync();
    return () => {
      observer.disconnect();
      cancelAnimationFrame(frame);
    };
  }, [files]);

  useEffect(() => {
    const usedIds = new Set(collectUsedLiveInputIds(clips, compositions));
    liveInputRuntime.setReconnectRequiredIds(files.flatMap((file) => (
      file.liveInput &&
      file.liveInput.kind !== 'composition-feedback' &&
      usedIds.has(file.id) &&
      !liveInputRuntime.getVideoElement(file.id)
        ? [file.id]
        : []
    )));
  }, [clips, compositions, files]);
}
