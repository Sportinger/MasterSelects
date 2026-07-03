import { describe, expect, it } from 'vitest';
import {
  FLASHBOARD_STATE_CLASSIFICATION,
  FLASHBOARD_STORE_STATE_KEYS,
  type FlashBoardStoreStateKey,
} from '../../src/stores/flashboardStore/types';

function sortedKeys(keys: readonly FlashBoardStoreStateKey[]): FlashBoardStoreStateKey[] {
  return [...keys].sort();
}

describe('FlashBoard active generation state classification', () => {
  it('classifies every top-level store state key without overlap', () => {
    const { activeGeneration, retiredBoardWorkspace } = FLASHBOARD_STATE_CLASSIFICATION;

    const overlap = activeGeneration.filter((key) => retiredBoardWorkspace.includes(key));
    const classifiedKeys = [...activeGeneration, ...retiredBoardWorkspace];

    expect(overlap).toEqual([]);
    expect(sortedKeys(classifiedKeys)).toEqual(sortedKeys(FLASHBOARD_STORE_STATE_KEYS));
  });

  it('keeps generation records and composer state active after board deletion', () => {
    expect(FLASHBOARD_STATE_CLASSIFICATION.activeGeneration).toEqual([
      'activeGenerationRecords',
      'selectedActiveGenerationRecordIds',
      'composer',
      'promptHistory',
      'hoveredComposerReference',
    ]);
    expect(FLASHBOARD_STATE_CLASSIFICATION.retiredBoardWorkspace).toEqual([]);
  });
});
