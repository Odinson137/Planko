import { create } from 'zustand';
import { Point2D, SnapResult } from '../../core/geometry/PolygonSlicingEngine';
import { cutPanelOnWall, cuttableWall, findCutPanel } from '../../core/geometry/PanelCutEngine';
import { useProjectStore } from './useProjectStore';
import { useEditorStore } from './useEditorStore';

interface PanelCutState {
  projectId: string | null;
  wallId: string | null;
  panelId: string | null;
  p1: Point2D | null;
  p2: Point2D | null;
  locked: boolean;
  snap: SnapResult | null;
  error: string | null;
  begin: (wallId: string, panelId?: string | null) => void;
  choosePanel: (id: string) => void;
  setPoint: (point: 'p1' | 'p2', value: Point2D) => void;
  hover: (snap: SnapResult) => void;
  clickPoint: (snap: SnapResult) => void;
  clearLine: () => void;
  finish: () => void;
  apply: () => boolean;
  undo: () => boolean;
}

const emptyLine = { p1: null, p2: null, locked: false, snap: null, error: null };
export const usePanelCutStore = create<PanelCutState>((set, get) => ({
  projectId: null, wallId: null, panelId: null, ...emptyLine,
  begin: (wallId, panelId) => {
    const project = useProjectStore.getState().project;
    const wall = project.walls.find(w => w.id === wallId);
    if (!wall) return;
    const panel = findCutPanel(cuttableWall(wall, project.materials), panelId ?? null);
    set({ projectId: project.id, wallId, panelId: panel?.id ?? null, ...emptyLine });
    useEditorStore.getState().setViewMode('2D');
    useEditorStore.getState().setEditMode('PANELS');
    useEditorStore.getState().setActiveTool('CUT_PANEL');
  },
  choosePanel: panelId => set({ panelId, ...emptyLine }),
  setPoint: (point, value) => set({ [point]: value, locked: true, snap: null, error: null }),
  hover: snap => {
    if (get().locked) return;
    set(get().p1 ? { p2: snap.point, snap } : { snap });
  },
  clickPoint: snap => {
    if (get().locked) { set({ ...emptyLine, p1: snap.point, snap }); return; }
    set(get().p1 ? { p2: snap.point, locked: true, snap } : { p1: snap.point, p2: null, snap });
  },
  clearLine: () => set(emptyLine),
  finish: () => { set(emptyLine); useEditorStore.getState().setActiveTool('SELECT'); },
  apply: () => {
    const { projectId, wallId, panelId, p1, p2 } = get();
    const store = useProjectStore.getState();
    const wall = store.project.walls.find(w => w.id === wallId);
    if (store.project.id !== projectId || store.project.selectedWallId !== wallId || !wall || !panelId || !p1 || !p2) return false;
    const next = cutPanelOnWall(wall, store.project.materials, panelId, p1, p2);
    if (!next) { set({ error: 'Линия не разделяет панель. Укажите две точки на разных краях.' }); return false; }
    store.updateWall(wall.id, next);
    store.selectPanel(null, null, null);
    store.selectJoint(null);
    set({ panelId: null, ...emptyLine });
    return true;
  },
  undo: () => useProjectStore.getState().undo(),
}));

useProjectStore.subscribe((state, previous) => {
  if (state.historyRevision !== previous.historyRevision || state.project.id !== previous.project.id) {
    usePanelCutStore.setState({ panelId: null, ...emptyLine });
    if (useEditorStore.getState().activeTool === 'CUT_PANEL') useEditorStore.getState().setActiveTool('SELECT');
  }
});
