// The temporary IndexedDB store is a last resort (see browserStorageRoot): whoever sees the project
// chooser while it is active must read that projects can be lost there and what to do about it.
import { useEffect, useState } from 'react';
import {
  FALLBACK_STORAGE_RISK,
  describeBrowserStorageFallback,
  getBrowserStorageFallbackReason,
  isBrowserStorageFallbackActive,
  subscribeBrowserStorageKind,
} from '../../services/project/core/browserStorageRoot';

export const TEMPORARY_STORAGE_NOTICE_TITLE = 'Projects are only kept temporarily in this browser';

export function TemporaryStorageNotice({ className }: { className: string }) {
  const [active, setActive] = useState(isBrowserStorageFallbackActive);
  useEffect(() => subscribeBrowserStorageKind(() => setActive(isBrowserStorageFallbackActive())), []);
  if (!active) return null;
  return (
    <div className={className} role="alert" data-testid="temporary-storage-notice">
      <strong>{TEMPORARY_STORAGE_NOTICE_TITLE}</strong>
      <p>{describeBrowserStorageFallback(getBrowserStorageFallbackReason())}</p>
      <p>{FALLBACK_STORAGE_RISK}</p>
    </div>
  );
}
