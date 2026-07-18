// Classic ADSR envelope shape (#298 UI polish). A schematic of the amp/filter
// envelope that redraws as the sliders move, so the shape is visible while
// editing. Attack/decay/release are seconds; sustain is a LEVEL (0..1), not a
// time, so it draws as a fixed-width plateau. A/D/R widths are proportional to
// their seconds (sharing the non-plateau width) so relative durations read at a
// glance. Straight segments — the conventional ADSR look, not a scope trace.
//
// Pure and framework-neutral: it re-renders from props on edit (no bus needed,
// edits aren't 60fps). Reusable for any ADSR envelope.

interface EnvelopeGraphProps {
  attack: number;
  decay: number;
  sustain: number;
  release: number;
  /** Fraction of width given to the sustain plateau (default 0.28). */
  sustainFrac?: number;
}

const VB_W = 100;
const VB_H = 44;
const PAD = 3;

export function EnvelopeGraph({ attack, decay, sustain, release, sustainFrac = 0.28 }: EnvelopeGraphProps) {
  const w = VB_W - PAD * 2;
  const h = VB_H - PAD * 2;
  const s = Math.max(0, Math.min(1, sustain));

  const a = Math.max(0, attack);
  const d = Math.max(0, decay);
  const r = Math.max(0, release);
  const sum = a + d + r;
  const timeW = w * (1 - sustainFrac);
  // Split the time width by proportion; if all times are 0 the ramps collapse to
  // vertical steps and only the sustain plateau shows.
  const aW = sum > 0 ? (a / sum) * timeW : 0;
  const dW = sum > 0 ? (d / sum) * timeW : 0;
  const rW = sum > 0 ? (r / sum) * timeW : 0;
  const sW = w - aW - dW - rW; // whatever's left is the plateau

  const yFor = (level: number) => PAD + (1 - level) * h;
  const x0 = PAD;
  const p0 = [x0, yFor(0)];
  const p1 = [x0 + aW, yFor(1)];
  const p2 = [x0 + aW + dW, yFor(s)];
  const p3 = [x0 + aW + dW + sW, yFor(s)];
  const p4 = [x0 + aW + dW + sW + rW, yFor(0)];
  const pts = [p0, p1, p2, p3, p4];

  const line = pts.map(([x, y]) => `${x.toFixed(2)},${y.toFixed(2)}`).join(' ');
  const area = `M ${p0[0]},${yFor(0)} L ${pts.map(([x, y]) => `${x.toFixed(2)},${y.toFixed(2)}`).join(' L ')} L ${p4[0]},${yFor(0)} Z`;

  return (
    <svg className="envelope-graph" viewBox={`0 0 ${VB_W} ${VB_H}`} preserveAspectRatio="none" aria-hidden="true">
      {/* baseline */}
      <line className="envelope-graph-base" x1={PAD} y1={yFor(0)} x2={VB_W - PAD} y2={yFor(0)} />
      {/* sustain-level guide */}
      <line className="envelope-graph-guide" x1={PAD} y1={yFor(s)} x2={VB_W - PAD} y2={yFor(s)} />
      <path className="envelope-graph-fill" d={area} />
      <polyline className="envelope-graph-line" points={line} />
      {pts.map(([x, y], i) => (
        <circle key={i} className="envelope-graph-dot" cx={x} cy={y} r={1.4} />
      ))}
    </svg>
  );
}
