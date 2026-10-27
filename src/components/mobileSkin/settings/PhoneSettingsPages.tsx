// Sub pages of the phone Settings sheet: leave a note, diagnostics, cache reset with a confirmation
// that names exactly what goes, and the desktop settings pages shown as they are.
import { Suspense, lazy, useEffect, useState, type ComponentType } from 'react';
import { PhoneSheet } from '../sheets/PhoneSheet';
import { usePhoneRuntime } from '../runtime/PhoneRuntimeContext';
import { Logger } from '../../../services/logger';
import { submitSupportNote } from '../../../services/supportNoteService';
import { projectFileService } from '../../../services/projectFileService';
import { saveCurrentProject } from '../../../services/projectSync';
import { getActiveRepositorySession } from '../../../services/project/repository/lifecycle/editorRepositoryLifecycle';
import { clearAllCacheAndReloadConfirmed } from '../../common/toolbar/cacheActions';
import { blurTappedControl, PhoneStatusLine, usePhoneStatus } from '../library/phoneListUi';
import { collectPhoneDiagnostics, formatPhoneDiagnostics, type PhoneDiagnostics } from './phoneAppInfo';
import { PHONE_SETTINGS_TEST_IDS as IDS } from './phoneSettingsTestIds';
import '../../common/settings/SettingsDialog.css';

const log = Logger.create('PhoneSettings');

interface PageProps { onBack: () => void }

export function PhoneLeaveNotePage({ onBack }: PageProps) {
  const [message, setMessage] = useState('');
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const { status, report } = usePhoneStatus();
  const send = async () => {
    const text = message.trim();
    if (!text || sending) return;
    setSending(true);
    try {
      await submitSupportNote(text);
      setSent(true);
      setMessage('');
      report({ ok: true, message: 'Thanks, your note was sent.' });
    } catch (error) {
      log.warn('Support note failed', error);
      // The draft stays so a second try needs no retyping.
      report({ ok: false, message: `Not sent: ${error instanceof Error ? error.message : String(error)}. Your text is still here; try again.` });
    } finally {
      setSending(false);
    }
  };
  return (
    <PhoneSheet title="Leave a note" height="tall" onCancel={onBack} cancelLabel={sent ? 'Back' : 'Cancel'}
      onDone={() => void send()} doneLabel={sending ? 'Sending…' : 'Send'} doneDisabled={sending || message.trim().length === 0}>
      <div className="phone-lib" onPointerUpCapture={blurTappedControl}>
        <p className="phone-lib__note">Tell the developer what works, what does not, or what you miss. Nothing is sent until you tap Send.</p>
        <textarea className="phone-lib__textarea" data-testid={IDS.noteInput} value={message} maxLength={4000} aria-label="Your note"
          onChange={(event) => setMessage(event.target.value)} />
        <PhoneStatusLine status={status} testId={IDS.status} />
        <button type="button" className="phone-lib__button phone-lib__button--wide phone-lib__button--primary" data-testid={IDS.noteSend}
          aria-disabled={sending || message.trim().length === 0} onClick={() => void send()}>
          {sending ? 'Sending…' : 'Send'}
        </button>
      </div>
    </PhoneSheet>
  );
}

export function PhoneDiagnosticsPage({ onBack }: PageProps) {
  const { status: runtime } = usePhoneRuntime();
  const [diagnostics, setDiagnostics] = useState<PhoneDiagnostics | null>(null);
  const { status, report } = usePhoneStatus();
  useEffect(() => {
    let alive = true;
    void collectPhoneDiagnostics(runtime).then((next) => { if (alive) setDiagnostics(next); });
    return () => { alive = false; };
  }, [runtime]);
  const copy = async () => {
    if (!diagnostics) return;
    try {
      await navigator.clipboard.writeText(formatPhoneDiagnostics(diagnostics));
      report({ ok: true, message: 'Copied. Paste it into your note or issue.' });
    } catch {
      report({ ok: false, message: 'Copying is not allowed here. Select the text and copy it by hand.' });
    }
  };
  return (
    <PhoneSheet title="Diagnostics" height="tall" onCancel={onBack} cancelLabel="Back">
      <div className="phone-lib" onPointerUpCapture={blurTappedControl}>
        {diagnostics ? (
          <dl className="phone-lib__info" data-testid={IDS.diagnosticsRows}>
            {diagnostics.rows.map(([label, value]) => (
              <div key={label} style={{ display: 'contents' }}><dt>{label}</dt><dd>{value}</dd></div>
            ))}
          </dl>
        ) : <p className="phone-lib__note">Collecting…</p>}
        {diagnostics && diagnostics.errors.length > 0 && (
          <>
            <h3 className="phone-lib__section">Recent errors</h3>
            <ul className="phone-lib__usage">{diagnostics.errors.map((line, index) => <li key={index}>{line}</li>)}</ul>
          </>
        )}
        <p className="phone-lib__note">Addresses, keys and long ids are removed. Nothing leaves your phone unless you share it.</p>
        <PhoneStatusLine status={status} testId={IDS.status} />
        <button type="button" className="phone-lib__button phone-lib__button--wide" data-testid={IDS.diagnosticsCopy} onClick={() => void copy()}>
          Copy report
        </button>
      </div>
    </PhoneSheet>
  );
}

export function PhoneCacheResetPage({ onBack }: PageProps) {
  const [busy, setBusy] = useState(false);
  const { status, report } = usePhoneStatus();
  const reset = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const writable = getActiveRepositorySession()?.opening.writable !== false;
      if (projectFileService.isProjectOpen() && writable && !await saveCurrentProject({ source: 'manual' })) {
        report({ ok: false, message: 'The project could not be saved first, so nothing was cleared.' });
        setBusy(false);
        return;
      }
      await clearAllCacheAndReloadConfirmed();
    } catch (error) {
      log.error('Cache reset failed', error);
      report({ ok: false, message: `The reset did not finish: ${error instanceof Error ? error.message : String(error)}.` });
      setBusy(false);
    }
  };
  return (
    <PhoneSheet title="Reset caches" height="tall" onCancel={onBack}>
      <div className="phone-lib" onPointerUpCapture={blurTappedControl}>
        <p className="phone-lib__note">This clears on this device:</p>
        <ul className="phone-lib__usage">
          <li>your settings and preferences</li>
          <li>cached thumbnails, waveforms, analyses and media copies of old projects</li>
          <li>remembered folder access and saved integration keys</li>
          <li>the offline copy of the app</li>
        </ul>
        <p className="phone-lib__note">
          Kept: projects stored in this browser and in project folders. The open project is saved first, then the app reloads.
        </p>
        <PhoneStatusLine status={status} testId={IDS.status} />
        <button type="button" className="phone-lib__button phone-lib__button--wide phone-lib__button--danger" data-testid={IDS.cacheResetConfirm}
          aria-disabled={busy} onClick={() => void reset()}>
          {busy ? 'Saving and clearing…' : 'Clear and reload'}
        </button>
        <button type="button" className="phone-lib__button phone-lib__button--wide" data-testid={IDS.cacheResetKeep} onClick={onBack}>
          Keep everything
        </button>
      </div>
    </PhoneSheet>
  );
}

export interface PhoneDesktopSettingsPage {
  id: string;
  title: string;
  /** Why it stays greyed on a phone; omitted when it works. */
  limit?: string;
  load?: () => Promise<ComponentType>;
}

export const PHONE_DESKTOP_SETTINGS_PAGES: readonly PhoneDesktopSettingsPage[] = [
  { id: 'general', title: 'General', load: () => import('../../common/settings/GeneralSettings').then((m) => m.GeneralSettings) },
  { id: 'import', title: 'Import', load: () => import('../../common/settings/ImportSettings').then((m) => m.ImportSettings) },
  { id: 'audio', title: 'Audio', load: () => import('../../common/settings/AudioSettings').then((m) => m.AudioSettings) },
  { id: 'previews', title: 'Previews', load: () => import('../../common/settings/PreviewsSettings').then((m) => m.PreviewsSettings) },
  { id: 'performance', title: 'Performance', load: () => import('../../common/settings/PerformanceSettings').then((m) => m.PerformanceSettings) },
  { id: 'midi', title: 'MIDI', load: () => import('../../common/settings/MidiSettings').then((m) => m.MidiSettings) },
  { id: 'analytics', title: 'Usage statistics', load: () => import('../../common/settings/ProductAnalyticsSettings').then((m) => m.ProductAnalyticsSettings) },
  {
    id: 'nativeHelper', title: 'Native helper',
    limit: 'The native helper (fast decoding, web downloads with yt-dlp, MatAnyone2, MuScriptor) is a desktop program with Python and local models; neither iPhone Safari nor the Android app can install or run it, so the phone never tries to reach it. Export the project and continue on a computer for these steps.',
  },
];

export function PhoneDesktopSettingsView({ page, onBack }: PageProps & { page: PhoneDesktopSettingsPage }) {
  const [Content] = useState(() => (page.load ? lazy(() => page.load!().then((component) => ({ default: component }))) : null));
  return (
    <PhoneSheet title={page.title} height="tall" onCancel={onBack} cancelLabel="Back">
      <div className="phone-settings-desktop" data-testid={IDS.desktopPage} data-category={page.id}>
        <p className="phone-lib__note">Changes on this page apply right away, the same as in the full editor.</p>
        {Content && (
          <Suspense fallback={<p className="phone-lib__note">Loading…</p>}>
            <Content />
          </Suspense>
        )}
      </div>
    </PhoneSheet>
  );
}
