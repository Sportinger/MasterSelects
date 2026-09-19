import type { ReactNode } from 'react';
import { useEffect, useState } from 'react';

import {
  colorGradeThumbnailPreviewRenderer,
  type ColorGradeThumbnailPreview as ColorGradeThumbnailPreviewPlan,
} from '../../../services/colorGrades/colorGradeThumbnailPreview';

interface ColorGradeThumbnailProps {
  className: string;
  sourceUrl?: string;
  preview?: ColorGradeThumbnailPreviewPlan;
  children?: ReactNode;
}

export function ColorGradeThumbnail({
  className,
  sourceUrl,
  preview,
  children,
}: ColorGradeThumbnailProps) {
  const [renderedUrl, setRenderedUrl] = useState(sourceUrl);
  const graphHash = preview?.graphHash;

  useEffect(() => {
    if (!sourceUrl) {
      setRenderedUrl(undefined);
      return;
    }
    if (!preview) {
      setRenderedUrl(sourceUrl);
      return;
    }

    let active = true;
    const timeout = window.setTimeout(() => {
      void colorGradeThumbnailPreviewRenderer.render(sourceUrl, preview).then(url => {
        if (active) setRenderedUrl(url);
      });
    }, 24);
    return () => {
      active = false;
      window.clearTimeout(timeout);
    };
  }, [graphHash, preview, sourceUrl]);

  return (
    <span
      aria-hidden="true"
      className={className}
      style={renderedUrl ? { backgroundImage: `url("${renderedUrl.replace(/"/g, '\\"')}")` } : undefined}
    >
      {!renderedUrl && children}
    </span>
  );
}
