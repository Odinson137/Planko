import { create } from 'zustand';
import { calculateSlopeGeometry, patchSlopeJoints, resolveSlopeJoints } from '../../core/geometry/SlopeJointGeometry';
import { ensureOpeningSlopes, type SlopeJointConfig, type SlopeJointId, type SlopeJoints } from '../../core/models/Opening';
import { useProjectStore } from './useProjectStore';

interface Target { projectId: string; wallId: string; openingId: string }
interface Change { before: SlopeJoints; after: SlopeJoints }
interface SlopeJointState {
  target: Target | null;
  corner: SlopeJointId;
  past: Change[];
  future: Change[];
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

// History contains only joint settings, so undo never rolls back dimensions/materials.
export const useSlopeJointStore = create<SlopeJointState>((set, get) => {
  function restore(redo: boolean) {
    const state = get(), opening = currentOpening(state.target);
    const entry = (redo ? state.future[state.future.length - 1] : state.past[state.past.length - 1]);
    if (!entry || !opening || !state.target) return;
    if (!equal(resolveSlopeJoints(opening), redo ? entry.before : entry.after)) {
      set({ past: [], future: [], error: 'Настройки изменились. История стыков обновлена.' });
      return;
    }
    const joints = redo ? entry.after : entry.before;
    const next = { ...opening, slopes: { ...ensureOpeningSlopes(opening), joints } };
    if (Object.values(calculateSlopeGeometry(next).faces).some(f => f.enabled && f.length <= 0)) {
      set({ error: 'Эти зазоры не помещаются в изменённый проём.' });
      return;
    }
    useProjectStore.getState().updateOpening(state.target.wallId, next);
    set({ error: null, past: redo ? [...state.past, entry] : state.past.slice(0, -1),
      future: redo ? state.future.slice(0, -1) : [...state.future, entry] });
  }
  return {
    target: null, corner: 'top-left', past: [], future: [], error: null,
    select: (wallId, openingId, corner) => {
      const target = { projectId: useProjectStore.getState().project.id, wallId, openingId };
      set(state => ({ target, corner, error: null, ...(equal(state.target, target) ? {} : { past: [], future: [] }) }));
    },
    change: (wallId, openingId, corner, patch, all = false) => {
      get().select(wallId, openingId, corner);
      const state = get(), opening = currentOpening(state.target);
      if (!opening) return;
      try {
        const next = patchSlopeJoints(opening, corner, patch, all);
        const before = resolveSlopeJoints(opening), after = resolveSlopeJoints(next);
        if (equal(before, after)) return;
        const past = state.past.length && !equal(state.past[state.past.length - 1]?.after, before) ? [] : state.past;
        useProjectStore.getState().updateOpening(wallId, { id: openingId, slopes: next.slopes });
        set({ past: [...past.slice(-49), { before, after }], future: [], error: null });
      } catch (error) {
        set({ error: error instanceof Error ? error.message : String(error) });
      }
    },
    undo: () => restore(false),
    redo: () => restore(true),
  };
});
