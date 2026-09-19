import { FileTypeIcon } from '../../panels/media/FileTypeIcon';
import type { TimelineClipCanvasChromeOverlay } from '../utils/timelineClipCanvasChromeOverlays';

const CAMERA_PREFIX_GAP_PX = 4;
const CAMERA_PREFIX_FONT_RATIO = 0.75;
const CAMERA_PREFIX_WIDTH_RATIO = 1.25;
const MIN_CAMERA_PREFIX_SIZE_PX = 10;

interface TimelineClipCanvasChromeLayerProps {
  chromeOverlays: readonly TimelineClipCanvasChromeOverlay[];
  chromeScrollX: number;
  chromeViewportWidth: number;
  height: number;
}

export function TimelineClipCanvasChromeLayer({
  chromeOverlays,
  chromeScrollX,
  chromeViewportWidth,
  height,
}: TimelineClipCanvasChromeLayerProps) {
  return (
    <div
      className="timeline-clip-chrome-layer"
      style={{
        transform: `translateX(${chromeScrollX}px)`,
        width: chromeViewportWidth,
      }}
      aria-hidden="true"
    >
      {chromeOverlays.map((overlay) => {
        const isSceneCamera = overlay.iconType === 'camera';
        const availableIconWidth = Math.min(
          overlay.width - 8,
          overlay.width - overlay.badgeReserve * 2 - 8,
        );
        const iconOnlySize = Math.max(0, Math.min(height - 10, availableIconWidth));
        const cameraGroupSize = Math.floor(Math.max(0, Math.min(
          height - 10,
          (availableIconWidth - CAMERA_PREFIX_GAP_PX)
            / (1 + CAMERA_PREFIX_FONT_RATIO * CAMERA_PREFIX_WIDTH_RATIO),
        )));
        const showCameraPrefix = isSceneCamera && cameraGroupSize >= MIN_CAMERA_PREFIX_SIZE_PX;
        const iconSize = showCameraPrefix ? cameraGroupSize : iconOnlySize;
        const cameraPrefixSize = Math.round(iconSize * CAMERA_PREFIX_FONT_RATIO);
        const iconGroupWidth = showCameraPrefix
          ? iconSize + cameraPrefixSize * CAMERA_PREFIX_WIDTH_RATIO + CAMERA_PREFIX_GAP_PX
          : iconSize;
        const showIcon = overlay.showIcon && iconSize >= 4;

        return (
          <div
            key={overlay.id}
            className={`timeline-clip-chrome ${overlay.isAudio ? 'is-audio' : 'is-visual'}${overlay.linked ? ' is-linked' : ''}`}
            style={{
              left: overlay.left,
              top: 1,
              width: overlay.width,
              height: Math.max(1, height - 2),
            }}
          >
            <span className="resolve-clip-footer-media-icon" aria-hidden="true">
              <svg viewBox="0 0 12 10" width="11" height="9">
                <rect x="1" y="1" width="10" height="8" rx="0.7" />
                <path d="M3 1v8M9 1v8M1 3h2M1 7h2M9 3h2M9 7h2" />
              </svg>
            </span>
            {overlay.linked && (
              <span className="resolve-clip-footer-link-icon" aria-hidden="true">
                <svg viewBox="0 0 12 10" width="11" height="9">
                  <path d="M4.8 6.8 3.7 7.9a2 2 0 0 1-2.8-2.8L2.7 3.3a2 2 0 0 1 2.8 0M7.2 3.2l1.1-1.1a2 2 0 1 1 2.8 2.8L9.3 6.7a2 2 0 0 1-2.8 0M4.1 5h3.8" />
                </svg>
              </span>
            )}
            {showIcon && (
              <span className="timeline-clip-type-icon" data-clip-type={overlay.iconType ?? 'file'}>
                {showCameraPrefix && (
                  <span className="timeline-clip-camera-prefix" style={{ fontSize: cameraPrefixSize }}>3D</span>
                )}
                <FileTypeIcon type={overlay.iconType} outline size={iconSize} />
              </span>
            )}
            {overlay.label && (
              <span
                className="timeline-clip-chrome-title"
                style={{
                  right: Math.max(
                    overlay.badgeReserve + 8,
                    showIcon ? overlay.width / 2 + iconGroupWidth / 2 + 4 : 6,
                  ),
                }}
              >
                {overlay.label}
              </span>
            )}
            {overlay.badges.map((badge, index) => (
              <span
                key={`${badge.label}:${index}`}
                className="timeline-clip-chrome-badge"
                style={{
                  right: badge.right,
                  width: badge.width,
                  backgroundColor: badge.fill,
                  borderColor: badge.stroke ?? 'transparent',
                }}
              >
                {badge.label}
              </span>
            ))}
          </div>
        );
      })}
    </div>
  );
}
