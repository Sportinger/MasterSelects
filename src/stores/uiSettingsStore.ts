import { create } from 'zustand';
import { persist, subscribeWithSelector } from 'zustand/middleware';

export type InterfaceFontFamily = 'system' | 'segoe' | 'arial' | 'verdana' | 'mono';
export type AudioLatencyHint = 'interactive' | 'balanced' | 'playback';
export type CaptureBitratePreset = 'balanced' | 'quality' | 'high';
export type CaptureScalePreset = '100' | '75' | '50' | '1080p';

export const DEFAULT_INTERFACE_TEXT_SCALE = 1;
export const MIN_INTERFACE_TEXT_SCALE = 0.9;
export const MAX_INTERFACE_TEXT_SCALE = 1.25;

export function clampInterfaceTextScale(value: number): number {
  if (!Number.isFinite(value)) {
    return DEFAULT_INTERFACE_TEXT_SCALE;
  }
  return Math.min(MAX_INTERFACE_TEXT_SCALE, Math.max(MIN_INTERFACE_TEXT_SCALE, value));
}

interface UiSettingsState {
  interfaceTextScale: number;
  interfaceFontFamily: InterfaceFontFamily;
  highReadabilityMode: boolean;
  audioOutputDeviceId: string;
  audioInputDeviceId: string;
  audioLatencyHint: AudioLatencyHint;
  captureFps: 30 | 60;
  captureBitratePreset: CaptureBitratePreset;
  captureScalePreset: CaptureScalePreset;
  captureCursorEnabled: boolean;
  captureMicrophoneEnabled: boolean;
  captureDisplayAudioEnabled: boolean;
  captureMuteCapturedTab: boolean;
  captureAutoPlaceOnTimeline: boolean;
  setInterfaceTextScale: (scale: number) => void;
  setInterfaceFontFamily: (fontFamily: InterfaceFontFamily) => void;
  setHighReadabilityMode: (enabled: boolean) => void;
  setAudioOutputDeviceId: (deviceId: string) => void;
  setAudioInputDeviceId: (deviceId: string) => void;
  setAudioLatencyHint: (hint: AudioLatencyHint) => void;
  setCaptureFps: (fps: 30 | 60) => void;
  setCaptureBitratePreset: (preset: CaptureBitratePreset) => void;
  setCaptureScalePreset: (preset: CaptureScalePreset) => void;
  setCaptureCursorEnabled: (enabled: boolean) => void;
  setCaptureMicrophoneEnabled: (enabled: boolean) => void;
  setCaptureDisplayAudioEnabled: (enabled: boolean) => void;
  setCaptureMuteCapturedTab: (enabled: boolean) => void;
  setCaptureAutoPlaceOnTimeline: (enabled: boolean) => void;
}

export const useUiSettingsStore = create<UiSettingsState>()(
  subscribeWithSelector(
    persist(
      (set) => ({
        interfaceTextScale: DEFAULT_INTERFACE_TEXT_SCALE,
        interfaceFontFamily: 'system',
        highReadabilityMode: false,
        audioOutputDeviceId: '',
        audioInputDeviceId: '',
        audioLatencyHint: 'interactive',
        captureFps: 30,
        captureBitratePreset: 'balanced',
        captureScalePreset: '100',
        captureCursorEnabled: true,
        captureMicrophoneEnabled: false,
        captureDisplayAudioEnabled: true,
        captureMuteCapturedTab: false,
        captureAutoPlaceOnTimeline: false,
        setInterfaceTextScale: (scale) => set({ interfaceTextScale: clampInterfaceTextScale(scale) }),
        setInterfaceFontFamily: (fontFamily) => set({ interfaceFontFamily: fontFamily }),
        setHighReadabilityMode: (enabled) => set({ highReadabilityMode: enabled }),
        setAudioOutputDeviceId: (deviceId) => set({ audioOutputDeviceId: deviceId }),
        setAudioInputDeviceId: (deviceId) => set({ audioInputDeviceId: deviceId }),
        setAudioLatencyHint: (hint) => set({ audioLatencyHint: hint }),
        setCaptureFps: (fps) => set({ captureFps: fps }),
        setCaptureBitratePreset: (preset) => set({ captureBitratePreset: preset }),
        setCaptureScalePreset: (preset) => set({ captureScalePreset: preset }),
        setCaptureCursorEnabled: (enabled) => set({ captureCursorEnabled: enabled }),
        setCaptureMicrophoneEnabled: (enabled) => set({ captureMicrophoneEnabled: enabled }),
        setCaptureDisplayAudioEnabled: (enabled) => set({ captureDisplayAudioEnabled: enabled }),
        setCaptureMuteCapturedTab: (enabled) => set({ captureMuteCapturedTab: enabled }),
        setCaptureAutoPlaceOnTimeline: (enabled) => set({ captureAutoPlaceOnTimeline: enabled }),
      }),
      {
        name: 'masterselects-ui-settings',
      },
    ),
  ),
);
