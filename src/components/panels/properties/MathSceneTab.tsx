import { useCallback, useMemo, useState } from 'react';
import type { MathFunctionObject, MathParameter, MathSceneDefinition } from '../../../types';
import { useTimelineStore } from '../../../stores/timeline';
import {
  createMathSceneTemplate,
  MATH_SCENE_TEMPLATES,
  type MathSceneTemplateId,
} from '../../../services/mathScene/templates';

interface MathSceneTabProps {
  clipId: string;
  mathScene: MathSceneDefinition;
}

function NumberField({
  label,
  value,
  step = 0.1,
  onChange,
}: {
  label: string;
  value: number;
  step?: number;
  onChange: (value: number) => void;
}) {
  return (
    <label className="tt-compact-num" title={label}>
      <span className="tt-num-icon" style={{ fontSize: 10 }}>{label}</span>
      <input
        type="number"
        value={Number.isFinite(value) ? value : 0}
        step={step}
        onChange={(event) => onChange(Number(event.target.value))}
      />
    </label>
  );
}

function parseSceneJson(value: string): MathSceneDefinition {
  const parsed = JSON.parse(value) as unknown;
  if (!parsed || typeof parsed !== 'object') {
    throw new Error('Scene must be an object');
  }

  const scene = parsed as Record<string, unknown>;
  if (!scene.viewport || typeof scene.viewport !== 'object') {
    throw new Error('Missing viewport');
  }
  if (!scene.style || typeof scene.style !== 'object') {
    throw new Error('Missing style');
  }
  if (!Array.isArray(scene.objects)) {
    throw new Error('Missing objects');
  }
  if (!Array.isArray(scene.parameters)) {
    throw new Error('Missing parameters');
  }

  return parsed as MathSceneDefinition;
}

export function MathSceneTab({ clipId, mathScene }: MathSceneTabProps) {
  const updateMathScene = useTimelineStore((state) => state.updateMathScene);
  const updateMathObject = useTimelineStore((state) => state.updateMathObject);
  const updateMathParameter = useTimelineStore((state) => state.updateMathParameter);
  const [selectedTemplate, setSelectedTemplate] = useState<MathSceneTemplateId>('derivative-sine');
  const [sceneJsonDraft, setSceneJsonDraft] = useState<{ clipId: string; value: string } | null>(null);
  const [sceneJsonError, setSceneJsonError] = useState<{ clipId: string; message: string } | null>(null);

  const functionObject = mathScene.objects.find((object): object is MathFunctionObject => object.type === 'function');
  const parameter = mathScene.parameters[0];
  const currentSceneJson = useMemo(() => JSON.stringify(mathScene, null, 2), [mathScene]);
  const sceneJson = sceneJsonDraft?.clipId === clipId ? sceneJsonDraft.value : currentSceneJson;
  const sceneJsonErrorMessage = sceneJsonError?.clipId === clipId ? sceneJsonError.message : null;

  const updateViewport = useCallback((patch: Partial<MathSceneDefinition['viewport']>) => {
    updateMathScene(clipId, (scene) => ({
      ...scene,
      viewport: { ...scene.viewport, ...patch },
    }));
  }, [clipId, updateMathScene]);

  const updateParameter = useCallback((param: MathParameter, patch: Partial<MathParameter>) => {
    updateMathParameter(clipId, param.id, patch);
  }, [clipId, updateMathParameter]);

  const applyTemplate = useCallback(() => {
    updateMathScene(clipId, () => createMathSceneTemplate(selectedTemplate));
  }, [clipId, selectedTemplate, updateMathScene]);

  const applySceneJson = useCallback(() => {
    try {
      const parsed = parseSceneJson(sceneJson);
      updateMathScene(clipId, () => parsed);
      setSceneJsonError(null);
    } catch (error) {
      setSceneJsonError({
        clipId,
        message: error instanceof Error ? error.message : 'Invalid scene',
      });
    }
  }, [clipId, sceneJson, updateMathScene]);

  return (
    <div className="tt">
      <div className="tt-section">
        <div className="tt-section-header">Templates</div>
        <div className="tt-row-2col">
          <select
            className="tt-select-full"
            value={selectedTemplate}
            onChange={(event) => setSelectedTemplate(event.target.value as MathSceneTemplateId)}
          >
            {MATH_SCENE_TEMPLATES.map((template) => (
              <option key={template.id} value={template.id}>{template.name}</option>
            ))}
          </select>
          <button className="btn btn-xs" type="button" onClick={applyTemplate}>
            Apply
          </button>
        </div>
      </div>

      <div className="tt-section">
        <div className="tt-section-header">Graph</div>
        {functionObject && (
          <>
            <input
              className="tt-select-full"
              value={functionObject.expression}
              onChange={(event) => updateMathObject(clipId, functionObject.id, { expression: event.target.value })}
              placeholder="sin(x)"
              spellCheck={false}
            />
            <div className="tt-color-row">
              <input
                type="color"
                className="tt-color-swatch"
                value={functionObject.stroke}
                onChange={(event) => updateMathObject(clipId, functionObject.id, { stroke: event.target.value })}
                title="Graph Color"
              />
              <span className="tt-color-label">Stroke</span>
              <input
                type="text"
                className="tt-color-hex"
                value={functionObject.stroke}
                onChange={(event) => updateMathObject(clipId, functionObject.id, { stroke: event.target.value })}
              />
            </div>
            <div className="tt-row-2col">
              <NumberField
                label="W"
                value={functionObject.strokeWidth}
                step={0.5}
                onChange={(value) => updateMathObject(clipId, functionObject.id, { strokeWidth: value })}
              />
              <NumberField
                label="S"
                value={functionObject.samples}
                step={20}
                onChange={(value) => updateMathObject(clipId, functionObject.id, { samples: Math.max(16, Math.round(value)) })}
              />
            </div>
          </>
        )}
      </div>

      {parameter && (
        <div className="tt-section">
          <div className="tt-section-header">Parameter</div>
          <input
            className="tt-select-full"
            value={parameter.name}
            onChange={(event) => updateParameter(parameter, { name: event.target.value.trim() || parameter.name })}
            spellCheck={false}
          />
          <div className="tt-row-2col">
            <NumberField label="Min" value={parameter.min} onChange={(value) => updateParameter(parameter, { min: value })} />
            <NumberField label="Max" value={parameter.max} onChange={(value) => updateParameter(parameter, { max: value })} />
          </div>
          <div className="tt-row-2col">
            <NumberField label="Val" value={parameter.value} onChange={(value) => updateParameter(parameter, { value })} />
            <NumberField label="Step" value={parameter.step} step={0.01} onChange={(value) => updateParameter(parameter, { step: value })} />
          </div>
          {parameter.animation && (
            <>
              <div className="tt-section-header">Animate</div>
              <label className="tt-toggle-header">
                <input
                  type="checkbox"
                  checked={parameter.animation.enabled}
                  onChange={(event) => updateParameter(parameter, {
                    animation: { ...parameter.animation!, enabled: event.target.checked },
                  })}
                />
                Parameter over clip time
              </label>
              <div className="tt-row-2col">
                <NumberField
                  label="From"
                  value={parameter.animation.from}
                  onChange={(value) => updateParameter(parameter, { animation: { ...parameter.animation!, from: value } })}
                />
                <NumberField
                  label="To"
                  value={parameter.animation.to}
                  onChange={(value) => updateParameter(parameter, { animation: { ...parameter.animation!, to: value } })}
                />
              </div>
              <div className="tt-row-2col">
                <NumberField
                  label="In"
                  value={parameter.animation.startTime}
                  onChange={(value) => updateParameter(parameter, { animation: { ...parameter.animation!, startTime: value } })}
                />
                <NumberField
                  label="Out"
                  value={parameter.animation.endTime}
                  onChange={(value) => updateParameter(parameter, { animation: { ...parameter.animation!, endTime: value } })}
                />
              </div>
            </>
          )}
        </div>
      )}

      <div className="tt-section">
        <div className="tt-section-header">Viewport</div>
        <div className="tt-row-2col">
          <NumberField label="X-" value={mathScene.viewport.xMin} onChange={(value) => updateViewport({ xMin: value })} />
          <NumberField label="X+" value={mathScene.viewport.xMax} onChange={(value) => updateViewport({ xMax: value })} />
        </div>
        <div className="tt-row-2col">
          <NumberField label="Y-" value={mathScene.viewport.yMin} onChange={(value) => updateViewport({ yMin: value })} />
          <NumberField label="Y+" value={mathScene.viewport.yMax} onChange={(value) => updateViewport({ yMax: value })} />
        </div>
        <label className="tt-toggle-header">
          <input
            type="checkbox"
            checked={mathScene.viewport.showGrid}
            onChange={(event) => updateViewport({ showGrid: event.target.checked })}
          />
          Grid
        </label>
        <label className="tt-toggle-header">
          <input
            type="checkbox"
            checked={mathScene.viewport.showAxes}
            onChange={(event) => updateViewport({ showAxes: event.target.checked })}
          />
          Axes
        </label>
      </div>

      <div className="tt-section">
        <div className="tt-section-header">Scene JSON</div>
        <textarea
          className="tt-textarea"
          value={sceneJson}
          onChange={(event) => setSceneJsonDraft({ clipId, value: event.target.value })}
          spellCheck={false}
          rows={10}
        />
        <div className="tt-row-2col">
          <button className="btn btn-xs" type="button" onClick={applySceneJson}>
            Apply
          </button>
          <button
            className="btn btn-xs"
            type="button"
            onClick={() => {
              setSceneJsonDraft(null);
              setSceneJsonError(null);
            }}
          >
            Reset
          </button>
        </div>
        {sceneJsonErrorMessage && (
          <div style={{ color: '#f97316', fontSize: 11, marginTop: 6 }}>
            {sceneJsonErrorMessage}
          </div>
        )}
      </div>
    </div>
  );
}
