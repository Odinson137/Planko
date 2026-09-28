import { create } from 'zustand';
import { useProjectStore } from './useProjectStore';
import { useEditorStore } from './useEditorStore';
import { copyWallObjects, clipboardAt, clipboardPlacementError, pasteWallObjects, type WallClipboard } from '../services/WallClipboard';
import type { Point2D } from '../../core/geometry/PolygonSlicingEngine';

interface ClipboardState {
  content: WallClipboard | null;
  preview: WallClipboard | null;
  wallId: string | null;
  message: string | null;
  error: string | null;
  copy: () => boolean;
  beginPaste: () => boolean;
  move: (point: Point2D, free?: boolean) => void;
  place: () => boolean;
  cancel: () => void;
}

export const useClipboardStore = create<ClipboardState>((set, get) => ({
  content: null, preview: null, wallId: null, message: null, error: null,
  copy: () => {
    const state = useProjectStore.getState(), project = state.project;
    const wall = project.walls.find(w => w.id === project.selectedWallId);
    if (!wall) return false;
    const content = copyWallObjects(project.id, wall, project.materials,
      project.selectedOpeningId ? (state.selectedOpeningIds.length ? state.selectedOpeningIds : [project.selectedOpeningId]) : [], state.selectedPieceIds);
    if (!content) { set({ message: 'Выберите объект или панели для копирования.' }); return false; }
    const count = content.kind === 'openings' ? content.openings.length : content.panels.length;
    set({ content, preview: null, error: null, message: `Скопировано: ${count}. Ctrl+V — разместить копию.` });
    return true;
  },
  beginPaste: () => {
    const { content } = get(), project = useProjectStore.getState().project;
    const wall = project.walls.find(w => w.id === project.selectedWallId);
    if (!content || !wall || content.projectId !== project.id) { set({ message: 'Сначала скопируйте объект: Ctrl+C.' }); return false; }
    useEditorStore.getState().setViewMode('2D');
    useEditorStore.getState().setEditMode('PANELS');
    useEditorStore.getState().setActiveTool('SELECT');
    const preview = clipboardAt(content, { x: Math.max(0, (wall.width - content.bounds.width) / 2), y: Math.max(0, (wall.height - content.bounds.height) / 2) });
    set({ wallId: wall.id, preview, error: clipboardPlacementError(wall, preview, project.materials), message: null });
    return true;
  },
  move: (point, free = false) => {
    const { content, preview, wallId } = get();
    if (!content || !preview) return;
    const project = useProjectStore.getState().project, wall = project.walls.find(w => w.id === wallId);
    if (!wall) return;
    const step = free ? 1 : 10;
    const next = clipboardAt(content, { x: Math.round(point.x / step) * step, y: Math.round(point.y / step) * step });
    set({ preview: next, error: clipboardPlacementError(wall, next, project.materials) });
  },
  place: () => {
    const { preview, wallId } = get(), store = useProjectStore.getState();
    const wall = store.project.walls.find(w => w.id === wallId);
    if (!preview || !wall || wallId !== store.project.selectedWallId || preview.projectId !== store.project.id) return false;
    try {
      const result = pasteWallObjects(wall, preview, store.project.materials);
      store.endHistoryGroup();
      store.replaceWall(wall.id, result.wall);
      if (preview.kind === 'openings') result.ids.forEach((id, i) => store.selectOpening(id, i > 0));
      else result.ids.forEach((id, i) => store.toggleCellSelection(id, result.wall.panels!.findIndex(p => p.id === id), 0, i > 0));
      set({ preview: null, wallId: null, error: null, message: 'Копия размещена. Ctrl+V — вставить ещё.' });
      return true;
    } catch (error) { set({ error: error instanceof Error ? error.message : 'Не удалось вставить объект.' }); return false; }
  },
  cancel: () => set({ preview: null, wallId: null, error: null, message: null }),
}));

useProjectStore.subscribe((state, previous) => {
  if (state.projectSession !== previous.projectSession || state.project.id !== previous.project.id)
    useClipboardStore.setState({ content: null, preview: null, wallId: null, message: null, error: null });
  else if (state.historyRevision !== previous.historyRevision || state.project.selectedWallId !== previous.project.selectedWallId)
    useClipboardStore.getState().cancel();
});
useEditorStore.subscribe((state, previous) => {
  if (state.viewMode !== previous.viewMode || state.editMode !== previous.editMode || state.activeTool !== previous.activeTool || state.currentScreen !== previous.currentScreen)
    useClipboardStore.getState().cancel();
});
