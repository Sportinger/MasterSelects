import type { ReactNode, SVGProps } from 'react';

export interface TransitionPreviewRendererProps {
  type: string;
  idPrefix: string;
}

export type TransitionPreviewRenderer = (
  props: TransitionPreviewRendererProps,
) => ReactNode | null;

interface PreviewSvgProps extends Omit<SVGProps<SVGSVGElement>, 'type'> {
  type: string;
  children: ReactNode;
}

export function PreviewSvg({
  type,
  children,
  className,
  ...props
}: PreviewSvgProps) {
  return (
    <svg
      viewBox="0 0 80 40"
      className={[
        'transition-preview-svg',
        'transition-preview-animated',
        `transition-preview-${type}`,
        className,
      ].filter(Boolean).join(' ')}
      aria-hidden="true"
      focusable="false"
      {...props}
    >
      {children}
    </svg>
  );
}

export const PREVIEW_BLUE = '#4a9eff';
export const PREVIEW_CORAL = '#ff6b4a';
export const PREVIEW_WHITE = '#ffffff';
export const PREVIEW_DARK = '#111827';
