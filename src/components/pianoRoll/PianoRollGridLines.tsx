// Tempo-synced vertical gridlines for the piano roll (issue #249, Phase 3).
//
// Replaces the old clip-local 1-second lines with bar / beat / sub lines from
// `buildPianoRollGrid`, positioned at the SAME clip-local pixel
// `(absoluteTime - clipStartTime) * pxPerSec` the ruler uses — so every line sits
// exactly under its ruler tick at any zoom (the old lines were on whole clip
// seconds and drifted from the absolute-time ruler whenever the clip didn't start
// on a whole second).
//
// Full-width DOM lines (plan §7 option a): they live inside the scrolling grid
// content, so they scroll for free with no per-frame work, and the count is modest
// even for long clips (one div per beat). Pure `<div>`s — no canvas — so there is
// no Mesa tile-seam risk. `memo` + stable (memoized) line arrays keep this off the
// re-render path when notes change.
//
// Styled inline (the popup can't rely on app CSS classes; see PianoRollRuler).

import { memo } from 'react';
import type { GridLine } from './pianoRollGrid';

// Bar lines pick up the bars-lane accent tint; beats medium; subs faint.
const BAR_LINE = 'rgba(45, 140, 235, 0.34)';
const BEAT_LINE = 'rgba(255, 255, 255, 0.08)';
const SUB_LINE = 'rgba(255, 255, 255, 0.035)';

interface PianoRollGridLinesProps {
  barLines: GridLine[];
  beatLines: GridLine[];
  subLines: GridLine[];
  height: number;
}

function PianoRollGridLinesImpl({ barLines, beatLines, subLines, height }: PianoRollGridLinesProps) {
  const line = (key: string, pixelX: number, color: string) => (
    <div
      key={key}
      style={{ position: 'absolute', top: 0, left: pixelX, width: 1, height, background: color }}
    />
  );
  // Faint → strong paint order so bar lines sit visually on top of beats/subs.
  return (
    <>
      {subLines.map((l) => line(`sub-${l.time.toFixed(4)}`, l.pixelX, SUB_LINE))}
      {beatLines.map((l) => line(`beat-${l.time.toFixed(4)}`, l.pixelX, BEAT_LINE))}
      {barLines.map((l) => line(`bar-${l.time.toFixed(4)}`, l.pixelX, BAR_LINE))}
    </>
  );
}

export const PianoRollGridLines = memo(PianoRollGridLinesImpl);
