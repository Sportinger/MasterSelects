// Effects panel component

import { useMixerStore } from '../stores/mixerStore';
import type { EffectType, BlendMode } from '../types';

const BLEND_MODES: BlendMode[] = [
  'normal',
  'add',
  'multiply',
  'screen',
  'overlay',
  'difference',
];

const AVAILABLE_EFFECTS: { type: EffectType; name: string }[] = [
  { type: 'hue-shift', name: 'Hue Shift' },
  { type: 'brightness', name: 'Brightness' },
  { type: 'contrast', name: 'Contrast' },
  { type: 'saturation', name: 'Saturation' },
  { type: 'pixelate', name: 'Pixelate' },
  { type: 'kaleidoscope', name: 'Kaleidoscope' },
  { type: 'mirror', name: 'Mirror' },
  { type: 'rgb-split', name: 'RGB Split' },
  { type: 'invert', name: 'Invert' },
];

export function EffectsPanel() {
  const { layers, selectedLayerId, addEffect, removeEffect, updateEffect, setLayerOpacity, setLayerBlendMode } =
    useMixerStore();

  const selectedLayer = layers.find((l) => l?.id === selectedLayerId);

  if (!selectedLayer) {
    return (
      <div className="effects-panel">
        <div className="panel-header">
          <h3>Effects</h3>
        </div>
        <div className="panel-empty">
          <p>Select a layer to add effects</p>
        </div>
      </div>
    );
  }

  return (
    <div className="effects-panel">
      <div className="panel-header">
        <h3>Effects - {selectedLayer.name}</h3>
        <div className="effect-add">
          <select
            onChange={(e) => {
              if (e.target.value) {
                addEffect(selectedLayer.id, e.target.value);
                e.target.value = '';
              }
            }}
            defaultValue=""
          >
            <option value="" disabled>
              + Add Effect
            </option>
            {AVAILABLE_EFFECTS.map((effect) => (
              <option key={effect.type} value={effect.type}>
                {effect.name}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="layer-settings">
        <div className="control-row">
          <label>Opacity</label>
          <input
            type="range"
            min="0"
            max="1"
            step="0.01"
            value={selectedLayer.opacity}
            onChange={(e) => setLayerOpacity(selectedLayer.id, parseFloat(e.target.value))}
          />
          <span>{Math.round(selectedLayer.opacity * 100)}%</span>
        </div>
        <div className="control-row">
          <label>Blend</label>
          <select
            value={selectedLayer.blendMode}
            onChange={(e) => setLayerBlendMode(selectedLayer.id, e.target.value as BlendMode)}
          >
            {BLEND_MODES.map((mode) => (
              <option key={mode} value={mode}>
                {mode}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="effects-list">
        {selectedLayer.effects.length === 0 ? (
          <div className="panel-empty">
            <p>No effects added</p>
          </div>
        ) : (
          selectedLayer.effects.map((effect) => (
            <div key={effect.id} className="effect-item">
              <div className="effect-header">
                <span className="effect-name">{effect.name}</span>
                <button
                  className="btn btn-sm btn-danger"
                  onClick={() => removeEffect(selectedLayer.id, effect.id)}
                >
                  ×
                </button>
              </div>

              <div className="effect-params">
                {renderEffectParams(effect, (params) =>
                  updateEffect(selectedLayer.id, effect.id, params)
                )}
              </div>
            </div>
          ))
        )}
      </div>

      <div className="transform-section">
        <h4>Transform</h4>
        <div className="control-row">
          <label>Position X</label>
          <input
            type="range"
            min="-1"
            max="1"
            step="0.01"
            value={selectedLayer.position.x}
            onChange={(e) =>
              useMixerStore.getState().setLayerTransform(selectedLayer.id, {
                position: { x: parseFloat(e.target.value), y: selectedLayer.position.y },
              })
            }
          />
          <span>{selectedLayer.position.x.toFixed(2)}</span>
        </div>
        <div className="control-row">
          <label>Position Y</label>
          <input
            type="range"
            min="-1"
            max="1"
            step="0.01"
            value={selectedLayer.position.y}
            onChange={(e) =>
              useMixerStore.getState().setLayerTransform(selectedLayer.id, {
                position: { x: selectedLayer.position.x, y: parseFloat(e.target.value) },
              })
            }
          />
          <span>{selectedLayer.position.y.toFixed(2)}</span>
        </div>
        <div className="control-row">
          <label>Scale</label>
          <input
            type="range"
            min="0.1"
            max="3"
            step="0.01"
            value={selectedLayer.scale.x}
            onChange={(e) => {
              const scale = parseFloat(e.target.value);
              useMixerStore.getState().setLayerTransform(selectedLayer.id, {
                scale: { x: scale, y: scale },
              });
            }}
          />
          <span>{selectedLayer.scale.x.toFixed(2)}</span>
        </div>
        <div className="control-row">
          <label>Rotation</label>
          <input
            type="range"
            min="0"
            max={Math.PI * 2}
            step="0.01"
            value={selectedLayer.rotation}
            onChange={(e) =>
              useMixerStore.getState().setLayerTransform(selectedLayer.id, {
                rotation: parseFloat(e.target.value),
              })
            }
          />
          <span>{Math.round((selectedLayer.rotation * 180) / Math.PI)}°</span>
        </div>
      </div>
    </div>
  );
}

function renderEffectParams(
  effect: { type: string; params: Record<string, number | boolean | string> },
  onChange: (params: Record<string, number | boolean | string>) => void
) {
  switch (effect.type) {
    case 'hue-shift':
      return (
        <div className="control-row">
          <label>Shift</label>
          <input
            type="range"
            min="0"
            max="1"
            step="0.01"
            value={effect.params.shift as number}
            onChange={(e) => onChange({ shift: parseFloat(e.target.value) })}
          />
        </div>
      );

    case 'brightness':
      return (
        <div className="control-row">
          <label>Amount</label>
          <input
            type="range"
            min="-1"
            max="1"
            step="0.01"
            value={effect.params.amount as number}
            onChange={(e) => onChange({ amount: parseFloat(e.target.value) })}
          />
        </div>
      );

    case 'contrast':
      return (
        <div className="control-row">
          <label>Amount</label>
          <input
            type="range"
            min="0"
            max="3"
            step="0.01"
            value={effect.params.amount as number}
            onChange={(e) => onChange({ amount: parseFloat(e.target.value) })}
          />
        </div>
      );

    case 'saturation':
      return (
        <div className="control-row">
          <label>Amount</label>
          <input
            type="range"
            min="0"
            max="3"
            step="0.01"
            value={effect.params.amount as number}
            onChange={(e) => onChange({ amount: parseFloat(e.target.value) })}
          />
        </div>
      );

    case 'pixelate':
      return (
        <div className="control-row">
          <label>Size</label>
          <input
            type="range"
            min="1"
            max="64"
            step="1"
            value={effect.params.size as number}
            onChange={(e) => onChange({ size: parseInt(e.target.value, 10) })}
          />
        </div>
      );

    case 'kaleidoscope':
      return (
        <>
          <div className="control-row">
            <label>Segments</label>
            <input
              type="range"
              min="2"
              max="16"
              step="1"
              value={effect.params.segments as number}
              onChange={(e) => onChange({ segments: parseInt(e.target.value, 10) })}
            />
          </div>
          <div className="control-row">
            <label>Rotation</label>
            <input
              type="range"
              min="0"
              max={Math.PI * 2}
              step="0.01"
              value={effect.params.rotation as number}
              onChange={(e) => onChange({ rotation: parseFloat(e.target.value) })}
            />
          </div>
        </>
      );

    case 'mirror':
      return (
        <>
          <div className="control-row">
            <label>
              <input
                type="checkbox"
                checked={effect.params.horizontal as boolean}
                onChange={(e) => onChange({ horizontal: e.target.checked })}
              />
              Horizontal
            </label>
          </div>
          <div className="control-row">
            <label>
              <input
                type="checkbox"
                checked={effect.params.vertical as boolean}
                onChange={(e) => onChange({ vertical: e.target.checked })}
              />
              Vertical
            </label>
          </div>
        </>
      );

    case 'rgb-split':
      return (
        <>
          <div className="control-row">
            <label>Amount</label>
            <input
              type="range"
              min="0"
              max="0.1"
              step="0.001"
              value={effect.params.amount as number}
              onChange={(e) => onChange({ amount: parseFloat(e.target.value) })}
            />
          </div>
          <div className="control-row">
            <label>Angle</label>
            <input
              type="range"
              min="0"
              max={Math.PI * 2}
              step="0.01"
              value={effect.params.angle as number}
              onChange={(e) => onChange({ angle: parseFloat(e.target.value) })}
            />
          </div>
        </>
      );

    case 'invert':
      return <p className="effect-info">No parameters</p>;

    default:
      return null;
  }
}
