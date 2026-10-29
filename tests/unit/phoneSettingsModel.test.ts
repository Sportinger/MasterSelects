import { afterEach, describe, expect, it, vi } from 'vitest';
vi.unmock('../../src/stores/settingsStore');
import { checkPhoneAppUpdate, describePhoneUpdateOutcome, sanitizePhoneLogLine } from '../../src/components/mobileSkin/settings/phoneAppInfo';
import { applyPhoneSettingsDraft, phoneTranscriptionAvailability, readPhoneSettingsDraft } from '../../src/components/mobileSkin/settings/phoneSettingsModel';
import { useSettingsStore } from '../../src/stores/settingsStore';
import { CACHE_RESET_DATABASES, clearAllCacheAndReload } from '../../src/components/common/toolbar/cacheActions';

describe('phone settings draft', () => {
  it('writes only changed fields and nothing on an unchanged draft', () => {
    useSettingsStore.getState().setTheme('dark');
    useSettingsStore.getState().setTranscriptionProvider('local');
    const draft = readPhoneSettingsDraft();
    expect(applyPhoneSettingsDraft(draft)).toBe(0);
    expect(applyPhoneSettingsDraft({ ...draft, theme: 'midnight', customHue: 42 })).toBe(2);
    expect(useSettingsStore.getState().theme).toBe('midnight');
    expect(useSettingsStore.getState().customHue).toBe(42);
    expect(useSettingsStore.getState().transcriptionProvider).toBe('local');
  });

  it('explains why a hosted provider needs an account', () => {
    expect(phoneTranscriptionAvailability('local', false).ok).toBe(true);
    expect(phoneTranscriptionAvailability('openai', true).ok).toBe(true);
    expect(phoneTranscriptionAvailability('deepgram', false)).toEqual({ ok: false, reason: expect.stringContaining('Sign in') });
  });
});

describe('phone app info', () => {
  it('describes each answer of the shared update check', () => {
    expect(describePhoneUpdateOutcome({ kind: 'current' }, '3.3.4')).toEqual({ kind: 'current', message: 'You have the latest version (3.3.4).' });
    expect(describePhoneUpdateOutcome({ kind: 'available', version: '3.3.5' })).toMatchObject({ kind: 'available', serverVersion: '3.3.5' });
    expect(describePhoneUpdateOutcome({ kind: 'failed', cause: 'no-build-info', message: 'x' }).message).toContain('no build info');
    expect(describePhoneUpdateOutcome({ kind: 'failed', cause: 'unreachable', message: 'x' }).message).toContain('needs a connection');
    expect(describePhoneUpdateOutcome({ kind: 'disabled' })).toEqual({ kind: 'unknown', message: 'Update checks are off in this browser.' });
  });

  it('checks through the shared checker, so a found version reaches the top bar and the other tabs', async () => {
    const checkNow = vi.fn(async () => ({ kind: 'available', version: '3.3.5' }) as const);
    await expect(checkPhoneAppUpdate({ checkNow })).resolves.toMatchObject({ kind: 'available', serverVersion: '3.3.5' });
    expect(checkNow).toHaveBeenCalledTimes(1);
  });

  it('removes query strings, tokens and long ids from diagnostics lines', () => {
    const line = sanitizePhoneLogLine('GET https://x.test/a?token=abc failed token=secret id 0123456789abcdef0123456789abcdef');
    expect(line).toBe('GET https://x.test/a failed token [hidden] id [id]');
  });
});

describe('cache reset split (editor root change)', () => {
  afterEach(() => vi.unstubAllGlobals());
  it('the confirming variant does nothing when the person cancels', async () => {
    const deleteDatabase = vi.fn();
    vi.stubGlobal('confirm', vi.fn(() => false));
    vi.stubGlobal('indexedDB', { deleteDatabase });
    await clearAllCacheAndReload();
    expect(deleteDatabase).not.toHaveBeenCalled();
    expect(CACHE_RESET_DATABASES).toContain('MASterSelectsDB');
  });
});
