// Settings Dialog - After Effects style preferences with sidebar navigation

import { useState, useCallback, useRef } from 'react';
import { useSettingsStore, type SettingsCategoryId } from '../../stores/settingsStore';
import { useDraggableDialog } from './settings/useDraggableDialog';
import { AppearanceSettings } from './settings/AppearanceSettings';
import { AudioSettings } from './settings/AudioSettings';
import { GeneralSettings } from './settings/GeneralSettings';
import { MidiSettings } from './settings/MidiSettings';
import { TranscriptionSettings } from './settings/TranscriptionSettings';
import { IntegrationCredentialsSettings } from './settings/IntegrationCredentialsSettings';
import { NativeHelperSettings } from './settings/NativeHelperSettings';
import { ShortcutsSettings } from './settings/ShortcutsSettings';
import './settings/SettingsDialog.css';

interface SettingsDialogProps {
  onClose: () => void;
}

interface CategoryConfig {
  id: SettingsCategoryId;
  label: string;
  icon: string;
}

const categories: CategoryConfig[] = [
  { id: 'general', label: 'General', icon: '\u2699' },
  { id: 'midi', label: 'MIDI', icon: '\u266B' },
  { id: 'shortcuts', label: 'Shortcuts', icon: '\u2328' },
  { id: 'appearance', label: 'Appearance', icon: '\uD83C\uDFA8' },
  { id: 'audio', label: 'Audio', icon: '\uD83D\uDD0A' },
  { id: 'transcription', label: 'Transcription', icon: '\uD83C\uDFA4' },
  { id: 'nativeHelper', label: 'Native Helper', icon: '\u26A1' },
  { id: 'integrations', label: 'Integrations', icon: '\uD83D\uDD11' },
];

export function SettingsDialog({ onClose }: SettingsDialogProps) {
  const settingsInitialCategory = useSettingsStore((s) => s.settingsInitialCategory);
  const [activeCategory, setActiveCategory] = useState<SettingsCategoryId>(settingsInitialCategory ?? 'general');
  const dialogRef = useRef<HTMLDivElement>(null);
  const { position, isDragging, handleMouseDown } = useDraggableDialog(dialogRef);

  const youtubeApiKey = useSettingsStore((state) => state.youtubeApiKey);
  const setYouTubeApiKey = useSettingsStore((state) => state.setYouTubeApiKey);
  const [localYouTubeApiKey, setLocalYouTubeApiKey] = useState(youtubeApiKey);

  const handleSave = useCallback(() => {
    setYouTubeApiKey(localYouTubeApiKey);
    onClose();
  }, [localYouTubeApiKey, setYouTubeApiKey, onClose]);

  const renderCategoryContent = () => {
    switch (activeCategory) {
      case 'general': return <GeneralSettings />;
      case 'midi': return <MidiSettings />;
      case 'shortcuts': return <ShortcutsSettings />;
      case 'appearance': return <AppearanceSettings />;
      case 'audio': return <AudioSettings />;
      case 'transcription': return <TranscriptionSettings />;
      case 'nativeHelper': return <NativeHelperSettings />;
      case 'integrations': return (
        <IntegrationCredentialsSettings
          youtubeApiKey={localYouTubeApiKey}
          onYouTubeApiKeyChange={setLocalYouTubeApiKey}
        />
      );
      default: return null;
    }
  };

  return (
    <div className="settings-container">
      <div
        ref={dialogRef}
        className={`settings-dialog ${isDragging ? 'dragging' : ''}`}
        style={{
          left: position.x,
          top: position.y,
        }}
      >
        {/* Header - Draggable */}
        <div
          className="settings-header"
          onMouseDown={handleMouseDown}
        >
          <h1>Preferences</h1>
          <button className="settings-close" onClick={onClose} onMouseDown={(e) => e.stopPropagation()}>{'\u00D7'}</button>
        </div>

        {/* Main content with sidebar */}
        <div className="settings-main">
          {/* Sidebar */}
          <div className="settings-sidebar">
            {categories.map((cat) => (
              <button
                key={cat.id}
                className={`sidebar-item ${activeCategory === cat.id ? 'active' : ''}`}
                onClick={() => setActiveCategory(cat.id)}
              >
                <span className="sidebar-icon">{cat.icon}</span>
                <span className="sidebar-label">{cat.label}</span>
              </button>
            ))}
          </div>

          {/* Content */}
          <div className="settings-content">
            {renderCategoryContent()}
          </div>
        </div>

        {/* Footer */}
        <div className="settings-footer">
          <button className="btn-cancel" onClick={onClose}>Cancel</button>
          <button className="btn-save" onClick={handleSave}>OK</button>
        </div>
      </div>
    </div>
  );
}
