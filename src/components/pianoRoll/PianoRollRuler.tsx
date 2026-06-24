// Piano-roll Bars + Time ruler (issue #249, Phase 2).
//
// Two stacked lanes — Bars on top, Time below — geometrically locked to the
// piano roll's own horizontal time zoom (`pxPerSec`) and reading the SAME shared
// TempoMap as the main timeline, so bar numbers and timecodes are identical to
// the timeline at the same musical positions (the mapping lives in
// `pianoRollGrid.ts`). Pure presentation: it renders absolutely-positioned ticks
// at clip-local pixels. The horizontal scroll offset is applied by the parent as
// an imperative `translateX` on the wrapping track, so scrolling never
// re-renders this subtree (PianoRoll.tsx §6).
//
// Styled entirely INLINE, like the rest of PianoRoll. The popup is a detached
// window whose stylesheets are mirrored by PianoRollBoot only as
// `<link rel="stylesheet">` — but in Vite dev the app CSS is injected as
// `<style>` tags, so the timeline's `.ruler-lane`/`.time-marker` classes are NOT
// present in dev. Inline styles make the ruler self-contained and correct in dev,
// production, and on Mesa (all-DOM, no canvas).

import type { CSSProperties } from 'react';
import type { RulerTick } from '../timeline/utils/timelineGrid';

const RULER_LANE_H = 30;
// Two lanes plus the 1px separator drawn between them.
export const PIANO_ROLL_RULER_H = RULER_LANE_H * 2 + 1;

const LANE_SEPARATOR = '#2a2a2a';

// Mirror the main timeline ruler: the Time lane sits on the plain ruler bg
// (#1e1e1e), and the Bars lane gets the timeline's selected-lane treatment — a
// subtle accent-tinted background (--accent #2D8CEB at ~7% over #1e1e1e ≈ #1f262c)
// plus a 2px accent edge — so the two lanes read as distinctly colored, exactly
// like the timeline. Concrete values (not CSS vars) because the popup can't
// resolve the app's CSS variables in dev.
const BARS_BG = '#1f262c';
const BARS_ACCENT = '#2d8ceb';
const TIME_COLORS = { major: '#4a4a4a', minor: '#2c2c2c', label: '#b8b8b8' };
const BARS_COLORS = { major: '#54627a', minor: '#313d4d', label: '#d2dae3' };

const LABEL_BASE: CSSProperties = {
  position: 'absolute',
  top: 4,
  left: 4,
  fontSize: 10,
  whiteSpace: 'nowrap',
  userSelect: 'none',
  pointerEvents: 'none',
};

interface PianoRollRulerProps {
  /** Bars + Time ticks (absolute-time `.time`), from `buildPianoRollGrid`. */
  rulerTicks: { bars: RulerTick[]; time: RulerTick[] };
  /** Absolute timeline time of the clip window's left edge (grid pixel 0). */
  clipStartTime: number;
  /** Piano-roll horizontal zoom (pixels per second) — shared with the grid. */
  pxPerSec: number;
}

export function PianoRollRuler({ rulerTicks, clipStartTime, pxPerSec }: PianoRollRulerProps) {
  const toPixel = (time: number): number => (time - clipStartTime) * pxPerSec;

  const renderLane = (
    key: string,
    ticks: RulerTick[],
    colors: { major: string; minor: string; label: string },
    isSecond: boolean,
    bg?: string,
    accentEdge?: string,
  ) => (
    <div
      style={{
        position: 'relative',
        height: RULER_LANE_H,
        width: '100%',
        borderTop: isSecond ? `1px solid ${LANE_SEPARATOR}` : 'none',
        background: bg,
        boxShadow: accentEdge ? `inset 2px 0 0 ${accentEdge}` : undefined,
      }}
    >
      {ticks.map((tick, index) => {
        const major = tick.kind === 'major';
        return (
          <div
            key={`${key}-${index}-${tick.time.toFixed(4)}`}
            style={{
              position: 'absolute',
              left: toPixel(tick.time),
              top: major ? 0 : '50%',
              height: major ? '100%' : '50%',
              borderLeft: `1px solid ${major ? colors.major : colors.minor}`,
            }}
          >
            {tick.label !== null && <span style={{ ...LABEL_BASE, color: colors.label }}>{tick.label}</span>}
          </div>
        );
      })}
    </div>
  );

  // Time lane on top (plain bg); Bars lane below (accent-tinted, like the timeline).
  return (
    <>
      {renderLane('time', rulerTicks.time, TIME_COLORS, false)}
      {renderLane('bars', rulerTicks.bars, BARS_COLORS, true, BARS_BG, BARS_ACCENT)}
    </>
  );
}
