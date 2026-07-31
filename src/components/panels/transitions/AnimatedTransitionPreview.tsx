import { memo, useId } from 'react';
import { TRANSITION_PREVIEW_RENDERERS } from './previewRenderers';
import {
  PREVIEW_BLUE,
  PREVIEW_CORAL,
  PREVIEW_WHITE,
  PreviewSvg,
} from './previews/previewShared';

interface AnimatedTransitionPreviewProps {
  type: string;
}

export const AnimatedTransitionPreview = memo(function AnimatedTransitionPreview({
  type,
}: AnimatedTransitionPreviewProps) {
  const reactId = useId();
  const idPrefix = `transitionPreview${reactId.replace(/[^a-zA-Z0-9_-]/g, '')}`;

  for (const renderPreview of TRANSITION_PREVIEW_RENDERERS) {
    const preview = renderPreview({ type, idPrefix });
    if (preview) return preview;
  }

  return (
    <PreviewSvg type={type} className="transition-preview-fallback">
      <rect className="tp-fallback-outgoing" x="5" y="8" width="30" height="24" fill={PREVIEW_BLUE} rx="2" />
      <rect className="tp-fallback-incoming" x="45" y="8" width="30" height="24" fill={PREVIEW_CORAL} rx="2" />
      <path d="M38 20h4" stroke={PREVIEW_WHITE} strokeWidth="2" strokeLinecap="round" />
    </PreviewSvg>
  );
});
