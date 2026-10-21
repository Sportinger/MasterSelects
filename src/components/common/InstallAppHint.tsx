import { useState, useSyncExternalStore, type PointerEvent } from 'react';
import { IconAppWindow, IconX } from '@tabler/icons-react';
import {
  dismissAppInstallHint,
  getAppInstallState,
  promptAppInstall,
  subscribeAppInstallState,
  type AppInstallOutcome,
} from '../../services/pwa/appInstallPrompt';
import './InstallAppHint.css';

const blurAfterPointer = (event: PointerEvent<HTMLButtonElement>) => event.currentTarget.blur();

/**
 * Offers installing MasterSelects where folder access has to be allowed again. Browser tabs lose
 * File System Access grants when the browsing session ends; the installed app keeps them.
 * Shown only while the browser offers installation and the user has not hidden it.
 */
export function InstallAppHint({ className }: { className?: string }) {
  const state = useSyncExternalStore(subscribeAppInstallState, getAppInstallState, getAppInstallState);
  const [outcome, setOutcome] = useState<AppInstallOutcome | null>(null);
  const [busy, setBusy] = useState(false);
  const message = outcome === 'accepted'
    ? 'Installed. Open MasterSelects from its app window: folder access is kept there.'
    : outcome === 'failed' || outcome === 'unavailable'
      ? 'The install dialog could not open. Use the install icon in the address bar instead.'
      : null;
  if (state.dismissed || (!state.canInstall && !message)) return null;

  const install = async () => {
    if (busy) return;
    setBusy(true);
    try { setOutcome(await promptAppInstall()); } finally { setBusy(false); }
  };

  // Closing a result message only clears it; closing the offer hides it on this device.
  const close = () => { if (message) setOutcome(null); else dismissAppInstallHint(); };

  return (
    <div className={`install-app-hint${className ? ` ${className}` : ''}`} role="note" aria-label="Install MasterSelects">
      <IconAppWindow className="install-app-hint-icon" aria-hidden="true" />
      <div className="install-app-hint-copy">
        {message
          ? <span role={outcome === 'accepted' ? 'status' : 'alert'}>{message}</span>
          : <>
            <strong>Install MasterSelects to keep folder access</strong>
            <span>The installed app keeps folder permissions after a browser restart, so this step is not needed again.</span>
          </>}
      </div>
      {!message && (
        <button type="button" className="install-app-hint-install" disabled={busy}
          onPointerUp={blurAfterPointer} onClick={() => { void install(); }}>
          {busy ? 'Installing…' : 'Install'}
        </button>
      )}
      <button type="button" className="install-app-hint-dismiss" aria-label="Hide install hint" title="Hide install hint"
        onPointerUp={blurAfterPointer} onClick={close}>
        <IconX aria-hidden="true" />
      </button>
    </div>
  );
}
