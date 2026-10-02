import { bindEditorGestureCallback, ensureEditorInputGesture } from '../../../../services/project/repository/transaction/editorGestureOwnership';
import { useEffect, useRef } from 'react';
import type { AudioEqBand } from '../../../../engine/audio/eq/AudioEqTypes';

export interface BandDragCommitQueue {
  /** Merge a drag patch and commit it on the next animation frame. */
  scheduleBandDragCommit: (bandId: string, patch: Partial<AudioEqBand>) => void;
  /** Commit any pending patch immediately (pointer down/up boundaries). */
  flushBandDragCommit: () => void;
}

/**
 * Coalesces band-drag parameter commits to at most one store update per
 * animation frame. Pointer moves arrive far above frame rate (high-poll-rate
 * mice report at 250-1000Hz) and every commit rebuilds the clip list and
 * invalidates the layer cache, so committing per pointer event janks the
 * whole panel during drags.
 */
export function useBandDragCommits(
  updateBand: (bandId: string, patch: Partial<AudioEqBand>) => void,
): BandDragCommitQueue {
  const pendingRef = useRef<{ bandId: string; patch: Partial<AudioEqBand> } | null>(null);
  const frameRef = useRef<number | null>(null);
  const commitRef = useRef<() => void>(() => {});
  const ownedCommitRef = useRef<() => void>(() => {});

  useEffect(() => {
    commitRef.current = () => {
      const pending = pendingRef.current;
      pendingRef.current = null;
      if (pending) updateBand(pending.bandId, pending.patch);
    };
  });

  useEffect(() => () => {
    pendingRef.current = null;
    if (
      frameRef.current !== null &&
      typeof window !== 'undefined' &&
      typeof window.cancelAnimationFrame === 'function'
    ) {
      window.cancelAnimationFrame(frameRef.current);
      frameRef.current = null;
    }
  }, []);

  const scheduleBandDragCommit = (bandId: string, patch: Partial<AudioEqBand>) => {
    ensureEditorInputGesture('Adjust equalizer band');
    ownedCommitRef.current = bindEditorGestureCallback(() => commitRef.current());
    const pending = pendingRef.current;
    pendingRef.current = pending && pending.bandId === bandId
      ? { bandId, patch: { ...pending.patch, ...patch } }
      : { bandId, patch };

    if (typeof window === 'undefined' || typeof window.requestAnimationFrame !== 'function') {
      ownedCommitRef.current();
      return;
    }
    if (frameRef.current !== null) return;
    frameRef.current = window.requestAnimationFrame(bindEditorGestureCallback(() => {
      frameRef.current = null;
      ownedCommitRef.current();
    }));
  };

  const flushBandDragCommit = () => {
    if (
      frameRef.current !== null &&
      typeof window !== 'undefined' &&
      typeof window.cancelAnimationFrame === 'function'
    ) {
      window.cancelAnimationFrame(frameRef.current);
      frameRef.current = null;
    }
    ownedCommitRef.current();
  };

  return { scheduleBandDragCommit, flushBandDragCommit };
}
