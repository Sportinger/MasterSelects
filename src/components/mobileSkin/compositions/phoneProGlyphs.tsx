// Line glyphs of the pro sheets and landscape editors that the shell's icon set does not carry
// (track toggles, track types, panel sides, rotate). Own geometry, 24x24 grid, stroke = currentColor.
import type { ReactNode } from 'react';

export type ProGlyphName =
  | 'eye' | 'eye-off' | 'lock' | 'unlock' | 'solo' | 'mute' | 'more'
  | 'track-video' | 'track-audio' | 'track-midi'
  | 'panel-left' | 'panel-right' | 'rotate' | 'chevron-right' | 'chevron-left' | 'chevron-down' | 'chevron-up'
  | 'folder' | 'image' | 'text' | 'solid' | 'data' | 'cube'
  | 'empty' | 'jobs' | 'markers' | 'bake' | 'source' | 'variants' | 'details' | 'film' | 'tools';

const GLYPHS: Record<ProGlyphName, ReactNode> = {
  eye: (<><path d="M2.5 12s3.5-6.5 9.5-6.5S21.5 12 21.5 12s-3.5 6.5-9.5 6.5S2.5 12 2.5 12z" /><circle cx="12" cy="12" r="3" /></>),
  'eye-off': (<><path d="M2.5 12s3.5-6.5 9.5-6.5S21.5 12 21.5 12s-3.5 6.5-9.5 6.5S2.5 12 2.5 12z" /><path d="M4 4l16 16" /></>),
  lock: (<><rect x="5" y="10.5" width="14" height="10" rx="2" /><path d="M8 10.5V7.5a4 4 0 0 1 8 0v3" /></>),
  unlock: (<><rect x="5" y="10.5" width="14" height="10" rx="2" /><path d="M8 10.5V7.5a4 4 0 0 1 7.6-1.7" /></>),
  solo: (<><circle cx="12" cy="12" r="8.5" /><path d="M14.5 9.2c-.5-1-1.5-1.5-2.6-1.5-1.5 0-2.6.8-2.6 2s1.1 1.7 2.7 2.1c1.6.4 2.7 1 2.7 2.3s-1.2 2.2-2.8 2.2c-1.3 0-2.4-.6-2.9-1.6" /></>),
  mute: (<><path d="M4.5 10h3l4-3.5v11l-4-3.5h-3z" /><path d="M15.5 9.5l5 5M20.5 9.5l-5 5" /></>),
  more: (<><circle cx="5.5" cy="12" r="1.2" /><circle cx="12" cy="12" r="1.2" /><circle cx="18.5" cy="12" r="1.2" /></>),
  'track-video': (<><rect x="3.5" y="6" width="12" height="12" rx="2" /><path d="M15.5 10.5l5-3v9l-5-3" /></>),
  'track-audio': (<path d="M4 12h2M8 8v8M12 5v14M16 9v6M20 11v2" />),
  'track-midi': (<><rect x="3.5" y="5" width="17" height="14" rx="2" /><path d="M8 5v8M12 5v8M16 5v8M8 13v6M12 13v6M16 13v6" /></>),
  'panel-left': (<><rect x="3.5" y="4.5" width="17" height="15" rx="2" /><path d="M9.5 4.5v15" /></>),
  'panel-right': (<><rect x="3.5" y="4.5" width="17" height="15" rx="2" /><path d="M14.5 4.5v15" /></>),
  rotate: (<><rect x="8" y="3.5" width="8" height="14" rx="1.5" /><path d="M4 14a8 8 0 0 0 13 6M17 20h-3.5M17 20v-3.5" /></>),
  'chevron-right': (<path d="M9 5l7 7-7 7" />),
  'chevron-left': (<path d="M15 5l-7 7 7 7" />),
  'chevron-down': (<path d="M5 9l7 7 7-7" />),
  'chevron-up': (<path d="M5 15l7-7 7 7" />),
  folder: (<path d="M3.5 7.5a2 2 0 0 1 2-2h4l2 2.5h7a2 2 0 0 1 2 2v7.5a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2z" />),
  image: (<><rect x="3.5" y="5" width="17" height="14" rx="2" /><path d="M3.5 15l5-4.5 4 3.5 3-2.5 5 4.5" /><circle cx="16" cy="9.5" r="1.2" /></>),
  text: (<path d="M5 6.5V5h14v1.5M12 5v14M9 19h6" />),
  solid: (<rect x="4.5" y="4.5" width="15" height="15" rx="2.5" fill="currentColor" fillOpacity="0.35" />),
  data: (<path d="M4 17l4-6 4 3 4-7 4 5" />),
  cube: (<><path d="M12 3.5l7.5 4.2v8.6L12 20.5l-7.5-4.2V7.7z" /><path d="M4.5 7.7L12 12l7.5-4.3M12 12v8.5" /></>),
  empty: (<><rect x="4" y="5" width="16" height="14" rx="2" strokeDasharray="3 2" /><path d="M9 12h6" /></>),
  jobs: (<><circle cx="12" cy="12" r="8.5" /><path d="M12 7v5l3.5 2" /></>),
  markers: (<path d="M7 20V4.5h9l-2 3.5 2 3.5H7" />),
  bake: (<><path d="M4 9h16v9.5a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 18.5z" /><path d="M8 9V6M12 9V4.5M16 9V6" /></>),
  source: (<><rect x="3.5" y="5" width="17" height="12" rx="2" /><path d="M8 20h8M10.5 9l4 2-4 2z" /></>),
  variants: (<><rect x="3.5" y="6" width="5" height="12" rx="1" /><rect x="9.5" y="6" width="5" height="12" rx="1" /><rect x="15.5" y="6" width="5" height="12" rx="1" /></>),
  details: (<><circle cx="12" cy="12" r="8.5" /><path d="M12 11v5.5M12 7.5v.5" /></>),
  film: (<><rect x="3.5" y="4.5" width="17" height="15" rx="2" /><path d="M7.5 4.5v15M16.5 4.5v15M3.5 9h4M3.5 15h4M16.5 9h4M16.5 15h4" /></>),
  tools: (<><rect x="4" y="4" width="6.5" height="6.5" rx="1.5" /><rect x="13.5" y="4" width="6.5" height="6.5" rx="1.5" /><rect x="4" y="13.5" width="6.5" height="6.5" rx="1.5" /><rect x="13.5" y="13.5" width="6.5" height="6.5" rx="1.5" /></>),
};

export function ProGlyph({ name, size = 20 }: { name: ProGlyphName; size?: number }) {
  return (
    <svg className="phone-pro-glyph" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      {GLYPHS[name]}
    </svg>
  );
}
