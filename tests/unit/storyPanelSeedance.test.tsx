import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';

import { SeedanceEditorWorkflowProvider } from '../../src/components/story/SeedanceEditorWorkflowContext';
import { StoryPanel } from '../../src/components/story/StoryPanel';
import { useSeedancePreproductionStore } from '../../src/stores/seedancePreproductionStore';

beforeEach(() => {
  useSeedancePreproductionStore.getState().reset();
});

describe('Story workspace', () => {
  it('shows only the Story handoff when no workflow is active', () => {
    render(
      <SeedanceEditorWorkflowProvider enabled>
        <StoryPanel />
      </SeedanceEditorWorkflowProvider>,
    );

    expect(screen.getByRole('heading', { name: 'Story' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Start Story from Media' })).toBeInTheDocument();
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
    expect(screen.queryByText('Live from the shared AI story.')).not.toBeInTheDocument();
  });
});
