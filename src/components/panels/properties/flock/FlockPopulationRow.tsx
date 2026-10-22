import { useRef, useState, type ReactNode } from 'react';
import { LabeledValue } from '../LabeledValue';
import { HandleOnlyRange } from '../transformTab/HandleOnlyRange';
import { ResolveInspectorIconButton, ResolveInspectorRow, ResolveResetIcon } from '../resolveInspector/ResolveInspectorPrimitives';
import { FLOCK_POPULATION_HINT, FLOCK_POPULATION_SLIDER, populationFromSlider } from './flockControlUtils';

const log = Math.log10;

/**
 * Population: the complete inspector row (slider, number field, reset) on a logarithmic slider, so
 * 500, 4000 and 20 000 points all sit in reach. A count rebuilds the swarm, so a drag commits once,
 * on release, not every step.
 */
export function FlockPopulationRow({ label, value, defaultValue, min, max, onCommit, actions }: {
  label: string; value: number; defaultValue: number; min: number; max: number;
  onCommit: (value: number) => void; actions?: ReactNode;
}) {
  const [draft, setDraft] = useState<number | null>(null);
  const pending = useRef<number | null>(null), dragging = useRef(false);
  const clamp = (next: number) => Math.round(Math.min(max, Math.max(min, next)));
  const shown = draft ?? value;
  const sliderMin = log(Math.min(FLOCK_POPULATION_SLIDER.min, Math.max(1, shown))), sliderMax = log(Math.max(FLOCK_POPULATION_SLIDER.max, shown));
  const hold = (next: number) => { pending.current = clamp(next); setDraft(pending.current); };
  const release = () => {
    const next = pending.current;
    pending.current = null; setDraft(null);
    if (next !== null && next !== value) onCommit(next);
  };
  return <ResolveInspectorRow label={label} title={FLOCK_POPULATION_HINT} className={actions ? 'resolve-inspector-row--extra-action' : undefined} actions={<>
    {actions}
    <ResolveInspectorIconButton ariaLabel={`Reset ${label}`} className="resolve-inspector-reset-button"
      onClick={() => { if (value !== defaultValue) onCommit(defaultValue); }}><ResolveResetIcon /></ResolveInspectorIconButton>
  </>}>
    <div className="resolve-inspector-slider-value">
      <HandleOnlyRange aria-label={`${label} slider`} value={log(Math.max(1, shown))} min={sliderMin} max={sliderMax} step={0.02}
        onChange={position => { const next = populationFromSlider(position); if (dragging.current) hold(next); else if (clamp(next) !== value) onCommit(clamp(next)); }} onDragStart={() => { dragging.current = true; }}
        onDragEnd={() => { dragging.current = false; release(); }} />
      <LabeledValue label="" ariaLabel={label} className="resolve-inspector-field resolve-inspector-field--plain"
        value={shown} defaultValue={defaultValue} min={min} max={max} decimals={0} sensitivity={Math.max(1, shown / 200)}
        touchDragAxis="horizontal"
        onDragStart={() => { dragging.current = true; }}
        onDragEnd={() => { dragging.current = false; release(); }}
        onChange={next => { if (!Number.isFinite(next)) return; if (dragging.current) hold(next); else onCommit(clamp(next)); }} />
    </div>
  </ResolveInspectorRow>;
}
