import { useEffect, useMemo, useState } from 'react';
import type { TimelineSpectrogramTileSet } from '../../../services/audio/timelineSpectrogramCache';
import {
  getCachedTimelineSpectrogramTileSet,
  loadTimelineSpectrogramTileSet,
} from '../../../services/audio/timelineSpectrogramCache';

export type TimelineSpectrogramTileSetLoadStatus = 'idle' | 'loading' | 'ready' | 'missing' | 'error';

export interface TimelineSpectrogramTileSetLoadState {
  refId: string | undefined;
  tileSet: TimelineSpectrogramTileSet | null;
  status: TimelineSpectrogramTileSetLoadStatus;
}

function createInitialState(refId: string | undefined): TimelineSpectrogramTileSetLoadState {
  const cached = getCachedTimelineSpectrogramTileSet(refId);
  if (cached) {
    return { refId, tileSet: cached, status: 'ready' };
  }

  return {
    refId,
    tileSet: null,
    status: refId ? 'loading' : 'idle',
  };
}

export function useTimelineSpectrogramTileSetState(
  refId: string | undefined,
): TimelineSpectrogramTileSetLoadState {
  const cached = getCachedTimelineSpectrogramTileSet(refId);
  const [loaded, setLoaded] = useState<TimelineSpectrogramTileSetLoadState>(() => createInitialState(refId));
  const fallback = useMemo(() => createInitialState(refId), [refId]);
  const cachedState = useMemo<TimelineSpectrogramTileSetLoadState | null>(() => {
    if (!cached) return null;
    return { refId, tileSet: cached, status: 'ready' };
  }, [cached, refId]);

  useEffect(() => {
    let cancelled = false;

    setLoaded(createInitialState(refId));

    if (!refId || cached) {
      return () => {
        cancelled = true;
      };
    }

    loadTimelineSpectrogramTileSet(refId)
      .then((tileSet) => {
        if (!cancelled) {
          setLoaded({ refId, tileSet, status: tileSet ? 'ready' : 'missing' });
        }
      })
      .catch(() => {
        if (!cancelled) {
          setLoaded({ refId, tileSet: null, status: 'error' });
        }
      });

    return () => {
      cancelled = true;
    };
  }, [cached, refId]);

  if (cachedState) {
    return cachedState;
  }

  return loaded.refId === refId ? loaded : fallback;
}

export function useTimelineSpectrogramTileSet(
  refId: string | undefined,
): TimelineSpectrogramTileSet | null {
  return useTimelineSpectrogramTileSetState(refId).tileSet;
}
