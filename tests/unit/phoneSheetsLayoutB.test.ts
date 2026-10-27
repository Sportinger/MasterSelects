// V4 per-sheet layout B: the view-model pieces behind the reworked phone sheets (composition poster
// frames, All tools rows with icons and without a repeated "Main toolbar" subtitle, colour panes that
// open the matching side of the Colour editor).
import { describe, expect, it } from 'vitest';

import { PHONE_ACTIONS } from '../../src/components/mobileSkin/actions/phoneActionCatalog';
import type { PhoneActionContext } from '../../src/components/mobileSkin/contracts';
import { phoneCompositionPosterUrl } from '../../src/components/mobileSkin/library/phoneLibraryModel';
import { buildPhoneAllToolsEntries } from '../../src/components/mobileSkin/panels/phoneAllToolsCatalog';
import { getPhonePanel } from '../../src/components/mobileSkin/panels/phonePanelCatalog';
import { getPhoneWorkspace } from '../../src/components/mobileSkin/workspace/phoneWorkspaceCatalog';
import type { PanelType } from '../../src/types/dock';

const ready: PhoneActionContext = { selectedClipIds: [], playheadTime: 0, projectOpen: true, engineReady: true };

type PosterComposition = Parameters<typeof phoneCompositionPosterUrl>[0];
const comp = (clips: Array<{ mediaFileId?: string; startTime: number }>) => ({ timelineData: { clips } }) as unknown as PosterComposition;

describe('composition poster frame', () => {
  const files = [
    { id: 'song', type: 'audio' as const, thumbnailUrl: 'blob:song' },
    { id: 'late', type: 'video' as const, thumbnailUrl: 'blob:late' },
    { id: 'early', type: 'image' as const, thumbnailUrl: 'blob:early' },
    { id: 'pending', type: 'video' as const },
  ];

  it('uses the thumbnail of the earliest picture clip, never a sound', () => {
    expect(phoneCompositionPosterUrl(comp([
      { mediaFileId: 'song', startTime: 0 }, { mediaFileId: 'late', startTime: 4 }, { mediaFileId: 'early', startTime: 1 },
    ]), files)).toBe('blob:early');
  });

  it('has no poster while no picture clip has a thumbnail', () => {
    expect(phoneCompositionPosterUrl(comp([{ mediaFileId: 'pending', startTime: 0 }, { mediaFileId: 'song', startTime: 0 }]), files)).toBeUndefined();
    expect(phoneCompositionPosterUrl({ timelineData: undefined } as PosterComposition, files)).toBeUndefined();
  });
});

describe('All tools rows', () => {
  it('give toolbar actions their toolbar icon and no repeated "Main toolbar" subtitle', () => {
    const entries = buildPhoneAllToolsEntries(ready);
    for (const action of PHONE_ACTIONS) {
      const entry = entries.find((candidate) => candidate.id === `action:${action.id}`)!;
      expect(entry.icon).toBe(action.icon);
      expect(entry.detail).toBe('');
    }
    expect(entries.some((entry) => /toolbar$/i.test(entry.detail))).toBe(false);
  });
});

describe('Colour panes', () => {
  it('open the side of the Colour editor that holds them', () => {
    const color = getPhoneWorkspace('color')!;
    for (const type of ['color-nodes', 'color-scopes'] as PanelType[]) {
      const panel = getPhonePanel(type)!;
      expect(panel.workspace).toBe('color');
      const side = panel.workspaceSide!;
      const content = color[side]!;
      expect(content.kind === 'panel' ? content.type : null).toBe(type);
    }
  });
});
