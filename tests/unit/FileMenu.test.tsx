import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { FileMenu } from '../../src/components/common/toolbar/FileMenu';

function renderFileMenu(isProjectOpen: boolean) {
  render(
    <FileMenu
      autosaveEnabled={false}
      autosaveInterval={5}
      hasUnsavedChanges={() => false}
      isLoading={false}
      isProjectOpen={isProjectOpen}
      onClearRecentProjects={vi.fn()}
      onMenuClick={vi.fn()}
      onMenuHover={vi.fn()}
      onNew={vi.fn()}
      onOpen={vi.fn()}
      onOpenRecent={vi.fn()}
      onRename={vi.fn()}
      onSave={vi.fn()}
      onSaveAs={vi.fn()}
      openMenu="file"
      recentProjects={[]}
      setAutosaveEnabled={vi.fn()}
      setAutosaveInterval={vi.fn()}
      shortcutLabels={{
        copy: 'Ctrl+C',
        new: 'Ctrl+N',
        open: 'Ctrl+O',
        paste: 'Ctrl+V',
        save: 'Ctrl+S',
        saveAs: 'Ctrl+Shift+S',
      }}
    />,
  );
}

describe('FileMenu project rename action', () => {
  it('shows Rename Project when a project is open', () => {
    renderFileMenu(true);

    expect(screen.getByRole('button', { name: 'Rename Project...' })).toBeEnabled();
  });

  it('disables Rename Project when no project is open', () => {
    renderFileMenu(false);

    expect(screen.getByRole('button', { name: 'Rename Project...' })).toBeDisabled();
  });
});
