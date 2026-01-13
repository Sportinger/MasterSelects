// Mobile Properties Panel - Pull down from top

import { useState, useCallback } from 'react';
import { useTimelineStore } from '../../stores/timeline';

interface SliderConfig {
  property: string;
  label: string;
  min: number;
  max: number;
  step: number;
  value: number;
}

interface MobilePropertiesPanelProps {
  isOpen: boolean;
  onClose: () => void;
  onActivateSlider: (slider: SliderConfig) => void;
}

type Tab = 'transform' | 'effects' | 'audio';

export function MobilePropertiesPanel({
  isOpen,
  onClose,
  onActivateSlider,
}: MobilePropertiesPanelProps) {
  const [activeTab, setActiveTab] = useState<Tab>('transform');

  // Get selected clip
  const selectedClipIds = useTimelineStore((s) => s.selectedClipIds);
  const clips = useTimelineStore((s) => s.clips);
  const updateClipTransform = useTimelineStore((s) => s.updateClipTransform);

  const selectedClip = clips.find((c) => selectedClipIds.has(c.id));
  const transform = selectedClip?.transform;

  // Handle slider tap - activates the slider in the main view
  const handleSliderTap = useCallback((config: SliderConfig) => {
    onActivateSlider(config);
  }, [onActivateSlider]);

  // Quick value change (direct in panel)
  const handleValueChange = useCallback((property: string, value: number) => {
    if (!selectedClip) return;

    const updates: Record<string, number> = {};
    updates[property] = value;
    updateClipTransform(selectedClip.id, updates);
  }, [selectedClip, updateClipTransform]);

  if (!isOpen) return null;

  return (
    <div className="mobile-properties-panel" onClick={onClose}>
      <div className="mobile-properties-content" onClick={(e) => e.stopPropagation()}>
        {/* Pull handle */}
        <div className="mobile-panel-handle">
          <div className="handle-bar" />
        </div>

        {/* Tabs */}
        <div className="mobile-properties-tabs">
          <button
            className={`tab ${activeTab === 'transform' ? 'active' : ''}`}
            onClick={() => setActiveTab('transform')}
          >
            Transform
          </button>
          <button
            className={`tab ${activeTab === 'effects' ? 'active' : ''}`}
            onClick={() => setActiveTab('effects')}
          >
            Effects
          </button>
          <button
            className={`tab ${activeTab === 'audio' ? 'active' : ''}`}
            onClick={() => setActiveTab('audio')}
          >
            Audio
          </button>
        </div>

        {/* Content */}
        <div className="mobile-properties-body">
          {!selectedClip ? (
            <div className="mobile-properties-empty">
              Select a clip to edit properties
            </div>
          ) : activeTab === 'transform' ? (
            <div className="mobile-properties-list">
              <PropertyRow
                label="Opacity"
                value={transform?.opacity ?? 1}
                min={0}
                max={1}
                step={0.01}
                format={(v) => `${Math.round(v * 100)}%`}
                onTap={() => handleSliderTap({
                  property: 'opacity',
                  label: 'Opacity',
                  min: 0,
                  max: 1,
                  step: 0.01,
                  value: transform?.opacity ?? 1,
                })}
                onChange={(v) => handleValueChange('opacity', v)}
              />
              <PropertyRow
                label="Scale X"
                value={transform?.scale?.x ?? 1}
                min={0}
                max={3}
                step={0.01}
                format={(v) => `${Math.round(v * 100)}%`}
                onTap={() => handleSliderTap({
                  property: 'scale.x',
                  label: 'Scale X',
                  min: 0,
                  max: 3,
                  step: 0.01,
                  value: transform?.scale?.x ?? 1,
                })}
                onChange={(v) => {
                  if (selectedClip) {
                    updateClipTransform(selectedClip.id, {
                      scale: { x: v, y: transform?.scale?.y ?? 1 }
                    });
                  }
                }}
              />
              <PropertyRow
                label="Scale Y"
                value={transform?.scale?.y ?? 1}
                min={0}
                max={3}
                step={0.01}
                format={(v) => `${Math.round(v * 100)}%`}
                onTap={() => handleSliderTap({
                  property: 'scale.y',
                  label: 'Scale Y',
                  min: 0,
                  max: 3,
                  step: 0.01,
                  value: transform?.scale?.y ?? 1,
                })}
                onChange={(v) => {
                  if (selectedClip) {
                    updateClipTransform(selectedClip.id, {
                      scale: { x: transform?.scale?.x ?? 1, y: v }
                    });
                  }
                }}
              />
              <PropertyRow
                label="Position X"
                value={transform?.position?.x ?? 0}
                min={-1000}
                max={1000}
                step={1}
                format={(v) => `${Math.round(v)}px`}
                onTap={() => handleSliderTap({
                  property: 'position.x',
                  label: 'Position X',
                  min: -1000,
                  max: 1000,
                  step: 1,
                  value: transform?.position?.x ?? 0,
                })}
                onChange={(v) => {
                  if (selectedClip) {
                    updateClipTransform(selectedClip.id, {
                      position: { x: v, y: transform?.position?.y ?? 0, z: transform?.position?.z ?? 0 }
                    });
                  }
                }}
              />
              <PropertyRow
                label="Position Y"
                value={transform?.position?.y ?? 0}
                min={-1000}
                max={1000}
                step={1}
                format={(v) => `${Math.round(v)}px`}
                onTap={() => handleSliderTap({
                  property: 'position.y',
                  label: 'Position Y',
                  min: -1000,
                  max: 1000,
                  step: 1,
                  value: transform?.position?.y ?? 0,
                })}
                onChange={(v) => {
                  if (selectedClip) {
                    updateClipTransform(selectedClip.id, {
                      position: { x: transform?.position?.x ?? 0, y: v, z: transform?.position?.z ?? 0 }
                    });
                  }
                }}
              />
              <PropertyRow
                label="Rotation"
                value={transform?.rotation?.z ?? 0}
                min={-360}
                max={360}
                step={1}
                format={(v) => `${Math.round(v)}°`}
                onTap={() => handleSliderTap({
                  property: 'rotation.z',
                  label: 'Rotation',
                  min: -360,
                  max: 360,
                  step: 1,
                  value: transform?.rotation?.z ?? 0,
                })}
                onChange={(v) => {
                  if (selectedClip) {
                    updateClipTransform(selectedClip.id, {
                      rotation: { x: transform?.rotation?.x ?? 0, y: transform?.rotation?.y ?? 0, z: v }
                    });
                  }
                }}
              />
            </div>
          ) : activeTab === 'effects' ? (
            <div className="mobile-properties-list">
              <div className="mobile-properties-empty">
                Effects coming soon...
              </div>
            </div>
          ) : (
            <div className="mobile-properties-list">
              <div className="mobile-properties-empty">
                Audio controls coming soon...
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// Property row component
interface PropertyRowProps {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  format: (v: number) => string;
  onTap: () => void;
  onChange: (v: number) => void;
}

function PropertyRow({ label, value, min, max, step, format, onTap, onChange }: PropertyRowProps) {
  return (
    <div className="mobile-property-row" onClick={onTap}>
      <span className="property-label">{label}</span>
      <div className="property-slider-container">
        <input
          type="range"
          min={min}
          max={max}
          step={step}
          value={value}
          onChange={(e) => {
            e.stopPropagation();
            onChange(parseFloat(e.target.value));
          }}
          onClick={(e) => e.stopPropagation()}
        />
      </div>
      <span className="property-value">{format(value)}</span>
    </div>
  );
}
