// 'settings' sheet. Preferences (theme, custom colours, transcription provider, editing behaviour)
// are a draft: Done writes them, Cancel throws them away. Account, help, version, diagnostics and the
// cache reset are commands with their own pages; the desktop settings pages open as they are.
// Keyboard shortcuts stay greyed: they need a keyboard. The account dialogs are the app-wide ones
// (RootApp mounts AccountDialogHost for /m too).
import { useState } from 'react';
import type { PhoneSheetComponent } from '../contracts';
import { PhoneSheet } from '../sheets/PhoneSheet';
import { usePhoneUiStore } from '../state/phoneUiStore';
import { useSettingsStore } from '../../../stores/settingsStore';
import { isLegacyMobileDockLayoutEnabled } from '../../../stores/dockStore/legacyMobileLayout';
import { hasHostedAiSession, useAccountStore } from '../../../stores/accountStore';
import { reloadForAppUpdate } from '../../../services/appUpdate/reloadForAppUpdate';
import { blurTappedControl, PhoneStatusLine, usePhoneStatus } from '../library/phoneListUi';
import { checkPhoneAppUpdate, describePhoneBuild, type PhoneUpdateState } from './phoneAppInfo';
import {
  PHONE_RESOLVE_THEME, PHONE_THEMES, PHONE_TRANSCRIPTION_PROVIDERS, applyPhoneSettingsDraft, phoneTranscriptionAvailability,
  readPhoneSettingsDraft, type PhoneSettingsDraft,
} from './phoneSettingsModel';
import {
  PHONE_DESKTOP_SETTINGS_PAGES, PhoneCacheResetPage, PhoneDesktopSettingsView, PhoneDiagnosticsPage, PhoneLeaveNotePage,
  type PhoneDesktopSettingsPage,
} from './PhoneSettingsPages';
import { PHONE_SETTINGS_TEST_IDS as IDS } from './phoneSettingsTestIds';
import { PhoneIntegrationsPage } from './PhoneIntegrationsPage';
import { PhoneAssistantReplaySection, PhonePreviewDisplaySection, PhoneTouchInputSection } from './PhoneSettingsSections';
import { PhoneDevChat, PhoneInstallPage, PhoneLegalPage } from './PhoneHelpPages';
import { PHONE_HELP_TEST_IDS as HELP } from './phoneHelpTestIds';
import { useDevChatNotification } from '../../common/toolbar/useDevChatNotification';
import { resetPhoneWelcome } from '../home/phoneWelcome';
import { requestPhoneHome } from '../shell/phoneHomeRequests';
import '../library/PhoneLibrary.css';
import './PhoneSettings.css';

const ISSUE_URL = 'https://github.com/Sportinger/MasterSelects/issues/new/choose';
const DOCS_URL = 'https://www.masterselects.com/docs/';

type View = 'main' | 'note' | 'diagnostics' | 'cache' | 'integrations' | 'install' | 'legal' | PhoneDesktopSettingsPage;

function Toggle({ testId, label, hint, checked, onChange }: { testId: string; label: string; hint?: string; checked: boolean; onChange: (next: boolean) => void }) {
  return (
    <button type="button" role="switch" className="phone-settings__toggle" data-testid={testId} aria-checked={checked} onClick={() => onChange(!checked)}>
      <span>{label}{hint && <small>{hint}</small>}</span>
      <span className="phone-settings__state">{checked ? 'On' : 'Off'}</span>
    </button>
  );
}

export const PhoneSettingsSheet: PhoneSheetComponent = () => {
  const closeSheet = usePhoneUiStore((state) => state.closeSheet);
  const showUnavailable = usePhoneUiStore((state) => state.showUnavailable);
  const showToast = usePhoneUiStore((state) => state.showToast);
  const resolveUnlocked = useSettingsStore((state) => state.resolveThemeUnlocked);
  const hosted = useAccountStore((state) => hasHostedAiSession(state.session));
  const authenticated = useAccountStore((state) => state.session?.authenticated === true);
  const youtubeKeySaved = useSettingsStore((state) => state.youtubeApiKey.length > 0);
  const [draft, setDraft] = useState<PhoneSettingsDraft>(readPhoneSettingsDraft);
  const storedTranscription = phoneTranscriptionAvailability(draft.transcriptionProvider, hosted);
  const [view, setView] = useState<View>('main');
  const [update, setUpdate] = useState<PhoneUpdateState | null>(null);
  const [checking, setChecking] = useState(false);
  const [devChatOpen, setDevChatOpen] = useState(false);
  const devChat = useDevChatNotification({ paused: devChatOpen });
  const { status, report } = usePhoneStatus();
  const set = <K extends keyof PhoneSettingsDraft>(key: K, value: PhoneSettingsDraft[K]) => setDraft((current) => ({ ...current, [key]: value }));
  const back = () => setView('main');

  const done = () => {
    const written = applyPhoneSettingsDraft(draft);
    if (written > 0) showToast(`Saved ${written} setting${written === 1 ? '' : 's'}.`);
    closeSheet();
  };

  const openAccount = (kind: 'account' | 'redeem') => {
    const account = useAccountStore.getState();
    if (kind === 'redeem' && !authenticated) {
      report({ ok: true, message: 'Sign in first; the gift code field is in your account.' });
      account.openAuthDialog();
    } else {
      account.openAccountDialog();
    }
  };

  const checkUpdate = async () => {
    setChecking(true);
    setUpdate(await checkPhoneAppUpdate());
    setChecking(false);
  };

  // Same safe reload as the top bar's Update button: copies finish and the project is saved first.
  const reloadForUpdate = async () => {
    const outcome = await reloadForAppUpdate();
    if (outcome.status === 'export-running') report({ ok: false, message: 'An export is running. Update when it has finished.' });
    else if (outcome.status === 'save-failed') report({ ok: false, message: outcome.message });
  };

  if (view === 'note') return <PhoneLeaveNotePage onBack={back} />;
  if (view === 'diagnostics') return <PhoneDiagnosticsPage onBack={back} />;
  if (view === 'cache') return <PhoneCacheResetPage onBack={back} />;
  if (view === 'install') return <PhoneInstallPage onBack={back} />;
  if (view === 'legal') return <PhoneLegalPage onBack={back} />;
  if (view === 'integrations') {
    return <PhoneIntegrationsPage onBack={(message) => { if (message) report({ ok: true, message }); back(); }} />;
  }
  if (view !== 'main') return <PhoneDesktopSettingsView page={view} onBack={back} />;

  const midiAvailable = typeof navigator !== 'undefined' && 'requestMIDIAccess' in navigator;
  const themes = resolveUnlocked ? [PHONE_THEMES[0], PHONE_RESOLVE_THEME, ...PHONE_THEMES.slice(1)] : PHONE_THEMES;

  return (
    <PhoneSheet title="Settings" height="tall" onCancel={closeSheet} onDone={done}>
      <div className="phone-lib" data-testid={IDS.root} onPointerUpCapture={blurTappedControl}>
        <PhoneStatusLine status={status} testId={IDS.status} />

        <h3 className="phone-lib__section">Theme</h3>
        <div className="phone-settings__themes" role="group" aria-label="Theme">
          {themes.map((theme) => (
            <button key={theme.id} type="button" className="phone-settings__theme" data-testid={IDS.themeChip} data-theme={theme.id}
              aria-pressed={draft.theme === theme.id} onClick={() => set('theme', theme.id)}>
              <span className="phone-settings__swatch" style={{ background: theme.id === 'custom' ? `hsl(${draft.customHue},30%,${8 + draft.customBrightness * 0.6}%)` : theme.swatch }} />
              {theme.label}
            </button>
          ))}
        </div>
        {draft.theme === 'custom' && (
          <>
            <label className="phone-settings__slider">Hue
              <input type="range" min={0} max={360} value={draft.customHue} data-testid={IDS.customHue}
                onChange={(event) => set('customHue', Number(event.target.value))} />
              <span>{draft.customHue}°</span>
            </label>
            <label className="phone-settings__slider">Brightness
              <input type="range" min={0} max={100} value={draft.customBrightness} data-testid={IDS.customBrightness}
                onChange={(event) => set('customBrightness', Number(event.target.value))} />
              <span>{draft.customBrightness}</span>
            </label>
          </>
        )}
        <p className="phone-lib__note">The theme colours the full editor and its panels; Light, System on a light device and a bright Custom theme also make the phone screens light.</p>

        <h3 className="phone-lib__section">Transcription</h3>
        <div className="phone-settings__group" role="radiogroup" aria-label="Transcription provider">
          {PHONE_TRANSCRIPTION_PROVIDERS.map((provider) => {
            const availability = phoneTranscriptionAvailability(provider.id, hosted);
            // The mark stays on the stored engine, like in Captions: a hosted one without an account is
            // checked but greyed, and the note below says transcription waits (nothing falls back).
            const checked = draft.transcriptionProvider === provider.id;
            return (
              <button key={provider.id} type="button" role="radio" className="phone-settings__toggle phone-settings__radio" data-testid={IDS.transcription}
                data-provider={provider.id} aria-checked={checked} aria-disabled={!availability.ok}
                onClick={() => {
                  if (!availability.ok) { report({ ok: false, message: availability.reason }); return; }
                  set('transcriptionProvider', provider.id);
                }}>
                <span>{provider.label}<small>{availability.ok ? provider.description : `${provider.description} Needs sign-in.`}</small></span>
                <span className="phone-settings__radio-mark" aria-hidden="true" />
              </button>
            );
          })}
        </div>
        {storedTranscription.ok ? null : (
          <p className="phone-lib__note" data-testid={IDS.transcriptionNote}>
            {PHONE_TRANSCRIPTION_PROVIDERS.find((provider) => provider.id === draft.transcriptionProvider)?.label ?? 'This provider'} needs
            a signed-in account, so Captions will not transcribe until you sign in or choose On this device.
          </p>
        )}

        <h3 className="phone-lib__section">Editing</h3>
        <p className="phone-lib__note">On the phone a second tap on a clip deselects it and pinch keeps the playhead in place.</p>
        <Toggle testId={IDS.repeatDeselect} label="Second click deselects" hint="Full editor"
          checked={draft.deselectClipOnRepeatClick} onChange={(next) => set('deselectClipOnRepeatClick', next)} />
        <Toggle testId={IDS.zoomAnchor} label="Zoom around the playhead" hint="Full editor; off zooms around the pointer"
          checked={draft.timelineZoomAnchor === 'playhead'} onChange={(next) => set('timelineZoomAnchor', next ? 'playhead' : 'mouse')} />
        {/* The legacy Mobile dock layout is switched off (dockStore/legacyMobileLayout.ts): its toggle would do nothing. */}
        {isLegacyMobileDockLayoutEnabled() && (
          <Toggle testId={IDS.autoMobileLayout} label="Compact layout on small windows" hint="Full editor"
            checked={draft.automaticMobileLayoutEnabled} onChange={(next) => set('automaticMobileLayoutEnabled', next)} />
        )}
        <button type="button" className="phone-settings__toggle" data-testid={IDS.shortcuts} aria-disabled="true"
          onClick={() => showUnavailable({ actionId: 'settings-shortcuts', label: 'Keyboard shortcuts', reason: 'Keyboard shortcuts need a keyboard. Set them in the full editor on a computer.' })}>
          <span>Keyboard shortcuts<small>Needs a keyboard</small></span>
          <span className="phone-settings__state">›</span>
        </button>

        <PhoneTouchInputSection draft={draft} set={set} />
        <PhoneAssistantReplaySection draft={draft} set={set} />
        <PhonePreviewDisplaySection />

        <h3 className="phone-lib__section">Integrations</h3>
        <button type="button" className="phone-settings__toggle" data-testid={IDS.integrations} onClick={() => setView('integrations')}>
          <span>YouTube search key<small>{youtubeKeySaved ? 'Saved on this device' : 'Not set'}</small></span>
          <span className="phone-settings__state">›</span>
        </button>

        <h3 className="phone-lib__section">Account</h3>
        <div className="phone-lib__bar">
          <button type="button" className="phone-lib__button" data-testid={IDS.account} onClick={() => openAccount('account')}>
            {authenticated ? 'Account and credits' : 'Sign in'}
          </button>
          <button type="button" className="phone-lib__button" data-testid={IDS.redeem} onClick={() => openAccount('redeem')}>Redeem a gift</button>
        </div>

        <h3 className="phone-lib__section">Help</h3>
        <div className="phone-lib__bar">
          <button type="button" className="phone-lib__button" data-testid={IDS.leaveNote} onClick={() => setView('note')}>Leave a note</button>
          <a className="phone-lib__button" style={{ display: 'inline-flex', alignItems: 'center', textDecoration: 'none' }} data-testid={IDS.writeIssue}
            href={ISSUE_URL} target="_blank" rel="noopener noreferrer">Report an issue</a>
          <a className="phone-lib__button" style={{ display: 'inline-flex', alignItems: 'center', textDecoration: 'none' }} data-testid={IDS.docs}
            href={DOCS_URL} target="_blank" rel="noopener noreferrer">Guide</a>
          <button type="button" className="phone-lib__button" data-testid={IDS.tutorials} aria-disabled="true"
            onClick={() => showUnavailable({ actionId: 'settings-tutorials', label: 'Guided tours', reason: 'The guided tours point at the full editor’s controls. Open the Guide, or take the tour in the full editor.' })}>
            Guided tours
          </button>
        </div>
        <div className="phone-settings__group">
          <button type="button" className="phone-settings__toggle" data-testid={HELP.install} onClick={() => setView('install')}>
            <span>Install the app<small>Home screen icon</small></span>
            <span className="phone-settings__state">›</span>
          </button>
          <button type="button" className="phone-settings__toggle" data-testid={HELP.legal} onClick={() => setView('legal')}>
            <span>Legal and contact<small>Imprint, privacy, terms, cancel a contract</small></span>
            <span className="phone-settings__state">›</span>
          </button>
          <button type="button" className="phone-settings__toggle" data-testid={HELP.devChat} onClick={() => setDevChatOpen(true)}>
            <span>Chat with the developer<small>Write to the person who builds MasterSelects</small></span>
            <span className="phone-settings__state" data-testid={HELP.devChatUnread} data-unread={devChat.unreadCount}>
              {devChat.unreadCount > 0 ? `${devChat.unreadCount} new` : '›'}
            </span>
          </button>
          <button type="button" className="phone-settings__toggle" data-testid={HELP.welcomeAgain}
            onClick={() => { resetPhoneWelcome(); closeSheet(); requestPhoneHome(); }}>
            <span>Show the welcome again<small>On the home screen</small></span>
            <span className="phone-settings__state">›</span>
          </button>
        </div>

        <h3 className="phone-lib__section">App</h3>
        <p className="phone-lib__note" data-testid={IDS.version}>{describePhoneBuild()}</p>
        {update && <p className="phone-lib__status" data-tone={update.kind === 'unknown' ? 'error' : 'info'}>{update.message}</p>}
        <div className="phone-lib__bar">
          <button type="button" className="phone-lib__button" data-testid={IDS.checkUpdate} aria-disabled={checking} onClick={() => void checkUpdate()}>
            {checking ? 'Checking…' : 'Check for update'}
          </button>
          {update?.kind === 'available' && (
            <button type="button" className="phone-lib__button phone-lib__button--primary" data-testid={IDS.reloadUpdate} onClick={() => void reloadForUpdate()}>
              Save and reload
            </button>
          )}
          <button type="button" className="phone-lib__button" data-testid={IDS.diagnostics} onClick={() => setView('diagnostics')}>Diagnostics</button>
          <button type="button" className="phone-lib__button phone-lib__button--danger" data-testid={IDS.cacheReset} onClick={() => setView('cache')}>
            Reset caches
          </button>
        </div>

        <h3 className="phone-lib__section">More settings</h3>
        <div className="phone-settings__group">
          {PHONE_DESKTOP_SETTINGS_PAGES.map((page) => (
            <button key={page.id} type="button" className="phone-settings__toggle" data-testid={IDS.desktopCategory} data-category={page.id}
              aria-disabled={page.limit ? true : undefined}
              onClick={() => {
                if (page.limit) showUnavailable({ actionId: `settings-${page.id}`, label: page.title, reason: page.limit });
                else setView(page);
              }}>
              <span>{page.title}{page.limit ? <small>Not on the phone</small> : page.id === 'midi' ? (
                <small data-testid={IDS.midiAvailability}>{midiAvailable ? 'Web MIDI works in this browser' : 'No Web MIDI in this browser; mappings stay visible'}</small>
              ) : null}</span>
              <span className="phone-settings__state">›</span>
            </button>
          ))}
        </div>
      </div>
      {devChatOpen && <PhoneDevChat onClose={() => setDevChatOpen(false)} onMessagesSeen={devChat.markMessagesSeen} />}
    </PhoneSheet>
  );
};
