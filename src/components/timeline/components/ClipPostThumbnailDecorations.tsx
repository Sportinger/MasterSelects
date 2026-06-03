import { memo } from 'react';
import type { TimelineClip } from '../../../types';

interface ClipPostThumbnailDecorationsProps {
  enabled: boolean;
  clip: TimelineClip;
}

export const ClipPostThumbnailDecorations = memo(function ClipPostThumbnailDecorations({
  enabled,
  clip,
}: ClipPostThumbnailDecorationsProps) {
  if (!enabled) return null;

  return (
    <>
      {clip.isComposition && clip.nestedClipBoundaries && clip.nestedClipBoundaries.length > 0 && (
        <div className="nested-clip-boundaries">
          {clip.nestedClipBoundaries.map((boundary, i) => (
            <div
              key={i}
              className="nested-boundary-line"
              style={{ left: `${boundary * 100}%` }}
            />
          ))}
        </div>
      )}
      {clip.needsReload && (
        <div className="clip-reload-badge" title="Click media file to reload">
          !
        </div>
      )}
    </>
  );
});
