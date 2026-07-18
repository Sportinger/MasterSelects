import { SCENE_NAV_FPS_MOVE_SPEED_STEPS } from '../../../../stores/engineStore';
import { DraggableNumber, KeyframeToggle } from '../shared';
import { BLEND_MODE_GROUPS, formatBlendModeName } from '../sharedConstants';
import { MIDIParameterLabel } from '../MIDIParameterLabel';
import {
  FpsModeIcon,
  NoKeyframesIcon,
  ResetAllIcon,
  SetAllKeyframesIcon,
} from './SceneNavIcons';
import type { CreateMidiTarget } from './transformTabTypes';

interface OptionsSectionProps {
  clipId: string;
  blendMode: string;
  canToggleThreeDEffectors: boolean;
  isCameraClip: boolean;
  isEffectively3D: boolean;
  isLocked3D: boolean;
  isModel: boolean;
  modelPrimitiveIndex?: number;
  modelPrimitiveOptions: readonly { index: number; label: string }[];
  opacity: number;
  opacityPct: number;
  sceneNavFpsMode: boolean;
  sceneNavFpsMoveSpeed: number;
  sceneNavFpsMoveSpeedIndex: number;
  sceneNavNoKeyframes: boolean;
  speed: number;
  speedPct: number;
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
  onResetAll: () => void;
  onSceneNavFpsModeChange: (enabled: boolean) => void;
  onSceneNavFpsMoveSpeedChange: (speed: number) => void;
  onSceneNavNoKeyframesChange: (enabled: boolean) => void;
  onSetAllCameraKeyframes: () => void;
  onSpeedChange: (pct: number) => void;
  onFreeRunToggle: () => void;
  onThreeDEffectorsToggle: () => void;
  onToggle3D: () => void;
  onWireframeToggle: () => void;
}

const CLIP_SPEED_MIN_PERCENT = -10000;
const CLIP_SPEED_MAX_PERCENT = 10000;
const CLIP_SPEED_MIN_MULTIPLIER = CLIP_SPEED_MIN_PERCENT / 100;
const CLIP_SPEED_MAX_MULTIPLIER = CLIP_SPEED_MAX_PERCENT / 100;

export function OptionsSection({
  clipId,
  blendMode,
  canToggleThreeDEffectors,
  isCameraClip,
  isEffectively3D,
  isLocked3D,
  isModel,
  modelPrimitiveIndex,
  modelPrimitiveOptions,
  opacity,
  opacityPct,
  sceneNavFpsMode,
  sceneNavFpsMoveSpeed,
  sceneNavFpsMoveSpeedIndex,
  sceneNavNoKeyframes,
  speed,
  speedPct,
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
  onResetAll,
  onSceneNavFpsModeChange,
  onSceneNavFpsMoveSpeedChange,
  onSceneNavNoKeyframesChange,
  onSetAllCameraKeyframes,
  onSpeedChange,
  onFreeRunToggle,
  onThreeDEffectorsToggle,
  onToggle3D,
  onWireframeToggle,
}: OptionsSectionProps) {
  return (
    <div className="properties-section">
      {isCameraClip && (
        <div
          className="control-row transform-option-row scene-nav-row"
          title={sceneNavFpsMode
            ? 'Click preview, hold LMB to look, WASD/QE move, MMB/RMB/Shift+LMB pan, wheel speed while moving/looking, wheel moves camera otherwise.'
            : 'Click preview, then WASD move, Q/E up-down, LMB orbit, MMB/RMB/Shift+LMB pan, wheel moves camera.'}
        >
          <label className="prop-label">Nav Mode</label>
          <button
            className={`btn btn-xs scene-nav-icon-btn ${sceneNavFpsMode ? 'btn-active' : ''}`}
            onClick={() => onSceneNavFpsModeChange(!sceneNavFpsMode)}
            title={sceneNavFpsMode ? 'Use orbit mouse look' : 'Use FPS mouse look'}
            aria-label={sceneNavFpsMode ? 'Use orbit mouse look' : 'Use FPS mouse look'}
          >
            <FpsModeIcon />
          </button>
          <button
            className={`btn btn-xs scene-nav-icon-btn ${sceneNavNoKeyframes ? 'btn-active' : ''}`}
            onClick={() => onSceneNavNoKeyframesChange(!sceneNavNoKeyframes)}
            title="Live camera override: MIDI and scene-nav controls do not write camera keyframes"
            aria-label="Live camera override: MIDI and scene-nav controls do not write camera keyframes"
          >
            <NoKeyframesIcon />
          </button>
          <button
            className="btn btn-xs scene-nav-icon-btn"
            onClick={onSetAllCameraKeyframes}
            title="Enable all camera transform stopwatches and set keyframes at the playhead"
            aria-label="Enable all camera transform stopwatches and set keyframes at the playhead"
          >
            <SetAllKeyframesIcon />
          </button>
          <button
            className="btn btn-xs scene-nav-icon-btn"
            onClick={onResetAll}
            title="Reset camera transform"
            aria-label="Reset camera transform"
          >
            <ResetAllIcon />
          </button>
          {sceneNavFpsMode && (
            <div className="scene-nav-speed-control" title="FPS movement speed">
              <input
                type="range"
                min={0}
                max={SCENE_NAV_FPS_MOVE_SPEED_STEPS.length - 1}
                step={1}
                value={sceneNavFpsMoveSpeedIndex}
                onChange={(event) => {
                  const nextSpeed = SCENE_NAV_FPS_MOVE_SPEED_STEPS[Number(event.target.value)];
                  if (nextSpeed !== undefined) onSceneNavFpsMoveSpeedChange(nextSpeed);
                }}
              />
              <span>{sceneNavFpsMoveSpeed.toFixed(1)}x</span>
            </div>
          )}
        </div>
      )}
      {!isCameraClip && (
        <div className="control-row transform-option-row">
          <label className="prop-label">3D Layer</label>
          {isLocked3D ? (
            <span className="btn btn-xs btn-active" style={{ cursor: 'default' }}>3D</span>
          ) : (
            <button
              className={`btn btn-xs ${isEffectively3D ? 'btn-active' : ''}`}
              onClick={onToggle3D}
              title={isEffectively3D ? 'Disable 3D layer' : 'Enable 3D layer'}
            >
              {isEffectively3D ? '3D' : '2D'}
            </button>
          )}
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
          <select
            value={modelPrimitiveIndex ?? ''}
            onChange={(event) => {
              const value = event.target.value;
              onModelPrimitiveIndexChange(value === '' ? undefined : Number(value));
            }}
          >
            <option value="">All Meshes</option>
            {modelPrimitiveOptions.map((option) => (
              <option key={option.index} value={option.index}>
                {option.label}
              </option>
            ))}
          </select>
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
        <div className="control-row transform-option-row">
          <label className="prop-label">Blend</label>
          <select value={blendMode} onChange={(event) => onBlendModeChange(event.target.value)}>
            {BLEND_MODE_GROUPS.map((group) => (
              <optgroup key={group.label} label={group.label}>
                {group.modes.map((mode) => (
                  <option key={mode} value={mode}>{formatBlendModeName(mode)}</option>
                ))}
              </optgroup>
            ))}
          </select>
        </div>
      )}
      {!isCameraClip && (
        <div className="control-row transform-param-row">
          <KeyframeToggle clipId={clipId} property="opacity" value={opacity} />
          <MIDIParameterLabel
            as="label"
            className="prop-label"
            target={createMidiTarget('opacity', 'Opacity', opacity, 0, 1)}
          >
            Opacity
          </MIDIParameterLabel>
          <DraggableNumber
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
          />
        </div>
      )}
      {!isCameraClip && (
        <div className="control-row transform-param-row">
          <KeyframeToggle clipId={clipId} property="speed" value={speed} />
          <MIDIParameterLabel
            as="label"
            className="prop-label"
            target={createMidiTarget(
              'speed',
              'Speed',
              speed,
              CLIP_SPEED_MIN_MULTIPLIER,
              CLIP_SPEED_MAX_MULTIPLIER,
            )}
          >
            Speed <span className="menu-wip-badge">WIP</span>
          </MIDIParameterLabel>
          <DraggableNumber
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
          />
        </div>
      )}
      {supportsFreeRun && (
        <div className="control-row transform-option-row">
          <label className="prop-label" htmlFor={`free-run-${clipId}`}>Free Run</label>
          <input
            id={`free-run-${clipId}`}
            type="checkbox"
            checked={freeRun}
            onChange={onFreeRunToggle}
            title="Loop this video independently of the timeline playhead"
          />
        </div>
      )}
    </div>
  );
}
