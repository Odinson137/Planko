import { create } from 'zustand';
import type { Wall, WallBend } from '../../core/models/Wall';
import { extendWall, changeWallCorner, straightenWallCorner, resizeWallSection, resizeWallHeight, removeWallSection, type WallEnd } from '../../core/geometry/WallEditing';
import { materializeWall } from '../services/WallEditing';
import { useProjectStore } from './useProjectStore';

type Selection = { kind: 'segment' | 'corner'; id: string } | null;
interface Change { before: Wall; after: Wall | null; wallIndex: number }
interface WallEditorState {
  target: { projectId: string; wallId: string } | null;
  selection: Selection;
  drawEnd: WallEnd | null;
  error: string | null;
  past: Change[]; future: Change[];
  camera: { x: number; y: number; zoom: number } | null;
  syncTarget: (projectId: string, wallId: string) => void;
  select: (selection: Selection) => void;
  begin: (end: WallEnd) => void;
  finish: () => void;
  setCamera: (camera: WallEditorState['camera']) => void;
  extend: (length: number, heading: number) => boolean;
  resize: (id: string, length: number) => void;
  remove: (id: string) => void;
  corner: (id: string, patch: Pick<WallBend, 'angleDeg' | 'radius' | 'type'>) => void;
  straighten: (id: string) => void;
  details: (name: string, roomName: string) => void;
  height: (height: number) => void;
  undo: () => void; redo: () => void;
}
const equal = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
let writing = false;
export const useWallEditorStore = create<WallEditorState>((set, get) => {
  function current() {
    const project = useProjectStore.getState().project, target = get().target;
    return target?.projectId === project.id && target.wallId === project.selectedWallId
      ? project.walls.find(w => w.id === target.wallId) : undefined;
  }
  function write(wall: Wall | null, wallIndex: number) {
    const target = get().target;
    if (!target) return;
    writing = true;
    try {
      useProjectStore.setState(state => {
        const walls = [...state.project.walls];
        const index = walls.findIndex(w => w.id === target.wallId);
        if (!wall) { if (index >= 0) walls.splice(index, 1); }
        else if (index >= 0) walls[index] = wall;
        else walls.splice(wallIndex, 0, wall);
        return { isDirty: true, project: { ...state.project, walls, selectedWallId: wall?.id ?? null, selectedOpeningId: null } };
      });
    } finally { writing = false; }
  }
  function apply(operation: (wall: Wall) => Wall | null) {
    const before = current();
    if (!before) return false;
    try {
      const after = operation(materializeWall(useProjectStore.getState().project, before));
      if (equal(before, after)) { set({ error: null }); return true; }
      const state = get();
      const past = state.past.length && !equal(state.past[state.past.length-1].after, before) ? [] : state.past;
      const wallIndex = useProjectStore.getState().project.walls.findIndex(w => w.id === before.id);
      write(after, wallIndex);
      set({ past: [...past.slice(-49), { before, after, wallIndex }], future: [], error: null });
      return true;
    } catch (e) { set({ error: e instanceof Error ? e.message : String(e) }); return false; }
  }
  function restore(redo: boolean) {
    const state = get(), wall = current();
    const entry = redo ? state.future[state.future.length-1] : state.past[state.past.length-1];
    const project = useProjectStore.getState().project;
    if (!entry || state.target?.projectId !== project.id) return;
    // An outside material/opening edit invalidates this history instead of being overwritten.
    if ((project.selectedWallId !== state.target.wallId && project.selectedWallId !== null) ||
      !equal(wall ?? null, redo ? entry.before : entry.after) ||
      (!wall && project.walls.some(w => w.id === state.target?.wallId))) {
      set({ past: [], future: [], drawEnd: null, error: 'Стена изменилась вне режима. История построения обновлена.' }); return;
    }
    write(redo ? entry.after : entry.before, entry.wallIndex);
    set({ past: redo ? [...state.past, entry] : state.past.slice(0,-1),
      future: redo ? state.future.slice(0,-1) : [...state.future, entry], error: null, drawEnd: null, selection: null });
  }
  return {
    target: null, selection: null, drawEnd: null, error: null, past: [], future: [], camera: null,
    syncTarget: (projectId, wallId) => {
      if (get().target?.projectId !== projectId || get().target?.wallId !== wallId)
        set({ target: { projectId, wallId }, selection: null, drawEnd: null, error: null, past: [], future: [], camera: null });
    },
    select: selection => set({ selection, drawEnd: null, error: null }),
    begin: drawEnd => set({ drawEnd, selection: null, error: null }),
    finish: () => set({ drawEnd: null, error: null }),
    setCamera: camera => set({ camera }),
    extend: (length, heading) => {
      const end = get().drawEnd;
      return end ? apply(w => extendWall(w, end, length, heading)) : false;
    },
    resize: (id, length) => { apply(w => resizeWallSection(w, id, length)); },
    remove: id => {
      if (apply(w => removeWallSection(w, id))) set({ selection: null, drawEnd: null });
    },
    corner: (id, patch) => { apply(w => changeWallCorner(w, id, patch)); },
    straighten: id => {
      if (apply(w => straightenWallCorner(w, id))) set({ selection: null, drawEnd: null });
    },
    details: (name, roomName) => { apply(w => ({ ...w, name: name.trim() || w.name, roomName: roomName.trim() || undefined })); },
    height: height => { apply(w => resizeWallHeight(w, height)); },
    undo: () => restore(false), redo: () => restore(true),
  };
});

useProjectStore.subscribe((state, previous) => {
  if (writing) return;
  const editor = useWallEditorStore.getState(), target = editor.target;
  if (!target) return;
  const wall = state.project.walls.find(w => w.id === target.wallId);
  const oldWall = previous.project.walls.find(w => w.id === target.wallId);
  const awaitingRestore = !wall && state.project.selectedWallId === null && editor.past.at(-1)?.after === null;
  if (state.project.id !== target.projectId || (!awaitingRestore && state.project.selectedWallId !== target.wallId) || wall !== oldWall)
    useWallEditorStore.setState({ past: [], future: [], drawEnd: null, selection: null, error: null });
});
