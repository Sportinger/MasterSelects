import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';

import { useSettingsStore } from '../../src/stores/settingsStore';
import { ApiKeysSettings } from '../../src/components/common/settings/ApiKeysSettings';

const mockedUseSettingsStore = useSettingsStore as unknown as Mock;

describe('ElevenLabs API key settings UI', () => {
  beforeEach(() => {
    mockedUseSettingsStore.mockImplementation((selector: (state: {
      apiKeys: Record<string, string>;
      apiKeyDefaults: Record<string, boolean>;
      setApiKeyDefault: (provider: string, enabled: boolean) => void;
    }) => unknown) => selector({
      apiKeys: {
        openai: '',
        anthropic: '',
        assemblyai: '',
        deepgram: '',
        piapi: '',
        kieai: '',
        evolink: '',
        elevenlabs: '',
        youtube: '',
        klingAccessKey: '',
        klingSecretKey: '',
      },
      apiKeyDefaults: {
        openai: false,
        anthropic: false,
        piapi: false,
        kieai: false,
        evolink: false,
        elevenlabs: false,
      },
      setApiKeyDefault: vi.fn(),
    }));
  });

  it('renders an ElevenLabs row and reports changes through the settings save path', () => {
    const onKeyChange = vi.fn();

    render(<ApiKeysSettings localKeys={{ elevenlabs: '' }} onKeyChange={onKeyChange} />);

    expect(screen.getByText('AI Audio Generation')).toBeInTheDocument();
    const input = screen.getByPlaceholderText('Enter ElevenLabs API key...');

    fireEvent.change(input, { target: { value: 'el-api-key' } });

    expect(onKeyChange).toHaveBeenCalledWith('elevenlabs', 'el-api-key');
  });

  it('renders an EvoLink row and reports changes through the settings save path', () => {
    const onKeyChange = vi.fn();

    render(<ApiKeysSettings localKeys={{ evolink: '' }} onKeyChange={onKeyChange} />);

    const input = screen.getByPlaceholderText('Enter EvoLink API key...');

    fireEvent.change(input, { target: { value: 'ev-api-key' } });

    expect(onKeyChange).toHaveBeenCalledWith('evolink', 'ev-api-key');
  });
});
