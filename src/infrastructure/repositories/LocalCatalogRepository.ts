import { Material } from '../../core/models/Material';

const STORAGE_KEY = 'planko_shared_material_catalog';

function isCatalogPanel(value: unknown): value is Material {
  if (!value || typeof value !== 'object') return false;
  const panel = value as Material;
  return typeof panel.id === 'string' && panel.id.length > 0 &&
    typeof panel.name === 'string' && typeof panel.color === 'string' &&
    ['SHEET', 'SLAT', 'HQ'].includes(panel.type) && !panel.isVoid &&
    [panel.width, panel.height, panel.thickness].every(n => Number.isFinite(n) && n > 0) &&
    (panel.thicknessOptions === undefined || (Array.isArray(panel.thicknessOptions) &&
      panel.thicknessOptions.every(n => Number.isFinite(n) && n > 0))) &&
    (panel.availableDecors === undefined || (Array.isArray(panel.availableDecors) &&
      panel.availableDecors.every(decor => decor && typeof decor.code === 'string' &&
        typeof decor.name === 'string' && typeof decor.color === 'string')));
}

/** Shared stock definitions on this computer; projects retain their saved copies. */
export class LocalCatalogRepository {
  getPanels(): Material[] {
    try {
      if (typeof localStorage === 'undefined') return [];
      const parsed: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
      if (!Array.isArray(parsed)) return [];
      return [...new Map(parsed.filter(isCatalogPanel).map(panel => [panel.id, panel])).values()];
    } catch {
      return [];
    }
  }

  savePanel(panel: Material): void {
    if (!isCatalogPanel(panel)) throw new Error('Некорректные параметры панели');
    const panels = new Map(this.getPanels().map(item => [item.id, item]));
    panels.set(panel.id, panel);
    // Let storage errors reach the editor so it never reports a failed write as saved.
    localStorage.setItem(STORAGE_KEY, JSON.stringify([...panels.values()]));
  }

  /** Restore only the entries changed by an editor action, in one storage write. */
  restorePanels(changes: { id: string; panel: Material | undefined }[]): void {
    const panels = new Map(this.getPanels().map(panel => [panel.id, panel]));
    for (const { id, panel } of changes) {
      if (panel) {
        if (!isCatalogPanel(panel)) throw new Error('Некорректные параметры панели');
        panels.set(id, panel);
      } else panels.delete(id);
    }
    localStorage.setItem(STORAGE_KEY, JSON.stringify([...panels.values()]));
  }

  mergePanels(materials: Material[], useSharedVersions = false, excludedIds: string[] = []): Material[] {
    const shared = this.getPanels();
    const byId = new Map(materials.map(panel => [panel.id, panel]));
    let changed = false;
    for (const panel of shared) {
      if (excludedIds.includes(panel.id)) continue;
      if (useSharedVersions || !byId.has(panel.id)) {
        byId.set(panel.id, panel);
        changed = true;
      }
    }
    return changed ? [...byId.values()] : materials;
  }
}

export const localCatalogRepository = new LocalCatalogRepository();
