import { SCENE_NAV_FPS_MOVE_SPEED_STEPS } from '../../../../stores/engineStore';
import { KeyframeToggle } from '../shared';
import { BLEND_MODE_GROUPS, formatBlendModeName } from '../sharedConstants';
import { InspectorSelect } from '../../../inspector/InspectorSelect';
import {
  ResolveInspectorIconButton,
  ResolveInspectorRow,
  ResolveInspectorSection,
} from '../resolveInspector/ResolveInspectorPrimitives';
import {
  NoKeyframesIcon,
} from './SceneNavIcons';
import { LayerModeControls } from './LayerModeControls';
import { LabeledValue } from './ValueControls';
import type { CreateMidiTarget } from './transformTabTypes';
import {
  CLIP_SPEED_MAX_MULTIPLIER,
  CLIP_SPEED_MAX_PERCENT,
  CLIP_SPEED_MIN_PERCENT,
  CLIP_SPEED_MIN_SIGNED_MULTIPLIER,
} from '../../../../stores/timeline/helpers/linkedClipSpeed';

function LinkedAudioIcon() {
  return (
    <svg className="transform-option-icon" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
      <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
    </svg>
  );
}

interface OptionsSectionProps {
  clipId: string;
  blendMode: string;
  canToggleThreeDEffectors: boolean;
  isCameraClip: boolean;
  isEffectively3D: boolean;
  isLocked3D: boolean;
  isModel: boolean;
  inspectorOnly?: boolean;
  layerModeControlsInSource: boolean;
  modelPrimitiveIndex?: number;
  modelPrimitiveOptions: readonly { index: number; label: string }[];
  opacity: number;
  opacityPct: number;
  sceneNavFpsMode: boolean;
  sceneNavFpsMoveSpeed: number;
  sceneNavFpsMoveSpeedIndex: number;
  sceneNavNoKeyframes: boolean;
  sceneNavTouchControlsVisible: boolean;
  speed: number;
  speedPct: number;
  linkedAudioSpeedEnabled?: boolean;
  supportsFreeRun: boolean;
  freeRun: boolean;
  supportsThreeDEffectorToggle: boolean;
  threeDEffectorsEnabled: boolean;
  wireframe: boolean;
  createMidiTarget: CreateMidiTarget;
  onBatchEnd: () => void;
  onBatchStart: () => void;
  onBlendModeChange: (blendMode: string) => void;
  onModelPrimitiveIndexChange: (index: number | undefined) => void;
  onOpacityChange: (pct: number) => void;
  onSceneNavFpsModeChange: (enabled: boolean) => void;
  onSceneNavFpsMoveSpeedChange: (speed: number) => void;
  onSceneNavNoKeyframesChange: (enabled: boolean) => void;
  onSceneNavTouchControlsVisibleChange: (visible: boolean) => void;
  onSpeedChange: (pct: number) => void;
  onLinkedAudioSpeedChange?: (enabled: boolean) => void;
  onFreeRunToggle: () => void;
  onThreeDEffectorsToggle: () => void;
  onToggle3D: () => void;
  onWireframeToggle: () => void;
}

export function OptionsSection({
  clipId,
  blendMode,
  canToggleThreeDEffectors,
  isCameraClip,
  isEffectively3D,
  isLocked3D,
  isModel,
  inspectorOnly = false,
  layerModeControlsInSource,
  modelPrimitiveIndex,
  modelPrimitiveOptions,
  opacity,
  opacityPct,
  sceneNavFpsMode,
  sceneNavFpsMoveSpeed,
  sceneNavFpsMoveSpeedIndex,
  sceneNavNoKeyframes,
  sceneNavTouchControlsVisible,
  speed,
  speedPct,
  linkedAudioSpeedEnabled,
  supportsFreeRun,
  freeRun,
  supportsThreeDEffectorToggle,
  threeDEffectorsEnabled,
  wireframe,
  createMidiTarget,
  onBatchEnd,
  onBatchStart,
  onBlendModeChange,
  onModelPrimitiveIndexChange,
  onOpacityChange,
  onSceneNavFpsModeChange,
  onSceneNavFpsMoveSpeedChange,
  onSceneNavNoKeyframesChange,
  onSceneNavTouchControlsVisibleChange,
  onSpeedChange,
  onLinkedAudioSpeedChange,
  onFreeRunToggle,
  onThreeDEffectorsToggle,
  onToggle3D,
  onWireframeToggle,
}: OptionsSectionProps) {
  if (isCameraClip) {
    const navigationTitle = 'Click preview, then WASD move, Q/E up-down, LMB orbit, RMB look, MMB/Shift+LMB pan, wheel moves camera.';

    return (
      <ResolveInspectorSection
        className="resolve-camera-navigation-section"
        indicator="none"
        title="Navigation"
      >
        <ResolveInspectorRow
          actions={(
            <ResolveInspectorIconButton
              active={sceneNavNoKeyframes}
              ariaLabel="Live camera override: MIDI and scene-nav controls do not write camera keyframes"
              className="resolve-camera-keyframe-mode-button"
              onClick={() => onSceneNavNoKeyframesChange(!sceneNavNoKeyframes)}
            >
              <NoKeyframesIcon crossedOut={sceneNavNoKeyframes} />
            </ResolveInspectorIconButton>
          )}
          label="Controls"
          title={navigationTitle}
        >
          <span className="resolve-camera-navigation-summary">Orbit / Look / Pan</span>
        </ResolveInspectorRow>
        <ResolveInspectorRow label="Mode">
          <div className="resolve-camera-navigation-actions">
            <ResolveInspectorIconButton
              active={!sceneNavFpsMode}
              ariaLabel="Orbit camera navigation"
              onClick={() => onSceneNavFpsModeChange(false)}
            >
              Orbit
            </ResolveInspectorIconButton>
            <ResolveInspectorIconButton
              active={sceneNavFpsMode}
              ariaLabel="FPS camera navigation"
              onClick={() => onSceneNavFpsModeChange(true)}
            >
              FPS
            </ResolveInspectorIconButton>
          </div>
        </ResolveInspectorRow>
        <ResolveInspectorRow label="Touch Overlay">
          <button
            aria-label="Show FPS touch controls on Preview"
            aria-pressed={sceneNavTouchControlsVisible}
            className={`transform-inspector-button${sceneNavTouchControlsVisible ? ' is-active' : ''}`}
            onClick={() => onSceneNavTouchControlsVisibleChange(!sceneNavTouchControlsVisible)}
            type="button"
          >
            {sceneNavTouchControlsVisible ? 'On' : 'Off'}
          </button>
        </ResolveInspectorRow>
        <ResolveInspectorRow label="Move Speed">
          <div className="resolve-camera-navigation-speed" title="WASD/QE movement speed">
            <input
              aria-label="Camera movement speed"
              max={SCENE_NAV_FPS_MOVE_SPEED_STEPS.length - 1}
              min={0}
              onChange={(event) => {
                const nextSpeed = SCENE_NAV_FPS_MOVE_SPEED_STEPS[Number(event.target.value)];
                if (nextSpeed !== undefined) onSceneNavFpsMoveSpeedChange(nextSpeed);
              }}
              step={1}
              type="range"
              value={sceneNavFpsMoveSpeedIndex}
            />
            <output>{sceneNavFpsMoveSpeed.toFixed(1)}x</output>
          </div>
        </ResolveInspectorRow>
      </ResolveInspectorSection>
    );
  }

  if (inspectorOnly) {
    return (
      <ResolveInspectorSection
        className="resolve-model-options-section"
        indicator="none"
        title="3D Options"
      >
        {isModel && modelPrimitiveOptions.length > 1 && (
          <ResolveInspectorRow label="Mesh">
            <InspectorSelect
              ariaLabel="Mesh"
              onChange={(value) => {
                onModelPrimitiveIndexChange(value === '' ? undefined : Number(value));
              }}
              options={[
                { label: 'All Meshes', value: '' },
                ...modelPrimitiveOptions.map(option => ({
                  label: option.label,
                  value: String(option.index),
                })),
              ]}
              value={modelPrimitiveIndex === undefined ? '' : String(modelPrimitiveIndex)}
            />
          </ResolveInspectorRow>
        )}
        {isModel && (
          <ResolveInspectorRow label="Wireframe">
            <button
              aria-label="Wireframe"
              aria-pressed={wireframe}
              className={`transform-inspector-button${wireframe ? ' is-active' : ''}`}
              onClick={onWireframeToggle}
              type="button"
            >
              {wireframe ? 'On' : 'Off'}
            </button>
          </ResolveInspectorRow>
        )}
        {supportsThreeDEffectorToggle && (
          <ResolveInspectorRow label="3D Effector">
            <button
              aria-label="3D Effector"
              aria-pressed={threeDEffectorsEnabled}
              className={`transform-inspector-button${threeDEffectorsEnabled ? ' is-active' : ''}`}
              disabled={!canToggleThreeDEffectors}
              onClick={onThreeDEffectorsToggle}
              type="button"
            >
              {threeDEffectorsEnabled ? 'On' : 'Off'}
            </button>
          </ResolveInspectorRow>
        )}
      </ResolveInspectorSection>
    );
  }

  const realtimeAudioPreviewLimited = Math.abs(speed) < 0.25 || Math.abs(speed) > 4;
  return (
    <div className="properties-section transform-options-section">
      {!isCameraClip && !layerModeControlsInSource && (
        <div className="control-row transform-mode-row">
          <LayerModeControls
            freeRun={freeRun}
            isEffectively3D={isEffectively3D}
            isLocked3D={isLocked3D}
            supportsFreeRun={supportsFreeRun}
            onFreeRunToggle={onFreeRunToggle}
            onToggle3D={onToggle3D}
          />
          {isModel && (
            <button
              className={`btn btn-xs ${wireframe ? 'btn-active' : ''}`}
              onClick={onWireframeToggle}
              title={wireframe ? 'Show solid' : 'Show wireframe'}
              style={wireframe ? { color: '#4488ff' } : undefined}
            >
              Wire
            </button>
          )}
        </div>
      )}
      {isModel && modelPrimitiveOptions.length > 1 && (
        <div className="control-row transform-option-row">
          <label className="prop-label">Mesh</label>
          <InspectorSelect
            ariaLabel="Mesh"
            onChange={(value) => {
              onModelPrimitiveIndexChange(value === '' ? undefined : Number(value));
            }}
            options={[
              { label: 'All Meshes', value: '' },
              ...modelPrimitiveOptions.map(option => ({
                label: option.label,
                value: String(option.index),
              })),
            ]}
            value={modelPrimitiveIndex === undefined ? '' : String(modelPrimitiveIndex)}
          />
        </div>
      )}
      {supportsThreeDEffectorToggle && (
        <div className="control-row transform-option-row">
          <label className="prop-label">3D Effector</label>
          {canToggleThreeDEffectors && (
            <button
              className={`btn btn-xs ${threeDEffectorsEnabled ? 'btn-active' : ''}`}
              onClick={onThreeDEffectorsToggle}
              title={threeDEffectorsEnabled ? 'Disable 3D effector influence' : 'Enable 3D effector influence'}
            >
              {threeDEffectorsEnabled ? 'On' : 'Off'}
            </button>
          )}
        </div>
      )}
      {!isCameraClip && (
        <div className="control-row transform-blend-opacity-row">
          <div className="transform-inline-opacity-control">
            <label className="prop-label">Opacity</label>
            <LabeledValue
              className="transform-inline-keyframed-value"
              label=""
              value={opacityPct}
              onChange={onOpacityChange}
              defaultValue={100}
              decimals={1}
              suffix="%"
              min={0}
              max={100}
              sensitivity={1}
              onDragStart={onBatchStart}
              onDragEnd={onBatchEnd}
              keyframeToggle={<KeyframeToggle clipId={clipId} property="opacity" value={opacity} />}
              midiTarget={createMidiTarget('opacity', 'Opacity', opacity, 0, 1)}
            />
          </div>
          <div className="transform-inline-blend-control">
            <label className="prop-label">Blend</label>
            <InspectorSelect
              ariaLabel="Blend mode"
              groups={BLEND_MODE_GROUPS.map(group => ({
                label: group.label,
                options: group.modes.map(mode => ({
                  label: formatBlendModeName(mode),
                  value: mode,
                })),
              }))}
              onChange={onBlendModeChange}
              touchScrollSelection
              value={blendMode}
              wheelSelection
            />
          </div>
        </div>
      )}
      {!isCameraClip && (
        <div className="control-row transform-speed-row">
          <label className="prop-label">Speed</label>
          <div className="transform-speed-controls">
            <LabeledValue
              className="transform-inline-keyframed-value"
              label=""
              value={speedPct}
              onChange={onSpeedChange}
              defaultValue={100}
              decimals={0}
              suffix="%"
              min={CLIP_SPEED_MIN_PERCENT}
              max={CLIP_SPEED_MAX_PERCENT}
              sensitivity={1}
              onDragStart={onBatchStart}
              onDragEnd={onBatchEnd}
              keyframeToggle={<KeyframeToggle clipId={clipId} property="speed" value={speed} />}
              midiTarget={createMidiTarget(
                'speed',
                'Speed',
                speed,
                CLIP_SPEED_MIN_SIGNED_MULTIPLIER,
                CLIP_SPEED_MAX_MULTIPLIER,
              )}
            />
            {linkedAudioSpeedEnabled !== undefined && onLinkedAudioSpeedChange && (
              <button
                type="button"
                className={`transform-icon-toggle transform-compact-action-button${linkedAudioSpeedEnabled ? ' is-active' : ''}`}
                onClick={() => onLinkedAudioSpeedChange(!linkedAudioSpeedEnabled)}
                aria-label="Linked Audio"
                aria-pressed={linkedAudioSpeedEnabled}
                title={linkedAudioSpeedEnabled
                  ? 'Unlink audio from video speed'
                  : 'Link audio to video speed'}
              >
                <LinkedAudioIcon />
              </button>
            )}
          </div>
        </div>
      )}
      {!isCameraClip && realtimeAudioPreviewLimited && (
        <div className="control-row">
          <span className="hint">Exact audio timing is used for export; browser preview is limited outside 25-400%.</span>
        </div>
      )}
    </div>
  );
}
