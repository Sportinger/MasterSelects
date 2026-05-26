import { useMemo, useState } from 'react';
import { createAudioEqVisualFixtureCases } from '../engine/audio/eq/AudioEqVisualFixtures';
import type { AudioEqParamsV2 } from '../engine/audio/eq/AudioEqTypes';
import type { AudioEffectParamValue } from '../types';
import { setAudioEffectParamPathValue } from '../utils/audioEffectParamPath';
import { FlexEqualizerControl } from '../components/panels/properties/FlexEqualizerControl';
import '../components/panels/properties/VolumeBlendshapeTabs.css';
import './FlexEqVisualQa.css';

interface FlexEqVisualQaPanelProps {
  fixture: ReturnType<typeof createAudioEqVisualFixtureCases>[number];
}

function updateEqParamsPath(
  current: AudioEqParamsV2,
  path: string,
  value: AudioEffectParamValue,
): AudioEqParamsV2 {
  const parts = path.split('.').filter(Boolean);
  const relativeParts = parts[0] === 'eq' ? parts.slice(1) : parts;
  return setAudioEffectParamPathValue(
    current as unknown as AudioEffectParamValue,
    relativeParts,
    value,
  ) as unknown as AudioEqParamsV2;
}

function FlexEqVisualQaPanel({ fixture }: FlexEqVisualQaPanelProps) {
  const [params, setParams] = useState(fixture.params);

  return (
    <section className={`flex-eq-qa-card ${fixture.compact ? 'compact' : ''}`}>
      <div className="flex-eq-qa-card-header">
        <h2>{fixture.title}</h2>
        <p>{fixture.caption}</p>
      </div>
      <FlexEqualizerControl
        params={params}
        compact={fixture.compact}
        analyzer={fixture.analyzer}
        ariaLabel={`${fixture.title} visual QA equalizer`}
        onUpdateParamPath={(path, value) => setParams(current => updateEqParamsPath(current, path, value))}
        onChangeParams={setParams}
      />
    </section>
  );
}

export function FlexEqVisualQa() {
  const fixtures = useMemo(() => createAudioEqVisualFixtureCases(), []);

  return (
    <main className="flex-eq-qa">
      <header className="flex-eq-qa-header">
        <div>
          <h1>Flex EQ Visual QA</h1>
          <p>Deterministic graph fixtures for curve, band fill, handle and spectrum review.</p>
        </div>
        <span className="flex-eq-qa-badge">?test=flex-eq</span>
      </header>
      <div className="flex-eq-qa-grid">
        {fixtures.map(fixture => (
          <FlexEqVisualQaPanel key={fixture.id} fixture={fixture} />
        ))}
      </div>
    </main>
  );
}
