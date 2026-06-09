import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type DragEvent,
  type MouseEvent as ReactMouseEvent,
  type RefObject,
  type UIEvent,
} from 'react';
import type { ProjectItem } from '../../../../stores/mediaStore';
import type { MediaPanelViewMode } from '../panel/types';
import {
  MEDIA_CLASSIC_ROW_HEIGHT as CLASSIC_ROW_HEIGHT,
  loadMediaClassicColumnOrder,
  saveMediaClassicColumnOrder,
  sortClassicMediaItems,
} from './classicListPlanning';
import type { MediaClassicColumnId } from './types';

const MEDIA_PANEL_NAME_WIDTH_STORAGE_KEY = 'media-panel-name-width';

interface UseMediaClassicListUiStateInput {
  itemListRef: RefObject<HTMLDivElement | null>;
  viewMode: MediaPanelViewMode;
}

export function useMediaClassicListUiState({
  itemListRef,
  viewMode,
}: UseMediaClassicListUiStateInput) {
  const classicListScrollTopRef = useRef(0);
  const classicListScrollLeftRef = useRef(0);
  const classicListScrollSnapTimerRef = useRef<number | null>(null);
  const classicListHorizontalSnapTimerRef = useRef<number | null>(null);
  const classicListScrollSettledTimerRef = useRef<number | null>(null);
  const resizeRef = useRef<{ startX: number; startWidth: number } | null>(null);

  const [classicListViewport, setClassicListViewport] = useState({ scrollTop: 0, height: 0 });
  const [isClassicListVerticalScrolling, setClassicListVerticalScrolling] = useState(false);
  const [isClassicListHorizontallyScrolled, setClassicListHorizontallyScrolled] = useState(false);
  const [columnOrder, setColumnOrder] = useState<MediaClassicColumnId[]>(loadMediaClassicColumnOrder);
  const [draggingColumn, setDraggingColumn] = useState<MediaClassicColumnId | null>(null);
  const [dragOverColumn, setDragOverColumn] = useState<MediaClassicColumnId | null>(null);
  const [sortColumn, setSortColumn] = useState<MediaClassicColumnId | null>(null);
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('asc');
  const [nameColumnWidth, setNameColumnWidth] = useState(() => {
    const stored = localStorage.getItem(MEDIA_PANEL_NAME_WIDTH_STORAGE_KEY);
    return stored ? parseInt(stored) : 250;
  });

  useEffect(() => {
    saveMediaClassicColumnOrder(columnOrder);
  }, [columnOrder]);

  useLayoutEffect(() => {
    if (viewMode !== 'classic') return;

    const list = itemListRef.current;
    if (!list) return;

    const updateViewport = () => {
      classicListScrollTopRef.current = list.scrollTop;
      classicListScrollLeftRef.current = list.scrollLeft;
      setClassicListHorizontallyScrolled(list.scrollLeft > 0.5);
      setClassicListViewport((current) => {
        const next = {
          scrollTop: list.scrollTop,
          height: list.clientHeight,
        };
        return current.scrollTop === next.scrollTop && current.height === next.height ? current : next;
      });
    };

    updateViewport();

    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', updateViewport);
      return () => window.removeEventListener('resize', updateViewport);
    }

    const resizeObserver = new ResizeObserver(updateViewport);
    resizeObserver.observe(list);
    return () => resizeObserver.disconnect();
  }, [itemListRef, viewMode]);

  useEffect(() => () => {
    if (classicListScrollSnapTimerRef.current !== null) {
      window.clearTimeout(classicListScrollSnapTimerRef.current);
      classicListScrollSnapTimerRef.current = null;
    }
    if (classicListHorizontalSnapTimerRef.current !== null) {
      window.clearTimeout(classicListHorizontalSnapTimerRef.current);
      classicListHorizontalSnapTimerRef.current = null;
    }
    if (classicListScrollSettledTimerRef.current !== null) {
      window.clearTimeout(classicListScrollSettledTimerRef.current);
      classicListScrollSettledTimerRef.current = null;
    }
  }, []);

  useEffect(() => {
    localStorage.setItem(MEDIA_PANEL_NAME_WIDTH_STORAGE_KEY, String(nameColumnWidth));
  }, [nameColumnWidth]);

  const resetClassicListUiState = useCallback(() => {
    setColumnOrder(loadMediaClassicColumnOrder());
    const storedNameWidth = localStorage.getItem(MEDIA_PANEL_NAME_WIDTH_STORAGE_KEY);
    setNameColumnWidth(storedNameWidth ? parseInt(storedNameWidth, 10) : 250);
  }, []);

  const handleColumnDragStart = useCallback((e: DragEvent, columnId: MediaClassicColumnId) => {
    e.stopPropagation();
    setDraggingColumn(columnId);
    e.dataTransfer.setData('application/x-column-id', columnId);
    e.dataTransfer.effectAllowed = 'move';
  }, []);

  const handleColumnDragOver = useCallback((e: DragEvent, columnId: MediaClassicColumnId) => {
    e.preventDefault();
    e.stopPropagation();
    if (draggingColumn && draggingColumn !== columnId) {
      setDragOverColumn(columnId);
    }
  }, [draggingColumn]);

  const handleColumnDragLeave = useCallback(() => {
    setDragOverColumn(null);
  }, []);

  const handleColumnDrop = useCallback((e: DragEvent, targetColumnId: MediaClassicColumnId) => {
    e.preventDefault();
    e.stopPropagation();
    const sourceColumnId = e.dataTransfer.getData('application/x-column-id') as MediaClassicColumnId;
    if (sourceColumnId && sourceColumnId !== targetColumnId) {
      setColumnOrder(prev => {
        const newOrder = [...prev];
        const sourceIndex = newOrder.indexOf(sourceColumnId);
        const targetIndex = newOrder.indexOf(targetColumnId);
        newOrder.splice(sourceIndex, 1);
        newOrder.splice(targetIndex, 0, sourceColumnId);
        return newOrder;
      });
    }
    setDraggingColumn(null);
    setDragOverColumn(null);
  }, []);

  const handleColumnDragEnd = useCallback(() => {
    setDraggingColumn(null);
    setDragOverColumn(null);
  }, []);

  const handleColumnSort = useCallback((colId: MediaClassicColumnId) => {
    if (sortColumn === colId) {
      if (sortDirection === 'asc') {
        setSortDirection('desc');
      } else {
        setSortColumn(null);
        setSortDirection('asc');
      }
    } else {
      setSortColumn(colId);
      setSortDirection('asc');
    }
  }, [sortColumn, sortDirection]);

  const sortItems = useCallback((items: ProjectItem[]): ProjectItem[] => {
    return sortClassicMediaItems(items, sortColumn, sortDirection);
  }, [sortColumn, sortDirection]);

  const handleClassicListScroll = useCallback((event: UIEvent<HTMLDivElement>) => {
    const target = event.currentTarget;
    const nextScrollTop = target.scrollTop;
    const nextScrollLeft = target.scrollLeft;
    const verticalScrollChanged = Math.abs(nextScrollTop - classicListScrollTopRef.current) > 0.5;
    const horizontalScrollChanged = Math.abs(nextScrollLeft - classicListScrollLeftRef.current) > 0.5;
    classicListScrollTopRef.current = nextScrollTop;
    classicListScrollLeftRef.current = nextScrollLeft;

    if (horizontalScrollChanged) {
      setClassicListHorizontallyScrolled(nextScrollLeft > 0.5);
      if (classicListHorizontalSnapTimerRef.current !== null) {
        window.clearTimeout(classicListHorizontalSnapTimerRef.current);
      }

      classicListHorizontalSnapTimerRef.current = window.setTimeout(() => {
        classicListHorizontalSnapTimerRef.current = null;
        const list = itemListRef.current;
        const header = list?.querySelector<HTMLElement>('.media-column-headers');
        if (!list || !header) return;

        const maxScrollLeft = Math.max(0, list.scrollWidth - list.clientWidth);
        if (maxScrollLeft <= 0) return;

        const nameColumn = header.querySelector<HTMLElement>('.media-col-name');
        const stickyWidth = nameColumn?.offsetWidth ?? 0;
        const candidates = new Set<number>([0, maxScrollLeft]);
        header.querySelectorAll<HTMLElement>('.media-col').forEach((column) => {
          if (column.classList.contains('media-col-name')) return;
          const alignedStart = Math.max(0, Math.min(maxScrollLeft, column.offsetLeft - stickyWidth));
          const alignedEnd = Math.max(0, Math.min(maxScrollLeft, column.offsetLeft + column.offsetWidth - stickyWidth));
          candidates.add(alignedStart);
          candidates.add(alignedEnd);
        });

        const snappedScrollLeft = [...candidates].reduce((best, candidate) => (
          Math.abs(candidate - list.scrollLeft) < Math.abs(best - list.scrollLeft) ? candidate : best
        ), 0);
        if (Math.abs(list.scrollLeft - snappedScrollLeft) > 0.5) {
          list.scrollTo({
            left: snappedScrollLeft,
            top: list.scrollTop,
            behavior: 'smooth',
          });
        }
      }, 90);
    }

    if (verticalScrollChanged) {
      setClassicListVerticalScrolling(true);
      if (classicListScrollSnapTimerRef.current !== null) {
        window.clearTimeout(classicListScrollSnapTimerRef.current);
      }
      if (classicListScrollSettledTimerRef.current !== null) {
        window.clearTimeout(classicListScrollSettledTimerRef.current);
      }

      classicListScrollSnapTimerRef.current = window.setTimeout(() => {
        classicListScrollSnapTimerRef.current = null;
        const list = itemListRef.current;
        if (!list) {
          setClassicListVerticalScrolling(false);
          return;
        }

        const maxScrollTop = Math.max(0, list.scrollHeight - list.clientHeight);
        const snappedScrollTop = Math.max(
          0,
          Math.min(maxScrollTop, Math.round(list.scrollTop / CLASSIC_ROW_HEIGHT) * CLASSIC_ROW_HEIGHT),
        );
        if (Math.abs(list.scrollTop - snappedScrollTop) > 0.5) {
          list.scrollTo({
            left: list.scrollLeft,
            top: snappedScrollTop,
            behavior: 'smooth',
          });
        }
      }, 90);

      classicListScrollSettledTimerRef.current = window.setTimeout(() => {
        classicListScrollSettledTimerRef.current = null;
        setClassicListVerticalScrolling(false);
      }, 260);
    }

    setClassicListViewport((current) => {
      const next = {
        scrollTop: nextScrollTop,
        height: target.clientHeight,
      };
      return current.scrollTop === next.scrollTop && current.height === next.height ? current : next;
    });
  }, [itemListRef]);

  const scrollClassicListRowIntoView = useCallback((rowIndex: number) => {
    const list = itemListRef.current;
    if (!list || rowIndex < 0) return false;

    const targetTop = rowIndex * CLASSIC_ROW_HEIGHT;
    const targetScrollTop = Math.max(0, targetTop - Math.max(0, (list.clientHeight - CLASSIC_ROW_HEIGHT) / 2));
    if (Math.abs(list.scrollTop - targetScrollTop) > 1) {
      list.scrollTop = targetScrollTop;
      setClassicListViewport({
        scrollTop: targetScrollTop,
        height: list.clientHeight,
      });
    }
    return true;
  }, [itemListRef]);

  const handleResizeStart = useCallback((e: ReactMouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    resizeRef.current = { startX: e.clientX, startWidth: nameColumnWidth };

    const handleMouseMove = (moveEvent: MouseEvent) => {
      if (resizeRef.current) {
        const delta = moveEvent.clientX - resizeRef.current.startX;
        const newWidth = Math.max(120, Math.min(500, resizeRef.current.startWidth + delta));
        setNameColumnWidth(newWidth);
      }
    };

    const handleMouseUp = () => {
      resizeRef.current = null;
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  }, [nameColumnWidth]);

  return {
    classicListViewport,
    isClassicListVerticalScrolling,
    isClassicListHorizontallyScrolled,
    columnOrder,
    draggingColumn,
    dragOverColumn,
    sortColumn,
    sortDirection,
    nameColumnWidth,
    resetClassicListUiState,
    sortItems,
    handleClassicListScroll,
    scrollClassicListRowIntoView,
    handleColumnDragStart,
    handleColumnDragOver,
    handleColumnDragLeave,
    handleColumnDrop,
    handleColumnDragEnd,
    handleColumnSort,
    handleResizeStart,
  };
}
