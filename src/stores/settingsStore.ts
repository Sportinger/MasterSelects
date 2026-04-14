// Settings store for API keys and app configuration
// Global settings persisted in browser localStorage
// API keys stored encrypted in IndexedDB via apiKeyManager

import { create } from 'zustand';
import { subscribeWithSelector, persist } from 'zustand/middleware';
import { apiKeyManager, type ApiKeyType } from '../services/apiKeyManager';
import { projectFileService } from '../services/project/ProjectFileService';
import { flags } from '../engine/featureFlags';
import { Logger } from '../services/logger';
import type { ShortcutPresetId, ShortcutMap, KeyCombo, ShortcutActionId, CustomShortcutPreset } from '../services/shortcutTypes';
import { PRESETS, DEFAULT_PRESET_ID } from '../services/shortcutPresets';
const log = Logger.create('SettingsStore');

function persistChangelogStateToProject(
  showChangelogOnStartup: boolean,
  lastSeenChangelogVersion: string | null,
): void {
  if (!projectFileService.isProjectOpen()) {
    return;
  }

  const projectData = projectFileService.getProjectData();
  if (!projectData) {
    return;
  }

  projectData.uiState = {
    ...projectData.uiState,
    showChangelogOnStartup,
    lastSeenChangelogVersion,
  };

  projectFileService.markDirty();
  void projectFileService.saveProject().catch((err) => {
    log.error('Failed to persist changelog state to project:', err);
  });
}

// Theme mode options
export type ThemeMode = 'dark' | 'light' | 'midnight' | 'system' | 'crazy' | 'custom';

// Transcription provider options
export type TranscriptionProvider = 'local' | 'openai' | 'assemblyai' | 'deepgram';

// Preview quality options (multiplier on base resolution)
export type PreviewQuality = 1 | 0.5 | 0.25;

// GPU power preference options
export type GPUPowerPreference = 'high-performance' | 'low-power';

interface APIKeys {
  openai: string;
  assemblyai: string;
  deepgram: string;
  piapi: string;  // PiAPI key for AI video generation (Kling, Luma, etc.)
  kieai: string;  // Kie.ai key for Kling 3.0 and Nano Banana 2
  youtube: string; // YouTube Data API v3 key (optional, Invidious works without)
  // Legacy Kling keys (deprecated, use piapi instead)
  klingAccessKey: string;
  klingSecretKey: string;
}

// Autosave interval options (in minutes)
export type AutosaveInterval = 1 | 2 | 5 | 10;

// Save mode: continuous saves on every change (debounced), interval saves on a timer
export type SaveMode = 'continuous' | 'interval';

interface SettingsState {
  // Theme
  theme: ThemeMode;
  customHue: number;        // 0-360 hue for custom theme
  customBrightness: number; // 0-100 brightness (0=dark, 100=light)

  // API Keys
  apiKeys: APIKeys;

  // Transcription settings
  transcriptionProvider: TranscriptionProvider;

  // Preview settings
  previewQuality: PreviewQuality;
  showTransparencyGrid: boolean;  // Show checkerboard pattern for transparent areas

  // Save settings
  saveMode: SaveMode;  // 'continuous' = save on every change, 'interval' = save on timer
  autosaveEnabled: boolean;  // legacy — derived from saveMode for compat
  autosaveInterval: AutosaveInterval;  // in minutes (only used in interval mode)

  // Native Helper (Turbo Mode)
  turboModeEnabled: boolean;  // Connect to native helper (downloads, yt-dlp)
  nativeDecodeEnabled: boolean;  // Use native FFmpeg decode/encode (Turbo decode)
  nativeHelperPort: number;   // WebSocket port (default 9876)
  nativeHelperConnected: boolean;  // Current connection status

  // Mobile/Desktop view
  forceDesktopMode: boolean;  // Show desktop UI even on mobile devices

  // GPU preference
  gpuPowerPreference: GPUPowerPreference;  // 'high-performance' (dGPU) or 'low-power' (iGPU)

  // AI Features
  matanyoneEnabled: boolean;      // Enable MatAnyone2 video matting
  matanyonePythonPath: string;    // Python path ('' = auto-detect)

  // AI approval mode for tool execution
  aiApprovalMode: 'auto' | 'confirm-destructive' | 'confirm-all-mutating';

  // Media import settings
  copyMediaToProject: boolean;  // Copy imported files to project Raw/ folder

  // First-run state
  hasCompletedSetup: boolean;
  hasSeenTutorial: boolean;
  hasSeenTutorialPart2: boolean;
  hasSeenAIChatOnboarding: boolean;

  // User background (which program they come from)
  userBackground: string | null;

  // Keyboard shortcuts
  activeShortcutPreset: ShortcutPresetId;
  shortcutOverrides: Partial<ShortcutMap> | null;
  customPresets: CustomShortcutPreset[];

  // Tutorial campaign completion tracking
  completedTutorials: string[];

  // Changelog settings
  showChangelogOnStartup: boolean;
  lastSeenChangelogVersion: string | null;

  // Playback engine mode
  webCodecsEnabled: boolean;  // true = WebCodecs, false = HTML Video

  // UI state
  isSettingsOpen: boolean;

  // Output settings
  // Default resolution for new compositions (active composition drives the engine)
  outputResolution: { width: number; height: number };
  fps: number;

  // Actions
  setTheme: (theme: ThemeMode) => void;
  setCustomHue: (hue: number) => void;
  setCustomBrightness: (brightness: number) => void;
  setApiKey: (provider: keyof APIKeys, key: string) => void;
  setTranscriptionProvider: (provider: TranscriptionProvider) => void;
  setPreviewQuality: (quality: PreviewQuality) => void;
  setShowTransparencyGrid: (show: boolean) => void;
  setSaveMode: (mode: SaveMode) => void;
  setAutosaveEnabled: (enabled: boolean) => void;
  setAutosaveInterval: (interval: AutosaveInterval) => void;
  setTurboModeEnabled: (enabled: boolean) => void;
  setNativeDecodeEnabled: (enabled: boolean) => void;
  setNativeHelperPort: (port: number) => void;
  setNativeHelperConnected: (connected: boolean) => void;
  setForceDesktopMode: (force: boolean) => void;
  setGpuPowerPreference: (preference: GPUPowerPreference) => void;
  setMatAnyoneEnabled: (enabled: boolean) => void;
  setMatAnyonePythonPath: (path: string) => void;
  setAiApprovalMode: (mode: 'auto' | 'confirm-destructive' | 'confirm-all-mutating') => void;
  setCopyMediaToProject: (enabled: boolean) => void;
  setHasCompletedSetup: (completed: boolean) => void;
  setHasSeenTutorial: (seen: boolean) => void;
  setHasSeenTutorialPart2: (seen: boolean) => void;
  setHasSeenAIChatOnboarding: (seen: boolean) => void;
  setUserBackground: (bg: string) => void;
  // Shortcut actions
  setActiveShortcutPreset: (preset: ShortcutPresetId) => void;
  setShortcutOverride: (action: ShortcutActionId, combos: KeyCombo[]) => void;
  clearShortcutOverride: (action: ShortcutActionId) => void;
  resetShortcutsToPreset: () => void;
  saveCustomPreset: (name: string) => void;
  loadCustomPreset: (name: string) => void;
  deleteCustomPreset: (name: string) => void;
  completeTutorial: (campaignId: string) => void;
  setShowChangelogOnStartup: (show: boolean) => void;
  setLastSeenChangelogVersion: (version: string | null) => void;
  markChangelogSeen: (version: string) => void;
  setWebCodecsEnabled: (enabled: boolean) => void;
  openSettings: () => void;
  closeSettings: () => void;
  toggleSettings: () => void;

  // Output actions
  setResolution: (width: number, height: number) => void;

  // Helpers
  getActiveApiKey: () => string | null;
  hasApiKey: (provider: keyof APIKeys) => boolean;

  // API key persistence (encrypted in IndexedDB)
  loadApiKeys: () => Promise<void>;
}

export const useSettingsStore = create<SettingsState>()(
  subscribeWithSelector(
    persist(
      (set, get) => ({
      // Initial state
      theme: 'dark' as ThemeMode,
      customHue: 210,       // Default: blue
      customBrightness: 15, // Default: dark
      apiKeys: {
        openai: '',
        assemblyai: '',
        deepgram: '',
        piapi: '',
        kieai: '',
        youtube: '',
        klingAccessKey: '',
        klingSecretKey: '',
      },
      transcriptionProvider: 'local',
      previewQuality: 1, // Full quality by default
      showTransparencyGrid: false, // Don't show checkerboard by default
      saveMode: 'continuous' as SaveMode, // Continuous save by default — every change saved automatically
      autosaveEnabled: true, // Legacy compat (interval mode uses this)
      autosaveInterval: 5, // 5 minutes default interval (only used in interval mode)
      turboModeEnabled: true, // Connect to native helper by default (downloads)
      nativeDecodeEnabled: false, // Native FFmpeg decode off by default
      nativeHelperPort: 9876, // Default WebSocket port
      nativeHelperConnected: false, // Not connected initially
      forceDesktopMode: false, // Use responsive detection by default
      gpuPowerPreference: 'high-performance', // Prefer dGPU by default
      matanyoneEnabled: false, // MatAnyone2 disabled by default
      matanyonePythonPath: '', // Auto-detect Python path
      aiApprovalMode: 'confirm-destructive' as const, // Require confirmation for destructive AI actions
      copyMediaToProject: true, // Copy imported files to Raw/ folder by default
      hasCompletedSetup: false, // Show welcome overlay on first run
      hasSeenTutorial: false, // Show tutorial on first run
      hasSeenTutorialPart2: false, // Show timeline tutorial after part 1
      hasSeenAIChatOnboarding: false, // Show AI chat onboarding hint on first open
      userBackground: null, // Which program the user comes from
      activeShortcutPreset: DEFAULT_PRESET_ID as ShortcutPresetId,
      shortcutOverrides: null,
      customPresets: [] as CustomShortcutPreset[],
      completedTutorials: [], // Campaign IDs that have been completed
      showChangelogOnStartup: true, // Show changelog dialog on every startup
      lastSeenChangelogVersion: null, // Latest app version whose changelog was acknowledged
      webCodecsEnabled: false, // Default to HTML Video
      isSettingsOpen: false,

      // Output settings
      outputResolution: { width: 1920, height: 1080 },
      fps: 60,

      // Actions
      setTheme: (theme) => set({ theme }),
      setCustomHue: (hue) => set({ customHue: hue }),
      setCustomBrightness: (brightness) => set({ customBrightness: brightness }),

      setApiKey: (provider, key) => {
        set((state) => ({
          apiKeys: {
            ...state.apiKeys,
            [provider]: key,
          },
        }));
        // Save to encrypted IndexedDB + project file
        apiKeyManager.storeKeyByType(provider as ApiKeyType, key)
          .then(() => {
            // Also update .keys.enc in the project folder if a project is open
            if (projectFileService.isProjectOpen()) {
              return projectFileService.saveKeysFile();
            }
          })
          .catch((err) => {
            log.error('Failed to save API key:', err);
          });
      },

      setTranscriptionProvider: (provider) => {
        set({ transcriptionProvider: provider });
      },

      setPreviewQuality: (quality) => {
        set({ previewQuality: quality });
      },

      setShowTransparencyGrid: (show) => {
        set({ showTransparencyGrid: show });
      },

      setSaveMode: (mode) => {
        set({ saveMode: mode });
      },

      setAutosaveEnabled: (enabled) => {
        set({ autosaveEnabled: enabled });
      },

      setAutosaveInterval: (interval) => {
        set({ autosaveInterval: interval });
      },

      setTurboModeEnabled: (enabled) => {
        set({ turboModeEnabled: enabled });
      },

      setNativeDecodeEnabled: (enabled) => {
        set({ nativeDecodeEnabled: enabled });
      },

      setNativeHelperPort: (port) => {
        set({ nativeHelperPort: port });
      },

      setNativeHelperConnected: (connected) => {
        set({ nativeHelperConnected: connected });
      },

      setForceDesktopMode: (force) => {
        set({ forceDesktopMode: force });
      },

      setGpuPowerPreference: (preference) => {
        set({ gpuPowerPreference: preference });
      },

      setMatAnyoneEnabled: (enabled) => {
        set({ matanyoneEnabled: enabled });
      },

      setMatAnyonePythonPath: (path) => {
        set({ matanyonePythonPath: path });
      },

      setAiApprovalMode: (mode) => {
        set({ aiApprovalMode: mode });
      },

      setCopyMediaToProject: (enabled) => {
        set({ copyMediaToProject: enabled });
      },

      setHasCompletedSetup: (completed) => {
        set({ hasCompletedSetup: completed });
      },

      setHasSeenTutorial: (seen) => {
        set({ hasSeenTutorial: seen });
      },

      setHasSeenTutorialPart2: (seen) => {
        set({ hasSeenTutorialPart2: seen });
      },

      setHasSeenAIChatOnboarding: (seen) => {
        set({ hasSeenAIChatOnboarding: seen });
      },

      setUserBackground: (bg) => {
        set({ userBackground: bg });
      },

      setActiveShortcutPreset: (preset) => {
        set({ activeShortcutPreset: preset, shortcutOverrides: null });
      },

      setShortcutOverride: (action, combos) => {
        const current = get().shortcutOverrides || {};
        set({ shortcutOverrides: { ...current, [action]: combos } });
      },

      clearShortcutOverride: (action) => {
        const current = get().shortcutOverrides;
        if (!current) return;
        const next = { ...current };
        delete next[action as keyof typeof next];
        set({ shortcutOverrides: Object.keys(next).length > 0 ? next : null });
      },

      resetShortcutsToPreset: () => {
        set({ shortcutOverrides: null });
      },

      saveCustomPreset: (name) => {
        const state = get();
        const presetId = state.activeShortcutPreset || DEFAULT_PRESET_ID;
        const preset = PRESETS[presetId] || PRESETS[DEFAULT_PRESET_ID];
        const effectiveMap = state.shortcutOverrides
          ? { ...preset.map, ...state.shortcutOverrides } as ShortcutMap
          : { ...preset.map };
        const existing = state.customPresets.filter((p) => p.name !== name);
        set({
          customPresets: [
            ...existing,
            { name, map: effectiveMap, createdAt: Date.now() },
          ],
        });
      },

      loadCustomPreset: (name) => {
        const custom = get().customPresets.find((p) => p.name === name);
        if (!custom) return;
        // Store the full map as overrides on top of current preset
        set({ shortcutOverrides: custom.map });
      },

      deleteCustomPreset: (name) => {
        set({ customPresets: get().customPresets.filter((p) => p.name !== name) });
      },

      completeTutorial: (campaignId) => {
        const current = get().completedTutorials;
        if (!current.includes(campaignId)) {
          set({ completedTutorials: [...current, campaignId] });
        }
      },

      setShowChangelogOnStartup: (show) => {
        set({ showChangelogOnStartup: show });
        persistChangelogStateToProject(show, get().lastSeenChangelogVersion);
      },
      setLastSeenChangelogVersion: (version) => {
        set({ lastSeenChangelogVersion: version });
        persistChangelogStateToProject(get().showChangelogOnStartup, version);
      },
      markChangelogSeen: (version) => {
        set({ lastSeenChangelogVersion: version });
        persistChangelogStateToProject(get().showChangelogOnStartup, version);
      },
      setWebCodecsEnabled: (enabled: boolean) => {
        flags.useFullWebCodecsPlayback = enabled;
        flags.disableHtmlPreviewFallback = enabled;
        set({ webCodecsEnabled: enabled });
      },
      openSettings: () => set({ isSettingsOpen: true }),
      closeSettings: () => set({ isSettingsOpen: false }),
      toggleSettings: () => set((state) => ({ isSettingsOpen: !state.isSettingsOpen })),

      // Output actions
      setResolution: (width, height) => {
        set({ outputResolution: { width, height } });
      },

      // Helpers
      getActiveApiKey: () => {
        const { transcriptionProvider, apiKeys } = get();
        if (transcriptionProvider === 'local') return null;
        return apiKeys[transcriptionProvider] || null;
      },

      hasApiKey: (provider) => {
        return !!get().apiKeys[provider];
      },

      // Load API keys from encrypted IndexedDB (call on app startup)
      // Falls back to .keys.enc in the project folder if IndexedDB is empty
      loadApiKeys: async () => {
        try {
          const keys = await apiKeyManager.getAllKeys();
          const hasAnyKey = Object.values(keys).some((v) => v !== '');

          if (!hasAnyKey && projectFileService.isProjectOpen()) {
            // IndexedDB empty — try restoring from project file
            const restored = await projectFileService.loadKeysFile();
            if (restored) {
              const restoredKeys = await apiKeyManager.getAllKeys();
              set({ apiKeys: restoredKeys });
              log.info('API keys restored from project file');
              return;
            }
          }

          set({ apiKeys: keys });
          log.info('API keys loaded from encrypted storage');
        } catch (err) {
          log.error('Failed to load API keys:', err);
        }
      },
    }),
    {
      name: 'masterselects-settings',
      // Don't persist API keys in localStorage - they go to encrypted IndexedDB
      // Don't persist transient UI state like isSettingsOpen
      partialize: (state) => ({
        theme: state.theme,
        customHue: state.customHue,
        customBrightness: state.customBrightness,
        transcriptionProvider: state.transcriptionProvider,
        previewQuality: state.previewQuality,
        showTransparencyGrid: state.showTransparencyGrid,
        saveMode: state.saveMode,
        autosaveEnabled: state.autosaveEnabled,
        autosaveInterval: state.autosaveInterval,
        turboModeEnabled: state.turboModeEnabled,
        nativeDecodeEnabled: state.nativeDecodeEnabled,
        nativeHelperPort: state.nativeHelperPort,
        forceDesktopMode: state.forceDesktopMode,
        gpuPowerPreference: state.gpuPowerPreference,
        matanyoneEnabled: state.matanyoneEnabled,
        matanyonePythonPath: state.matanyonePythonPath,
        aiApprovalMode: state.aiApprovalMode,
        copyMediaToProject: state.copyMediaToProject,
        hasCompletedSetup: state.hasCompletedSetup,
        hasSeenTutorial: state.hasSeenTutorial,
        hasSeenTutorialPart2: state.hasSeenTutorialPart2,
        hasSeenAIChatOnboarding: state.hasSeenAIChatOnboarding,
        userBackground: state.userBackground,
        activeShortcutPreset: state.activeShortcutPreset,
        shortcutOverrides: state.shortcutOverrides,
        customPresets: state.customPresets,
        completedTutorials: state.completedTutorials,
        showChangelogOnStartup: state.showChangelogOnStartup,
        lastSeenChangelogVersion: state.lastSeenChangelogVersion,
        outputResolution: state.outputResolution,
        fps: state.fps,
        webCodecsEnabled: state.webCodecsEnabled,
      }),
      onRehydrateStorage: () => (state) => {
        if (state) {
          // Sync feature flags with persisted setting on app start
          flags.useFullWebCodecsPlayback = state.webCodecsEnabled;
          flags.disableHtmlPreviewFallback = state.webCodecsEnabled;
        }
      },
    }
  )
  )
);
