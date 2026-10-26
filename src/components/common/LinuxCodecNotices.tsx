// LinuxCodecNotices - dismissible banners for H.265/AAC limits of the browser on Linux.
// Raised by real WebCodecs capability checks (export settings, export start, H.265 import).

import './LinuxPlatformBanner.css';
import { useLinuxCodecNoticeStore } from '../../stores/linuxCodecNoticeStore';
import { dismissLinuxCodecNotice } from '../../services/codecNotices/linuxCodecNotices';
import { getLinuxCodecNoticeMessage } from '../../services/codecNotices/linuxCodecNoticePolicy';

const DISMISS_LABELS = {
  'aac-encode': 'Dismiss AAC notice',
  'h265-encode': 'Dismiss H.265 export notice',
  'h265-decode': 'Dismiss H.265 playback notice',
} as const;

export function LinuxCodecNotices() {
  const notices = useLinuxCodecNoticeStore((state) => state.notices);
  if (notices.length === 0) return null;

  return (
    <>
      {notices.map(({ id, context }) => {
        const message = getLinuxCodecNoticeMessage(id, context);
        return (
          <div className="linux-banner linux-banner--notice" data-codec-notice={id} key={id} role="status">
            <div className="linux-banner-content">
              <span aria-hidden="true" className="linux-banner-icon">⚠</span>
              <span className="linux-banner-text">
                <strong>{message.title}</strong> {message.body}
              </span>
              <button
                aria-label={DISMISS_LABELS[id]}
                className="linux-banner-dismiss"
                onClick={() => dismissLinuxCodecNotice(id)}
                onPointerUp={(event) => event.currentTarget.blur()}
                title="Dismiss (won't show again)"
                type="button"
              >
                ✕
              </button>
            </div>
          </div>
        );
      })}
    </>
  );
}
