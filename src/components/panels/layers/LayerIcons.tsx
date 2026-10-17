const svgProps = {
  'aria-hidden': true,
  fill: 'none',
  height: 14,
  stroke: 'currentColor',
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
  strokeWidth: 1.5,
  viewBox: '0 0 16 16',
  width: 14,
} as const;

export function EyeIcon({ open }: { open: boolean }) {
  return (
    <svg {...svgProps}>
      <path d="M1.5 8s2.4-4.5 6.5-4.5S14.5 8 14.5 8 12.1 12.5 8 12.5 1.5 8 1.5 8Z" />
      {open ? <circle cx="8" cy="8" r="2" /> : <path d="m2.5 13.5 11-11" />}
    </svg>
  );
}

export function LockIcon({ locked }: { locked: boolean }) {
  return (
    <svg {...svgProps}>
      <rect height="6" rx="1" width="9" x="3.5" y="7.5" />
      <path d={locked ? 'M5.5 7.5V5a2.5 2.5 0 0 1 5 0v2.5' : 'M5.5 7.5V5a2.5 2.5 0 0 1 4.9-.7'} />
    </svg>
  );
}

export function PlusImageIcon() {
  return (
    <svg {...svgProps}>
      <rect height="10" rx="1.2" width="11" x="1.5" y="3.5" />
      <path d="m2.5 12 3.2-3.5 2.3 2.4 1.4-1.4 2.6 2.5M13 1v4M11 3h4" />
    </svg>
  );
}

export function TextIcon() {
  return (
    <svg {...svgProps}>
      <path d="M3 3.5h10M8 3.5v9.5M6 13h4" />
    </svg>
  );
}

export function SolidIcon() {
  return (
    <svg {...svgProps}>
      <rect fill="currentColor" fillOpacity=".35" height="10" rx="1.2" width="10" x="3" y="3" />
    </svg>
  );
}

export function TrashIcon() {
  return (
    <svg {...svgProps}>
      <path d="M2.5 4h11M6 4V2.5h4V4M4 4l.7 9.5h6.6L12 4" />
    </svg>
  );
}

export function DownloadIcon() {
  return (
    <svg {...svgProps}>
      <path d="M8 2v8M4.5 6.8 8 10.3l3.5-3.5M2.5 13.5h11" />
    </svg>
  );
}

export function NewDocumentIcon() {
  return (
    <svg {...svgProps}>
      <path d="M9.5 1.5H4a1 1 0 0 0-1 1v11a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1V5Z" />
      <path d="M9.5 1.5V5H13M8 7.5v4M6 9.5h4" />
    </svg>
  );
}
