export type IconName =
  | 'chevron'
  | 'pen'
  | 'edit'
  | 'rect'
  | 'ellipse'
  | 'eye'
  | 'eyeOff'
  | 'power'
  | 'invert'
  | 'copy'
  | 'paste'
  | 'trash'
  | 'close'
  | 'up'
  | 'down';

export function MaskIcon({ name }: { name: IconName }) {
  switch (name) {
    case 'chevron':
      return <path d="M8 10l4 4 4-4" />;
    case 'pen':
      return (
        <>
          <path d="M12 19l7-7 3 3-7 7-3-3z" />
          <path d="M18 13l-1.5-7.5L2 2l3.5 14.5L13 18l5-5z" />
          <circle cx="11" cy="11" r="2" />
        </>
      );
    case 'edit':
      return (
        <>
          <path d="M4 20h16" />
          <path d="M6 16l2.5-.5L18 6a2 2 0 0 0-3-3L5.5 12.5 5 15z" />
        </>
      );
    case 'rect':
      return <rect x="4" y="5" width="16" height="14" rx="1.5" />;
    case 'ellipse':
      return <ellipse cx="12" cy="12" rx="8" ry="6" />;
    case 'eye':
      return (
        <>
          <path d="M1.5 12s4-7 10.5-7 10.5 7 10.5 7-4 7-10.5 7S1.5 12 1.5 12z" />
          <circle cx="12" cy="12" r="2.5" />
        </>
      );
    case 'eyeOff':
      return (
        <>
          <path d="M3 3l18 18" />
          <path d="M10.7 5.2A10.9 10.9 0 0 1 12 5c6.5 0 10.5 7 10.5 7a16 16 0 0 1-2.8 3.6" />
          <path d="M6.1 6.5A16 16 0 0 0 1.5 12S5.5 19 12 19c1.6 0 3-.4 4.3-1" />
        </>
      );
    case 'power':
      return (
        <>
          <path d="M12 2v10" />
          <path d="M18.4 6.6a9 9 0 1 1-12.8 0" />
        </>
      );
    case 'invert':
      return (
        <>
          <circle cx="12" cy="12" r="8" />
          <path d="M12 4a8 8 0 0 0 0 16z" fill="currentColor" stroke="none" />
        </>
      );
    case 'copy':
      return (
        <>
          <rect x="8" y="8" width="11" height="11" rx="1.5" />
          <path d="M5 16H4a1.5 1.5 0 0 1-1.5-1.5V5A1.5 1.5 0 0 1 4 3.5h9.5A1.5 1.5 0 0 1 15 5v1" />
        </>
      );
    case 'paste':
      return (
        <>
          <path d="M8 4h8l1 3H7l1-3z" />
          <path d="M6 7h12v13H6z" />
          <path d="M9 11h6" />
        </>
      );
    case 'trash':
      return (
        <>
          <path d="M3 6h18" />
          <path d="M8 6V4h8v2" />
          <path d="M6 6l1 15h10l1-15" />
        </>
      );
    case 'close':
      return (
        <>
          <path d="M5 12a7 7 0 1 1 7 7" />
          <path d="M5 12h6v6" />
        </>
      );
    case 'up':
      return <path d="M7 14l5-5 5 5" />;
    case 'down':
      return <path d="M7 10l5 5 5-5" />;
  }
}
