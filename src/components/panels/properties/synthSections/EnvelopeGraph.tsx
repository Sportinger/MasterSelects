// Classic ADSR envelope shape (#298 UI polish).
//
// Layout matches how ADSR actually reads:
//   - Attack is anchored to the LEFT; its width is attack time.
//   - Decay follows the attack peak; its width is decay time.
//   - Release is anchored to the RIGHT — its END sits on the graph's right edge —
//     and its width is release time (so a longer release starts further left).
//   - The Sustain plateau is the flexible middle filler at the sustain LEVEL.
// Attack/decay/release each map their REAL value into their own fixed-width slot
// (w/3 each, via the knob power taper), so they are INDEPENDENT: changing decay
// never moves the attack curve. Each slot maxes at a third of the width, so the
// left (attack+decay) and right (release) blocks can never overlap.
//
// With `onChange` the handles are DRAGGABLE with ABSOLUTE cursor tracking, and
// edits flow through the same `onChange` as the knobs — graph, knobs, and audio
// stay in sync.

import { positionToValue, valueToPosition } from '../../../common/sliderScale';

interface EnvelopeGraphChange {
  attack?: number;
  decay?: number;
  sustain?: number;
  release?: number;
}

interface EnvelopeGraphProps {
  attack: number;
  decay: number;
  sustain: number;
  release: number;
  /** Upper bound (seconds) for the A/D/R time axis (matches the knobs). */
  timeMax?: number;
  /** When present, the handles are draggable and emit value patches. */
  onChange?: (patch: EnvelopeGraphChange) => void;
}

const VB_W = 100;
const VB_H = 44;
const PAD = 3;
// Graph-only time taper. Deliberately fuller (γ=3) than the knobs' γ=2 so short
// A/D/R times still render with visible width and typical envelopes fill their
// slots — the graph is self-consistent for dragging regardless of the knob taper.
const TIME_GAMMA = 3;

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

export function EnvelopeGraph({ attack, decay, sustain, release, timeMax = 4, onChange }: EnvelopeGraphProps) {
  const w = VB_W - PAD * 2;
  const h = VB_H - PAD * 2;
  const s = clamp01(sustain);
  const x0 = PAD;
  const rightEdge = VB_W - PAD;
  const segMaxW = w / 3; // each of A/D/R fills up to a third; blocks never overlap

  // Real value → slot width via the knob taper (independent per segment).
  const widthOf = (t: number) => valueToPosition(Math.max(0, t), 0, timeMax, 'power', TIME_GAMMA) * segMaxW;
  const aW = widthOf(attack);
  const dW = widthOf(decay);
  const rW = widthOf(release);

  const yFor = (level: number) => PAD + (1 - level) * h;
  const p0 = [x0, yFor(0)];                       // attack start (left, bottom)
  const p1 = [x0 + aW, yFor(1)];                  // attack peak
  const p2 = [x0 + aW + dW, yFor(s)];             // decay end / sustain corner
  const p3 = [rightEdge - rW, yFor(s)];           // release start / plateau end
  const p4 = [rightEdge, yFor(0)];                // release end (RIGHT edge, bottom)
  const pts = [p0, p1, p2, p3, p4];

  const line = pts.map(([x, y]) => `${x.toFixed(2)},${y.toFixed(2)}`).join(' ');
  const area = `M ${p0[0]},${yFor(0)} L ${pts.map(([x, y]) => `${x.toFixed(2)},${y.toFixed(2)}`).join(' L ')} L ${p4[0]},${yFor(0)} Z`;

  // Absolute drag: map the cursor into viewBox space, then into the dragged
  // handle's slot. Prior segments are frozen during the gesture, so it tracks.
  const startDrag = (e: React.PointerEvent, idx: number) => {
    if (!onChange) return;
    e.preventDefault();
    e.stopPropagation();
    const el = e.currentTarget as SVGCircleElement;
    const svg = el.ownerSVGElement;
    if (!svg) return;
    const rect = svg.getBoundingClientRect();
    el.setPointerCapture?.(e.pointerId);
    const decayStartX = x0 + widthOf(attack); // frozen; attack unchanged during a decay drag
    const toTime = (pos: number) => positionToValue(clamp01(pos), 0, timeMax, 'power', TIME_GAMMA);
    const move = (ev: PointerEvent) => {
      const vbX = ((ev.clientX - rect.left) / rect.width) * VB_W;
      const vbY = ((ev.clientY - rect.top) / rect.height) * VB_H;
      const sustainVal = clamp01(1 - (vbY - PAD) / h);
      const patch: EnvelopeGraphChange = {};
      if (idx === 1) patch.attack = toTime((vbX - x0) / segMaxW);
      else if (idx === 2) { patch.decay = toTime((vbX - decayStartX) / segMaxW); patch.sustain = sustainVal; }
      else if (idx === 3) { patch.release = toTime((rightEdge - vbX) / segMaxW); patch.sustain = sustainVal; }
      onChange(patch);
    };
    const up = (ev: PointerEvent) => {
      el.releasePointerCapture?.(ev.pointerId);
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
      el.removeEventListener('pointercancel', up);
    };
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
  };

  return (
    <svg className="envelope-graph" viewBox={`0 0 ${VB_W} ${VB_H}`} preserveAspectRatio="none" aria-hidden="true">
      <line className="envelope-graph-base" x1={PAD} y1={yFor(0)} x2={VB_W - PAD} y2={yFor(0)} />
      <line className="envelope-graph-guide" x1={PAD} y1={yFor(s)} x2={VB_W - PAD} y2={yFor(s)} />
      <path className="envelope-graph-fill" d={area} />
      <polyline className="envelope-graph-line" points={line} />
      {pts.map(([x, y], i) => {
        const editable = !!onChange && i >= 1 && i <= 3; // start + release-end are fixed
        return (
          <g key={i}>
            {editable && (
              <circle
                className="envelope-graph-hit"
                cx={x} cy={y} r={5}
                onPointerDown={(e) => startDrag(e, i)}
              />
            )}
            <circle className={`envelope-graph-dot${editable ? ' editable' : ''}`} cx={x} cy={y} r={1.6} />
          </g>
        );
      })}
    </svg>
  );
}
