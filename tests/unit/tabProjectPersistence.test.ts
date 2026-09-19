import { describe, expect, it } from 'vitest';

import {
  clearLastOpfsProjectName,
  getTabLastProjectHandleKey,
  getTabNativeLastProjectPathKey,
  getTabOpfsLastProjectNameKey,
  readLastOpfsProjectName,
  storeLastOpfsProjectName,
} from '../../src/services/project/tabProjectPersistence';

describe('tab-scoped project persistence', () => {
  it('keeps File System Access project handles separate per browser tab', () => {
    expect(getTabLastProjectHandleKey('chat-tab')).toBe('lastProject:chat-tab');
    expect(getTabLastProjectHandleKey('editor-tab')).toBe('lastProject:editor-tab');
  });

  it('keeps native project paths separate per browser tab', () => {
    expect(getTabNativeLastProjectPathKey('chat-tab'))
      .toBe('ms-native-last-project-path:chat-tab');
    expect(getTabNativeLastProjectPathKey('editor-tab'))
      .toBe('ms-native-last-project-path:editor-tab');
  });

  it('keeps OPFS project names across refreshes without serializing directory handles', () => {
    localStorage.clear();

    storeLastOpfsProjectName('iPad Edit', 'editor-tab');

    expect(getTabOpfsLastProjectNameKey('editor-tab'))
      .toBe('ms-opfs-last-project-name:editor-tab');
    expect(readLastOpfsProjectName('editor-tab')).toBe('iPad Edit');
    expect(readLastOpfsProjectName('another-tab')).toBe('iPad Edit');

    clearLastOpfsProjectName('editor-tab');
    expect(readLastOpfsProjectName('editor-tab')).toBe('iPad Edit');
  });
});
