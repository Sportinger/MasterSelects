import { useEffect, useState, useSyncExternalStore } from 'react';
import {
  getMediaLinkDurability,
  isCopyingUndurableMedia,
  probeMediaLinkDurability,
  setCopyingUndurableMedia,
  subscribeMediaLinkDurability,
} from '../../../services/project/mediaCopy/mediaLinkDurability';
import { formatMediaBytes } from '../../../services/project/mediaCopy/projectMediaCopyNotices';

function useBrowserStorageEstimate(): string | null {
  const [text, setText] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const estimate = await navigator.storage?.estimate?.();
        if (cancelled || !estimate?.quota) return;
        setText(`${formatMediaBytes(estimate.usage ?? 0)} of ${formatMediaBytes(estimate.quota)} browser storage used.`);
      } catch {
        // No estimate available; the setting works without it.
      }
    })();
    return () => { cancelled = true; };
  }, []);
  return text;
}

/**
 * Copy-or-link choice for media whose link cannot survive a reload: files without
 * a reopenable location and every linked file in browsers that cannot store file
 * handles (Safari on iPhone, iPad and Mac).
 */
export function UndurableMediaCopySetting() {
  const copying = useSyncExternalStore(subscribeMediaLinkDurability, isCopyingUndurableMedia, () => true);
  const durability = useSyncExternalStore(subscribeMediaLinkDurability, getMediaLinkDurability, () => 'unknown' as const);
  const storage = useBrowserStorageEstimate();

  useEffect(() => { void probeMediaLinkDurability(); }, []);

  return (
    <>
      <label className="settings-row">
        <span className="settings-label">Copy media that cannot stay linked</span>
        <input
          type="checkbox"
          checked={copying}
          onChange={(event) => setCopyingUndurableMedia(event.target.checked)}
          className="settings-checkbox"
        />
      </label>
      <p className="settings-hint">
        {durability === 'not-durable'
          ? 'This browser cannot keep links to files after a reload.'
          : 'Some files have no location the project can reopen after a reload (e.g. picked without folder access).'}
        {copying
          ? ' Such imported media are copied into the project and stored with it.'
          : ' Off: such media stay linked and must be picked again after every reload.'}
        {storage && ` ${storage}`}
      </p>
    </>
  );
}
