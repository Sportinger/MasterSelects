import type { EffectControlProps } from '../../../effects/types';
import { chromaKey } from '../../../effects/keying/chroma-key';
import {
  CHROMA_KEY_DEFAULT_SCREEN_COLOR, CHROMA_KEY_FULL_SCREEN_PURITY, chromaKeyHexColor, chromaKeyNumbers, chromaKeyScreen, chromaKeyScreenPurity,
  chromaKeySpillMethod,
} from '../../../effects/keying/chroma-key/keyerContract';
import { getParameterSourceTarget } from '../../../services/parameterSources/parameterSourceTargets';
import { useTimelineStore } from '../../../stores/timeline';
import type { AnimatableProperty } from '../../../types/animationProperties';
import { InspectorSelect } from '../../inspector/InspectorSelect';
import { ParameterSourceNumberRow } from './ParameterSourceNumberRow';
import { ResolveInspectorNumberRow } from './resolveInspector/ResolveInspectorNumberRow';
import { ResolveInspectorRow, ResolveInspectorSection } from './resolveInspector/ResolveInspectorPrimitives';
import { KeyframeToggle } from './shared';

type NumberKey = 'clipBlack' | 'clipWhite' | 'edgeShrink' | 'edgeSoftness' | 'spillSuppression';
const SUFFIX: Partial<Record<NumberKey, string>> = { edgeShrink: 'px', edgeSoftness: 'px' };
const CLAMPED_LABEL: Record<string, string> = {
  clipBlack: 'Clip Black', clipWhite: 'Clip White', spillSuppression: 'Spill Suppression', edgeSoftness: 'Edge Softness', edgeShrink: 'Shrink / Grow',
};

/** Chroma Key inspector: screen choice, matte levels, edge and spill in the shared Resolve inspector rows. */
export function ChromaKeyControls({ params, onChange, clipId, effectInstanceId }: EffectControlProps) {
  const setPropertyValue = useTimelineStore(state => state.setPropertyValue);
  const clip = useTimelineStore(state => state.clips.find(item => item.id === clipId));
  const screen = chromaKeyScreen(params.keyColor);
  const screenColor = typeof params.screenColor === 'string' ? params.screenColor : CHROMA_KEY_DEFAULT_SCREEN_COLOR;
  const greyPick = screen === 'custom' && chromaKeyScreenPurity(chromaKeyHexColor(screenColor)) < CHROMA_KEY_FULL_SCREEN_PURITY;
  const clamped = chromaKeyNumbers(params).clamped;
  const change = (key: string, value: number | string) => onChange({ ...params, [key]: value });
  const changeNumber = (key: NumberKey, value: number) => clipId && effectInstanceId
    ? setPropertyValue(clipId, `effect.${effectInstanceId}.${key}` as AnimatableProperty, value)
    : change(key, value);
  const numberRow = (key: NumberKey) => {
    const definition = chromaKey.params[key];
    const property = `effect.${effectInstanceId}.${key}`;
    if (clip && effectInstanceId && getParameterSourceTarget(clip, property)) return <ParameterSourceNumberRow key={key} clipId={clip.id} property={property} />;
    const value = typeof params[key] === 'number' ? params[key] as number : definition.default as number;
    return <ResolveInspectorNumberRow key={key} label={definition.label} value={value} defaultValue={definition.default as number}
      min={definition.min!} max={definition.max!} step={definition.step!} decimals={2} suffix={SUFFIX[key]}
      keyframeToggle={clipId && effectInstanceId ? <KeyframeToggle clipId={clipId} property={property as AnimatableProperty} value={value} /> : undefined}
      onChange={next => changeNumber(key, next)} />;
  };
  // Pointer activation must not leave a focus ring on selects, buttons or the colour well (keyboard focus stays visible).
  return <div className="effects-tab transform-tab-compact" onPointerUp={event => {
    if (event.target instanceof Element) event.target.closest<HTMLElement>('button, select, input[type="color"]')?.blur();
  }}>
    <ResolveInspectorSection title="Key" indicator="none">
      <ResolveInspectorRow label="Screen">
        <InspectorSelect wheelSelection ariaLabel="Chroma Key screen" value={screen} options={chromaKey.params.keyColor.options!}
          onChange={value => change('keyColor', value)} />
      </ResolveInspectorRow>
      {screen === 'custom' ? <ResolveInspectorRow label="Screen color">
        <input type="color" aria-label="Chroma Key screen color" value={screenColor} onChange={event => change('screenColor', event.target.value)} />
      </ResolveInspectorRow> : <p className="tracking-panel-status">Screen color is measured from every frame.</p>}
      {greyPick && <p className="tracking-panel-status" role="status">This color is too grey to key. Pick the screen itself, where it is most saturated.</p>}
      <ResolveInspectorRow label="View">
        <InspectorSelect ariaLabel="Chroma Key view" value={params.view === 'matte' ? 'matte' : 'result'} options={chromaKey.params.view.options!}
          onChange={value => change('view', value)} />
      </ResolveInspectorRow>
    </ResolveInspectorSection>
    <ResolveInspectorSection title="Matte" indicator="none">
      {numberRow('clipBlack')}
      {numberRow('clipWhite')}
    </ResolveInspectorSection>
    <ResolveInspectorSection title="Edge" indicator="none">
      {numberRow('edgeShrink')}
      {numberRow('edgeSoftness')}
    </ResolveInspectorSection>
    <ResolveInspectorSection title="Spill" indicator="none">
      {numberRow('spillSuppression')}
      <ResolveInspectorRow label="Spill Method">
        <InspectorSelect ariaLabel="Chroma Key spill method" value={chromaKeySpillMethod(params.spillMethod)} options={chromaKey.params.spillMethod.options!}
          onChange={value => change('spillMethod', value)} />
      </ResolveInspectorRow>
    </ResolveInspectorSection>
    {clamped.length > 0 && <p className="tracking-panel-status" role="status">
      Out of range, used at its limit: {clamped.map(key => CLAMPED_LABEL[key] ?? key).join(', ')}.
    </p>}
  </div>;
}
