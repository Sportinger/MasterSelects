import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LandingPage, type LandingProjectMediaItem } from '../../src/marketing/LandingPage';
import { LandingPanel } from '../../src/marketing/LandingPanel';
import {
  FACTORY_START_LAYOUT_ID,
  FACTORY_VIDEO_EDIT_LAYOUT_ID,
  START_CHAT_EXIT_DURATION_MS,
  START_EDITOR_REVEAL_DURATION_MS,
  START_LAYOUT_OUTRO_DURATION_MS,
  START_LAYOUT_REVEAL_DURATION_MS,
  getFactoryDockLayouts,
  useDockStore,
} from '../../src/stores/dockStore';
import {
  DOCK_LAYOUT_TRANSITION_EVENT,
  START_CHROME_TRANSITION_EVENT,
} from '../../src/stores/dockStore/layoutTransition';
import {
  RECENT_PROJECTS_CHANGED_EVENT,
  projectFileService,
} from '../../src/services/projectFileService';
import { useSeedancePreproductionStore } from '../../src/stores/seedancePreproductionStore';
import { useTimelineStore } from '../../src/stores/timeline';

const {
  createBlankProjectMock,
  runFlashBoardBridgeChatTurnMock,
  runLandingBackgroundCreationMock,
} = vi.hoisted(() => ({
  createBlankProjectMock: vi.fn().mockResolvedValue('created'),
  runFlashBoardBridgeChatTurnMock: vi.fn().mockResolvedValue({ response: 'Done.' }),
  runLandingBackgroundCreationMock: vi.fn().mockResolvedValue({
    response: 'Done.',
  }),
}));

vi.mock('../../src/services/projectSync', async () => {
  const actual = await vi.importActual<typeof import('../../src/services/projectSync')>(
    '../../src/services/projectSync',
  );
  return {
    ...actual,
    createBlankProject: createBlankProjectMock,
  };
});

vi.mock('../../src/marketing/runLandingBackgroundCreation', () => ({
  LANDING_FINAL_OUTPUT_PREFIX: 'MasterSelects Final',
  runLandingBackgroundCreation: runLandingBackgroundCreationMock,
}));

vi.mock('../../src/services/flashboard/FlashBoardChatBridgeRunner', () => ({
  runFlashBoardBridgeChatTurn: runFlashBoardBridgeChatTurnMock,
}));

vi.mock('../../src/components/preview', () => ({
  Preview: () => <div data-testid="landing-review-preview-canvas" />,
}));

const projectMedia: LandingProjectMediaItem[] = [
  { id: 'video-1', name: 'Interview.mp4', type: 'video', duration: 65, previewUrl: 'video-thumb.jpg' },
  { id: 'image-1', name: 'Poster.png', type: 'image', previewUrl: 'poster.png' },
  { id: 'audio-1', name: 'Theme.wav', type: 'audio', duration: 42 },
  { id: 'text-1', name: 'Opening title', type: 'text', textPreview: 'A film by MasterSelects' },
];

beforeEach(() => {
  createBlankProjectMock.mockResolvedValue('created');
  runFlashBoardBridgeChatTurnMock.mockResolvedValue({ response: 'Done.' });
  useSeedancePreproductionStore.getState().reset();
  useDockStore.setState({
    savedLayouts: getFactoryDockLayouts(),
    activeSavedLayoutId: FACTORY_START_LAYOUT_ID,
  });
});

afterEach(() => {
  cleanup();
  createBlankProjectMock.mockClear();
  runFlashBoardBridgeChatTurnMock.mockClear();
  runLandingBackgroundCreationMock.mockClear();
  useSeedancePreproductionStore.getState().reset();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('Start layout landing panel', () => {
  it('offers a compact Open action that starts the in-place editor reveal', () => {
    const onOpenEditor = vi.fn();
    render(<LandingPage onOpenEditor={onOpenEditor} />);

    fireEvent.click(screen.getByRole('button', { name: 'Open MasterSelects editor' }));

    expect(onOpenEditor).toHaveBeenCalledTimes(1);
  });
  useTimelineStore.setState({
    duration: 60,
    isDraggingPlayhead: false,
    isPlaying: false,
    playheadPosition: 0,
  });

  it('shows a preview and simplified two-lane edit as the editor morph source', () => {
    const onOpenEditor = vi.fn();
    render(
      <LandingPage
        onOpenEditor={onOpenEditor}
        onRenderVideo={() => undefined}
        reviewCompositionName="Chat cut"
        reviewReady
        selectedProjectId="project-1"
      />,
    );

    expect(screen.getByRole('heading', { name: 'Your edit is ready' })).toBeInTheDocument();
    expect(screen.getByText(/Chat cut ·/)).toBeInTheDocument();
    expect(screen.getByTestId('landing-review-preview-canvas')).toBeInTheDocument();
    expect(screen.getByLabelText('Simplified edit timeline')).toBeInTheDocument();
    expect(screen.getByRole('group', { name: 'Video cut' })).toBeInTheDocument();
    expect(screen.getByRole('group', { name: 'Audio cut' })).toBeInTheDocument();
    const playhead = screen.getByRole('slider', { name: 'Review timeline playhead' });
    const videoTrack = screen.getByRole('group', { name: 'Video cut' })
      .querySelector<HTMLElement>('.chat-review-lane-track');
    expect(playhead).toBeInTheDocument();
    expect(videoTrack).not.toBeNull();
    vi.spyOn(videoTrack!, 'getBoundingClientRect').mockReturnValue({
      bottom: 20,
      height: 20,
      left: 0,
      right: 100,
      toJSON: () => ({}),
      top: 0,
      width: 100,
      x: 0,
      y: 0,
    });
    fireEvent.pointerDown(playhead, { button: 0, clientX: 25, pointerId: 1 });
    fireEvent.pointerMove(playhead, { clientX: 75, pointerId: 1 });
    fireEvent.pointerUp(playhead, { clientX: 75, pointerId: 1 });
    expect(useTimelineStore.getState().playheadPosition).toBe(45);
    expect(useTimelineStore.getState().isDraggingPlayhead).toBe(false);
    expect(screen.getByLabelText('Compact timeline review')).toHaveAttribute(
      'data-dock-layout-anim-id',
      'panel:timeline',
    );
    expect(screen.getByLabelText('Message for AI Chat')).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Edit selected version' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(screen.getByRole('button', { name: /New version/i })).toBeEnabled();

    fireEvent.click(screen.getByRole('button', { name: 'Open full editor' }));
    expect(onOpenEditor).toHaveBeenCalledOnce();
  });

  it('offers a top-right action for opening another project', () => {
    const onShowProjectPicker = vi.fn();
    render(<LandingPage onShowProjectPicker={onShowProjectPicker} selectedProjectId="project-1" />);

    fireEvent.click(screen.getByRole('button', { name: 'Show project choices' }));

    expect(onShowProjectPicker).toHaveBeenCalledTimes(1);
  });

  it('shows the in-chat project choices before opening a folder dialog', async () => {
    vi.spyOn(window, 'requestAnimationFrame').mockReturnValue(1);
    const activeProject = {
      backend: 'native' as const,
      id: 'active-project',
      lastOpenedAt: Date.now(),
      name: 'Active project',
      path: 'C:/Projects/Active project',
    };
    vi.spyOn(projectFileService, 'isProjectOpen').mockReturnValue(true);
    vi.spyOn(projectFileService, 'getProjectPath').mockReturnValue(activeProject.path);
    vi.spyOn(projectFileService, 'getRecentProjects').mockReturnValue([activeProject]);
    const openProject = vi.spyOn(projectFileService, 'openProject');
    render(<LandingPanel />);

    fireEvent.click(screen.getByRole('button', { name: 'Show project choices' }));

    await waitFor(() => {
      expect(screen.getByRole('region', { name: 'Choose a project' })).toBeInTheDocument();
    });
    expect(screen.getByRole('region', { name: 'Choose a project' })).toHaveClass('is-entering');
    expect(screen.getByRole('button', { name: /New project/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Open project/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Active project/i })).toBeInTheDocument();
    expect(openProject).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Hide project choices' }));

    await waitFor(() => {
      expect(screen.getByRole('region', { name: 'Choose a project' })).toHaveClass('is-exiting');
    });
    await waitFor(() => {
      expect(screen.queryByRole('region', { name: 'Choose a project' })).not.toBeInTheDocument();
    });
    expect(screen.getByRole('button', { name: 'Show project choices' })).toHaveAttribute(
      'aria-pressed',
      'false',
    );
  });

  it('closes an existing Seedance result before showing project choices', async () => {
    vi.spyOn(window, 'requestAnimationFrame').mockReturnValue(1);
    const activeProject = {
      backend: 'native' as const,
      id: 'active-project',
      lastOpenedAt: Date.now(),
      name: 'Active project',
      path: 'C:/Projects/Active project',
    };
    vi.spyOn(projectFileService, 'isProjectOpen').mockReturnValue(true);
    vi.spyOn(projectFileService, 'getProjectPath').mockReturnValue(activeProject.path);
    vi.spyOn(projectFileService, 'getRecentProjects').mockReturnValue([activeProject]);
    useSeedancePreproductionStore.setState({
      activeRunId: 'seedance-result',
      runs: {
        'seedance-result': {
          schemaVersion: 1,
          id: 'seedance-result',
          createdAt: 1,
          updatedAt: 1,
          prompt: 'Cut a short video',
          phase: 'failed',
          error: 'Stopped for test',
          ideas: [],
          orchestrationCursor: 0,
          orchestrationEvents: [],
          scenePlans: [],
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
        },
      },
    });
    render(<LandingPanel />);
    expect(screen.getByText(/Story workflow/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Show project choices' }));

    await waitFor(() => {
      expect(screen.getByRole('region', { name: 'Choose a project' })).toBeInTheDocument();
    });
    expect(screen.queryByText(/Story workflow/)).not.toBeInTheDocument();
    expect(useSeedancePreproductionStore.getState().activeRunId).toBeNull();
  });

  it('locks the Open action while the editor is opening', () => {
    render(<LandingPage isOpeningEditor onOpenEditor={() => undefined} />);

    const openButton = screen.getByRole('button', { name: 'Open MasterSelects editor' });
    expect(openButton).toBeDisabled();
    expect(openButton).toHaveTextContent('Opening');
  });

  it('renders the real project media as individual files', () => {
    render(<LandingPage projectMedia={projectMedia} projectName="Quiet documentary" />);

    expect(screen.getByText('Quiet documentary')).toHaveClass('landing-active-project-name');
    expect(screen.getByRole('article', { name: 'Interview.mp4' })).toBeInTheDocument();
    expect(screen.getByRole('article', { name: 'Poster.png' })).toBeInTheDocument();
    expect(screen.getByRole('article', { name: 'Theme.wav' })).toBeInTheDocument();
    expect(screen.getByRole('article', { name: 'Opening title' })).toBeInTheDocument();
  });

  it('offers the same selectable media grid in Auto and forwards that selection', async () => {
    const onOpenChat = vi.fn();
    const onRemoveProjectFile = vi.fn();
    render(
      <LandingPage
        onOpenChat={onOpenChat}
        onRemoveProjectFile={onRemoveProjectFile}
        projectMedia={projectMedia}
        selectedProjectId="project-1"
      />,
    );

    expect(screen.getByRole('region', { name: 'Project files' })).toHaveClass('is-source-selection');
    expect(screen.queryByRole('button', { name: 'Remove Interview.mp4' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Use Poster.png' }));
    fireEvent.change(screen.getByLabelText('Message for AI Chat'), {
      target: { value: 'Build an image-led intro' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Create with AI' }));

    await waitFor(() => {
      expect(onOpenChat).toHaveBeenCalledWith(
        'Build an image-led intro',
        expect.any(Function),
        { sourceFileIds: ['image-1'] },
      );
    });
  });

  it('shows project sequences below Auto and forwards the loaded sequence as the edit target', async () => {
    const onOpenChat = vi.fn();
    const onSelectSequence = vi.fn();
    const sequences = [
      { clipCount: 6, duration: 24, hasTranscript: true, id: 'sequence-a', name: 'Interview select' },
      { clipCount: 3, duration: 8, hasTranscript: false, id: 'sequence-b', name: 'Logo ending' },
    ];
    const view = render(
      <LandingPage
        onOpenChat={onOpenChat}
        onSelectSequence={onSelectSequence}
        selectedProjectId="project-1"
        selectedSequenceId="sequence-a"
        selectedSequenceReady
        sequences={sequences}
      />,
    );

    const selector = screen.getByRole('region', { name: 'Available sequences' });
    const prompt = screen.getByRole('form', { name: 'Open MasterSelects AI Chat' });
    expect(prompt.compareDocumentPosition(selector) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Load sequence Interview select' }))
      .toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('heading', { name: 'Interview select' })).toBeInTheDocument();
    expect(screen.getByText(/6 clips · Transcript/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Load sequence Logo ending' }));
    expect(onSelectSequence).toHaveBeenCalledWith('sequence-b');
    view.rerender(
      <LandingPage
        onOpenChat={onOpenChat}
        onSelectSequence={onSelectSequence}
        selectedProjectId="project-1"
        selectedSequenceId="sequence-b"
        selectedSequenceReady
        sequences={sequences}
      />,
    );
    fireEvent.change(screen.getByLabelText('Message for AI Chat'), {
      target: { value: 'Make the logo ending slower' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Create with AI' }));

    await waitFor(() => {
      expect(onOpenChat).toHaveBeenCalledWith(
        'Make the logo ending slower',
        expect.any(Function),
        { sourceFileIds: [], targetCompositionId: 'sequence-b' },
      );
    });
  });

  it('automatically selects newly dropped project media', async () => {
    const onDropProjectMedia = vi.fn(async () => 1);
    const { rerender } = render(
      <LandingPage
        onDropProjectMedia={onDropProjectMedia}
        projectMedia={projectMedia}
        selectedProjectId="project-1"
      />,
    );

    fireEvent.drop(screen.getByRole('main'), {
      dataTransfer: { types: ['Files'] },
    });
    await waitFor(() => expect(onDropProjectMedia).toHaveBeenCalledTimes(1));
    await waitFor(() => {
      expect(screen.getByRole('status')).toHaveTextContent('1 file added to the project.');
    });

    rerender(
      <LandingPage
        onDropProjectMedia={onDropProjectMedia}
        projectMedia={[
          ...projectMedia,
          { id: 'image-2', name: 'Fresh frame.png', type: 'image', previewUrl: 'fresh.png' },
        ]}
        selectedProjectId="project-1"
      />,
    );

    await waitFor(() => {
      expect(screen.getByRole('article', { name: 'Fresh frame.png' }))
        .toHaveClass('is-source-selected');
    });
  });

  it('requires an explicit Seedance footage selection and greys out other files', () => {
    const onRemoveProjectFile = vi.fn();
    render(
      <LandingPage
        onRemoveProjectFile={onRemoveProjectFile}
        projectMedia={projectMedia}
        selectedProjectId="project-1"
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /^Story/ }));

    expect(screen.getByRole('button', { name: /^Story/ })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByPlaceholderText('Pick your media to work with')).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Project files' })).toHaveClass('is-source-selection');
    expect(screen.queryByRole('button', { name: 'Remove Interview.mp4' })).not.toBeInTheDocument();

    const video = screen.getByRole('article', { name: 'Interview.mp4' });
    const image = screen.getByRole('article', { name: 'Poster.png' });
    expect(video).toHaveClass('is-source-excluded');
    expect(image).toHaveClass('is-source-excluded');
    expect(screen.getByRole('button', { name: 'Choose at least one source file' }))
      .toBeDisabled();

    fireEvent.click(screen.getByRole('button', { name: 'Use Interview.mp4' }));

    expect(video).toHaveClass('is-source-selected');
    expect(video).not.toHaveClass('is-source-excluded');
    expect(image).toHaveClass('is-source-excluded');
    fireEvent.click(screen.getByRole('button', { name: 'Use Poster.png' }));
    expect(image).toHaveClass('is-source-selected');
    expect(image).not.toHaveClass('is-source-excluded');
    expect(screen.getByRole('button', { name: 'Start Story' })).toBeDisabled();
  });

  it('forwards the landing prompt to the background AI runner', async () => {
    const onOpenChat = vi.fn();
    render(<LandingPage onOpenChat={onOpenChat} />);

    fireEvent.change(screen.getByLabelText('Message for AI Chat'), {
      target: { value: 'Make a quiet documentary intro' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Create with AI' }));

    await waitFor(() => {
      expect(onOpenChat).toHaveBeenCalledWith(
        'Make a quiet documentary intro',
        expect.any(Function),
        { sourceFileIds: [] },
      );
    });
  });

  it('keeps a visible conversation and routes follow-ups through Direkt mode', async () => {
    const onOpenDirectChat = vi.fn();
    render(
      <LandingPage
        onOpenDirectChat={onOpenDirectChat}
        directMessages={[
          { id: 'direct-user', role: 'user', text: 'Build a documentary opening.' },
          { id: 'direct-assistant', role: 'assistant', text: 'Open on the strongest quote.' },
        ]}
        selectedProjectId="project-1"
      />,
    );

    expect(screen.getByRole('button', { name: /^Direkt/ }))
      .toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: /^Auto/ })).toBeEnabled();
    expect(screen.getByRole('button', { name: /^Story/ })).toBeEnabled();
    fireEvent.click(screen.getByRole('button', { name: /^Auto/ }));
    expect(screen.getByRole('button', { name: /^Auto/ }))
      .toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(screen.getByRole('button', { name: /^Direkt/ }));
    expect(screen.getByRole('button', { name: /^Direkt/ }))
      .toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByText('Open on the strongest quote.')).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Message for AI Chat'), {
      target: { value: 'Make that opening more restrained.' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Send to Direkt' }));

    await waitFor(() => {
      expect(onOpenDirectChat).toHaveBeenCalledWith(
        'Make that opening more restrained.',
        expect.any(Function),
      );
    });
  });

  it('puts a hosted-agent answer option into the active review prompt', () => {
    render(
      <LandingPage
        onOpenChat={vi.fn()}
        onRenderVideo={vi.fn()}
        reviewMessages={[{
          id: 'assistant-input',
          inputRequest: {
            allowFreeform: false,
            allowMultiple: false,
            id: 'input-pacing',
            options: [
              { description: 'Tighter cuts.', id: 'fast', title: 'Fast' },
              { description: 'Longer breaths.', id: 'calm', title: 'Calm' },
            ],
            question: 'Which pacing should I use?',
          },
          role: 'assistant',
          text: 'Which pacing should I use?',
        }]}
        reviewReady
        selectedProjectId="project-1"
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /FastTighter cuts/i }));
    expect(screen.getByLabelText('Message for AI Chat')).toHaveValue(
      'For “Which pacing should I use?”, I choose “Fast” (fast). Tighter cuts.',
    );
  });

  it('keeps the normal-mode busy action enabled and stops the active AI task', () => {
    const onStopChat = vi.fn(() => true);
    render(
      <LandingPage
        backgroundActivityStatus={{ label: 'Thinking…' }}
        backgroundJobRunning
        onStopChat={onStopChat}
        selectedProjectId="project-1"
      />,
    );

    const button = screen.getByRole('button', { name: 'Stop AI task' });
    expect(button).toBeEnabled();
    expect(button).toHaveAttribute('data-stoppable', 'true');

    fireEvent.click(button);

    expect(onStopChat).toHaveBeenCalledTimes(1);
    expect(screen.getAllByText('AI task stopped.')).toHaveLength(2);
  });

  it('shows the recently completed AI steps beside the live phase', () => {
    render(
      <LandingPage
        backgroundActivityStatus={{
          label: 'Applying the edit…',
          steps: ['Reading timeline', 'Planning the edit', 'Applying the edit'],
        }}
        backgroundJobRunning
        selectedProjectId="project-1"
      />,
    );

    expect(screen.getByText('Applying the edit…')).toBeInTheDocument();
    expect(screen.getByText('Reading timeline / Planning the edit')).toBeInTheDocument();
  });

  it('shows file duration and text previews in the project strip', () => {
    render(<LandingPage projectMedia={projectMedia} />);

    expect(screen.getByText('Interview.mp4')).toBeInTheDocument();
    expect(screen.getByText('1:05')).toBeInTheDocument();
    expect(screen.getByText('Opening title')).toBeInTheDocument();
    expect(screen.getByText('A film by MasterSelects')).toBeInTheDocument();
  });

  it('hides project-file remove actions while choosing AI sources', () => {
    const onRemoveProjectFile = vi.fn(async () => true);
    render(
      <LandingPage
        onRemoveProjectFile={onRemoveProjectFile}
        projectMedia={projectMedia}
      />,
    );

    expect(screen.queryByRole('button', { name: 'Remove Interview.mp4' })).not.toBeInTheDocument();
    expect(onRemoveProjectFile).not.toHaveBeenCalled();
  });

  it('runs a typed message in the background without leaving the Start layout', async () => {
    render(<LandingPanel />);

    fireEvent.click(screen.getByRole('button', { name: /New project/i }));
    expect(screen.getByLabelText('Name new project')).toHaveClass('is-project-naming');
    fireEvent.change(screen.getByLabelText('Project title'), {
      target: { value: 'Quiet documentary' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Continue to project location' }));
    await waitFor(() => {
      expect(createBlankProjectMock).toHaveBeenCalledWith('Quiet documentary');
    });
    const chatInput = await screen.findByLabelText('Message for AI Chat');
    fireEvent.change(chatInput, {
      target: { value: 'Help me plan a short film' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Send to Direkt' }));

    await waitFor(() => {
      expect(runFlashBoardBridgeChatTurnMock).toHaveBeenCalledWith(expect.objectContaining({
        agentPath: 'direct-codex',
        includeHistory: false,
        prompt: 'Help me plan a short film',
        runSource: 'ui',
        toolExecutionMode: 'normal',
      }));
    });
    expect(runLandingBackgroundCreationMock).not.toHaveBeenCalled();
    expect(screen.getByRole('main')).not.toHaveClass('is-opening-editor');
    expect(useDockStore.getState().activeSavedLayoutId).toBe(FACTORY_START_LAYOUT_ID);
  });

  it('adopts the project restored during chat startup', async () => {
    let projectOpen = false;
    const restoredProject = {
      backend: 'native' as const,
      id: 'restored-project',
      lastOpenedAt: Date.now(),
      name: 'Restored project',
      path: 'C:/Projects/Restored project',
    };
    vi.spyOn(projectFileService, 'isProjectOpen').mockImplementation(() => projectOpen);
    vi.spyOn(projectFileService, 'getProjectPath').mockReturnValue(restoredProject.path);
    vi.spyOn(projectFileService, 'getRecentProjects').mockReturnValue([restoredProject]);

    render(<LandingPanel />);
    expect(screen.getByLabelText('Message for AI Chat')).toBeDisabled();

    projectOpen = true;
    act(() => window.dispatchEvent(new CustomEvent(RECENT_PROJECTS_CHANGED_EVENT)));

    await waitFor(() => {
      expect(screen.getByLabelText('Message for AI Chat')).toBeEnabled();
    });
  });

  it('opens Video Edit through the shared 400ms sequence and keeps Chat in history', () => {
    vi.useFakeTimers();
    window.history.replaceState({ source: 'chat' }, '', '/chat');
    const pushState = vi.spyOn(window.history, 'pushState');
    const listener = vi.fn<(event: Event) => void>();
    const chromeListener = vi.fn<(event: Event) => void>();
    window.addEventListener(DOCK_LAYOUT_TRANSITION_EVENT, listener);
    window.addEventListener(START_CHROME_TRANSITION_EVENT, chromeListener);
    render(<LandingPanel />);

    fireEvent.click(screen.getByRole('button', { name: 'Open MasterSelects editor' }));

    expect(screen.getByRole('main')).toHaveClass('is-opening-editor');
    expect(listener).not.toHaveBeenCalled();
    act(() => {
      vi.advanceTimersByTime(START_CHAT_EXIT_DURATION_MS);
    });

    expect(pushState).toHaveBeenCalledWith({ source: 'chat' }, '', '/editor');
    expect(window.location.pathname).toBe('/editor');
    expect(listener).toHaveBeenCalledTimes(1);
    const event = listener.mock.calls[0]?.[0] as CustomEvent<{
      durationMs: number;
      staggerMode: string;
      startTransitionDirection: string;
    }>;
    expect(event.detail.durationMs).toBe(START_EDITOR_REVEAL_DURATION_MS);
    expect(event.detail.staggerMode).toBe('sequence');
    expect(event.detail.startTransitionDirection).toBe('from-start');
    expect((chromeListener.mock.calls[0]?.[0] as CustomEvent).detail).toEqual({
      durationMs: START_EDITOR_REVEAL_DURATION_MS,
      direction: 'from-start',
    });
    expect(START_CHAT_EXIT_DURATION_MS + event.detail.durationMs).toBe(
      START_LAYOUT_REVEAL_DURATION_MS,
    );
    expect(START_LAYOUT_REVEAL_DURATION_MS).toBe(400);
    expect(useDockStore.getState().activeSavedLayoutId).toBe(FACTORY_VIDEO_EDIT_LAYOUT_ID);
    window.removeEventListener(DOCK_LAYOUT_TRANSITION_EVENT, listener);
    window.removeEventListener(START_CHROME_TRANSITION_EVENT, chromeListener);
  });

  it('uses the same sequence when the Start favorite is opened from the editor', () => {
    useDockStore.setState({ activeSavedLayoutId: FACTORY_VIDEO_EDIT_LAYOUT_ID });
    const listener = vi.fn<(event: Event) => void>();
    const chromeListener = vi.fn<(event: Event) => void>();
    window.addEventListener(DOCK_LAYOUT_TRANSITION_EVENT, listener);
    window.addEventListener(START_CHROME_TRANSITION_EVENT, chromeListener);

    useDockStore.getState().loadSavedLayout(FACTORY_START_LAYOUT_ID);

    const event = listener.mock.calls[0]?.[0] as CustomEvent<{
      durationMs: number;
      staggerMode: string;
      startTransitionDirection: string;
    }>;
    expect(event.detail).toEqual({
      durationMs: START_LAYOUT_OUTRO_DURATION_MS,
      staggerMode: 'sequence',
      startTransitionDirection: 'to-start',
    });
    expect((chromeListener.mock.calls[0]?.[0] as CustomEvent).detail).toEqual({
      durationMs: START_LAYOUT_OUTRO_DURATION_MS,
      direction: 'to-start',
    });
    expect(START_LAYOUT_OUTRO_DURATION_MS).toBe(400);
    expect(useDockStore.getState().activeSavedLayoutId).toBe(FACTORY_START_LAYOUT_ID);
    window.removeEventListener(DOCK_LAYOUT_TRANSITION_EVENT, listener);
    window.removeEventListener(START_CHROME_TRANSITION_EVENT, chromeListener);
  });
});
