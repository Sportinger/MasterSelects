import { useEffect, useState } from 'react';
import type { TimelineWaveformPyramid } from '../utils/waveformLod';
import {
  getCachedTimelineWaveformPyramid,
  loadTimelineWaveformPyramid,
} from '../../../services/audio/timelineWaveformPyramidCache';

export function useTimelineWaveformPyramid(
  refId: string | undefined,
): TimelineWaveformPyramid | null {
  const cached = getCachedTimelineWaveformPyramid(refId);
  const [loaded, setLoaded] = useState<{
    refId: string | undefined;
    pyramid: TimelineWaveformPyramid | null;
  }>(() => ({ refId, pyramid: cached }));

  useEffect(() => {
    let cancelled = false;

    if (!refId || cached) {
      return () => {
        cancelled = true;
      };
    }

    loadTimelineWaveformPyramid(refId)
      .then((loaded) => {
        if (!cancelled) {
          setLoaded({ refId, pyramid: loaded });
        }
      })
      .catch(() => {
        if (!cancelled) {
          setLoaded({ refId, pyramid: null });
        }
      });

    return () => {
      cancelled = true;
    };
  }, [cached, refId]);

  return cached ?? (loaded.refId === refId ? loaded.pyramid : null);
}
