import { useEffect, useState, useSyncExternalStore, type PointerEvent } from 'react';
import {
  dismissProjectMediaCopyNotice,
  formatMediaBytes,
  getProjectMediaCopyNotice,
  subscribeProjectMediaCopyNotice,
  type ProjectMediaCopyNotice,
} from '../../services/project/mediaCopy/projectMediaCopyNotices';
import {
  getMediaLinkDurability,
  isCopyingUndurableMedia,
  setCopyingUndurableMedia,
  subscribeMediaLinkDurability,
} from '../../services/project/mediaCopy/mediaLinkDurability';
import './ProjectMediaCopyToast.css';

const SUCCESS_VISIBLE_MS = 9000;

function plural(count: number, word: string): string {
  return `${count} ${word}${count === 1 ? '' : 's'}`;
}

async function readFreeBrowserStorage(): Promise<number | null> {
  try {
    const estimate = await navigator.storage?.estimate?.();
    if (!estimate?.quota) return null;
    return Math.max(0, estimate.quota - (estimate.usage ?? 0));
  } catch {
    return null;
  }
}

function describe(notice: ProjectMediaCopyNotice, linkedReason: string): { title: string; text: string } {
  if (notice.failures.length > 0) {
    const first = notice.failures[0];
    const others = notice.failures.length > 1 ? ` (and ${plural(notice.failures.length - 1, 'other file')})` : '';
    return {
      title: 'Not copied into project',
      text: `${first.name} (${formatMediaBytes(first.bytes)})${others} could not be copied: ${first.message}. `
        + 'It works until the page reloads; then it must be picked again.',
    };
  }
  if (notice.pendingFiles > 0) {
    return {
      title: 'Copying into project',
      text: `${plural(notice.pendingFiles, 'file')} · ${formatMediaBytes(notice.pendingBytes)}. ${linkedReason}`,
    };
  }
  if (notice.copiedFiles > 0) {
    return {
      title: 'Copied into project',
      text: `${plural(notice.copiedFiles, 'file')} · ${formatMediaBytes(notice.copiedBytes)} stored with the project, `
        + 'so they stay available after a reload.',
    };
  }
  return {
    title: 'Linked only',
    text: `${plural(notice.linkedFiles, 'file')} stayed linked by your choice. Pick them again after a reload.`,
  };
}

function releasePointerFocus(event: PointerEvent<HTMLButtonElement>): void {
  event.currentTarget.blur();
}

/**
 * Says when imports were copied into the project because their links would not
 * survive a reload (e.g. Safari on iPhone/iPad), with the size, and reports
 * copies that failed. Offers to keep future imports linked instead.
 */
export function ProjectMediaCopyToast() {
  const notice = useSyncExternalStore(subscribeProjectMediaCopyNotice, getProjectMediaCopyNotice, () => null);
  const copying = useSyncExternalStore(subscribeMediaLinkDurability, isCopyingUndurableMedia, () => true);
  const durability = useSyncExternalStore(subscribeMediaLinkDurability, getMediaLinkDurability, () => 'unknown' as const);
  const [freeBytes, setFreeBytes] = useState<number | null>(null);
  const settled = notice !== null && notice.pendingFiles === 0;
  const hasFailures = (notice?.failures.length ?? 0) > 0;

  useEffect(() => {
    if (!settled) return;
    let cancelled = false;
    void readFreeBrowserStorage().then((bytes) => { if (!cancelled) setFreeBytes(bytes); });
    return () => { cancelled = true; };
  }, [settled, notice?.copiedBytes]);

  useEffect(() => {
    if (!settled || hasFailures) return;
    const timer = window.setTimeout(dismissProjectMediaCopyNotice, SUCCESS_VISIBLE_MS);
    return () => window.clearTimeout(timer);
  }, [settled, hasFailures, notice]);

  if (!notice) return null;
  const linkedReason = durability === 'not-durable'
    ? 'This browser cannot keep links to files after a reload.'
    : 'These files have no location the project can reopen.';
  const { title, text } = describe(notice, linkedReason);
  const showFree = settled && notice.copiedFiles > 0 && freeBytes !== null;
  const offerLinking = copying && !hasFailures && (notice.pendingFiles > 0 || notice.copiedFiles > 0);

  return (
    <div className="project-media-copy-toast" role={hasFailures ? 'alert' : 'status'} aria-live="polite">
      <div className="project-media-copy-toast-body">
        <span className="project-media-copy-toast-title">{title}</span>
        <span className="project-media-copy-toast-text">
          {text}
          {showFree && ` ${formatMediaBytes(freeBytes)} browser storage left.`}
          {!copying && notice.copiedFiles > 0 && ' Future imports stay linked; change this in Settings › Import.'}
        </span>
      </div>
      <div className="project-media-copy-toast-actions">
        {offerLinking && (
          <button
            type="button"
            className="project-media-copy-toast-button"
            title="Future imports stay linked and must be picked again after every reload"
            onPointerUp={releasePointerFocus}
            onClick={() => setCopyingUndurableMedia(false)}
          >
            Link future imports
          </button>
        )}
        {settled && (
          <button
            type="button"
            className="project-media-copy-toast-button"
            onPointerUp={releasePointerFocus}
            onClick={dismissProjectMediaCopyNotice}
          >
            Dismiss
          </button>
        )}
      </div>
    </div>
  );
}
