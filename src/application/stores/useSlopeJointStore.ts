import { create } from 'zustand';
import { patchSlopeJoints, resolveSlopeJoints } from '../../core/geometry/SlopeJointGeometry';
import { type SlopeJointConfig, type SlopeJointId } from '../../core/models/Opening';
import { useProjectStore } from './useProjectStore';

interface Target { projectId: string; wallId: string; openingId: string }
interface SlopeJointState {
  target: Target | null;
  corner: SlopeJointId;
  error: string | null;
  select: (wallId: string, openingId: string, corner: SlopeJointId) => void;
  change: (wallId: string, openingId: string, corner: SlopeJointId, patch: Partial<SlopeJointConfig>, all?: boolean) => void;
  undo: () => void;
  redo: () => void;
}
const snapshot = (value: unknown) => JSON.stringify(value, (_key, item) => item && typeof item === 'object' && !Array.isArray(item)
  ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b))) : item);
const equal = (a: unknown, b: unknown) => snapshot(a) === snapshot(b);
const currentOpening = (target: Target | null) => {
  const project = useProjectStore.getState().project;
  return target?.projectId === project.id ? project.walls.find(w => w.id === target.wallId)?.openings.find(op => op.id === target.openingId) : undefined;
};

export const useSlopeJointStore = create<SlopeJointState>((set, get) => {
  return {
    target: null, corner: 'top-left', error: null,
    select: (wallId, openingId, corner) => {
      const target = { projectId: useProjectStore.getState().project.id, wallId, openingId };
      set({ target, corner, error: null });
    },
    change: (wallId, openingId, corner, patch, all = false) => {
      get().select(wallId, openingId, corner);
      const state = get(), opening = currentOpening(state.target);
      if (!opening) return;
      try {
        const next = patchSlopeJoints(opening, corner, patch, all);
        const before = resolveSlopeJoints(opening), after = resolveSlopeJoints(next);
        if (equal(before, after)) return;
        useProjectStore.getState().updateOpening(wallId, { id: openingId, slopes: next.slopes });
        set({ error: null });
      } catch (error) {
        set({ error: error instanceof Error ? error.message : String(error) });
      }
    },
    undo: () => { useProjectStore.getState().undo(); },
    redo: () => { useProjectStore.getState().redo(); },
  };
});

useProjectStore.subscribe((state, previous) => {
  if (state.historyRevision !== previous.historyRevision || state.project.id !== previous.project.id)
    useSlopeJointStore.setState({ target: null, error: null });
});
