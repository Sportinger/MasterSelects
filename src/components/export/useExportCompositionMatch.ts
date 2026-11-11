// Keeps an export that follows the composition on the active composition's format and
// reports what differs when it does not follow.

import { useCallback, useEffect, useMemo } from 'react';
import { Logger } from '../../services/logger';
import type { ExportSettings } from '../../stores/exportStore';
import {
  buildCompositionMatchPatch,
  describeCompositionMismatch,
  resolveCompositionMatch,
  type CompositionFormat,
  type CompositionMatch,
  type CompositionMatchSettings,
  type CompositionMismatchNotes,
} from './exportCompositionMatch';

const log = Logger.create('ExportPanel');

const NO_MISMATCH: CompositionMismatchNotes = { resolution: null, frameRate: null };

export interface UseExportCompositionMatchOptions {
  /** False while exporting source media in a batch, or without an active composition. */
  available: boolean;
  composition: CompositionFormat | undefined;
  compositions: readonly CompositionFormat[];
  settings: CompositionMatchSettings;
  applySettings: (patch: Partial<ExportSettings>) => void;
  setCompositionMatch: (next: Partial<CompositionMatch>) => void;
}

export interface ExportCompositionMatchState {
  match: CompositionMatch;
  mismatch: CompositionMismatchNotes;
  setMatchResolution: (enabled: boolean) => void;
  setMatchFrameRate: (enabled: boolean) => void;
  setMatchBoth: (enabled: boolean) => void;
}

export function useExportCompositionMatch({
  available,
  composition,
  compositions,
  settings,
  applySettings,
  setCompositionMatch,
}: UseExportCompositionMatchOptions): ExportCompositionMatchState {
  const {
    width, height, customWidth, customHeight, useCustomResolution,
    fps, customFps, useCustomFps,
    matchCompositionResolution, matchCompositionFrameRate,
  } = settings;
  const compositionWidth = composition?.width;
  const compositionHeight = composition?.height;
  const compositionFrameRate = composition?.frameRate;

  const { match, mismatch, patch } = useMemo(() => {
    const current: CompositionMatchSettings = {
      width, height, customWidth, customHeight, useCustomResolution,
      fps, customFps, useCustomFps,
      matchCompositionResolution, matchCompositionFrameRate,
    };
    const active = compositionWidth === undefined || compositionHeight === undefined || compositionFrameRate === undefined
      ? undefined
      : { width: compositionWidth, height: compositionHeight, frameRate: compositionFrameRate };
    const resolved = resolveCompositionMatch(current, active, compositions);
    if (!available || !active) return { match: resolved, mismatch: NO_MISMATCH, patch: null };
    return {
      match: resolved,
      mismatch: describeCompositionMismatch(current, resolved, active),
      patch: buildCompositionMatchPatch(current, resolved, active),
    };
  }, [
    available, compositions, compositionFrameRate, compositionHeight, compositionWidth,
    customFps, customHeight, customWidth, fps, height, matchCompositionFrameRate,
    matchCompositionResolution, useCustomFps, useCustomResolution, width,
  ]);

  useEffect(() => {
    if (!patch) return;
    // An automatic follow-up, not a user edit: a read-only project session rejects it, and that
    // must not take the panel down. The next change of the composition retries it.
    try { applySettings(patch); }
    catch (error) { log.warn('Export settings were not matched to the composition', error); }
  }, [applySettings, patch]);

  const setMatchResolution = useCallback((enabled: boolean) => {
    setCompositionMatch({ resolution: enabled });
  }, [setCompositionMatch]);
  const setMatchFrameRate = useCallback((enabled: boolean) => {
    setCompositionMatch({ frameRate: enabled });
  }, [setCompositionMatch]);
  const setMatchBoth = useCallback((enabled: boolean) => {
    setCompositionMatch({ resolution: enabled, frameRate: enabled });
  }, [setCompositionMatch]);

  return { match, mismatch, setMatchResolution, setMatchFrameRate, setMatchBoth };
}
