import type { ExportPreset } from '../../../stores/exportStore';
import { ExportInspectorRow, ExportInspectorSection } from './ExportInspectorPrimitives';
import { InspectorSelect } from '../../inspector/InspectorSelect';

interface ExportPresetSectionProps {
  onSave: () => void;
  onSelectPreset: (presetId: string | null) => void;
  onUpdate: () => void;
  presets: ExportPreset[];
  selectedPresetId: string | null;
  setupStatus: string | null;
}

export function ExportPresetSection({
  onSave,
  onSelectPreset,
  onUpdate,
  presets,
  selectedPresetId,
  setupStatus,
}: ExportPresetSectionProps) {
  return (
    <ExportInspectorSection title="Presets">
      <ExportInspectorRow label="Preset">
        <div className="export-preset-controls">
          <InspectorSelect
            ariaLabel="Export preset"
            onChange={value => onSelectPreset(value || null)}
            options={[
              { label: 'Project presets', value: '' },
              ...presets.map(preset => ({ label: preset.name, value: preset.id })),
            ]}
            value={selectedPresetId ?? ''}
          />
          <button className="export-inspector-action-button" onClick={onSave} type="button">Save</button>
          <button
            className="export-inspector-action-button"
            disabled={!selectedPresetId}
            onClick={onUpdate}
            type="button"
          >
            Update
          </button>
        </div>
      </ExportInspectorRow>
      {setupStatus && <div className="export-inspector-status-text" role="status">{setupStatus}</div>}
    </ExportInspectorSection>
  );
}
