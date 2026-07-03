import { describe, expect, it } from 'vitest';

import {
  MEDIA_BOARD_COMPACT_LOD_ZOOM,
  MEDIA_BOARD_COMPACT_RENDER_BUFFER_PX,
  MEDIA_BOARD_OVERVIEW_CANVAS_ZOOM,
  MEDIA_BOARD_RENDER_BUFFER_PX,
  getMediaBoardRenderLod,
} from '../../src/components/panels/media/board/constants';
import { getMediaBoardVisibleRect } from '../../src/components/panels/media/board/layout';

describe('media board render LOD', () => {
  it('does not flip modes on tiny idle zoom jitter around thresholds', () => {
    const overview = getMediaBoardRenderLod(MEDIA_BOARD_OVERVIEW_CANVAS_ZOOM);
    expect(getMediaBoardRenderLod(MEDIA_BOARD_OVERVIEW_CANVAS_ZOOM + 0.01, overview).overviewCanvas).toBe(true);

    const full = getMediaBoardRenderLod(MEDIA_BOARD_OVERVIEW_CANVAS_ZOOM + 0.04, overview);
    expect(full.overviewCanvas).toBe(false);
    expect(getMediaBoardRenderLod(MEDIA_BOARD_OVERVIEW_CANVAS_ZOOM - 0.01, full).overviewCanvas).toBe(false);
  });

  it('keeps compact LOD stable until zoom clearly leaves the compact band', () => {
    const compact = getMediaBoardRenderLod(MEDIA_BOARD_COMPACT_LOD_ZOOM);
    expect(compact.compact).toBe(true);
    expect(getMediaBoardRenderLod(MEDIA_BOARD_COMPACT_LOD_ZOOM + 0.01, compact).compact).toBe(true);
    expect(getMediaBoardRenderLod(MEDIA_BOARD_COMPACT_LOD_ZOOM + 0.04, compact).compact).toBe(false);
  });

  it('uses the stabilized compact LOD for the visible render buffer', () => {
    const compact = getMediaBoardRenderLod(MEDIA_BOARD_COMPACT_LOD_ZOOM);
    const stillCompact = getMediaBoardRenderLod(MEDIA_BOARD_COMPACT_LOD_ZOOM + 0.01, compact);
    const clearlyFull = getMediaBoardRenderLod(MEDIA_BOARD_COMPACT_LOD_ZOOM + 0.04, compact);

    const compactRect = getMediaBoardVisibleRect(
      { zoom: MEDIA_BOARD_COMPACT_LOD_ZOOM + 0.01, panX: 0, panY: 0 },
      { width: 100, height: 100 },
      stillCompact.compact,
    );
    const fullRect = getMediaBoardVisibleRect(
      { zoom: MEDIA_BOARD_COMPACT_LOD_ZOOM + 0.04, panX: 0, panY: 0 },
      { width: 100, height: 100 },
      clearlyFull.compact,
    );

    expect(compactRect.left).toBeCloseTo(-MEDIA_BOARD_COMPACT_RENDER_BUFFER_PX / (MEDIA_BOARD_COMPACT_LOD_ZOOM + 0.01));
    expect(fullRect.left).toBeCloseTo(-MEDIA_BOARD_RENDER_BUFFER_PX / (MEDIA_BOARD_COMPACT_LOD_ZOOM + 0.04));
  });
});
