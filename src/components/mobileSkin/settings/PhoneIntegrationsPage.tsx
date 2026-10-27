// Integrations page of the phone Settings: the optional YouTube Data API key, stored exactly like the
// desktop does it (youtubeCredentialManager: obfuscated in this browser's IndexedDB next to its key, so
// not protected against anyone with access to this browser profile; never in a project archive; the
// settings store keeps it in memory). The copy says only what holds: kept in this browser. The field is a draft: Save writes it, Cancel keeps
// the old key. With a key, Library > Web sources searches YouTube inside the app.
import { useState } from 'react';
import { PhoneSheet } from '../sheets/PhoneSheet';
import { useSettingsStore } from '../../../stores/settingsStore';
import { blurTappedControl, PhoneStatusLine, usePhoneStatus } from '../library/phoneListUi';
import { PHONE_SETTINGS_TEST_IDS as IDS } from './phoneSettingsTestIds';
import { savePhoneYouTubeKey } from './phoneIntegrations';

const KEY_HELP_URL = 'https://console.cloud.google.com/apis/credentials';


export function PhoneIntegrationsPage({ onBack }: { onBack: (savedMessage?: string) => void }) {
  const saved = useSettingsStore((state) => state.youtubeApiKey);
  const [draft, setDraft] = useState(saved);
  const [visible, setVisible] = useState(false);
  const [busy, setBusy] = useState(false);
  const { status, report } = usePhoneStatus();

  const paste = async () => {
    try {
      const text = await navigator.clipboard.readText();
      if (!text.trim()) { report({ ok: false, message: 'The clipboard is empty.' }); return; }
      setDraft(text.trim());
    } catch {
      report({ ok: false, message: 'Pasting is not allowed here. Long-press the field and paste.' });
    }
  };

  const save = async () => {
    if (busy) return;
    if (draft.trim() === saved) { onBack(); return; }
    setBusy(true);
    const result = report(await savePhoneYouTubeKey(draft));
    setBusy(false);
    if (result.ok) onBack(result.message);
  };

  return (
    <PhoneSheet title="Integrations" height="tall" onCancel={() => onBack()} onDone={() => void save()} doneLabel={busy ? 'Saving…' : 'Save'} doneDisabled={busy}>
      <div className="phone-lib" data-testid={IDS.integrationsPage} onPointerUpCapture={blurTappedControl}>
        <p className="phone-lib__note">
          MasterSelects AI uses your account, not keys. The optional YouTube Data API key lets the Library search YouTube inside the app;
          it is kept only in this browser and never goes into a project file.
        </p>
        <h3 className="phone-lib__section">YouTube Data API v3 key</h3>
        <p className="phone-lib__note" data-testid={IDS.youtubeKeyState}>{saved ? 'A key is saved on this device.' : 'No key saved.'}</p>
        <div className="phone-settings__key">
          <input className="phone-lib__input" data-testid={IDS.youtubeKey} type={visible ? 'text' : 'password'} value={draft}
            placeholder="Paste your API key" autoComplete="off" autoCapitalize="off" spellCheck={false} aria-label="YouTube API key"
            onChange={(event) => setDraft(event.target.value)} />
          <button type="button" className="phone-lib__button" data-testid={IDS.youtubeKeyShow} aria-pressed={visible} onClick={() => setVisible(!visible)}>
            {visible ? 'Hide' : 'Show'}
          </button>
        </div>
        <div className="phone-lib__bar">
          <button type="button" className="phone-lib__button" data-testid={IDS.youtubeKeyPaste} onClick={() => void paste()}>Paste</button>
          <button type="button" className="phone-lib__button" data-testid={IDS.youtubeKeyClear} aria-disabled={draft.length === 0}
            onClick={() => setDraft('')}>Clear</button>
          <a className="phone-lib__button" style={{ display: 'inline-flex', alignItems: 'center', textDecoration: 'none' }}
            href={KEY_HELP_URL} target="_blank" rel="noopener noreferrer">Get a key</a>
        </div>
        <PhoneStatusLine status={status} testId={IDS.status} />
      </div>
    </PhoneSheet>
  );
}
