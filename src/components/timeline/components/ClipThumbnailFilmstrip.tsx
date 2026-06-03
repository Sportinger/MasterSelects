import { memo } from 'react';
import type {
  LegacyThumbnailRenderPlan,
  SegmentThumbnailRenderPlan,
} from '../utils/thumbnailFilmstrip';
import type { TimelineHorizontalRenderWindow } from '../utils/waveformRenderGeometry';

interface ClipThumbnailFilmstripBaseProps {
  renderWindow: TimelineHorizontalRenderWindow;
}

type ClipThumbnailFilmstripProps = ClipThumbnailFilmstripBaseProps & (
  | {
      mode: 'segments';
      segmentPlans: readonly SegmentThumbnailRenderPlan[];
    }
  | {
      mode: 'regular';
      useSourceCache: true;
      cachedThumbnails: readonly (string | null)[];
    }
  | {
      mode: 'regular';
      useSourceCache: false;
      legacyPlans: readonly LegacyThumbnailRenderPlan[];
    }
);

export const ClipThumbnailFilmstrip = memo(function ClipThumbnailFilmstrip(props: ClipThumbnailFilmstripProps) {
  const { renderWindow } = props;
  const windowStyle = {
    left: renderWindow.startPx,
    width: renderWindow.width,
    right: 'auto',
  };

  if (props.mode === 'segments') {
    const segmentPlans = props.segmentPlans;

    return (
      <div
        className="clip-thumbnails clip-thumbnails-segments clip-thumbnails-windowed"
        style={windowStyle}
      >
        {segmentPlans.map((segmentPlan) => {
          const segment = segmentPlan.segment;

          return (
            <div
              key={segmentPlan.segmentIndex}
              className="clip-segment"
              style={{
                position: 'absolute',
                left: `${segmentPlan.leftPercent}%`,
                width: `${segmentPlan.widthPercent}%`,
                height: '100%',
                display: 'flex',
                overflow: 'hidden',
              }}
            >
              {segment.thumbnails.length > 0 ? (
                segmentPlan.thumbnailIndexes.map((thumbIndex, i) => {
                  const thumb = segment.thumbnails[thumbIndex];

                  return (
                    <img
                      key={i}
                      src={thumb}
                      alt=""
                      className="clip-thumb"
                      draggable={false}
                      style={{ flex: '1 0 auto', minWidth: 0, objectFit: 'cover' }}
                    />
                  );
                })
              ) : (
                <div className="clip-segment-empty" style={{ width: '100%', height: '100%', background: '#1a1a1a' }} />
              )}
            </div>
          );
        })}
      </div>
    );
  }

  return (
    <div
      className="clip-thumbnails clip-thumbnails-windowed"
      style={windowStyle}
    >
      {props.useSourceCache ? (
        props.cachedThumbnails.map((thumb, i) => thumb ? (
          <img
            key={i}
            src={thumb}
            alt=""
            className="clip-thumb"
            draggable={false}
          />
        ) : (
          <div key={i} className="clip-thumb clip-thumb-placeholder" />
        ))
      ) : (
        props.legacyPlans.map((plan) => (
          <img
            key={plan.slotIndex}
            src={plan.thumbnail}
            alt=""
            className="clip-thumb"
            draggable={false}
          />
        ))
      )}
    </div>
  );
});
