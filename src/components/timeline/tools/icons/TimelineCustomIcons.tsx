import type { SVGProps } from 'react';

export type TimelineCustomIconProps = Omit<SVGProps<SVGSVGElement>, 'width' | 'height' | 'stroke'> & {
  size?: number | string;
  stroke?: number | string;
};

function SvgIcon({ size = 24, stroke = 2, children, ...props }: TimelineCustomIconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth={stroke}
      strokeLinecap="round"
      strokeLinejoin="round"
      {...props}
    >
      {children}
    </svg>
  );
}

export function TrackSelectForwardIcon(props: TimelineCustomIconProps) {
  return (
    <SvgIcon {...props}>
      <path d="M4 6h10" />
      <path d="M4 12h13" />
      <path d="M4 18h10" />
      <path d="M17 8l4 4-4 4" />
    </SvgIcon>
  );
}

export function TrackSelectBackwardIcon(props: TimelineCustomIconProps) {
  return (
    <SvgIcon {...props}>
      <path d="M10 6h10" />
      <path d="M7 12h13" />
      <path d="M10 18h10" />
      <path d="M7 8l-4 4 4 4" />
    </SvgIcon>
  );
}

export function BladeAllTracksIcon(props: TimelineCustomIconProps) {
  return (
    <SvgIcon {...props}>
      <path d="M5 6h14" />
      <path d="M5 12h14" />
      <path d="M5 18h14" />
      <path d="M15 4l-6 16" />
    </SvgIcon>
  );
}

export function GlueBottleIcon(props: TimelineCustomIconProps) {
  return (
    <SvgIcon {...props}>
      {/* School-glue bottle: orange-style cone cap, neck, chunky body, label band */}
      <path d="M9.5 7 L12 2.5 L14.5 7 Z" />
      <path d="M10.5 7v2" />
      <path d="M13.5 7v2" />
      <path d="M10.5 9 Q7 9.5 7 13 L7 19 Q7 21 9 21 L15 21 Q17 21 17 19 L17 13 Q17 9.5 13.5 9" />
      <ellipse cx="12" cy="15.5" rx="3.4" ry="2.3" />
    </SvgIcon>
  );
}

export function TrimEdgeIcon(props: TimelineCustomIconProps) {
  return (
    <SvgIcon {...props}>
      <path d="M7 5v14" />
      <path d="M17 5v14" />
      <path d="M10 8h4" />
      <path d="M10 16h4" />
    </SvgIcon>
  );
}

export function TrimToPlayheadIcon(props: TimelineCustomIconProps) {
  return (
    <SvgIcon {...props}>
      <path d="M12 4v16" />
      <path d="M4 8h5" />
      <path d="M4 16h5" />
      <path d="M20 8h-5" />
      <path d="M20 16h-5" />
      <path d="M8 12h8" />
    </SvgIcon>
  );
}

export function RippleTrimIcon(props: TimelineCustomIconProps) {
  return (
    <SvgIcon {...props}>
      <path d="M6 5v14" />
      <path d="M10 8h8" />
      <path d="M10 16h8" />
      <path d="M15 11l3 3-3 3" />
    </SvgIcon>
  );
}

export function RollingEditIcon(props: TimelineCustomIconProps) {
  return (
    <SvgIcon {...props}>
      <path d="M11 5v14" />
      <path d="M13 5v14" />
      <path d="M4 9h5" />
      <path d="M15 9h5" />
      <path d="M8 7l2 2-2 2" />
      <path d="M16 7l-2 2 2 2" />
    </SvgIcon>
  );
}

export function SlipEditIcon(props: TimelineCustomIconProps) {
  return (
    <SvgIcon {...props}>
      <path d="M5 7h14" />
      <path d="M5 17h14" />
      <path d="M9 12h6" />
      <path d="M9 12l2-2" />
      <path d="M9 12l2 2" />
      <path d="M15 12l-2-2" />
      <path d="M15 12l-2 2" />
    </SvgIcon>
  );
}

export function SlideEditIcon(props: TimelineCustomIconProps) {
  return (
    <SvgIcon {...props}>
      <path d="M4 8h5" />
      <path d="M15 8h5" />
      <path d="M8 16h8" />
      <path d="M8 16l2-2" />
      <path d="M8 16l2 2" />
      <path d="M16 16l-2-2" />
      <path d="M16 16l-2 2" />
    </SvgIcon>
  );
}

export function MarkInIcon(props: TimelineCustomIconProps) {
  return (
    <SvgIcon {...props}>
      <path d="M7 5v14" />
      <path d="M7 5h8" />
      <path d="M7 19h8" />
      <path d="M17 9v6" />
    </SvgIcon>
  );
}

export function MarkOutIcon(props: TimelineCustomIconProps) {
  return (
    <SvgIcon {...props}>
      <path d="M17 5v14" />
      <path d="M9 5h8" />
      <path d="M9 19h8" />
      <path d="M7 9v6" />
    </SvgIcon>
  );
}
