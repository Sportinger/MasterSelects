// Settings store for app configuration
// Global settings persisted in browser localStorage
// The optional YouTube integration credential is encrypted in IndexedDB.

import { create } from 'zustand';
import { subscribeWithSelector, persist } from 'zustand/middleware';
import { youtubeCredentialManager } from '../services/youtubeCredentialManager';
import { projectFileService } from '../services/project/ProjectFileService';
import { flags } from '../engine/featureFlags';
import { Logger } from '../services/logger';
import type { SimpleSynthPreset } from '../engine/audio/synth/simpleSynthPresets';
import type { SimpleSynthInstrument } from '../types/midiClip';
import { generateClipId } from './timeline/helpers/idGenerator';
import type { ShortcutPresetId, ShortcutMap, KeyCombo, ShortcutActionId, CustomShortcutPreset } from '../services/shortcutTypes';
import { PRESETS, DEFAULT_PRESET_ID } from '../services/shortcutPresets';
import {
  DEFAULT_GUIDED_ACTION_REPLAY_BUDGET_MS,
  DEFAULT_SHORTCUT_DISPLAY_SCALE,
  clampGuidedActionReplayBudgetMs,
  clampShortcutDisplayScale,
} from './settings/settingsOptions';
import type {
  AutosaveInterval,
  GPUPowerPreference,
  GuidedActionReplayCompressionMode,
  GuidedActionReplayVisualizationMode,
  PreviewQuality,
  SaveMode,
  ThemeMode,
  TimelineZoomAnchor,
  TranscriptionProvider,
} from './settings/settingsOptions';

// Compatibility re-export: option catalog moved to ./settings/settingsOptions.
// Surface kept identical to the pre-split module (clamp helpers stay internal).
export type {
  AutosaveInterval,
  GPUPowerPreference,
  GuidedActionReplayCompressionMode,
  GuidedActionReplayVisualizationMode,
  PreviewQuality,
  SaveMode,
  ThemeMode,
  TimelineZoomAnchor,
  TranscriptionProvider,
};
export {
  DEFAULT_GUIDED_ACTION_REPLAY_BUDGET_MS,
  DEFAULT_SHORTCUT_DISPLAY_SCALE,
  MAX_SHORTCUT_DISPLAY_SCALE,
  MIN_SHORTCUT_DISPLAY_SCALE,
} from './settings/settingsOptions';

const log = Logger.create('SettingsStore');

export type SettingsCategoryId =
  | 'general'
  | 'midi'
  | 'shortcuts'
  | 'appearance'
  | 'audio'
  | 'transcription'
  | 'nativeHelper'
  | 'integrations';

// Piano-roll controller-lane area (#249). Forward-compatible: `lanes` is an
// ordered list of lane-type ids (see pianoRollLaneTypes.ts) so future CC /
// pitchbend lanes persist without a schema change. Velocity is the only entry
// today. Both the show/hide flag and the area height survive across sessions.
export interface PianoRollControllerAreaState {
  visible: boolean;   // show the lane area under the grid (default true)
  height: number;     // px height of the whole area (clamped on resize)
  lanes: string[];    // ordered lane-type ids shown; default ['velocity']
}

const DEFAULT_PIANO_ROLL_CONTROLLER_AREA: PianoRollControllerAreaState = {
  visible: true,
  height: 96,
  lanes: ['velocity'],
};

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

interface SettingsState {
  // Theme
  theme: ThemeMode;
  customHue: number;        // 0-360 hue for custom theme
  customBrightness: number; // 0-100 brightness (0=dark, 100=light)
  audioMixerWoodThemeEnabled: boolean;
  mediaPanelWoodThemeEnabled: boolean;

  // Optional non-AI integration credential. Never persisted to localStorage.
  youtubeApiKey: string;

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

  // Timeline interaction
  timelineZoomAnchor: TimelineZoomAnchor;  // Where Ctrl/Alt+wheel zoom keeps focus

  // Input display
  showShortcutDisplay: boolean;  // Show pressed keys and mouse clicks in a screen overlay
  shortcutDisplayScale: number;  // Size multiplier for the input overlay

  // GPU preference
  gpuPowerPreference: GPUPowerPreference;  // 'high-performance' (dGPU) or 'low-power' (iGPU)

  // AI Features
  matanyoneEnabled: boolean;      // Enable MatAnyone2 video matting
  matanyonePythonPath: string;    // Python path ('' = auto-detect)

  guidedActionReplayVisualizationMode: GuidedActionReplayVisualizationMode;
  guidedActionReplayBudgetMs: number;
  guidedActionReplayCompressionMode: GuidedActionReplayCompressionMode;

  // Media import settings
  copyMediaToProject: boolean;  // Copy imported files to project Raw/ folder

  // First-run state
  hasCompletedSetup: boolean;
  hasSeenTutorial: boolean;
  hasSeenTutorialPart2: boolean;

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

  // Piano-roll controller-lane area (velocity + future CC lanes, #249)
  pianoRollControllerArea: PianoRollControllerAreaState;

  // User-saved Simple Synth presets (issue #298). Built-ins live in code
  // (simpleSynthPresets.ts); these are the user's own saved patches.
  simpleSynthUserPresets: SimpleSynthPreset[];

  // UI state
  isSettingsOpen: boolean;
  settingsInitialCategory: SettingsCategoryId | null;

  // Output settings
  // Default resolution for new compositions (active composition drives the engine)
  outputResolution: { width: number; height: number };
  fps: number;

  // Actions
  setTheme: (theme: ThemeMode) => void;
  setCustomHue: (hue: number) => void;
  setCustomBrightness: (brightness: number) => void;
  setAudioMixerWoodThemeEnabled: (enabled: boolean) => void;
  setMediaPanelWoodThemeEnabled: (enabled: boolean) => void;
  setYouTubeApiKey: (key: string) => void;
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
  setTimelineZoomAnchor: (anchor: TimelineZoomAnchor) => void;
  setShowShortcutDisplay: (show: boolean) => void;
  setShortcutDisplayScale: (scale: number) => void;
  setGpuPowerPreference: (preference: GPUPowerPreference) => void;
  setMatAnyoneEnabled: (enabled: boolean) => void;
  setMatAnyonePythonPath: (path: string) => void;
  setGuidedActionReplayVisualizationMode: (mode: GuidedActionReplayVisualizationMode) => void;
  setGuidedActionReplayBudgetMs: (budgetMs: number) => void;
  setGuidedActionReplayCompressionMode: (mode: GuidedActionReplayCompressionMode) => void;
  setCopyMediaToProject: (enabled: boolean) => void;
  setHasCompletedSetup: (completed: boolean) => void;
  setHasSeenTutorial: (seen: boolean) => void;
  setHasSeenTutorialPart2: (seen: boolean) => void;
  setUserBackground: (bg: string) => void;
  // Shortcut actions
  setActiveShortcutPreset: (preset: ShortcutPresetId) => void;
  setShortcutOverride: (action: ShortcutActionId, combos: KeyCombo[]) => void;
  clearShortcutOverride: (action: ShortcutActionId) => void;
  resetShortcutsToPreset: () => void;
  saveCustomPreset: (name: string) => void;
  loadCustomPreset: (name: string) => void;
  deleteCustomPreset: (name: string) => void;
  /** Save the given Simple Synth patch as a user preset; returns the stored preset. */
  addSimpleSynthUserPreset: (name: string, instrument: SimpleSynthInstrument) => SimpleSynthPreset;
  removeSimpleSynthUserPreset: (id: string) => void;
  completeTutorial: (campaignId: string) => void;
  setShowChangelogOnStartup: (show: boolean) => void;
  setLastSeenChangelogVersion: (version: string | null) => void;
  markChangelogSeen: (version: string) => void;
  setWebCodecsEnabled: (enabled: boolean) => void;
  setPianoRollControllerArea: (patch: Partial<PianoRollControllerAreaState>) => void;
  openSettings: (category?: SettingsCategoryId) => void;
  closeSettings: () => void;
  toggleSettings: () => void;

  // Output actions
  setResolution: (width: number, height: number) => void;

  // YouTube credential persistence (encrypted in IndexedDB)
  loadIntegrationCredentials: () => Promise<void>;
}

export const useSettingsStore = create<SettingsState>()(
  subscribeWithSelector(
    persist(
      (set, get) => ({
      // Initial state
      theme: 'dark' as ThemeMode,
      customHue: 210,       // Default: blue
      customBrightness: 15, // Default: dark
      audioMixerWoodThemeEnabled: false,
      mediaPanelWoodThemeEnabled: false,
      youtubeApiKey: '',
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
      timelineZoomAnchor: 'mouse' as TimelineZoomAnchor, // Zoom toward the mouse pointer by default
      showShortcutDisplay: false, // Optional Blender-style input overlay
      shortcutDisplayScale: DEFAULT_SHORTCUT_DISPLAY_SCALE,
      gpuPowerPreference: 'high-performance', // Prefer dGPU by default
      matanyoneEnabled: false, // MatAnyone2 disabled by default
      matanyonePythonPath: '', // Auto-detect Python path
      guidedActionReplayVisualizationMode: 'concise' as GuidedActionReplayVisualizationMode,
      guidedActionReplayBudgetMs: DEFAULT_GUIDED_ACTION_REPLAY_BUDGET_MS,
      guidedActionReplayCompressionMode: 'family' as GuidedActionReplayCompressionMode,
      copyMediaToProject: true, // Copy imported files to Raw/ folder by default
      hasCompletedSetup: false, // Show welcome overlay on first run
      hasSeenTutorial: false, // Show tutorial on first run
      hasSeenTutorialPart2: false, // Show timeline tutorial after part 1
      userBackground: null, // Which program the user comes from
      activeShortcutPreset: DEFAULT_PRESET_ID as ShortcutPresetId,
      shortcutOverrides: null,
      customPresets: [] as CustomShortcutPreset[],
      completedTutorials: [], // Campaign IDs that have been completed
      showChangelogOnStartup: true, // Show changelog dialog on every startup
      lastSeenChangelogVersion: null, // Latest app version whose changelog was acknowledged
      webCodecsEnabled: false, // Default to HTML Video
      pianoRollControllerArea: { ...DEFAULT_PIANO_ROLL_CONTROLLER_AREA },
      simpleSynthUserPresets: [] as SimpleSynthPreset[],
      isSettingsOpen: false,
      settingsInitialCategory: null,

      // Output settings
      outputResolution: { width: 1920, height: 1080 },
      fps: 60,

      // Actions
      setTheme: (theme) => set({ theme }),
      setCustomHue: (hue) => set({ customHue: hue }),
      setCustomBrightness: (brightness) => set({ customBrightness: brightness }),
      setAudioMixerWoodThemeEnabled: (enabled) => set({ audioMixerWoodThemeEnabled: enabled }),
      setMediaPanelWoodThemeEnabled: (enabled) => set({ mediaPanelWoodThemeEnabled: enabled }),

      setYouTubeApiKey: (key) => {
        set({ youtubeApiKey: key });
        void youtubeCredentialManager.store(key).catch((err) => {
          log.error('Failed to save YouTube integration credential:', err);
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

      setTimelineZoomAnchor: (anchor) => {
        set({ timelineZoomAnchor: anchor });
      },

      setShowShortcutDisplay: (show) => {
        set({ showShortcutDisplay: show });
      },

      setShortcutDisplayScale: (scale) => {
        set({ shortcutDisplayScale: clampShortcutDisplayScale(scale) });
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

      setGuidedActionReplayVisualizationMode: (mode) => {
        set({ guidedActionReplayVisualizationMode: mode });
      },

      setGuidedActionReplayBudgetMs: (budgetMs) => {
        set({ guidedActionReplayBudgetMs: clampGuidedActionReplayBudgetMs(budgetMs) });
      },

      setGuidedActionReplayCompressionMode: (mode) => {
        set({ guidedActionReplayCompressionMode: mode });
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

      addSimpleSynthUserPreset: (name, instrument) => {
        // Deep-clone via JSON so the stored preset can never share a reference with
        // the live track instrument (it's plain JSON, so this is lossless).
        const preset: SimpleSynthPreset = {
          id: generateClipId('synth-preset'),
          name,
          instrument: JSON.parse(JSON.stringify(instrument)) as SimpleSynthInstrument,
        };
        set({ simpleSynthUserPresets: [...get().simpleSynthUserPresets, preset] });
        return preset;
      },

      removeSimpleSynthUserPreset: (id) => {
        set({ simpleSynthUserPresets: get().simpleSynthUserPresets.filter((p) => p.id !== id) });
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
      setPianoRollControllerArea: (patch) => {
        set((state) => ({
          pianoRollControllerArea: { ...state.pianoRollControllerArea, ...patch },
        }));
      },
      openSettings: (category) => set({ isSettingsOpen: true, settingsInitialCategory: category ?? null }),
      closeSettings: () => set({ isSettingsOpen: false, settingsInitialCategory: null }),
      toggleSettings: () => set((state) => ({
        isSettingsOpen: !state.isSettingsOpen,
        settingsInitialCategory: state.isSettingsOpen ? null : state.settingsInitialCategory,
      })),

      // Output actions
      setResolution: (width, height) => {
        set({ outputResolution: { width, height } });
      },

      loadIntegrationCredentials: async () => {
        try {
          set({ youtubeApiKey: await youtubeCredentialManager.get() ?? '' });
          log.info('Integration credentials loaded from encrypted storage');
        } catch (err) {
          set({ youtubeApiKey: '' });
          log.error('Failed to load integration credentials:', err);
        }
      },
    }),
    {
      name: 'masterselects-settings',
      // Don't persist the YouTube credential in localStorage.
      // Don't persist transient UI state like isSettingsOpen
      partialize: (state) => ({
        theme: state.theme,
        customHue: state.customHue,
        customBrightness: state.customBrightness,
        audioMixerWoodThemeEnabled: state.audioMixerWoodThemeEnabled,
        mediaPanelWoodThemeEnabled: state.mediaPanelWoodThemeEnabled,
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
        timelineZoomAnchor: state.timelineZoomAnchor,
        showShortcutDisplay: state.showShortcutDisplay,
        shortcutDisplayScale: state.shortcutDisplayScale,
        gpuPowerPreference: state.gpuPowerPreference,
        matanyoneEnabled: state.matanyoneEnabled,
        matanyonePythonPath: state.matanyonePythonPath,
        guidedActionReplayVisualizationMode: state.guidedActionReplayVisualizationMode,
        guidedActionReplayBudgetMs: state.guidedActionReplayBudgetMs,
        guidedActionReplayCompressionMode: state.guidedActionReplayCompressionMode,
        copyMediaToProject: state.copyMediaToProject,
        hasCompletedSetup: state.hasCompletedSetup,
        hasSeenTutorial: state.hasSeenTutorial,
        hasSeenTutorialPart2: state.hasSeenTutorialPart2,
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
        pianoRollControllerArea: state.pianoRollControllerArea,
        simpleSynthUserPresets: state.simpleSynthUserPresets,
      }),
      merge: (persistedState, currentState) => {
        const persisted = persistedState as Omit<Partial<SettingsState>, 'transcriptionProvider'> & {
          apiKeys?: unknown;
          apiKeysUnlocked?: unknown;
          apiKeyDefaults?: unknown;
          aiProvider?: unknown;
          lemonadeEndpoint?: unknown;
          lemonadeContextSize?: unknown;
          lemonadeModel?: unknown;
          aiSystemPromptOverrides?: unknown;
          aiSystemPromptSendContext?: unknown;
          transcriptionProvider?: TranscriptionProvider | 'assemblyai';
        };
        const {
          apiKeys: _retiredApiKeys,
          apiKeysUnlocked: _retiredApiKeysUnlocked,
          apiKeyDefaults: _retiredApiKeyDefaults,
          aiProvider: _retiredAiProvider,
          lemonadeEndpoint: _retiredLemonadeEndpoint,
          lemonadeContextSize: _retiredLemonadeContextSize,
          lemonadeModel: _retiredLemonadeModel,
          aiSystemPromptOverrides: _retiredPromptOverrides,
          aiSystemPromptSendContext: _retiredPromptContext,
          transcriptionProvider: persistedTranscriptionProvider,
          ...supportedPersistedState
        } = persisted;
        return {
          ...currentState,
          ...supportedPersistedState,
          transcriptionProvider: persistedTranscriptionProvider === 'assemblyai'
            ? 'deepgram'
            : persistedTranscriptionProvider ?? currentState.transcriptionProvider,
        };
      },
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
