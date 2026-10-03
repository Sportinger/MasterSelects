import { useEffect, useRef, useState } from 'react';
import { useTimelineStore } from '../../../../../stores/timeline';
import { useMediaStore } from '../../../../../stores/mediaStore';
import type { BeatRuleSource } from '../../../../../types/compositionGraph';
import { listBeatRuleSourceOptions } from '../../../../../services/compositionRules/beatRuleSource';
import { InspectorSelect } from '../../../../inspector/InspectorSelect';
import { ResolveInspectorIconButton, ResolveInspectorRow } from '../../../properties/resolveInspector/ResolveInspectorPrimitives';

interface BeatSourceSelectProps {
  value: string;
  ariaLabel: string;
  disabled?: boolean;
  onChange: (value: string, source?: BeatRuleSource) => void | Promise<void>;
  onBusyChange: (busy: boolean) => void;
}

/** Analysis writes only analysis refs; callers explicitly create or update the rule afterwards. */
export function BeatSourceSelect({ value, ariaLabel, disabled, onChange, onBusyChange }: BeatSourceSelectProps) {
  const clips = useTimelineStore(state => state.clips);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const mounted = useRef(true);
  const inFlight = useRef(false);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      if (inFlight.current) onBusyChange(false);
    };
  }, [onBusyChange]);
  const options = listBeatRuleSourceOptions(clips);
  const selected = options.find(option => option.value === value);
  // Keep the draft visible while the store replaces it with a completed artifact option.
  const pendingClipId = value.endsWith(':unanalyzed') ? value.slice(0, -':unanalyzed'.length) : undefined;
  const clip = clips.find(candidate => candidate.id === (selected?.analysisClipId ?? pendingClipId));
  const job = clip?.audioAnalysisJob;
  const clipBusy = !!job || clip?.waveformGenerating === true;
  const displayedOptions = selected ? options : [...options, {
    value, label: clip ? `${clip.name} (analysis ready)` : 'Missing beat source',
  }];
  const analyze = async () => {
    if (!clip || clipBusy || inFlight.current) return;
    const clipId = clip.id;
    const compositionId = useMediaStore.getState().activeCompositionId;
    inFlight.current = true;
    setRunning(true);
    setError(null);
    onBusyChange(true);
    try {
      await useTimelineStore.getState().generateBeatOnsetForClip(clipId, {});
      if (!mounted.current || useMediaStore.getState().activeCompositionId !== compositionId) return;
      const freshOptions = listBeatRuleSourceOptions(useTimelineStore.getState().clips);
      const ready = freshOptions.find(option => option.source?.kind === 'clip-beat-grid' && option.source.clipId === clipId);
      // The store action logs/catches failures, so a resolved promise alone is not success.
      if (!ready?.source) throw new Error('Beat analysis did not produce a beat grid. The audio may be unavailable, the clip may have changed, or analysis was cancelled. Retry when the audio is ready.');
      await onChange(ready.value, ready.source);
    } catch (cause) {
      if (mounted.current) setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      inFlight.current = false;
      if (mounted.current) { setRunning(false); onBusyChange(false); }
    }
  };
  const select = async (next: string) => {
    setError(null);
    try { await onChange(next, options.find(option => option.value === next)?.source); }
    catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
  };
  return <>
    <ResolveInspectorRow label="Beat source" disabled={disabled || running}>
      <InspectorSelect ariaLabel={ariaLabel} value={value} options={displayedOptions}
        disabled={disabled || running} onChange={next => void select(next)} />
    </ResolveInspectorRow>
    {pendingClipId && <ResolveInspectorRow label="Beat analysis" disabled={disabled || running || clipBusy || !clip}>
      <ResolveInspectorIconButton ariaLabel="Analyze beats" className="beat-rule-action"
        disabled={disabled || running || clipBusy || !clip}
        onClick={() => void analyze()}>Analyze beats</ResolveInspectorIconButton>
    </ResolveInspectorRow>}
    {(running || clipBusy) && <p className="beat-rule-status" role="status" aria-live="polite">
      {job?.message ?? job?.label ?? 'Analyzing beats'}{clip ? ` · ${Math.round(job?.progress ?? clip.waveformProgress ?? 0)}%` : ''}
    </p>}
    {error && <p className="beat-rule-status beat-rule-error" role="alert">{error}</p>}
  </>;
}
