import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { SeedancePreproductionWizard } from '../../src/marketing/SeedancePreproductionWizard';
import type { SeedancePreproductionRun } from '../../src/services/seedancePreproduction/contracts';

afterEach(cleanup);

const run: SeedancePreproductionRun = {
  schemaVersion: 1,
  id: 'run-1',
  createdAt: 1,
  updatedAt: 1,
  prompt: 'Turn the supplied material into a proper video',
  phase: 'choosing-idea',
  ideas: Array.from({ length: 5 }, (_, index) => ({
    id: `direction-${index + 1}`,
    title: `Direction ${index + 1}`,
    summary: `Production approach ${index + 1}`,
    tone: 'cinematic',
    targetDurationSeconds: 660,
  })),
  storyExpanded: false,
  sourceAssets: [],
  researchDiagnostics: [],
  masterGenerationRound: 0,
  masterLooks: [],
  keyframeBriefs: [],
  keyframeVersions: [],
  acceptedVersionByBriefId: {},
  selectedKeyframeIds: [],
  segments: [],
};

describe('Seedance preproduction direction choice', () => {
  it('shows the abbreviated direct-edit route when generation is unnecessary', () => {
    const directRun: SeedancePreproductionRun = {
      ...run,
      phase: 'edit-ready',
      orchestrationEvents: [],
      orchestration: {
        agents: [],
        drafts: [],
        finalConcepts: [],
        phase: 'completed',
        runId: 'seedance-preproduction-direct-edit-0001',
        treatment: {
          aiGeneration: {
            required: false,
            reason: 'Existing footage and editor-native graphics cover the selected plan.',
          },
        },
        updatedAt: 2,
      } as SeedancePreproductionRun['orchestration'],
    };
    const onOpenEditor = vi.fn();

    render(<SeedancePreproductionWizard
      chooseIdea={vi.fn()}
      chooseMaster={vi.fn()}
      continueFromMedia={vi.fn()}
      moreIdeas={vi.fn()}
      onOpenEditor={onOpenEditor}
      readyKeyframeCount={0}
      regenerateMasters={vi.fn()}
      regenerateSelected={vi.fn()}
      replanAssets={vi.fn()}
      resume={vi.fn()}
      retrySourceResearch={vi.fn()}
      reset={vi.fn()}
      run={directRun}
      setStoryExpanded={vi.fn()}
      toggleKeyframe={vi.fn()}
      toggleSourceAsset={vi.fn()}
    />);

    expect(screen.getByRole('navigation', { name: /progress/i }))
      .toHaveTextContent(/Direction.*Plan.*Edit/);
    expect(screen.queryByText('Master look')).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /selected production plan is implemented/i }))
      .toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Open the edit' }));
    expect(onOpenEditor).toHaveBeenCalledOnce();
  });

  it('turns legacy schema dumps into a readable error with collapsed details', () => {
    const rawError = '[{"code":"custom","message":"Root-authored scene plans must be accepted by the root orchestrator.","path":["scenePlanning","rootScenePlans",0,"status"]}]';
    const failedRun: SeedancePreproductionRun = {
      ...run,
      phase: 'failed',
      error: rawError,
    };

    const { container } = render(<SeedancePreproductionWizard
      chooseIdea={vi.fn()}
      chooseMaster={vi.fn()}
      continueFromMedia={vi.fn()}
      moreIdeas={vi.fn()}
      readyKeyframeCount={0}
      regenerateMasters={vi.fn()}
      regenerateSelected={vi.fn()}
      replanAssets={vi.fn()}
      resume={vi.fn()}
      retrySourceResearch={vi.fn()}
      reset={vi.fn()}
      run={failedRun}
      setStoryExpanded={vi.fn()}
      toggleKeyframe={vi.fn()}
      toggleSourceAsset={vi.fn()}
    />);

    expect(screen.getByText('The scene plan could not be accepted')).toBeInTheDocument();
    expect(screen.getByText(/internal workflow field was invalid/i)).toBeInTheDocument();
    expect(screen.getByText('Technical details')).toBeInTheDocument();
    expect(container.querySelector('details.seedance-error-details')).not.toHaveAttribute('open');
    expect(screen.getByRole('button', { name: 'Return to last review' })).toBeInTheDocument();
  });

  it('describes alternatives as production approaches while preserving existing scripts', () => {
    render(<SeedancePreproductionWizard
      chooseIdea={vi.fn()}
      chooseMaster={vi.fn()}
      continueFromMedia={vi.fn()}
      moreIdeas={vi.fn()}
      readyKeyframeCount={0}
      regenerateMasters={vi.fn()}
      regenerateSelected={vi.fn()}
      replanAssets={vi.fn()}
      resume={vi.fn()}
      retrySourceResearch={vi.fn()}
      reset={vi.fn()}
      run={run}
      setStoryExpanded={vi.fn()}
      toggleKeyframe={vi.fn()}
      toggleSourceAsset={vi.fn()}
    />);

    expect(screen.getByRole('heading', { name: 'Choose the strongest video direction' }))
      .toBeInTheDocument();
    expect(screen.getByText(/Existing scripts remain authoritative/i)).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Choose direction' })).toHaveLength(5);
  });

  it('shows the full scene asset checklist and retained Commons diagnostics', () => {
    const sourceRun: SeedancePreproductionRun = {
      ...run,
      phase: 'reviewing-media',
      storyExpanded: true,
      ideas: [],
      story: {
        schemaVersion: 1,
        kind: 'story',
        title: 'Tax history',
        logline: 'A receipt reveals a tax reform.',
        summary: 'A factual production plan.',
        aspectRatio: '16:9',
        totalDurationSeconds: 30,
        scenes: [{
          id: 'scene-1',
          title: 'The receipt',
          summary: 'Open on a modern receipt.',
          durationSeconds: 30,
          narration: 'The tax is visible today.',
          visualIntent: 'Macroaufnahme eines Kassenzettels; dann eine stilisierte Diagramm-Rekonstruktion.',
        }],
        researchRequirements: [{
          id: 'research-1',
          sceneId: 'scene-1',
          query: 'Wikimedia Commons Bundesverfassungsgericht Karlsruhe 1966',
          purpose: 'Ground the historical location.',
        }, {
          id: 'research-2',
          sceneId: 'scene-1',
          query: 'Wikimedia Commons Kassenzettel Mehrwertsteuer',
          purpose: 'Show the visible tax line on a receipt.',
        }],
      },
      sourceAssets: [{
        id: 'commons-research-2-42',
        requirementId: 'research-2',
        sceneIds: ['scene-1'],
        title: 'Receipt with VAT.jpg',
        description: 'A receipt with a visible VAT line.',
        creator: 'Example creator',
        credit: 'Own work',
        license: 'CC BY 4.0',
        licenseUrl: 'https://creativecommons.org/licenses/by/4.0/',
        sourceUrl: 'https://commons.wikimedia.org/wiki/File:Receipt_with_VAT.jpg',
        originalUrl: 'https://upload.wikimedia.org/receipt.jpg',
        thumbnailUrl: 'https://upload.wikimedia.org/receipt-thumb.jpg',
        mimeType: 'image/jpeg',
        pageId: 42,
        retrievedAt: 1,
        importToken: 'signed-token',
        selected: true,
      }],
      researchDiagnostics: [{
        requirementId: 'research-1',
        sceneId: 'scene-1',
        requestedQuery: 'Wikimedia Commons Bundesverfassungsgericht Karlsruhe 1966',
        status: 'empty',
        resultCount: 0,
        attempts: [{ query: 'Bundesverfassungsgericht Karlsruhe', status: 'succeeded', resultCount: 0 }],
      }, {
        requirementId: 'research-2',
        sceneId: 'scene-1',
        requestedQuery: 'Wikimedia Commons Kassenzettel Mehrwertsteuer',
        status: 'matched',
        resultCount: 1,
        attempts: [{ query: 'Kassenzettel Mehrwertsteuer', status: 'succeeded', resultCount: 1 }],
      }],
    };

    const { container } = render(<SeedancePreproductionWizard
      chooseIdea={vi.fn()}
      chooseMaster={vi.fn()}
      continueFromMedia={vi.fn()}
      moreIdeas={vi.fn()}
      readyKeyframeCount={0}
      regenerateMasters={vi.fn()}
      regenerateSelected={vi.fn()}
      replanAssets={vi.fn()}
      resume={vi.fn()}
      retrySourceResearch={vi.fn()}
      reset={vi.fn()}
      run={sourceRun}
      setStoryExpanded={vi.fn()}
      toggleKeyframe={vi.fn()}
      toggleSourceAsset={vi.fn()}
    />);

    expect(screen.getByRole('region', { name: 'Production asset checklist' })).toBeInTheDocument();
    expect(container.querySelector('.seedance-story-disclosure .seedance-asset-checklist')).toBeNull();
    expect(container.querySelectorAll('details.seedance-scene-disclosure')).toHaveLength(1);
    expect(container.querySelector('details.seedance-scene-disclosure')).toHaveAttribute('open');
    expect(screen.getAllByText('Practical footage')).toHaveLength(2);
    expect(screen.getByText('Motion graphic')).toBeInTheDocument();
    expect(screen.getByText('Voiceover 01')).toBeInTheDocument();
    expect(screen.getAllByText('Camera & visual direction')).toHaveLength(2);
    expect(screen.getByText('The tax is visible today.')).toBeInTheDocument();
    expect(screen.getByText(/Macroaufnahme eines Kassenzettels/i)).toBeInTheDocument();
    expect(screen.getByText(/Visual continuation · no new spoken line/i)).toBeInTheDocument();
    expect(screen.getByText(/No Commons search planned/i)).toBeInTheDocument();
    expect(screen.getByText(/Needed · not found on Commons/i)).toBeInTheDocument();
    expect(screen.getAllByRole('img', { name: 'Receipt with VAT.jpg' })).toHaveLength(1);
    const sourceToggle = screen.getByRole('button', { name: /Show source media/i });
    expect(sourceToggle).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(sourceToggle);
    expect(screen.getAllByRole('img', { name: 'Receipt with VAT.jpg' })).toHaveLength(2);
    expect(screen.getByText(/1 matched · 0 failed · 1 empty/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Retry Commons search/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Re-plan assets/i })).toBeInTheDocument();
  });

  it('shows the kernel asset route and keeps each scene in its own disclosure', () => {
    const plannedRun: SeedancePreproductionRun = {
      ...run,
      phase: 'reviewing-media',
      storyExpanded: true,
      ideas: [],
      story: {
        schemaVersion: 1,
        kind: 'story',
        title: 'Planned scenes',
        logline: 'Two fully routed scenes.',
        summary: 'Every visual need has an explicit source.',
        aspectRatio: '16:9',
        totalDurationSeconds: 20,
        scenes: ['scene-1', 'scene-2'].map((id, index) => ({
          id,
          title: `Scene ${index + 1}`,
          summary: `Summary ${index + 1}`,
          durationSeconds: 10,
          narration: `Narration ${index + 1}.`,
          visualIntent: `Visual ${index + 1}.`,
        })),
        researchRequirements: [],
      },
      assetPlan: {
        schemaVersion: 1,
        kind: 'asset-plan',
        assetNeeds: [{
          id: 'need-receipt',
          sceneId: 'scene-1',
          description: 'A contemporary VAT receipt.',
          cameraDirection: 'Macro push toward the tax line.',
          sourceKind: 'practical-footage',
          priority: 'required',
          commonsQueries: [],
        }, {
          id: 'need-chart',
          sceneId: 'scene-2',
          description: 'A clean animated tax chart.',
          cameraDirection: 'Bars grow left to right.',
          sourceKind: 'motion-graphic',
          priority: 'supporting',
          commonsQueries: [],
        }],
      },
    };

    const { container } = render(<SeedancePreproductionWizard
      chooseIdea={vi.fn()}
      chooseMaster={vi.fn()}
      continueFromMedia={vi.fn()}
      moreIdeas={vi.fn()}
      readyKeyframeCount={0}
      regenerateMasters={vi.fn()}
      regenerateSelected={vi.fn()}
      replanAssets={vi.fn()}
      resume={vi.fn()}
      retrySourceResearch={vi.fn()}
      reset={vi.fn()}
      run={plannedRun}
      setStoryExpanded={vi.fn()}
      toggleKeyframe={vi.fn()}
      toggleSourceAsset={vi.fn()}
    />);

    const scenes = container.querySelectorAll('details.seedance-scene-disclosure');
    expect(scenes).toHaveLength(2);
    expect(scenes[0]).toHaveAttribute('open');
    expect(scenes[1]).not.toHaveAttribute('open');
    expect(screen.getByText('Macro push toward the tax line.')).toBeInTheDocument();
    expect(screen.getByText('Practical footage planned')).toBeInTheDocument();
    expect(screen.getAllByText(/not a missing Commons result/i)).toHaveLength(1);
    expect(screen.queryByText('Bars grow left to right.')).not.toBeInTheDocument();
  });
});
