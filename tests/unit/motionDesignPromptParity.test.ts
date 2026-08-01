import { describe, expect, it } from 'vitest';
import {
  buildFlashBoardChatPlaybookInjection,
  selectFlashBoardChatPlaybooks,
} from '../../src/services/flashboard/FlashBoardChatPlaybooks';

describe('motion-design prompt parity', () => {
  it('selects the motion playbook for English and German motion-design prompts', () => {
    expect(selectFlashBoardChatPlaybooks('Build a motion design title card')).toContain('motion');
    expect(selectFlashBoardChatPlaybooks('Baue eine animierte Form als Bauchbinde')).toContain('motion');
  });

  it('advertises exactly the implemented MD1 primitive and appearance vocabulary', () => {
    const injection = buildFlashBoardChatPlaybookInjection('Create editable motion graphics shapes');
    const normalized = injection.toLowerCase();

    for (const term of [
      'rectangle',
      'ellipse',
      'polygon',
      'star',
      'color fills',
      'strokes',
      'linear/radial gradients',
      'updateMotionAppearances',
    ]) {
      expect(normalized).toContain(term.toLowerCase());
    }
    expect(normalized).toContain('ordered');
  });

  it('does not retain the obsolete two-primitive/no-gradient limitation', () => {
    const injection = buildFlashBoardChatPlaybookInjection('Create a motion shape');
    expect(injection).not.toMatch(/only\s+(?:supports?\s+)?rectangle\s+(?:and|or|\/)\s+ellipse/i);
    expect(injection).not.toMatch(/never claim[^.]*polygon[^.]*star[^.]*gradient/i);
    expect(injection).not.toMatch(/polygon\s*\/\s*star[^.]*not supported/i);
  });
});
