import { useEffect, useMemo, useState, type PointerEvent } from 'react';
import type { EffectControlProps } from '../../../effects/types';
import type { EffectOperatorGraph } from '../../../types/operatorGraph';
import { graphBoundParameters } from '../../../services/operators/effectParamVisibility';
import { chromaKey } from '../../../effects/keying/chroma-key';
import { chromaKeyScreenProbeMessage, probeChromaKeyScreen } from '../../../effects/keying/chroma-key/screenProbe';
import { useMediaStore } from '../../../stores/mediaStore';
import {
  CHROMA_KEY_DEFAULT_SCREEN_COLOR, CHROMA_KEY_FULL_SCREEN_PURITY, chromaKeyHexColor, chromaKeyNumbers, chromaKeyScreen, chromaKeyScreenPurity,
  chromaKeySpillMethod,
} from '../../../effects/keying/chroma-key/keyerContract';
import { finiteEffectNumber } from '../../../effects/_shared/effectNumberParam';
import { getParameterSourceTarget } from '../../../services/parameterSources/parameterSourceTargets';
import { useTimelineStore } from '../../../stores/timeline';
import type { AnimatableProperty } from '../../../types/animationProperties';
import { InspectorSelect } from '../../inspector/InspectorSelect';
import { ParameterSourceNumberRow } from './ParameterSourceNumberRow';
import { ResolveInspectorColorRow } from './resolveInspector/ResolveInspectorColorRow';
import { ResolveInspectorNumberRow } from './resolveInspector/ResolveInspectorNumberRow';
import { ResolveInspectorRow, ResolveInspectorSection } from './resolveInspector/ResolveInspectorPrimitives';
import { KeyframeToggle } from './shared';

type NumberKey = 'clipBlack' | 'clipWhite' | 'edgeShrink' | 'edgeSoftness' | 'spillSuppression' | 'tolerance' | 'softness';
const SUFFIX: Partial<Record<NumberKey, string>> = { edgeShrink: 'px', edgeSoftness: 'px' };
const LABEL: Record<string, string> = {
  clipBlack: 'Clip Black', clipWhite: 'Clip White', spillSuppression: 'Spill Suppression', edgeSoftness: 'Edge Softness', edgeShrink: 'Shrink / Grow',
};
const RETIRED = [['tolerance', 'Tolerance'], ['softness', 'old Edge Softness']] as const;
const NEW_KEYER = ['keyColor', 'screenColor', 'view', 'clipBlack', 'clipWhite', 'edgeShrink', 'edgeSoftness', 'spillSuppression', 'spillMethod'] as const;
const status = (text: string) => <p className="tracking-panel-status" role="status">{text}</p>;
const NO_THUMBNAILS: string[] = [];

/** Whether the clip's thumbnails show the chosen screen at all (screenProbe.ts); undefined until known. */
function useScreenProbe(clipId: string | undefined, screen: ReturnType<typeof chromaKeyScreen>, enabled: boolean): string | undefined {
  const thumbnails = useTimelineStore(state => state.clips.find(item => item.id === clipId)?.thumbnails ?? NO_THUMBNAILS);
  const mediaId = useTimelineStore(state => {
    const clip = state.clips.find(item => item.id === clipId); return clip?.source?.mediaFileId ?? clip?.mediaFileId;
  });
  const mediaThumbnail = useMediaStore(state => state.files.find(file => file.id === mediaId)?.thumbnailUrl);
  const urls = useMemo(() => thumbnails.length ? thumbnails : mediaThumbnail ? [mediaThumbnail] : NO_THUMBNAILS, [thumbnails, mediaThumbnail]);
  const [result, setResult] = useState<{ key: string; message?: string }>();
  const key = `${screen}|${urls.join('|').length}|${urls[0] ?? ''}`;
  useEffect(() => {
    if (!enabled) return;
    let current = true;
    void probeChromaKeyScreen(urls, screen).then(found => { if (current) setResult({ key, message: chromaKeyScreenProbeMessage(found, screen) }); });
    return () => { current = false; };
  }, [enabled, key, screen, urls]);
  return enabled && result?.key === key ? result.message : undefined;
}

/** Chroma Key inspector: screen choice, matte levels, edge and spill in the shared Resolve inspector rows.
 * A graph edited before the screen-matte rebuild keeps the old Rec.601 key: it gets the controls it reads. */
export function ChromaKeyControls({ params, onChange, clipId, effectInstanceId, operatorGraph }: EffectControlProps & { operatorGraph?: EffectOperatorGraph }) {
  // The old Rec.601 key is recognised by what it reads (Tolerance, Edge Softness), not by a missing new control:
  // an edited new graph keeps the new card and names the controls it no longer reads.
  const bound = useMemo(() => graphBoundParameters({ type: 'chroma-key', params: {}, operatorGraph }), [operatorGraph]);
  const legacyGraph = !!bound && RETIRED.some(([key]) => bound.has(key));
  const unread = bound && !legacyGraph ? NEW_KEYER.filter(key => !bound.has(key)) : [];
  const setPropertyValue = useTimelineStore(state => state.setPropertyValue);
  const clip = useTimelineStore(state => state.clips.find(item => item.id === clipId));
  // Keyframes on the retired parameters (from the old keyer) still exist but no longer act on the new key.
  const retiredKeyframes = useTimelineStore(state => RETIRED.filter(([key]) => !!clipId && !!effectInstanceId
    && state.hasKeyframes(clipId, `effect.${effectInstanceId}.${key}` as AnimatableProperty)).map(([key]) => key).join(','));
  const screen = chromaKeyScreen(params.keyColor);
  const noScreen = useScreenProbe(clipId, screen, !legacyGraph && params.view !== 'matte');
  const screenColor = typeof params.screenColor === 'string' ? params.screenColor : CHROMA_KEY_DEFAULT_SCREEN_COLOR;
  const greyPick = !legacyGraph && screen === 'custom' && chromaKeyScreenPurity(chromaKeyHexColor(screenColor)) < CHROMA_KEY_FULL_SCREEN_PURITY;
  const numbers = chromaKeyNumbers(params);
  const change = (key: string, value: number | string) => onChange({ ...params, [key]: value });
  const changeNumber = (key: NumberKey, value: number) => clipId && effectInstanceId && chromaKey.params[key].animatable
    ? setPropertyValue(clipId, `effect.${effectInstanceId}.${key}` as AnimatableProperty, value)
    : change(key, value);
  /** `label` shortens the name inside its section (Edge → Softness); tools and screen readers keep the full name. */
  const numberRow = (key: NumberKey, label?: string) => {
    const definition = chromaKey.params[key];
    const property = `effect.${effectInstanceId}.${key}`;
    if (clip && effectInstanceId && getParameterSourceTarget(clip, property)) return <ParameterSourceNumberRow key={key} clipId={clip.id} property={property} />;
    const value = finiteEffectNumber(params[key], definition.default as number);
    return <ResolveInspectorNumberRow key={key} label={label ?? definition.label} ariaLabel={definition.label} value={value} defaultValue={definition.default as number}
      min={definition.min!} max={definition.max!} step={definition.step!} decimals={2} suffix={SUFFIX[key]}
      keyframeToggle={clipId && effectInstanceId && definition.animatable ? <KeyframeToggle clipId={clipId} property={property as AnimatableProperty} value={value} /> : undefined}
      onChange={next => changeNumber(key, next)} />;
  };
  const screenRow = <ResolveInspectorRow label="Screen">
    <InspectorSelect wheelSelection ariaLabel="Chroma Key screen" value={screen} options={chromaKey.params.keyColor.options!}
      onChange={value => change('keyColor', value)} />
  </ResolveInspectorRow>;
  // Pointer activation must not leave a focus ring on selects or buttons (keyboard focus stays visible).
  const blurPointerFocus = (event: PointerEvent) => {
    if (event.target instanceof Element) event.target.closest<HTMLElement>('button, select')?.blur();
  };
  if (legacyGraph) return <div className="effects-tab effect-sections" onPointerUp={blurPointerFocus}>
    <ResolveInspectorSection title="Key (edited graph)" indicator="none">
      {screenRow}
      {numberRow('tolerance')}
      {numberRow('softness')}
      {numberRow('spillSuppression')}
    </ResolveInspectorSection>
    {status('This node graph was edited before the keyer was rebuilt, so it still keys with Tolerance and Edge Softness. '
      + 'Clip Black/White, Shrink/Grow, Spill Method, View and a picked screen colour need the new keyer: re-add Chroma Key to use them.')}
  </div>;

  const retiredValues = RETIRED.filter(([key]) => {
    const value = params[key];
    return value !== undefined && finiteEffectNumber(value, NaN) !== chromaKey.params[key].default;
  }).map(([key, label]) => `${label} ${finiteEffectNumber(params[key], NaN).toFixed(2)}`);
  const retiredAnimated = RETIRED.filter(([key]) => retiredKeyframes.split(',').includes(key)).map(([, label]) => `${label} keyframes`);
  const retired = [...retiredValues, ...retiredAnimated];
  // Before the rebuild 'Custom' keyed pure green and stored no screen colour.
  const oldCustom = screen === 'custom' && params.screenColor === undefined;
  return <div className="effects-tab effect-sections" onPointerUp={blurPointerFocus}>
    <ResolveInspectorSection title="Key" indicator="none">
      {screenRow}
      {screen === 'custom' ? <ResolveInspectorColorRow label="Screen color" ariaLabel="Chroma Key screen color" value={screenColor}
        defaultValue={CHROMA_KEY_DEFAULT_SCREEN_COLOR} onChange={value => change('screenColor', value)} />
        : <p className="tracking-panel-status">Screen color is measured from every frame.</p>}
      {greyPick && status('This color is too grey to key. Pick the screen itself, where it is most saturated.')}
      {noScreen && status(noScreen)}
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
      {numberRow('edgeSoftness', 'Softness')}
    </ResolveInspectorSection>
    <ResolveInspectorSection title="Spill" indicator="none">
      {numberRow('spillSuppression', 'Suppression')}
      <ResolveInspectorRow label="Method">
        <InspectorSelect ariaLabel="Chroma Key spill method" value={chromaKeySpillMethod(params.spillMethod)} options={chromaKey.params.spillMethod.options!}
          onChange={value => change('spillMethod', value)} />
      </ResolveInspectorRow>
    </ResolveInspectorSection>
    {unread.length > 0 && status(`This edited node graph does not read ${unread.map(key => LABEL[key] ?? chromaKey.params[key].label).join(', ')}, so ${unread.length > 1 ? 'they have' : 'it has'} no effect.`)}
    {oldCustom && status(`The old Custom key keyed pure green; Picked color now keys the colour above (${screenColor.toUpperCase()}). `
      + 'Pick your screen colour, or choose Green to measure it.')}
    {retired.length > 0 && status(`From the old keyer, no longer used: ${retired.join(', ')}. Set the key with Clip Black and Clip White.`)}
    {numbers.reversed && status('Clip Black is at or above Clip White, so the matte is a hard cut at Clip Black.')}
    {numbers.clamped.length > 0 && status(`Out of range, used at its limit: ${numbers.clamped.map(key => LABEL[key] ?? key).join(', ')}.`)}
    {numbers.invalid.length > 0 && status(`Not a number, used at its default: ${numbers.invalid.map(key => LABEL[key] ?? key).join(', ')}.`)}
  </div>;
}
