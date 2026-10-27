// State of the Advanced export: the person's choices (kept for this page session), the browser
// capabilities at the chosen size, the resulting plan, and the project export presets shared
// with the desktop export panel.
import { useCallback, useMemo, useState } from 'react';
import { useExportStore } from '../../../stores/exportStore';
import { useMediaStore } from '../../../stores/mediaStore';
import { useTimelineStore } from '../../../stores/timeline';
import {
  buildPhoneAdvancedPlan,
  createDefaultPhoneAdvancedSettings,
  hasInOutPoints,
  resolveAdvancedFps,
  resolveAdvancedSize,
  resolveSelectionRange,
  type PhoneAdvancedPlan,
  type PhoneAdvancedSettings,
} from './phoneExportAdvancedPlan';
import { exportSettingsToPhone, phoneSpecToExportSettings } from './phoneExportPresetMapping';
import type { PhoneExportBrowserCapabilities } from './phoneExportFormats';
import { usePhoneExportCapabilities } from './usePhoneExportCapabilities';

/** Survives closing and reopening the sheet within one page session (not a project setting). */
let rememberedSettings: PhoneAdvancedSettings | null = null;

export interface PhoneAdvancedExport {
  settings: PhoneAdvancedSettings;
  update: (patch: Partial<PhoneAdvancedSettings>) => void;
  plan: PhoneAdvancedPlan;
  capabilities: PhoneExportBrowserCapabilities;
  size: { width: number; height: number };
  inOutAvailable: boolean;
  selectionAvailable: boolean;
  presets: ReadonlyArray<{ id: string; name: string }>;
  selectedPresetId: string | null;
  loadPreset: (presetId: string) => string;
  savePreset: (name: string) => string;
  deletePreset: (presetId: string) => string;
}

export function usePhoneAdvancedExport(enabled: boolean): PhoneAdvancedExport {
  const composition = useMediaStore((store) => store.compositions.find((c) => c.id === store.activeCompositionId) ?? null);
  const clips = useTimelineStore((store) => store.clips);
  const tracks = useTimelineStore((store) => store.tracks);
  const inPoint = useTimelineStore((store) => store.inPoint);
  const outPoint = useTimelineStore((store) => store.outPoint);
  const selectedClipIds = useTimelineStore((store) => store.selectedClipIds);
  const playhead = useTimelineStore((store) => store.playheadPosition);
  const presets = useExportStore((store) => store.presets);
  const selectedPresetId = useExportStore((store) => store.selectedPresetId);

  const [settings, setSettings] = useState<PhoneAdvancedSettings>(
    () => rememberedSettings ?? createDefaultPhoneAdvancedSettings(composition),
  );
  const update = useCallback((patch: Partial<PhoneAdvancedSettings>) => {
    setSettings((current) => {
      const next = { ...current, ...patch };
      rememberedSettings = next;
      return next;
    });
  }, []);

  const size = useMemo(
    () => (composition ? resolveAdvancedSize(settings, composition) : { width: 1080, height: 1920, notes: [] }),
    [composition, settings],
  );
  const fps = composition ? resolveAdvancedFps(settings, composition) : 30;
  const capabilities = usePhoneExportCapabilities(size.width, size.height, fps, enabled);

  const plan = useMemo(() => buildPhoneAdvancedPlan(settings, {
    composition,
    clips,
    tracks,
    inPoint,
    outPoint,
    selectedClipIds,
    playhead,
    capabilities,
  }), [capabilities, clips, composition, inPoint, outPoint, playhead, selectedClipIds, settings, tracks]);

  const loadPreset = useCallback((presetId: string) => {
    const preset = useExportStore.getState().presets.find((entry) => entry.id === presetId);
    if (!preset) return 'That preset no longer exists.';
    useExportStore.getState().setSelectedPresetId(presetId);
    const next = exportSettingsToPhone(preset.settings, composition);
    rememberedSettings = next;
    setSettings(next);
    return `Loaded "${preset.name}".`;
  }, [composition]);

  const savePreset = useCallback((name: string) => {
    const trimmed = name.trim();
    if (!trimmed) return 'Type a name for the preset first.';
    if (!plan.supported) return `Cannot save this setup: ${plan.reason}`;
    const store = useExportStore.getState();
    const saved = store.savePreset(trimmed, phoneSpecToExportSettings(plan.spec, settings.range, store.settings));
    if (!saved) return 'The preset could not be saved.';
    const rangeNote = settings.range === 'selection' ? ' (the selected-clips range is not stored in presets)' : '';
    return `${saved.overwritten ? 'Updated' : 'Saved'} preset "${saved.preset.name}"${rangeNote}.`;
  }, [plan, settings.range]);

  const deletePreset = useCallback((presetId: string) => {
    const store = useExportStore.getState();
    const preset = store.presets.find((entry) => entry.id === presetId);
    if (!preset) return 'That preset no longer exists.';
    store.deletePreset(presetId);
    return `Deleted preset "${preset.name}".`;
  }, []);

  return {
    settings,
    update,
    plan,
    capabilities,
    size: { width: size.width, height: size.height },
    inOutAvailable: hasInOutPoints(inPoint, outPoint),
    selectionAvailable: resolveSelectionRange(clips, selectedClipIds) !== null,
    presets: presets.map((preset) => ({ id: preset.id, name: preset.name })),
    selectedPresetId,
    loadPreset,
    savePreset,
    deletePreset,
  };
}
