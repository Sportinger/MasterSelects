import { describe, expect, it } from 'vitest';
import { EFFECT_REGISTRY } from '../../src/effects';
import { getAllAudioEffects } from '../../src/engine/audio/AudioEffectRegistry';
import { listNodeCatalog } from '../../src/services/operators/operatorCatalog';
import { CONTROL_OPERATORS } from '../../src/services/parameterSources/controlOperators';
import { buildAgentNodeCatalogContext, getAgentNodeCatalog } from '../../src/services/nodeGraph/agentNodeCatalog';
import { handleGetNodeDefinitions, handleSearchNodeCatalog } from '../../src/services/aiTools/handlers/nodeCatalog';
import { checkToolAccess, getToolPolicy } from '../../src/services/aiTools/policy';

describe('agent node discovery', () => {
  it('includes every full definition up front for node requests without truncation', () => {
    for (const request of ['mix blue in NODES', 'baue einen Node-Graph', 'Knotengraph bearbeiten']) {
      const context = buildAgentNodeCatalogContext(request);
      expect(context.definitions).toEqual(getAgentNodeCatalog());
      expect(context.definitions?.length).toBe(context.total);
    }
    expect(buildAgentNodeCatalogContext('trim the selected clip').definitions).toBeUndefined();
  });
  it('supplies every registered base entry up front without conflating control and image definitions', () => {
    const catalog = getAgentNodeCatalog(), ids = catalog.map(e => e.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toEqual(expect.arrayContaining(listNodeCatalog().map(e => e.id)));
    expect(ids).toEqual(expect.arrayContaining(getAllAudioEffects().map(e => `audio:${e.id}`)));
    expect(ids).toEqual(expect.arrayContaining(CONTROL_OPERATORS.map(e => `control:${e.id}`)));
    expect(ids).toEqual(expect.arrayContaining(['color:primary', 'color:wheels', 'builtin:source', 'builtin:transform']));
    expect(catalog.find(e => e.id === 'control:values.number')?.parameters[0].max)
      .not.toBe(catalog.find(e => e.id === 'values.number')?.parameters[0].max);
    const context = buildAgentNodeCatalogContext();
    expect(context.groups.flatMap(g => g.entries.map(e => e[0])).toSorted()).toEqual(ids.toSorted());
    expect(context.total).toBe(catalog.length);
    expect(JSON.stringify(context).length).toBeLessThan(128_000);
    expect(JSON.stringify(context)).not.toMatch(/"parameters"|"shader"|"composition"|"bindings"/);
  });

  it('retains real effect choices and hides internal parameters and implementation bodies', async () => {
    const effect = [...EFFECT_REGISTRY.values()].find(e => Object.values(e.params).some(p => p.options?.length));
    expect(effect).toBeDefined();
    const response = await handleGetNodeDefinitions({ ids: [`effect:${effect!.id}`, 'control:control.time', 'missing-node'], detail: 'full' });
    expect(response.success).toBe(true);
    const data = response.data as { definitions: ReturnType<typeof getAgentNodeCatalog>; missingIds: string[] };
    expect(data.missingIds).toEqual(['missing-node']);
    expect(data.definitions[0].typeId).toBe(effect!.id);
    for (const [id, spec] of Object.entries(effect!.params)) {
      const param = data.definitions[0].parameters.find(p => p.id === id);
      if (spec.hidden) expect(param).toBeUndefined();
      else { expect(param?.default).toEqual(spec.default); expect(param?.options).toEqual(spec.options); }
    }
    expect(data.definitions[1].parameters[0].options).toEqual([
      { value: 'clip', label: 'Clip time' }, { value: 'timeline', label: 'Timeline time' },
    ]);
    expect(JSON.stringify(data)).not.toMatch(/"shader"|"composition"|"packUniforms"/);
  });

  it('returns compact definitions by default and the full inventory as one text list on request', async () => {
    const compact = await handleGetNodeDefinitions({ ids: ['values.number', 'image.sample'] });
    const data = compact.data as { legend: string; definitions: Array<{ id: string; in: string[]; out: string[]; params?: string[] }> };
    expect(data.legend).toContain('id:type');
    expect(data.definitions[0].params?.[0]).toMatch(/^value:number \[/);
    expect(data.definitions[1].in).toEqual(expect.arrayContaining(['image:image!', 'uv:vec2!']));
    const full = await handleGetNodeDefinitions({ ids: ['values.number', 'image.sample'], detail: 'full' });
    expect(JSON.stringify(compact.data).length).toBeLessThan(JSON.stringify(full.data).length / 1.5);
    const list = await handleSearchNodeCatalog({ list: true });
    expect((list.data as { catalog: string }).catalog.split('\n').some(line => line.startsWith('values.number '))).toBe(true);
  });

  it('paginates the whole inventory without silently losing entries', async () => {
    const ids: string[] = [];
    let offset: number | null = 0;
    while (offset !== null) {
      const response = await handleSearchNodeCatalog({ offset, limit: 30 });
      expect(response.success).toBe(true);
      const data = response.data as { entries: { id: string }[]; nextOffset: number | null };
      ids.push(...data.entries.map(e => e.id)); offset = data.nextOffset;
    }
    expect(ids).toEqual(getAgentNodeCatalog().map(e => e.id));
  });

  it('matches exact IDs first and combines signal and owner filters', async () => {
    const exact = await handleSearchNodeCatalog({ query: 'VALUES.NUMBER' });
    expect((exact.data as { entries: { id: string }[] }).entries[0].id).toBe('values.number');
    const response = await handleSearchNodeCatalog({ kind: 'control', context: 'CONTROLS', query: 'time', outputType: 'number' });
    const entries = (response.data as { entries: { kind: string; context: string; outputTypes: string[] }[] }).entries;
    expect(entries.length).toBeGreaterThan(0);
    for (const e of entries) { expect(e.kind).toBe('control'); expect(e.context).toBe('Controls'); expect(e.outputTypes).toContain('number'); }
  });

  it('rejects malformed and unbounded calls', async () => {
    for (const args of [{ offset: -1 }, { limit: 1.5 }, { query: 'x'.repeat(201) }, { kind: 'made-up' }, { unknown: true }]) {
      expect((await handleSearchNodeCatalog(args)).success).toBe(false);
    }
    for (const args of [{ ids: [] }, { ids: ['a', 'a'] }, { ids: Array(9).fill('a') }, { ids: [1] }, { ids: ['a'], mutate: true }]) {
      expect((await handleGetNodeDefinitions(args)).success).toBe(false);
    }
  });

  it('allows discovery in plan and read-only chat without mutation authority', () => {
    for (const name of ['searchNodeCatalog', 'getNodeDefinitions']) {
      expect(getToolPolicy(name)?.readOnly).toBe(true);
      expect(checkToolAccess(name, 'chat', { executionMode: 'plan' }).allowed).toBe(true);
      expect(checkToolAccess(name, 'chat', { executionMode: 'read-only' }).allowed).toBe(true);
    }
  });
});
