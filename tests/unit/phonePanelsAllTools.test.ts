import { describe, expect, it } from 'vitest';

import { PHONE_ACTIONS } from '../../src/components/mobileSkin/actions/phoneActionCatalog';
import type { PhoneActionContext } from '../../src/components/mobileSkin/contracts';
import { PHONE_ASSISTANT_TASKS } from '../../src/components/mobileSkin/assistant/phoneAssistantTasks';
import {
  buildPhoneAllToolsEntries, filterPhoneAllTools, groupPhoneAllTools, PHONE_ALL_TOOLS_GROUP_ORDER, PHONE_ALL_TOOLS_SHEETS,
  phoneAllToolsBadge,
} from '../../src/components/mobileSkin/panels/phoneAllToolsCatalog';
import { phoneFitSpeed } from '../../src/components/mobileSkin/panels/phoneFitLength';
import { PHONE_PANELS } from '../../src/components/mobileSkin/panels/phonePanelCatalog';
import { getPhoneWorkspace } from '../../src/components/mobileSkin/workspace/phoneWorkspaceCatalog';

const ready: PhoneActionContext = { selectedClipIds: [], playheadTime: 0, projectOpen: true, engineReady: true };

describe('phone All tools catalog', () => {
  it('lists every toolbar action, every reachable sheet, the fullscreen preview and every desktop panel exactly once', () => {
    const entries = buildPhoneAllToolsEntries(ready);
    const ids = entries.map((entry) => entry.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const action of PHONE_ACTIONS) expect(ids).toContain(`action:${action.id}`);
    for (const sheet of PHONE_ALL_TOOLS_SHEETS) expect(ids).toContain(`sheet:${sheet.id}`);
    for (const panel of PHONE_PANELS) expect(ids).toContain(`panel:${panel.type}`);
    expect(ids).toContain('view:fullscreen');
    for (const sheet of ['compositions', 'tracks', 'markers', 'captions', 'audioFx', 'library', 'settings']) {
      expect(ids).toContain(`sheet:${sheet}`);
    }
    for (const task of PHONE_ASSISTANT_TASKS) expect(ids).toContain(`assistant:${task.catalogId}`);
    expect(entries.length).toBe(PHONE_ACTIONS.length + PHONE_ALL_TOOLS_SHEETS.length + 1 + PHONE_ASSISTANT_TASKS.length + PHONE_PANELS.length);
  });

  it('offers every panel once M4 shipped; landscape panels name an existing landscape editor', () => {
    const entries = buildPhoneAllToolsEntries(ready, 'M4');
    for (const panel of PHONE_PANELS) {
      const entry = entries.find((candidate) => candidate.id === `panel:${panel.type}`)!;
      expect(entry.state.kind, panel.type).toBe(panel.phoneLimit ? 'unavailable' : 'available');
      if (panel.workspace) {
        expect(getPhoneWorkspace(panel.workspace), panel.type).toBeDefined();
        expect(entry.detail).toBe('Landscape editor');
      }
    }
    const before = buildPhoneAllToolsEntries(ready, 'M3').find((entry) => entry.id === 'panel:audio-mixer')!;
    expect(before.state.kind === 'unavailable' && before.state.reason).toMatch(/M4/);
  });

  it('greys clip tools without a selection and explains why, and offers them with one', () => {
    const none = buildPhoneAllToolsEntries(ready).find((entry) => entry.id === 'action:speed')!;
    expect(none.state.kind).toBe('unavailable');
    expect(none.state.kind === 'unavailable' && none.state.reason).toMatch(/Select a clip/);
    const some = buildPhoneAllToolsEntries({ ...ready, selectedClipIds: ['c1'] }).find((entry) => entry.id === 'action:speed')!;
    expect(some.state.kind).toBe('available');
    const replaceSheet = buildPhoneAllToolsEntries(ready).find((entry) => entry.id === 'sheet:replace')!;
    expect(replaceSheet.state.kind).toBe('unavailable');
  });

  it('keeps the reason of actions whose milestone has not shipped', () => {
    const entries = buildPhoneAllToolsEntries(ready, 'M2');
    const captions = entries.find((entry) => entry.id === 'action:captions')!;
    expect(captions.state.kind === 'unavailable' && captions.state.reason).toMatch(/M3/);
  });

  it('finds tools by label, group words and keywords; every word must match', () => {
    const entries = buildPhoneAllToolsEntries(ready);
    expect(filterPhoneAllTools(entries, 'opacity').map((entry) => entry.id)).toEqual([]);
    expect(filterPhoneAllTools(entries, 'subtitles').map((entry) => entry.id)).toContain('sheet:captions');
    expect(filterPhoneAllTools(entries, 'panels colour scopes').map((entry) => entry.id)).toContain('panel:color-scopes');
    expect(filterPhoneAllTools(entries, 'PROPERTIES').map((entry) => entry.id)).toContain('panel:clip-properties');
    expect(filterPhoneAllTools(entries, '  ')).toHaveLength(entries.length);
  });

  it('lists one Assistant entry per assistant task that carries its prompt and needs an open project', () => {
    const entries = buildPhoneAllToolsEntries(ready).filter((entry) => entry.kind === 'assistant');
    expect(entries).toHaveLength(PHONE_ASSISTANT_TASKS.length);
    for (const entry of entries) {
      expect(entry.group).toBe('Assistant');
      expect(entry.label).toMatch(/^Ask the assistant: /);
      expect(entry.prompt && entry.prompt.length).toBeGreaterThan(10);
      expect(entry.state.kind).toBe('available');
    }
    const closed = buildPhoneAllToolsEntries({ ...ready, projectOpen: false }).find((entry) => entry.kind === 'assistant')!;
    expect(closed.state.kind === 'unavailable' && closed.state.reason).toMatch(/project/);
    expect(phoneAllToolsBadge(closed.state)).toBe('No project');
    expect(filterPhoneAllTools(buildPhoneAllToolsEntries(ready), 'assistant masks').map((entry) => entry.id)).toContain('assistant:INV-8/assistant-masks');
  });

  it('badges greyed rows with a short word instead of a milestone name', () => {
    const entries = buildPhoneAllToolsEntries(ready, 'M3');
    const badges = entries.map((entry) => phoneAllToolsBadge(entry.state));
    expect(badges.filter((badge) => badge !== null && /^M\d$/.test(badge))).toEqual([]);
    expect(phoneAllToolsBadge(entries.find((entry) => entry.id === 'action:speed')!.state)).toBe('Select a clip');
    expect(phoneAllToolsBadge(entries.find((entry) => entry.id === 'panel:audio-mixer')!.state)).toBe('Not now');
    expect(phoneAllToolsBadge({ kind: 'available' })).toBeNull();
  });

  it('groups in display order and drops empty groups', () => {
    const groups = groupPhoneAllTools(buildPhoneAllToolsEntries(ready));
    const order: readonly string[] = PHONE_ALL_TOOLS_GROUP_ORDER;
    expect(groups.map((group) => group.group)).toEqual(order.filter((name) => groups.some((group) => group.group === name)));
    expect(groups[0].group).toBe('Main tools');
    expect(groupPhoneAllTools([])).toEqual([]);
  });
});

describe('phone fit to a length', () => {
  it('derives the constant speed that makes the clip last the typed length', () => {
    expect(phoneFitSpeed(4, 1, 2, 0.1, 10)).toEqual({ speed: 2, length: 2, clamped: false });
    expect(phoneFitSpeed(2, 2, 8, 0.1, 10)).toEqual({ speed: 0.5, length: 8, clamped: false });
    expect(phoneFitSpeed(4, -1, 8, 0.1, 10)?.speed).toBe(0.5);
  });

  it('clamps to the editor speed range and says so', () => {
    const fit = phoneFitSpeed(4, 1, 0.1, 0.1, 10)!;
    expect(fit.clamped).toBe(true);
    expect(fit.speed).toBe(10);
    expect(fit.length).toBeCloseTo(0.4, 9);
  });

  it('refuses empty or invalid lengths', () => {
    expect(phoneFitSpeed(0, 1, 2, 0.1, 10)).toBeNull();
    expect(phoneFitSpeed(4, 1, 0, 0.1, 10)).toBeNull();
    expect(phoneFitSpeed(4, 1, Number.NaN, 0.1, 10)).toBeNull();
  });
});
