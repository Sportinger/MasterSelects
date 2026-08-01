import { readFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { useDockStore } from '../../src/stores/dockStore';
import { useExportStore } from '../../src/stores/exportStore';
import { useFlashBoardStore } from '../../src/stores/flashboardStore';
import { getHistoryStateView, useHistoryStore } from '../../src/stores/historyStore';
import { useMediaStore } from '../../src/stores/mediaStore';
import { useTimelineStore } from '../../src/stores/timeline';
import { projectFileService } from '../../src/services/projectFileService';
import { renderHostPort } from '../../src/services/render/renderHostPort';
import {
  assertMd2DisposableEvidenceSession,
  assertMd2RestorableExportState,
  captureMd2EvidenceRestoreSnapshot,
  restoreMd2EvidenceSnapshot,
  runWithMd2EvidenceRestore,
} from '../../src/services/aiTools/devBridge/browser/debugActions/motionDesignMd2Evidence';

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('MD2 disposable evidence lifecycle', () => {
  it('refuses playback and non-restorable export resources before mutation', () => {
    expect(() => assertMd2RestorableExportState({
      isPlaying: false,
      isExporting: false,
      exportPreviewFrame: null,
    })).not.toThrow();
    expect(() => assertMd2RestorableExportState({
      isPlaying: true,
      isExporting: false,
      exportPreviewFrame: null,
    })).toThrow('playback active');
    expect(() => assertMd2RestorableExportState({
      isPlaying: false,
      isExporting: true,
      exportPreviewFrame: null,
    })).toThrow('export in progress');
    expect(() => assertMd2RestorableExportState({
      isPlaying: false,
      isExporting: false,
      exportPreviewFrame: {} as ImageBitmap,
    })).toThrow('no existing export preview frame');
  });

  it('requires an exact dedicated, blank, chat-free browser session', () => {
    const timelineBefore = useTimelineStore.getState();
    const mediaBefore = useMediaStore.getState();
    const chatBefore = useFlashBoardStore.getState().chatMessages;
    const expectedUrl = 'http://motion-md0-a1b2c3d4.localhost:5173/?motionDesignEvidenceSession=a1b2c3d4';
    const projectOpen = vi.spyOn(projectFileService, 'isProjectOpen').mockReturnValue(false);
    vi.stubGlobal('window', { location: { href: expectedUrl } } as unknown as Window);
    try {
      useTimelineStore.setState({
        clips: [],
        isPlaying: false,
        isExporting: false,
        exportPreviewFrame: null,
      });
      vi.mocked(useMediaStore.getState).mockReturnValue({
        ...mediaBefore,
        currentProjectId: null,
        currentProjectName: 'Untitled Project',
      });
      useFlashBoardStore.setState({ chatMessages: [] });
      expect(useMediaStore.getState().currentProjectId).toBeNull();
      expect(useMediaStore.getState().currentProjectName).toBe('Untitled Project');
      expect(assertMd2DisposableEvidenceSession({
        confirmDisposableSession: true,
        expectedSessionUrl: expectedUrl,
      }).href).toBe(expectedUrl);

      useFlashBoardStore.setState({
        chatMessages: [{ id: 'evidence-chat' } as never],
      });
      expect(() => assertMd2DisposableEvidenceSession({
        confirmDisposableSession: true,
        expectedSessionUrl: expectedUrl,
      })).toThrow('chat-free');
      useFlashBoardStore.setState({ chatMessages: [] });

      expect(() => assertMd2DisposableEvidenceSession({
        confirmDisposableSession: true,
        expectedSessionUrl: 'http://localhost:5173/?motionDesignEvidenceSession=a1b2c3d4',
      })).toThrow('dedicated *.localhost');
      expect(() => assertMd2DisposableEvidenceSession({
        confirmDisposableSession: true,
        expectedSessionUrl: 'http://motion-md2.localhost:5173/',
      })).toThrow('motionDesignEvidenceSession');
      expect(() => assertMd2DisposableEvidenceSession({
        confirmDisposableSession: true,
        expectedSessionUrl: 'http://other.localhost:5173/?motionDesignEvidenceSession=a1b2c3d4',
      })).toThrow('does not match');
      expect(projectOpen).toHaveBeenCalled();
    } finally {
      useTimelineStore.setState({
        clips: timelineBefore.clips,
        isPlaying: timelineBefore.isPlaying,
        isExporting: timelineBefore.isExporting,
        exportPreviewFrame: timelineBefore.exportPreviewFrame,
      });
      vi.mocked(useMediaStore.getState).mockReturnValue(mediaBefore);
      useFlashBoardStore.setState({ chatMessages: chatBefore });
    }
  });

  it('restores timeline, history, media, export, dock, and render state after failure', async () => {
    const timelineBefore = useTimelineStore.getState();
    const historyBefore = getHistoryStateView();
    const mediaBefore = useMediaStore.getState();
    const exportBefore = useExportStore.getState();
    const dockBefore = structuredClone(useDockStore.getState().layout);
    const dimensionsBefore = renderHostPort.getOutputDimensions();
    const snapshot = captureMd2EvidenceRestoreSnapshot();

    await expect(runWithMd2EvidenceRestore(async () => {
      useTimelineStore.setState({
        zoom: timelineBefore.zoom + 4,
        scrollX: timelineBefore.scrollX + 9,
        selectedClipIds: new Set(['md2-temp']),
        selectedKeyframeIds: new Set(['md2-kf']),
        isExporting: true,
      });
      useHistoryStore.setState({ maxHistoryNodes: historyBefore.maxHistorySize + 1 });
      useMediaStore.setState({ selectedIds: ['md2-media'], currentProjectName: 'MD2 mutation' });
      useExportStore.setState({ selectedPresetId: 'md2-preset' });
      useDockStore.setState({
        layout: {
          ...useDockStore.getState().layout,
          panelZoom: { ...useDockStore.getState().layout.panelZoom, 'md2-evidence': 2 },
        },
      });
      renderHostPort.setResolution(dimensionsBefore.width + 16, dimensionsBefore.height + 16);
      throw new Error('forced MD2 evidence failure');
    }, () => restoreMd2EvidenceSnapshot(snapshot))).rejects.toThrow('forced MD2 evidence failure');

    const timelineAfter = useTimelineStore.getState();
    expect(timelineAfter.zoom).toBe(timelineBefore.zoom);
    expect(timelineAfter.scrollX).toBe(timelineBefore.scrollX);
    expect(timelineAfter.selectedClipIds).toBe(timelineBefore.selectedClipIds);
    expect(timelineAfter.selectedKeyframeIds).toBe(timelineBefore.selectedKeyframeIds);
    expect(timelineAfter.isExporting).toBe(timelineBefore.isExporting);
    expect(getHistoryStateView().maxHistorySize).toBe(historyBefore.maxHistorySize);
    expect(useMediaStore.getState().selectedIds).toEqual(mediaBefore.selectedIds);
    expect(useMediaStore.getState().currentProjectName).toBe(mediaBefore.currentProjectName);
    expect(useExportStore.getState().selectedPresetId).toBe(exportBefore.selectedPresetId);
    expect(useDockStore.getState().layout).toEqual(dockBefore);
    expect(renderHostPort.getOutputDimensions()).toEqual(dimensionsBefore);
  });

  it('registers only the exact hidden debug action and real UI selectors', () => {
    const indexSource = readFileSync(path.join(
      process.cwd(),
      'src/services/aiTools/devBridge/browser/debugActions/index.ts',
    ), 'utf8');
    const actionSource = readFileSync(path.join(
      process.cwd(),
      'src/services/aiTools/devBridge/browser/debugActions/motionDesignMd2Evidence.ts',
    ), 'utf8');
    expect(indexSource).toContain("case 'run-motion-design-md2-evidence':");
    expect(indexSource).toContain('runMotionDesignMd2EvidenceDebugAction(args)');
    expect(actionSource).toContain('[data-testid="timeline-global-curve-surface"]');
    expect(actionSource).toContain('svg[data-motion-path-overlay="true"]');
    expect(actionSource).toContain('button[aria-label="Toggle Timeline and Graph view"]');
    expect(actionSource).toContain('rasterizeMd2SvgElement');
    expect(actionSource).not.toContain('focusedTab');
  });
});
