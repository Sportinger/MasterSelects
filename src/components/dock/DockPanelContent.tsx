// Maps panel type to actual component
// Note: Effects, Transcript, Analysis are now integrated into PropertiesPanel

import { lazy, Suspense } from 'react';
import type {
  CurvesPanelData,
  DockPanel,
  MultiPreviewPanelData,
  NodeWorkspacePanelData,
  PreviewPanelData,
  ScopesPanelData,
  TimelinePanelData,
} from '../../types/dock';
import { Preview } from '../preview/Preview';
import { PropertiesPanel } from '../panels/properties';
import { MediaPanel } from '../panels/MediaPanel';
import { TimelineSlotPanelHost } from '../panels/slot-grid/TimelineSlotPanelHost';
import { normalizePreviewPanelSource } from '../../utils/previewPanelSource';
import { importAudioMixerPanel } from '../panels/audio-mixer/audioMixerPanelLoader';
import { PreviewDockPanelContext } from '../preview/PreviewDockPanelContext';

// Lazy-loaded panels: only loaded when the user opens them
// This keeps the initial bundle small by deferring export pipeline,
// AI services and export code
const ExportPanel = lazy(() => import('../export/ExportPanel').then(m => ({ default: m.ExportPanel })));
const AudioMixerPanel = lazy(importAudioMixerPanel);
const NodeWorkspacePanel = lazy(() => import('../panels/nodes/NodeWorkspacePanel').then(m => ({ default: m.NodeWorkspacePanel })));
const ColorNodesPanel = lazy(() => import('../panels/color-workspace/ColorDockPanels').then(m => ({ default: m.ColorNodesPanel })));
const ColorControlsPanel = lazy(() => import('../panels/color-workspace/ColorDockPanels').then(m => ({ default: m.ColorControlsPanel })));
const ColorKeyframesDockPanel = lazy(() => import('../panels/color-workspace/ColorDockPanels').then(m => ({ default: m.ColorKeyframesDockPanel })));
const ColorClipStrip = lazy(() => import('../panels/color-workspace/ColorClipStrip').then(m => ({ default: m.ColorClipStrip })));
const ColorCompactTimeline = lazy(() => import('../panels/color-workspace/ColorCompactTimeline').then(m => ({ default: m.ColorCompactTimeline })));
const ScopesPanel = lazy(() => import('../panels/scopes/ScopesPanel').then(m => ({ default: m.ScopesPanel })));
const MIDIMappingPanel = lazy(() => import('../panels/MIDIMappingPanel').then(m => ({ default: m.MIDIMappingPanel })));
const TransitionsPanel = lazy(() => import('../panels/TransitionsPanel').then(m => ({ default: m.TransitionsPanel })));
const SAM2Panel = lazy(() => import('../panels/SAM2Panel').then(m => ({ default: m.SAM2Panel })));
const SceneDescriptionPanel = lazy(() => import('../panels/SceneDescriptionPanel').then(m => ({ default: m.SceneDescriptionPanel })));
const MultiPreviewPanel = lazy(() => import('../preview/MultiPreviewPanel').then(m => ({ default: m.MultiPreviewPanel })));
const HistoryPanel = lazy(() => import('../panels/HistoryPanel').then(m => ({ default: m.HistoryPanel })));
const CapturePanel = lazy(() => import('../panels/capture/CapturePanel').then(m => ({ default: m.CapturePanel })));
const GoLivePanel = lazy(() => import('../panels/go-live/GoLivePanel').then(m => ({ default: m.GoLivePanel })));
const StreamChatPanel = lazy(() => import('../panels/stream-chat/StreamChatPanel').then(m => ({ default: m.StreamChatPanel })));
const StreamAnalyticsPanel = lazy(() => import('../panels/stream-analytics/StreamAnalyticsPanel').then(m => ({ default: m.StreamAnalyticsPanel })));
const StatsPanel = lazy(() => import('../panels/stats/StatsPanel').then(m => ({ default: m.StatsPanel })));
const LandingPanel = lazy(() => import('../../marketing/LandingPanel').then(m => ({ default: m.LandingPanel })));
const StoryPanel = lazy(() => import('../story/StoryPanel').then(m => ({ default: m.StoryPanel })));
const AIStudioPanel = lazy(() => import('../panels/ai-studio/AIStudioPanel').then(m => ({ default: m.AIStudioPanel })));
const AnnotationsPanel = lazy(() => import('../panels/annotations/AnnotationsPanel').then(m => ({ default: m.AnnotationsPanel })));
const DocumentsPanel = lazy(() => import('../panels/documents/DocumentsPanel').then(m => ({ default: m.DocumentsPanel })));
const MediaDiscoveryPanel = lazy(() => import('../panels/media-discovery/MediaDiscoveryPanel').then(m => ({ default: m.MediaDiscoveryPanel })));
const ThreeDScanPanel = lazy(() => import('../panels/three-d-scan/ThreeDScanPanel').then(m => ({ default: m.ThreeDScanPanel })));
const CurvesPanel = lazy(() => import('../panels/curves/CurvesPanel').then(m => ({ default: m.CurvesPanel })));

const DEFAULT_MULTI_PREVIEW_DATA: MultiPreviewPanelData = {
  sourceCompositionId: null,
  slots: [{ compositionId: null }, { compositionId: null }, { compositionId: null }, { compositionId: null }],
  showTransparencyGrid: false,
};

function PanelLoading() {
  return <div className="flex items-center justify-center h-full text-gray-500 text-sm">Loading...</div>;
}

interface DockPanelContentProps {
  panel: DockPanel;
  allowPanelMaximize?: boolean;
}

export function DockPanelContent({ panel, allowPanelMaximize = false }: DockPanelContentProps) {
  switch (panel.type) {
    case 'start':
      return <Suspense fallback={null}><LandingPanel /></Suspense>;
    case 'preview': {
      const previewData = panel.data as PreviewPanelData | undefined;
      return (
        <PreviewDockPanelContext.Provider value={allowPanelMaximize ? panel.id : null}>
          <Preview
            panelId={panel.id}
            source={normalizePreviewPanelSource(previewData)}
            showTransparencyGrid={previewData?.showTransparencyGrid ?? false}
            showTransport
            initialEdit={previewData}
          />
        </PreviewDockPanelContext.Provider>
      );
    }
    case 'multi-preview': {
      const mpData = (panel.data as MultiPreviewPanelData | undefined) ?? DEFAULT_MULTI_PREVIEW_DATA;
      return <Suspense fallback={<PanelLoading />}><MultiPreviewPanel panelId={panel.id} data={mpData} /></Suspense>;
    }
    case 'export':
      return <Suspense fallback={<PanelLoading />}><ExportPanel /></Suspense>;
    case 'clip-properties':
      return <PropertiesPanel />;
    case 'audio-mixer':
      return <Suspense fallback={<PanelLoading />}><AudioMixerPanel /></Suspense>;
    case 'node-workspace':
      return <Suspense fallback={<PanelLoading />}><NodeWorkspacePanel panelId={panel.id} data={panel.data as NodeWorkspacePanelData | undefined} /></Suspense>;
    case 'color-nodes':
      return <Suspense fallback={<PanelLoading />}><ColorNodesPanel /></Suspense>;
    case 'color-controls':
      return <Suspense fallback={<PanelLoading />}><ColorControlsPanel /></Suspense>;
    case 'color-clips':
      return <Suspense fallback={<PanelLoading />}><ColorClipStrip /></Suspense>;
    case 'color-timeline':
      return <Suspense fallback={<PanelLoading />}><ColorCompactTimeline /></Suspense>;
    case 'color-scopes':
      return (
        <Suspense fallback={<PanelLoading />}>
          <ScopesPanel initialMode={(panel.data as ScopesPanelData | undefined)?.scopeMode} />
        </Suspense>
      );
    case 'color-keyframes':
      return <Suspense fallback={<PanelLoading />}><ColorKeyframesDockPanel /></Suspense>;
    case 'timeline':
      return (
        <TimelineSlotPanelHost
          panelId={panel.id}
          initialMode={(panel.data as TimelinePanelData | undefined)?.timelineSurfaceMode ?? 'timeline'}
        />
      );
    case 'curves': {
      const curvesData = panel.data as CurvesPanelData | undefined;
      return (
        <Suspense fallback={<PanelLoading />}>
          <CurvesPanel
            panelId={panel.id}
            initialPreferredTarget={curvesData?.curvePreferredTarget}
            initialTimeView={curvesData?.curveTimeView}
            initialViewedClipId={curvesData?.curveViewedClipId}
          />
        </Suspense>
      );
    }
    case 'media':
      return <MediaPanel />;
    case '3d-scan':
      return <Suspense fallback={<PanelLoading />}><ThreeDScanPanel /></Suspense>;
    case 'discover':
      return <Suspense fallback={<PanelLoading />}><MediaDiscoveryPanel /></Suspense>;
    case 'ai-studio':
      return <Suspense fallback={<PanelLoading />}><AIStudioPanel /></Suspense>;
    case 'annotations':
      return <Suspense fallback={<PanelLoading />}><AnnotationsPanel /></Suspense>;
    case 'documents':
      return <Suspense fallback={<PanelLoading />}><DocumentsPanel /></Suspense>;
    case 'history':
      return <Suspense fallback={<PanelLoading />}><HistoryPanel /></Suspense>;
    case 'stats':
      return <Suspense fallback={<PanelLoading />}><StatsPanel /></Suspense>;
    case 'midi-mapping':
      return <Suspense fallback={<PanelLoading />}><MIDIMappingPanel /></Suspense>;
    case 'capture':
      return <Suspense fallback={<PanelLoading />}><CapturePanel /></Suspense>;
    case 'go-live':
      return <Suspense fallback={<PanelLoading />}><GoLivePanel /></Suspense>;
    case 'slot-grid':
      return (
        <TimelineSlotPanelHost
          panelId={panel.id}
          initialMode={(panel.data as TimelinePanelData | undefined)?.timelineSurfaceMode ?? 'slot-grid'}
        />
      );
    case 'stream-chat':
      return <Suspense fallback={<PanelLoading />}><StreamChatPanel /></Suspense>;
    case 'stream-analytics':
      return <Suspense fallback={<PanelLoading />}><StreamAnalyticsPanel /></Suspense>;
    case 'story':
      return <Suspense fallback={<PanelLoading />}><StoryPanel /></Suspense>;
    case 'ai-segment':
      return <Suspense fallback={<PanelLoading />}><SAM2Panel /></Suspense>;
    case 'transitions':
      return <Suspense fallback={<PanelLoading />}><TransitionsPanel /></Suspense>;
    case 'scene-description':
      return <Suspense fallback={<PanelLoading />}><SceneDescriptionPanel /></Suspense>;
    case 'scope-waveform':
      return <Suspense fallback={<PanelLoading />}><ScopesPanel initialMode="waveform" /></Suspense>;
    case 'scope-histogram':
      return <Suspense fallback={<PanelLoading />}><ScopesPanel initialMode="histogram" /></Suspense>;
    case 'scope-vectorscope':
      return <Suspense fallback={<PanelLoading />}><ScopesPanel initialMode="vectorscope" /></Suspense>;
    default:
      return <div className="panel-placeholder">Unknown panel: {panel.type}</div>;
  }
}
