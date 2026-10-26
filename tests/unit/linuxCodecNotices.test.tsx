import { act, cleanup, fireEvent, render, renderHook, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LinuxCodecNotices } from '../../src/components/common/LinuxCodecNotices';
import { useLinuxAacExportNotice } from '../../src/components/export/useLinuxAacExportNotice';
import { InspectorSelect } from '../../src/components/inspector/InspectorSelect';
import {
  getLinuxCodecNoticeMessage,
  shouldShowLinuxCodecNotice,
} from '../../src/services/codecNotices/linuxCodecNoticePolicy';
import {
  reportLinuxCodecSupport,
  resetLinuxCodecNoticeLogForTests,
} from '../../src/services/codecNotices/linuxCodecNotices';
import { Logger } from '../../src/services/logger';
import { useLinuxCodecNoticeStore } from '../../src/stores/linuxCodecNoticeStore';
import { useUiSettingsStore } from '../../src/stores/uiSettingsStore';

function platform(os: string, userAgent = 'Mozilla/5.0 (X11; Linux x86_64) Chrome/141.0 Safari/537.36') {
  vi.spyOn(navigator, 'platform', 'get').mockReturnValue(os);
  vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue(userAgent);
}

const visibleIds = () => useLinuxCodecNoticeStore.getState().notices.map(({ id }) => id);

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  useLinuxCodecNoticeStore.setState({ notices: [] });
  useUiSettingsStore.setState({ dismissedCodecNotices: [] });
  resetLinuxCodecNoticeLogForTests();
});

describe('shouldShowLinuxCodecNotice', () => {
  it('shows on Linux when the browser check says unsupported', () => {
    expect(shouldShowLinuxCodecNotice({ platform: 'linux', supported: false, dismissed: false })).toBe(true);
  });

  it('stays hidden on Linux when the check says supported or has not answered', () => {
    expect(shouldShowLinuxCodecNotice({ platform: 'linux', supported: true, dismissed: false })).toBe(false);
    expect(shouldShowLinuxCodecNotice({ platform: 'linux', supported: null, dismissed: false })).toBe(false);
    expect(shouldShowLinuxCodecNotice({ platform: 'linux', supported: undefined, dismissed: false })).toBe(false);
  });

  it.each(['windows', 'macos', 'android', 'ios', 'other'] as const)('never shows on %s', (os) => {
    expect(shouldShowLinuxCodecNotice({ platform: os, supported: false, dismissed: false })).toBe(false);
  });

  it('stays hidden once dismissed', () => {
    expect(shouldShowLinuxCodecNotice({ platform: 'linux', supported: false, dismissed: true })).toBe(false);
  });
});

describe('Linux codec notice messages', () => {
  it('names the Opus fallback and the .mov route for AAC', () => {
    const { title, body } = getLinuxCodecNoticeMessage('aac-encode', { ffmpegAvailable: true });
    expect(title).toBe('AAC audio is not available in this browser on Linux.');
    expect(body).toContain('uses Opus audio in MP4');
    expect(body).toContain('.mov container');
    expect(getLinuxCodecNoticeMessage('aac-encode', { ffmpegAvailable: false }).body).not.toContain('.mov');
  });

  it('names the codec an H.265 setting falls back to', () => {
    expect(getLinuxCodecNoticeMessage('h265-encode', { fallbackCodec: 'H.264 (AVC)' }).body)
      .toContain('so this export uses H.264 (AVC).');
    expect(getLinuxCodecNoticeMessage('h265-decode', { sourceName: 'drone.mp4' }).body)
      .toContain('"drone.mp4" is decoded in software');
  });
});

describe('reportLinuxCodecSupport', () => {
  it('shows the banner on Linux and logs the fallback once', () => {
    platform('Linux x86_64');
    const logged = () => Logger.getBuffer('WARN')
      .filter(entry => entry.module === 'LinuxCodecNotice' && entry.message.startsWith('AAC audio'));
    const before = logged().length;
    expect(reportLinuxCodecSupport('aac-encode', false)).toBe(true);
    expect(reportLinuxCodecSupport('aac-encode', false)).toBe(true);
    expect(visibleIds()).toEqual(['aac-encode']);
    expect(logged().length - before).toBe(1);
  });

  it('shows nothing on Linux when the browser supports the codec', () => {
    platform('Linux x86_64');
    expect(reportLinuxCodecSupport('h265-encode', true)).toBe(false);
    expect(visibleIds()).toEqual([]);
  });

  it.each([
    ['Win32', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/141.0'],
    ['MacIntel', 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Chrome/141.0'],
    ['Linux armv8l', 'Mozilla/5.0 (Linux; Android 14; Pixel 8) Chrome/141.0 Mobile'],
  ])('shows nothing on %s', (os, agent) => {
    platform(os, agent);
    expect(reportLinuxCodecSupport('h265-decode', false, { sourceName: 'clip.mp4' })).toBe(false);
    expect(visibleIds()).toEqual([]);
  });

  it('keeps a dismissed notice closed, per codec, and persists the dismissal', () => {
    platform('Linux x86_64');
    reportLinuxCodecSupport('h265-encode', false);
    reportLinuxCodecSupport('aac-encode', false);
    render(<LinuxCodecNotices />);
    expect(screen.getByText('H.265 (HEVC) encoding is not available in this browser on Linux.')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Dismiss H.265 export notice' }));
    expect(screen.queryByText('H.265 (HEVC) encoding is not available in this browser on Linux.')).toBeNull();
    expect(screen.getByText('AAC audio is not available in this browser on Linux.')).toBeTruthy();
    expect(useUiSettingsStore.getState().dismissedCodecNotices).toEqual(['h265-encode']);
    expect(localStorage.getItem('masterselects-ui-settings')).toContain('h265-encode');

    act(() => { reportLinuxCodecSupport('h265-encode', false); });
    expect(visibleIds()).toEqual(['aac-encode']);
  });
});

describe('useLinuxAacExportNotice', () => {
  it('stays quiet for saved settings, shows on a choice, and withdraws when the choice is undone', () => {
    platform('Linux x86_64');
    const { rerender } = renderHook((props: Parameters<typeof useLinuxAacExportNotice>[0]) => useLinuxAacExportNotice(props), {
      initialProps: { usesBrowserMp4Audio: true, detectedAudioCodec: 'opus', ffmpegAvailable: true },
    });
    expect(visibleIds()).toEqual([]);

    rerender({ usesBrowserMp4Audio: false, detectedAudioCodec: 'opus', ffmpegAvailable: true });
    rerender({ usesBrowserMp4Audio: true, detectedAudioCodec: 'opus', ffmpegAvailable: true });
    expect(visibleIds()).toEqual(['aac-encode']);

    rerender({ usesBrowserMp4Audio: false, detectedAudioCodec: 'opus', ffmpegAvailable: true });
    expect(visibleIds()).toEqual([]);
    expect(useUiSettingsStore.getState().dismissedCodecNotices).toEqual([]);
  });

  it('waits for the audio check and shows nothing when AAC is supported', () => {
    platform('Linux x86_64');
    const { rerender } = renderHook((props: Parameters<typeof useLinuxAacExportNotice>[0]) => useLinuxAacExportNotice(props), {
      initialProps: { usesBrowserMp4Audio: false, detectedAudioCodec: null, ffmpegAvailable: true },
    });
    rerender({ usesBrowserMp4Audio: true, detectedAudioCodec: null, ffmpegAvailable: true });
    expect(visibleIds()).toEqual([]);
    rerender({ usesBrowserMp4Audio: true, detectedAudioCodec: 'aac', ffmpegAvailable: true });
    expect(visibleIds()).toEqual([]);
  });
});

describe('InspectorSelect unavailable options', () => {
  const options = (onUnavailableClick?: () => void) => [
    { label: 'H.264 (AVC)', value: 'h264' },
    { disabled: true, label: 'H.265 (HEVC)', onUnavailableClick, value: 'h265' },
  ];

  it('explains a disabled option on click without selecting it', () => {
    const onChange = vi.fn();
    const explain = vi.fn();
    render(<InspectorSelect ariaLabel="Video codec" onChange={onChange} options={options(explain)} value="h264" />);
    fireEvent.click(screen.getByRole('combobox', { name: 'Video codec' }));
    const h265 = screen.getByRole('option', { name: 'H.265 (HEVC)' });
    expect(h265).toHaveAttribute('aria-disabled', 'true');
    expect(h265).not.toBeDisabled();
    fireEvent.click(h265);
    expect(explain).toHaveBeenCalledTimes(1);
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  });

  it('keeps a disabled option without explanation natively disabled', () => {
    render(<InspectorSelect ariaLabel="Video codec" onChange={vi.fn()} options={options()} value="h264" />);
    fireEvent.click(screen.getByRole('combobox', { name: 'Video codec' }));
    expect(screen.getByRole('option', { name: 'H.265 (HEVC)' })).toBeDisabled();
  });
});
