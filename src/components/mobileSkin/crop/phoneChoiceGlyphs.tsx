// Small pictograms for choice tiles (own geometry, stroke = currentColor): an aspect-ratio frame,
// a mask shape outline and a motion hint for animation presets. They show what a choice does, so the
// tiles never fall back to text-only buttons.

import type { ReactElement } from 'react';

const SVG = { viewBox: '0 0 40 28', fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round', strokeLinejoin: 'round' } as const;

/** A frame of the given aspect ratio (width / height), fitted into the tile; null = free. */
export function PhoneRatioGlyph({ ratio }: { ratio: number | null }) {
  if (ratio === null) {
    return (
      <svg {...SVG} aria-hidden="true">
        <path d="M8 9V5h4M28 5h4v4M32 19v4h-4M12 23H8v-4" />
      </svg>
    );
  }
  const maxW = 30, maxH = 22;
  const w = ratio >= maxW / maxH ? maxW : maxH * ratio;
  const h = ratio >= maxW / maxH ? maxW / ratio : maxH;
  return (
    <svg {...SVG} aria-hidden="true">
      <rect x={(40 - w) / 2} y={(28 - h) / 2} width={w} height={h} rx="2" />
    </svg>
  );
}

const SHAPES: Record<string, ReactElement> = {
  none: <path d="M14 14h12" />,
  linear: (<><rect x="6" y="4" width="28" height="20" rx="2" strokeOpacity="0.45" /><path d="M6 14h28" /><path d="M6 14h28v10H6z" fill="currentColor" fillOpacity="0.35" stroke="none" /></>),
  mirror: (<><rect x="6" y="4" width="28" height="20" rx="2" strokeOpacity="0.45" /><path d="M6 10h28M6 18h28" /></>),
  circle: <ellipse cx="20" cy="14" rx="10" ry="9" />,
  rectangle: <rect x="9" y="6" width="22" height="16" rx="1.5" />,
  star: <path d="M20 4l2.9 6.2 6.6.7-5 4.5 1.5 6.6L20 18.6 14 22l1.5-6.6-5-4.5 6.6-.7z" />,
  heart: <path d="M20 23s-9-5.4-9-11.3A4.8 4.8 0 0 1 20 9a4.8 4.8 0 0 1 9 2.7C29 17.6 20 23 20 23z" />,
  pen: (<><path d="M9 21c6-1 6-11 12-12s7 6 10 5" /><circle cx="9" cy="21" r="1.6" /><circle cx="21" cy="9" r="1.6" /><circle cx="31" cy="14" r="1.6" /></>),
};

export function PhoneShapeGlyph({ shape }: { shape: string }) {
  return <svg {...SVG} aria-hidden="true">{SHAPES[shape] ?? SHAPES.rectangle}</svg>;
}

/** Motion hint for an animation preset id ('left', 'zoom-in', 'spin', 'fade', 'typewriter', ...). */
export function PhoneMotionGlyph({ id }: { id: string }) {
  const box = <rect x="15" y="9" width="10" height="10" rx="1.5" />;
  let motion: ReactElement;
  if (id === 'none') motion = <path d="M14 14h12" />;
  else if (/left|through/.test(id)) motion = (<>{box}<path d="M4 14h8M8 11l-3 3 3 3" /></>);
  else if (/right/.test(id)) motion = (<>{box}<path d="M28 14h8M32 11l3 3-3 3" /></>);
  else if (/top|fall/.test(id)) motion = (<>{box}<path d="M20 2v5M17.5 4.5L20 2l2.5 2.5" /></>);
  else if (/bottom|rise/.test(id)) motion = (<>{box}<path d="M20 21v5M17.5 23.5L20 26l2.5-2.5" /></>);
  else if (/zoom-out|shrink/.test(id)) motion = (<><rect x="9" y="5" width="22" height="18" rx="2" strokeDasharray="2.5 2" />{box}</>);
  else if (/zoom|pulse|pop/.test(id)) motion = (<><rect x="9" y="5" width="22" height="18" rx="2" />{box}</>);
  else if (/spin/.test(id)) motion = (<><rect x="15" y="9" width="10" height="10" rx="1.5" transform="rotate(20 20 14)" /><path d="M30 8a11 11 0 0 1 0 12M30 20l-3-.5M30 20l.6-3" /></>);
  else if (/typewriter|decode/.test(id)) motion = (<><path d="M8 18h4M14 18h4M20 18h4" /><path d="M27 10v10" /></>);
  else motion = (<><rect x="9" y="8" width="10" height="12" rx="1.5" strokeOpacity="0.35" /><rect x="21" y="8" width="10" height="12" rx="1.5" /></>);
  return <svg {...SVG} aria-hidden="true">{motion}</svg>;
}
