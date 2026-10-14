/** Poster-style lettering: every word fills its row, with more height for short words. */
export function AudioEffectTileLabel({ name }: { name: string }) {
  const words = name.toUpperCase().trim().split(/\s+/).filter(Boolean);
  const weights = words.map(word => 1 / Math.sqrt(word.length));
  const totalWeight = weights.reduce((sum, weight) => sum + weight, 0);
  const gap = 2;
  const availableHeight = 52 - gap * (words.length - 1);
  let top = 1;
  const rows = [];
  for (const [index, word] of words.entries()) {
    const height = availableHeight * weights[index] / totalWeight;
    rows.push({ word, height, baseline: top + height });
    top += height + gap;
  }

  return (
    <svg className="audio-effect-tile-label" viewBox="0 0 120 56"
      preserveAspectRatio="none" aria-hidden="true" focusable="false">
      {rows.map(({ word, height, baseline }, index) => {
        return <text key={index} x="1" y={baseline} fontSize={height / 0.73}
          textLength="118" lengthAdjust="spacingAndGlyphs">{word}</text>;
      })}
    </svg>
  );
}
