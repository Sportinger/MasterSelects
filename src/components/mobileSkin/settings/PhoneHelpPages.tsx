// Help pages of the phone Settings sheet: install MasterSelects as an app (the browser's own install
// dialog where it offers one, numbered steps otherwise), legal pages and contact (the editor's
// LegalDialog), and the developer chat (the editor's DevChatDialog). The two dialogs are the desktop
// ones, which already lay out for phone widths; they open above the sheet.
import { useState, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import { PhoneSheet } from '../sheets/PhoneSheet';
import { getAppInstallState, promptAppInstall, subscribeAppInstallState } from '../../../services/pwa/appInstallPrompt';
import { phoneInstallPlatform, phoneInstallView, type PhoneInstallPlatform } from './phoneHelpModel';
import { LegalDialog, type LegalPage } from '../../common/LegalDialog';
import { DevChatDialog } from '../../common/DevChatDialog';
import { blurTappedControl, PhoneStatusLine, usePhoneStatus } from '../library/phoneListUi';
import { PHONE_HELP_TEST_IDS as IDS } from './phoneHelpTestIds';

interface PageProps { onBack: () => void }

const STEPS: Record<PhoneInstallPlatform, string[]> = {
  ios: ['Open masterselects.com in Safari.', 'Tap Share (the square with the arrow).', 'Tap Add to Home Screen, then Add.'],
  android: ['Open the browser menu (⋮).', 'Tap Install app or Add to Home screen.', 'Confirm; the app icon appears on your home screen.'],
  other: ['Open the browser menu.', 'Choose Install MasterSelects or Add to Home screen.', 'Confirm; the app icon appears on your home screen.'],
};

export function PhoneInstallPage({ onBack }: PageProps) {
  const state = useSyncExternalStore(subscribeAppInstallState, getAppInstallState, getAppInstallState);
  const view = phoneInstallView(state);
  const platform = phoneInstallPlatform(navigator.userAgent, navigator.maxTouchPoints);
  const { status, report } = usePhoneStatus();
  const install = async () => {
    const outcome = await promptAppInstall();
    if (outcome === 'accepted') report({ ok: true, message: 'Installed. Open MasterSelects from your home screen.' });
    else if (outcome === 'dismissed') report({ ok: true, message: 'Not installed. You can install it any time from here.' });
    else if (outcome === 'unavailable') report({ ok: false, message: 'The browser no longer offers installing right now; use the steps below.' });
    else report({ ok: false, message: 'The browser’s install dialog failed. Use the steps below.' });
  };
  return (
    <PhoneSheet title="Install the app" height="tall" onCancel={onBack} cancelLabel="Back">
      <div className="phone-lib" data-testid={IDS.installPage} data-state={view} data-platform={platform} onPointerUpCapture={blurTappedControl}>
        <PhoneStatusLine status={status} testId={IDS.status} />
        {view === 'installed' ? (
          <p className="phone-lib__note" data-testid={IDS.installState}>MasterSelects already runs as an installed app on this device.</p>
        ) : view === 'prompt' ? (
          <>
            <p className="phone-lib__note" data-testid={IDS.installState}>This browser can install MasterSelects as an app.</p>
            <button type="button" className="phone-lib__button phone-lib__button--primary phone-lib__button--wide" data-testid={IDS.installButton}
              onClick={() => void install()}>
              Install
            </button>
          </>
        ) : (
          <p className="phone-lib__note" data-testid={IDS.installState}>This browser has no install button for the app; add it by hand:</p>
        )}
        {view !== 'installed' && (
          <ol className="phone-help__steps" data-testid={IDS.installSteps}>
            {STEPS[platform].map((step) => <li key={step}>{step}</li>)}
          </ol>
        )}
        <p className="phone-lib__note">
          The installed app opens the full editor (its address is the full editor’s); this phone editor stays at masterselects.com/m in the browser.
          {platform === 'ios' ? ' On iPhone the home-screen app has its own storage: bring a project over with Projects > Project archive (.msproj) and Import project file.' : ''}
        </p>
      </div>
    </PhoneSheet>
  );
}

const LEGAL_ROWS: ReadonlyArray<{ page: LegalPage; label: string; hint: string }> = [
  { page: 'imprint', label: 'Imprint', hint: 'Impressum' },
  { page: 'privacy', label: 'Privacy policy', hint: 'Datenschutz' },
  { page: 'terms', label: 'Terms and conditions', hint: 'AGB' },
  { page: 'withdrawal', label: 'Withdrawal policy', hint: 'Widerruf' },
  { page: 'cancellation', label: 'Cancel a contract', hint: 'Kündigen' },
  { page: 'contact', label: 'Contact', hint: 'Kontakt' },
];

export function PhoneLegalPage({ onBack }: PageProps) {
  const [open, setOpen] = useState<LegalPage | null>(null);
  return (
    <PhoneSheet title="Legal and contact" height="tall" onCancel={onBack} cancelLabel="Back">
      <div className="phone-lib" data-testid={IDS.legalPage} onPointerUpCapture={blurTappedControl}>
        <p className="phone-lib__note">English and German, the same pages as in the full editor. No project needs to be open.</p>
        <div className="phone-settings__group">
          {LEGAL_ROWS.map((row) => (
            <button key={row.page} type="button" className="phone-settings__toggle" data-testid={IDS.legalRow} data-page={row.page}
              onClick={() => setOpen(row.page)}>
              <span>{row.label}<small>{row.hint}</small></span>
              <span className="phone-settings__state">›</span>
            </button>
          ))}
        </div>
      </div>
      {open && createPortal(<LegalDialog key={open} initialPage={open} onClose={() => setOpen(null)} />, document.body)}
    </PhoneSheet>
  );
}

/** The editor's developer chat above the phone; it only sends what is typed and sent. */
export function PhoneDevChat({ onClose, onMessagesSeen }: { onClose: () => void; onMessagesSeen?: Parameters<typeof DevChatDialog>[0]['onMessagesSeen'] }) {
  return createPortal(<DevChatDialog onClose={onClose} onMessagesSeen={onMessagesSeen} />, document.body);
}
