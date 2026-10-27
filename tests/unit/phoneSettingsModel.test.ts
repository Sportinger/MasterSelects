import { afterEach, describe, expect, it, vi } from 'vitest';
vi.unmock('../../src/stores/settingsStore');
import { comparePhoneBuild, sanitizePhoneLogLine } from '../../src/components/mobileSkin/settings/phoneAppInfo';
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
  it('compares the loaded build with the server build info', () => {
    expect(comparePhoneBuild({ version: '3.3.4', buildId: 'b1' }, { version: '3.3.4', buildId: 'b1' }).kind).toBe('current');
    expect(comparePhoneBuild({ version: '3.3.4', buildId: 'b1' }, { version: '3.3.5', buildId: 'b2' })).toMatchObject({ kind: 'available', serverVersion: '3.3.5' });
    expect(comparePhoneBuild({ version: '3.3.4', buildId: 'b1' }, null).kind).toBe('unknown');
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
