import { Logger } from './logger';
import { useCanvasToolStore } from '../stores/canvasToolStore';
import { useDockStore } from '../stores/dockStore';
import { useSAM2Store } from '../stores/sam2Store';
import { useTimelineStore } from '../stores/timeline';
import { addTextLayer, openLayerProperties } from './imageDocument/imageDocumentService';

const log = Logger.create('CanvasTools');

export type MaskDrawMode = 'drawingRect' | 'drawingEllipse' | 'drawingPen';

function selectedClipId(): string | null {
  const { selectedClipIds } = useTimelineStore.getState();
  return selectedClipIds.values().next().value ?? null;
}

/**
 * Start drawing a mask on the selected layer. The mask overlay belongs to the
 * Properties Masks tab, so that tab is opened as well.
 */
export function startMaskDrawTool(mode: MaskDrawMode): boolean {
  const clipId = selectedClipId();
  if (!clipId) {
    log.warn('Mask tools need a selected layer', { mode });
    return false;
  }
  useCanvasToolStore.getState().setActiveCanvasTool('move');
  openLayerProperties(clipId, 'masks');
  useTimelineStore.getState().setMaskEditMode(mode);
  return true;
}

/** Open AI Segment and arm its click-to-segment mode when the model is loaded. */
export function startSegmentTool(): void {
  useDockStore.getState().activatePanelType('ai-segment');
  const sam2 = useSAM2Store.getState();
  if (sam2.modelStatus !== 'ready') {
    log.info('AI Segment model is not loaded; opened the panel to load it', { modelStatus: sam2.modelStatus });
    return;
  }
  useCanvasToolStore.getState().setActiveCanvasTool('move');
  sam2.setActive(true);
}

/**
 * Add a text layer centered on a composition pixel. Clip positions are offsets
 * from the composition center in half-size units.
 */
export async function placeTextLayerAt(
  point: { x: number; y: number },
  compositionSize: { width: number; height: number },
): Promise<string | null> {
  const clipId = await addTextLayer();
  if (!clipId) {
    log.warn('The text tool could not add a text layer');
    return null;
  }
  const halfWidth = compositionSize.width / 2;
  const halfHeight = compositionSize.height / 2;
  if (halfWidth > 0 && halfHeight > 0) {
    useTimelineStore.getState().updateClipTransform(clipId, {
      position: { x: (point.x - halfWidth) / halfWidth, y: (point.y - halfHeight) / halfHeight, z: 0 },
    });
  }
  useCanvasToolStore.getState().setActiveCanvasTool('move');
  return clipId;
}
