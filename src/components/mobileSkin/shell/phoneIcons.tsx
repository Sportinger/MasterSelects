// Neutral line glyphs for the phone skin (own geometry, 24x24 grid, stroke = currentColor).
import type { ReactNode } from 'react';
import type { PhoneIconName } from '../contracts';

const GLYPHS: Record<PhoneIconName, ReactNode> = {
  split: (<><rect x="3.5" y="6" width="6" height="12" rx="1.5" /><rect x="14.5" y="6" width="6" height="12" rx="1.5" /><path d="M12 3v18" /></>),
  trim: (<><path d="M7 4v16M17 4v16" /><path d="M7 12h10M10 9l-3 3 3 3M14 9l3 3-3 3" /></>),
  delete: (<><path d="M4.5 7h15M9.5 7V4.5h5V7" /><path d="M6.5 7l.8 12.5h9.4L17.5 7M10 11v5M14 11v5" /></>),
  duplicate: (<><rect x="8.5" y="8.5" width="11" height="11" rx="2" /><path d="M15.5 8.5V6a1.5 1.5 0 0 0-1.5-1.5H6A1.5 1.5 0 0 0 4.5 6v8A1.5 1.5 0 0 0 6 15.5h2.5" /></>),
  speed: (<><path d="M4 17a8 8 0 1 1 16 0" /><path d="M12 17l4-5" /><circle cx="12" cy="17" r="1" /></>),
  volume: (<><path d="M4.5 10h3l4-3.5v11l-4-3.5h-3z" /><path d="M15 9.5a3.5 3.5 0 0 1 0 5M17.5 7a7 7 0 0 1 0 10" /></>),
  animation: (<><path d="M4 18c3-9 5-9 8 0s5 9 8 0" /><circle cx="4" cy="18" r="1" /><circle cx="20" cy="18" r="1" /></>),
  effects: (<path d="M12 3.5l2.2 6.3 6.3 2.2-6.3 2.2L12 20.5l-2.2-6.3L3.5 12l6.3-2.2z" />),
  filters: (<><circle cx="9" cy="9.5" r="4.5" /><circle cx="15" cy="9.5" r="4.5" /><circle cx="12" cy="15" r="4.5" /></>),
  adjust: (<><path d="M5 7h14M5 12h14M5 17h14" /><circle cx="9" cy="7" r="2" /><circle cx="15" cy="12" r="2" /><circle cx="8" cy="17" r="2" /></>),
  text: (<path d="M5 6.5V5h14v1.5M12 5v14M9 19h6" />),
  audio: (<><path d="M9 17V6l10-2v11" /><circle cx="6.5" cy="17" r="2.5" /><circle cx="16.5" cy="15" r="2.5" /></>),
  overlay: (<><rect x="3.5" y="3.5" width="12" height="12" rx="2" /><rect x="8.5" y="8.5" width="12" height="12" rx="2" /></>),
  format: (<><rect x="4" y="4" width="16" height="16" rx="2" /><path d="M4 9h16M9 9v11" /></>),
  media: (<><rect x="3.5" y="5" width="17" height="14" rx="2" /><path d="M3.5 15l5-4.5 4 3.5 3-2.5 5 4.5" /><circle cx="16.5" cy="9.5" r="1.2" /></>),
  transition: (<><path d="M3.5 6l8 6-8 6zM20.5 6l-8 6 8 6z" /></>),
  mask: (<><rect x="3.5" y="3.5" width="17" height="17" rx="2" strokeDasharray="2.5 2" /><circle cx="12" cy="12" r="5" /></>),
  keyframe: (<path d="M12 3.5l8.5 8.5-8.5 8.5L3.5 12z" />),
  crop: (<><path d="M7 3v14h14M3 7h14v14" /></>),
  replace: (<><path d="M4 9h13l-3-3M20 15H7l3 3" /></>),
  assistant: (<><path d="M5 5.5h14a1.5 1.5 0 0 1 1.5 1.5v8a1.5 1.5 0 0 1-1.5 1.5h-7l-4.5 3.5v-3.5H5A1.5 1.5 0 0 1 3.5 15V7A1.5 1.5 0 0 1 5 5.5z" /><path d="M9 11h6" /></>),
  nodes: (<><circle cx="6" cy="6" r="2.2" /><circle cx="18" cy="12" r="2.2" /><circle cx="6" cy="18" r="2.2" /><path d="M8 6.5c5 0 5 5.5 8 5.5M8 17.5c5 0 5-5.5 8-5.5" /></>),
  color: (<><circle cx="12" cy="12" r="8.5" /><path d="M12 3.5v17M3.5 12h17" /></>),
  captions: (<><rect x="3.5" y="5.5" width="17" height="13" rx="2.5" /><path d="M7.5 11h5M7.5 14.5h9" /></>),
  more: (<><circle cx="5.5" cy="12" r="1.2" /><circle cx="12" cy="12" r="1.2" /><circle cx="18.5" cy="12" r="1.2" /></>),
  play: (<path d="M8 5l11 7-11 7z" />),
  pause: (<><path d="M8 5v14M16 5v14" /></>),
  undo: (<><path d="M9 14L4 9l5-5" /><path d="M4 9h10a6 6 0 0 1 0 12h-4" /></>),
  redo: (<><path d="M15 14l5-5-5-5" /><path d="M20 9H10a6 6 0 0 0 0 12h4" /></>),
  back: (<path d="M15 5l-7 7 7 7" />),
  export: (<><path d="M12 15V4M8 8l4-4 4 4" /><path d="M5 12v7h14v-7" /></>),
  fullscreen: (<path d="M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5" />),
  plus: (<path d="M12 5v14M5 12h14" />),
  compositions: (<><rect x="3.5" y="7.5" width="13" height="13" rx="2" /><path d="M7.5 7.5V5.5a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2h-2" /></>),
  reorder: (<><path d="M4 8h16M4 16h16" /><path d="M9 4.5L12 8l3-3.5M9 19.5L12 16l3 3.5" /></>),
  close: (<path d="M5.5 5.5l13 13M18.5 5.5l-13 13" />),
  check: (<path d="M4.5 12.5l5 5 10-11" />),
  update: (<><path d="M19.5 12a7.5 7.5 0 1 1-2.6-5.7" /><path d="M19.5 4v4h-4" /></>),
};

const FILLED: ReadonlySet<PhoneIconName> = new Set(['play']);

export function PhoneIcon({ name, size = 24 }: { name: PhoneIconName; size?: number }) {
  return (
    <svg
      className="phone-icon"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill={FILLED.has(name) ? 'currentColor' : 'none'}
      stroke="currentColor"
      strokeWidth={1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {GLYPHS[name]}
    </svg>
  );
}
