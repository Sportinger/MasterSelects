import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { PremiereSequenceImportDialog } from '../../src/components/common/PremiereSequenceImportDialog';
import {
  getPremiereSequenceSelectionSnapshot,
  requestPremiereSequenceSelection,
  resolvePremiereSequenceSelection,
} from '../../src/importers/premiere/premiereSequenceSelectionRuntime';

const summary = {
  mediaCount: 12,
  sequences: [
    { uid: 'seq-a', name: 'Main', videoTrackCount: 2, audioTrackCount: 3, clipCount: 40 },
    { uid: 'seq-b', name: 'Social', videoTrackCount: 1, audioTrackCount: 1, clipCount: 12 },
  ],
};

describe('Premiere sequence import dialog', () => {
  afterEach(() => {
    const active = getPremiereSequenceSelectionSnapshot();
    if (active) resolvePremiereSequenceSelection(active.id, null);
    cleanup();
  });

  it('lets the user import only selected sequences', async () => {
    const selection = requestPremiereSequenceSelection('Large.prproj', summary);
    render(<PremiereSequenceImportDialog />);

    expect(screen.getByText('Large.prproj')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('checkbox', { name: /Social/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Import selected' }));

    await expect(selection).resolves.toEqual(['seq-a']);
  });

  it('cancels the pending import without returning a partial selection', async () => {
    const selection = requestPremiereSequenceSelection('Large.prproj', summary);
    render(<PremiereSequenceImportDialog />);

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    await expect(selection).resolves.toBeNull();
  });
});
