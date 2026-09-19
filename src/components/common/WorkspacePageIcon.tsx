import {
  FACTORY_3D_EDIT_LAYOUT_ID,
  FACTORY_AUDIO_EDIT_LAYOUT_ID,
  FACTORY_COLOR_LAYOUT_ID,
  FACTORY_MOBILE_LAYOUT_ID,
  FACTORY_START_LAYOUT_ID,
  FACTORY_VIDEO_EDIT_LAYOUT_ID,
} from '../../stores/dockStore';

interface WorkspacePageIconProps {
  layoutId: string;
  size?: number;
}

export function WorkspacePageIcon({ layoutId, size = 20 }: WorkspacePageIconProps) {
  const svgProps = {
    'aria-hidden': true,
    className: 'workspace-page-icon',
    fill: 'none',
    height: size,
    viewBox: '0 0 24 24',
    width: size,
  } as const;

  if (layoutId === FACTORY_VIDEO_EDIT_LAYOUT_ID) {
    return (
      <svg {...svgProps}>
        <path d="M1 7h10v3H1zm15 0h7v3h-7zM6 11h6v3H6zm9 0h7v3h-7z" fill="#4083c5" />
        <path d="M1 7.5h10m5 0h7M6 11.5h6m3 0h7" stroke="#72a9d7" strokeWidth="1" />
        <path d="M1 15h10v3H1zm14 0h8v3h-8z" fill="#40834f" />
        <path d="M1 15.5h10m4 0h8" stroke="#72a94f" strokeWidth="1" />
        <path d="M11 3h3v3h-1v15h-1V6h-1z" fill="#e64b3d" />
      </svg>
    );
  }

  if (layoutId === FACTORY_MOBILE_LAYOUT_ID) {
    return (
      <svg {...svgProps}>
        <rect height="18" rx="2" stroke="currentColor" strokeWidth="1.4" width="12" x="6" y="3" />
        <circle cx="12" cy="11" r="4.15" stroke="#55bce2" strokeWidth="1.35" />
        <circle cx="15.2" cy="7.8" fill="#ee5654" r="1" />
        <path d="M10 18.3h4" stroke="currentColor" strokeLinecap="round" strokeWidth="1.2" />
      </svg>
    );
  }

  if (layoutId === FACTORY_AUDIO_EDIT_LAYOUT_ID) {
    return (
      <svg {...svgProps}>
        <path d="M9 17.7V6.3l9-2v10.9" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.55" />
        <path d="m9 8.8 9-2" stroke="#4dc6e9" strokeLinecap="round" strokeWidth="1.35" />
        <ellipse cx="6.8" cy="18" fill="#e05491" rx="3.1" ry="2.1" transform="rotate(-12 6.8 18)" />
        <ellipse cx="15.8" cy="15.5" fill="#58c884" rx="3.1" ry="2.1" transform="rotate(-12 15.8 15.5)" />
      </svg>
    );
  }

  if (layoutId === FACTORY_3D_EDIT_LAYOUT_ID) {
    return (
      <svg {...svgProps}>
        <path d="m12 2.8 8 4.4v9.4L12 21l-8-4.4V7.2Z" stroke="currentColor" strokeLinejoin="round" strokeWidth="1.35" />
        <path d="m4.4 7.4 7.6 4.2 7.6-4.2M12 11.6v8.8" stroke="#55c7df" strokeLinejoin="round" strokeWidth="1.3" />
        <path d="m8.4 5 7.5 4.2" stroke="#a57de5" strokeLinecap="round" strokeWidth="1.3" />
      </svg>
    );
  }

  if (layoutId === FACTORY_COLOR_LAYOUT_ID) {
    return (
      <svg {...svgProps}>
        <circle cx="8.5" cy="5.6" fill="#b84388" r="1.7" />
        <circle cx="14" cy="5.4" fill="#8a5491" r="1.7" />
        <circle cx="18.4" cy="9.2" fill="#5a61bb" r="1.7" />
        <circle cx="18.7" cy="14.6" fill="#3c77a8" r="1.7" />
        <circle cx="14.6" cy="18.8" fill="#12a448" r="1.7" />
        <circle cx="9.2" cy="18.8" fill="#c8bf3e" r="1.7" />
        <circle cx="5.4" cy="14.4" fill="#d4a445" r="1.7" />
        <circle cx="5.2" cy="9" fill="#e05751" r="1.7" />
        <circle cx="12" cy="12" fill="#8a8d8c" r="1.7" />
      </svg>
    );
  }

  if (layoutId === FACTORY_START_LAYOUT_ID) {
    return (
      <svg {...svgProps}>
        <path d="m5 19 9.5-9.5M12.8 6.2l5 5" stroke="currentColor" strokeLinecap="round" strokeWidth="1.6" />
        <path d="m17.8 3 .6 1.8 1.8.6-1.8.6-.6 1.8-.6-1.8-1.8-.6 1.8-.6ZM6 7l.5 1.5L8 9l-1.5.5L6 11l-.5-1.5L4 9l1.5-.5Z" fill="#f1c94b" />
        <circle cx="5" cy="18.8" fill="#e85a79" r="1.25" />
      </svg>
    );
  }

  return (
    <svg {...svgProps}>
      <rect height="16" rx="2" stroke="currentColor" strokeWidth="1.4" width="16" x="4" y="4" />
      <path d="M4 10h16M10 4v16" stroke="currentColor" strokeWidth="1.2" />
    </svg>
  );
}
