import { describe, expect, it, vi } from 'vitest';
vi.unmock('../../src/stores/settingsStore');
vi.mock('../../src/services/youtubeCredentialManager', () => ({
  youtubeCredentialManager: { store: vi.fn(async (key: string) => { if (key === 'fail') throw new Error('storage blocked'); }) },
}));
import {
  applyPhoneSettingsDraft, parsePhoneBudget, phoneBudgetUnitFor, readPhoneSettingsDraft,
} from '../../src/components/mobileSkin/settings/phoneSettingsModel';
import { savePhoneYouTubeKey } from '../../src/components/mobileSkin/settings/phoneIntegrations';
import { youtubeCredentialManager } from '../../src/services/youtubeCredentialManager';
import { useSettingsStore } from '../../src/stores/settingsStore';
import { parsePhoneWebUrl, phonePlatformSearchUrl, searchPhoneYouTube } from '../../src/components/mobileSkin/library/phoneWebSearch';

describe('phone settings: input display and assistant replay', () => {
  it('writes the touch display, its clamped size and the replay preferences to the shared settings', () => {
    const draft = readPhoneSettingsDraft();
    const written = applyPhoneSettingsDraft({
      ...draft, showShortcutDisplay: !draft.showShortcutDisplay, shortcutDisplayScale: 9, replayMode: 'full', replayBudgetMs: 120_000, replayCompression: 'none',
    });
    expect(written).toBe(5);
    const state = useSettingsStore.getState();
    expect(state.showShortcutDisplay).toBe(!draft.showShortcutDisplay);
    expect(state.shortcutDisplayScale).toBe(2);
    expect(state.guidedActionReplayVisualizationMode).toBe('full');
    expect(state.guidedActionReplayBudgetMs).toBe(120_000);
    expect(state.guidedActionReplayCompressionMode).toBe('none');
  });

  it('parses the replay time in its unit and keeps the old value for invalid text', () => {
    expect(parsePhoneBudget('3', 's', 1)).toBe(3000);
    expect(parsePhoneBudget('1,5', 'min', 1)).toBe(90_000);
    expect(parsePhoneBudget('', 's', 4000)).toBe(4000);
    expect(parsePhoneBudget('-2', 's', 4000)).toBe(4000);
    expect(parsePhoneBudget('0', 'h', 4000)).toBe(0);
    expect(phoneBudgetUnitFor(3000)).toBe('s');
    expect(phoneBudgetUnitFor(7_200_000)).toBe('h');
    expect(phoneBudgetUnitFor(1500)).toBe('ms');
    expect(phoneBudgetUnitFor(0)).toBe('s');
  });
});

describe('phone integrations', () => {
  it('stores the YouTube key through the desktop credential manager, and only then in the settings store', async () => {
    useSettingsStore.setState({ youtubeApiKey: 'old' });
    await expect(savePhoneYouTubeKey('  new-key  ')).resolves.toMatchObject({ ok: true });
    expect(youtubeCredentialManager.store).toHaveBeenCalledWith('new-key');
    expect(useSettingsStore.getState().youtubeApiKey).toBe('new-key');
    const failed = await savePhoneYouTubeKey('fail');
    expect(failed).toMatchObject({ ok: false, message: expect.stringContaining('storage blocked') });
    expect(useSettingsStore.getState().youtubeApiKey).toBe('new-key');
    await expect(savePhoneYouTubeKey('')).resolves.toMatchObject({ ok: true, message: expect.stringContaining('removed') });
    expect(useSettingsStore.getState().youtubeApiKey).toBe('');
  });
});

describe('phone web sources', () => {
  it('builds platform search URLs and accepts only web links', () => {
    expect(phonePlatformSearchUrl('youtube', ' cats & dogs ')).toBe('https://www.youtube.com/results?search_query=cats%20%26%20dogs');
    expect(phonePlatformSearchUrl('tiktok', 'a')).toBe('https://www.tiktok.com/search?q=a');
    expect(phonePlatformSearchUrl('instagram', 'a')).toContain('instagram.com/explore/search/keyword/?q=a');
    expect(parsePhoneWebUrl('youtu.be/abc')).toBe('https://youtu.be/abc');
    expect(parsePhoneWebUrl('javascript:alert(1)')).toBeNull();
    expect(parsePhoneWebUrl('   ')).toBeNull();
  });

  it('searches YouTube with the key and reports the API error message', async () => {
    const ok = vi.fn(async () => new Response(JSON.stringify({ items: [{ id: { videoId: 'v1' }, snippet: { title: 'T', channelTitle: 'C' } }, { id: {} }] }), { status: 200 }));
    const results = await searchPhoneYouTube('q', 'k e y', ok as unknown as typeof fetch);
    expect(results).toEqual([{ id: 'v1', title: 'T', channel: 'C', thumbnail: '', url: 'https://www.youtube.com/watch?v=v1' }]);
    expect(String((ok.mock.calls[0] as unknown[])[0])).toContain('key=k%20e%20y');
    const bad = vi.fn(async () => new Response(JSON.stringify({ error: { message: 'API key not valid' } }), { status: 400 }));
    await expect(searchPhoneYouTube('q', 'x', bad as unknown as typeof fetch)).rejects.toThrow('API key not valid');
  });
});
