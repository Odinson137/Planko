import type { Project } from '../../core/models/Project';
import type { Material } from '../../core/models/Material';

export const HISTORY_LIMIT = 100;

export interface CatalogChange {
  id: string;
  before: Material | undefined;
  after: Material | undefined;
}

export interface ProjectChange {
  before: Project;
  after: Project;
  group?: object;
  catalog: CatalogChange[];
}

export interface ProjectHistory {
  past: ProjectChange[];
  future: ProjectChange[];
}

// Project models are immutable JSON data. Reference checks skip unchanged branches;
// value comparison also discards setters that rebuild an identical object.
export function equalData(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (!a || !b || typeof a !== 'object' || typeof b !== 'object') return false;
  if (Array.isArray(a) || Array.isArray(b)) {
    return Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((v, i) => equalData(v, b[i]));
  }
  const first = a as Record<string, unknown>, second = b as Record<string, unknown>;
  const keys = Object.keys(first).filter(key => first[key] !== undefined);
  return keys.length === Object.keys(second).filter(key => second[key] !== undefined).length &&
    keys.every(key => equalData(first[key], second[key]));
}

export function projectContent(project: Project) {
  const { name, walls, materials, excludedCatalogPanelIds } = project;
  return { name, walls, materials, excludedCatalogPanelIds };
}

export function sameProjectContent(a: Project, b: Project): boolean {
  return a.id === b.id && equalData(projectContent(a), projectContent(b));
}

export function historyState(history: ProjectHistory = { past: [], future: [] }) {
  return { history, canUndo: history.past.length > 0, canRedo: history.future.length > 0 };
}

export function recordChange(history: ProjectHistory, before: Project, after: Project,
  group?: object, catalog: CatalogChange[] = []): ProjectHistory {
  const last = history.past[history.past.length - 1];
  const merge = group !== undefined && last?.group === group;
  const changes = new Map((merge ? last.catalog : []).map(change => [change.id, change]));
  for (const change of catalog) {
    const previous = changes.get(change.id);
    changes.set(change.id, { ...change, before: previous ? previous.before : change.before });
  }
  const entry: ProjectChange = {
    before: merge ? last.before : before, after, group,
    catalog: [...changes.values()].filter(change => !equalData(change.before, change.after)),
  };
  const past = merge ? history.past.slice(0, -1) : history.past;
  return {
    past: sameProjectContent(entry.before, entry.after) && !entry.catalog.length
      ? past : [...past, entry].slice(-HISTORY_LIMIT),
    future: [],
  };
}
