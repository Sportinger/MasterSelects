import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { StoryboardTemplateDiffPreview } from '../../src/components/storyboard/templates';
import {
  previewStoryboardTemplateApplication,
  type StoryboardTemplateApplicationPreview,
} from '../../src/services/storyboard/templates';
import type {
  StoryboardProjectState,
  StoryboardScene,
  StoryboardTemplate,
} from '../../src/services/storyboard/contracts';
import { createEmptyStoryboardStoreProjectState } from '../../src/stores/storyboardStore';

const template: StoryboardTemplate = {
  schemaVersion: 1,
  id: 'template-test',
  name: 'Template test',
  version: 2,
  description: 'A test template.',
  targetDurationSeconds: 10,
  beats: [{
    id: 'new',
    title: 'New scene',
    purpose: 'The new structure.',
    targetShare: 1,
    evidenceExpectations: [],
  }],
};

function scene(id: string, title: string): StoryboardScene {
  return {
    schemaVersion: 1,
    planId: 'plan-test',
    id,
    title,
    description: `${title} description`,
    targetDurationSeconds: 5,
    status: 'ready',
    filledClipIds: [],
    evidenceRefIds: [],
    variantSetIds: [],
    createdAt: 1,
    updatedAt: 1,
  };
}

async function preview(destructive: boolean): Promise<StoryboardTemplateApplicationPreview> {
  let state: StoryboardProjectState = createEmptyStoryboardStoreProjectState();
  if (destructive) {
    const first = scene('old-1', 'Old scene');
    const second = scene('old-2', 'Extra scene');
    state = {
      ...state,
      plans: {
        'plan-test': {
          schemaVersion: 1,
          id: 'plan-test',
          title: 'Old plan',
          sceneIds: [first.id, second.id],
          createdAt: 1,
          updatedAt: 1,
        },
      },
      scenes: { [first.id]: first, [second.id]: second },
    };
  }
  return previewStoryboardTemplateApplication({
    state,
    template,
    mode: destructive ? 'restructure' : 'instantiate',
    planId: 'plan-test',
    now: 2,
    createSceneId: () => 'new-scene',
  });
}

describe('StoryboardTemplateDiffPreview', () => {
  it('shows textual safe status and applies a non-destructive diff directly', async () => {
    const onApply = vi.fn();
    render(
      <StoryboardTemplateDiffPreview
        preview={await preview(false)}
        templateName="Safe template"
        onApply={onApply}
      />,
    );
    expect(screen.getByText('No destructive changes')).toBeInTheDocument();
    expect(screen.getAllByText('Non-destructive').length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole('button', { name: 'Apply template' }));
    expect(onApply).toHaveBeenCalledTimes(1);
  });

  it('renders the destructive diff before enabling confirmation and returns the confirmed fingerprint', async () => {
    const applicationPreview = await preview(true);
    const onApply = vi.fn();
    render(
      <StoryboardTemplateDiffPreview
        preview={applicationPreview}
        templateName="Restructure template"
        onApply={onApply}
      />,
    );
    expect(screen.getByText(/\d+ destructive changes?/)).toBeInTheDocument();
    expect(screen.getAllByText('Destructive').length).toBeGreaterThan(0);
    expect(screen.getByText(/Remove existing scene/)).toBeInTheDocument();
    const confirmButton = screen.getByRole('button', { name: 'Confirm restructure' });
    expect(confirmButton).toBeDisabled();

    fireEvent.click(screen.getByRole('checkbox', {
      name: 'I reviewed the destructive changes shown above.',
    }));
    expect(confirmButton).toBeEnabled();
    fireEvent.click(confirmButton);
    expect(onApply).toHaveBeenCalledWith(expect.objectContaining({
      confirmedDiffFingerprint: applicationPreview.diffFingerprint,
    }));
  });
});
