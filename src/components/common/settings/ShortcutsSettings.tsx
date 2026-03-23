// ShortcutsSettings — Settings tab for keyboard shortcut management
// Preset selection, searchable shortcut list, key recording, custom presets

import { useState, useCallback, useMemo } from 'react';
import { useSettingsStore } from '../../../stores/settingsStore';
import { ACTION_META, PRESET_LIST } from '../../../services/shortcutPresets';
import { getShortcutRegistry } from '../../../services/shortcutRegistry';
import type { ShortcutPresetId, ShortcutCategory, KeyCombo, ShortcutActionId } from '../../../services/shortcutTypes';
import { ShortcutRecorder } from './ShortcutRecorder';

const CATEGORIES_ORDER: ShortcutCategory[] = [
  'Playback',
  'Navigation',
  'Editing',
  'Tools',
  'Project',
  'History',
];

export function ShortcutsSettings() {
  const {
    activeShortcutPreset,
    shortcutOverrides,
    customPresets,
    setActiveShortcutPreset,
    setShortcutOverride,
    clearShortcutOverride,
    resetShortcutsToPreset,
    saveCustomPreset,
    deleteCustomPreset,
    loadCustomPreset,
  } = useSettingsStore();

  const [search, setSearch] = useState('');
  const [customPresetName, setCustomPresetName] = useState('');

  const registry = useMemo(() => getShortcutRegistry(), []);

  // Group actions by category, filtered by search
  const groupedActions = useMemo(() => {
    const lowerSearch = search.toLowerCase();
    const filtered = ACTION_META.filter((meta) => {
      if (!search) return true;
      return (
        meta.label.toLowerCase().includes(lowerSearch) ||
        meta.id.toLowerCase().includes(lowerSearch) ||
        meta.category.toLowerCase().includes(lowerSearch)
      );
    });

    const groups: Record<string, typeof filtered> = {};
    for (const cat of CATEGORIES_ORDER) {
      const items = filtered.filter((m) => m.category === cat);
      if (items.length > 0) {
        groups[cat] = items;
      }
    }
    return groups;
  }, [search]);

  const handlePresetChange = useCallback((e: React.ChangeEvent<HTMLSelectElement>) => {
    setActiveShortcutPreset(e.target.value as ShortcutPresetId);
  }, [setActiveShortcutPreset]);

  const handleRecord = useCallback((actionId: ShortcutActionId, combo: KeyCombo) => {
    setShortcutOverride(actionId, [combo]);
  }, [setShortcutOverride]);

  const handleReset = useCallback((actionId: ShortcutActionId) => {
    clearShortcutOverride(actionId);
  }, [clearShortcutOverride]);

  const handleSaveCustom = useCallback(() => {
    const name = customPresetName.trim();
    if (!name) return;
    saveCustomPreset(name);
    setCustomPresetName('');
  }, [customPresetName, saveCustomPreset]);

  const handleLoadCustom = useCallback((name: string) => {
    loadCustomPreset(name);
  }, [loadCustomPreset]);

  const handleDeleteCustom = useCallback((name: string) => {
    deleteCustomPreset(name);
  }, [deleteCustomPreset]);

  const getConflictLabel = useCallback((actionId: ShortcutActionId): string | null => {
    const combos = registry.getCombos(actionId);
    if (combos.length === 0) return null;

    for (const combo of combos) {
      const conflicts = registry.findConflicts(actionId, combo);
      if (conflicts.length > 0) {
        const meta = ACTION_META.find((m) => m.id === conflicts[0]);
        return meta?.label || conflicts[0];
      }
    }
    return null;
  }, [registry]);

  return (
    <div className="settings-category-content">
      <h2>Keyboard Shortcuts</h2>

      {/* Preset Selection */}
      <div className="settings-group">
        <div className="settings-group-title">Preset</div>

        <label className="settings-row">
          <span className="settings-label">Active Preset</span>
          <select
            value={activeShortcutPreset}
            onChange={handlePresetChange}
            className="settings-select"
          >
            {PRESET_LIST.map((preset) => (
              <option key={preset.id} value={preset.id}>
                {preset.label}
              </option>
            ))}
          </select>
        </label>

        {shortcutOverrides && Object.keys(shortcutOverrides).length > 0 && (
          <div className="settings-row">
            <span className="settings-label">
              {Object.keys(shortcutOverrides).length} custom override(s)
            </span>
            <button className="settings-button shortcut-reset-all-btn" onClick={resetShortcutsToPreset}>
              Reset All to Preset
            </button>
          </div>
        )}
      </div>

      {/* Custom Presets */}
      <div className="settings-group">
        <div className="settings-group-title">Custom Presets</div>

        <div className="settings-row shortcut-custom-save">
          <input
            type="text"
            className="settings-input shortcut-preset-name-input"
            placeholder="Preset name..."
            value={customPresetName}
            onChange={(e) => setCustomPresetName(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') handleSaveCustom(); }}
          />
          <button
            className="settings-button"
            onClick={handleSaveCustom}
            disabled={!customPresetName.trim()}
          >
            Save Current
          </button>
        </div>

        {customPresets.length > 0 && (
          <div className="shortcut-custom-list">
            {customPresets.map((preset) => (
              <div key={preset.name} className="shortcut-custom-item">
                <span className="shortcut-custom-name">{preset.name}</span>
                <button
                  className="settings-button shortcut-custom-load-btn"
                  onClick={() => handleLoadCustom(preset.name)}
                >
                  Load
                </button>
                <button
                  className="settings-button shortcut-custom-delete-btn"
                  onClick={() => handleDeleteCustom(preset.name)}
                >
                  Delete
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Search */}
      <div className="settings-group">
        <input
          type="text"
          className="settings-input shortcut-search-input"
          placeholder="Search shortcuts..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      {/* Shortcut List */}
      <div className="shortcut-list">
        {CATEGORIES_ORDER.map((cat) => {
          const actions = groupedActions[cat];
          if (!actions) return null;

          return (
            <div key={cat} className="shortcut-category-group">
              <div className="shortcut-category-title">{cat}</div>
              {actions.map((meta) => {
                const combos = registry.getCombos(meta.id);
                const isOverridden = !!(shortcutOverrides && meta.id in shortcutOverrides);
                const conflict = getConflictLabel(meta.id);

                return (
                  <div
                    key={meta.id}
                    className={`shortcut-row ${isOverridden ? 'shortcut-row--overridden' : ''}`}
                  >
                    <span className="shortcut-action-label">{meta.label}</span>
                    <ShortcutRecorder
                      combos={combos}
                      actionId={meta.id}
                      isOverridden={isOverridden}
                      onRecord={(combo) => handleRecord(meta.id, combo)}
                      onReset={() => handleReset(meta.id)}
                      conflictLabel={conflict}
                    />
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>
    </div>
  );
}
