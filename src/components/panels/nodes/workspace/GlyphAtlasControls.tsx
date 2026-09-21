import type { ReactNode } from 'react';
import type { EffectParam } from '../../../../effects/types';
import type { BoundOperatorNode, OperatorValue } from '../../../../types/operatorGraph';
import { InspectorSelect } from '../../../inspector/InspectorSelect';
import {
  ResolveInspectorIconButton,
  ResolveInspectorRow,
  ResolveResetIcon,
} from '../../properties/resolveInspector/ResolveInspectorPrimitives';

const BINDINGS = ['rampPreset', 'customRamp', 'fontFamily', 'fontWeight'] as const;
type GlyphBinding = typeof BINDINGS[number];

interface GlyphAtlasControlsProps {
  bindings: BoundOperatorNode['bindings'];
  params: Record<string, unknown>;
  parameterSchema?: Record<string, EffectParam>;
  onChange: (key: string, value: OperatorValue) => void;
  renderNumber: (key: string, schema: EffectParam, value: number) => ReactNode;
}

/** Effect-owned controls for the metadata-only glyph atlas operator. */
export function GlyphAtlasControls({ bindings, params, parameterSchema, onChange, renderNumber }: GlyphAtlasControlsProps) {
  const names = Object.fromEntries(BINDINGS.map(id => [id, bindings[id]])) as Record<GlyphBinding, unknown>;
  const expected = { rampPreset: 'select', customRamp: 'text', fontFamily: 'select', fontWeight: 'number' } as const;
  const invalid = BINDINGS.find(id => typeof names[id] !== 'string' || parameterSchema?.[names[id] as string]?.type !== expected[id]);
  if (invalid) return <p role="alert">Glyph Atlas control schema is unavailable for {invalid}.</p>;

  const binding = names as Record<GlyphBinding, string>;
  const schema = (id: GlyphBinding) => parameterSchema![binding[id]];
  const select = (id: 'rampPreset' | 'fontFamily') => {
    const spec = schema(id), key = binding[id];
    return <ResolveInspectorRow key={id} label={spec.label}>
      <InspectorSelect ariaLabel={`Glyph Atlas ${spec.label}`} value={String(params[key] ?? spec.default)} options={[...(spec.options ?? [])]}
        onChange={value => onChange(key, value)} onReset={() => onChange(key, spec.default)} />
    </ResolveInspectorRow>;
  };
  const custom = schema('customRamp'), customKey = binding.customRamp;
  const weight = schema('fontWeight'), weightKey = binding.fontWeight;

  return <>
    {select('rampPreset')}
    <ResolveInspectorRow label={custom.label} actions={<ResolveInspectorIconButton ariaLabel={`Reset ${custom.label}`}
      className="resolve-inspector-reset-button" onClick={() => onChange(customKey, custom.default)}><ResolveResetIcon /></ResolveInspectorIconButton>}>
      <input aria-label={`Glyph Atlas ${custom.label}`} className="resolve-inspector-text-input"
        type="text" value={String(params[customKey] ?? custom.default)} onChange={event => onChange(customKey, event.target.value)} />
    </ResolveInspectorRow>
    {select('fontFamily')}
    {renderNumber(weightKey, weight, Number(params[weightKey] ?? weight.default))}
  </>;
}
