import type { Project } from './Project';
import { normalizeProfileArticle } from './Profile';

/**
 * Update profile references in wall configs, including legacy column/subpiece edges,
 * opening framing and slope joints. Keep geometry, gaps, colors and source data intact.
 * Structural sharing makes subsequent reads a no-op. Nothing is written to storage here.
 */
export function migrateProjectProfiles(project: Project): Project {
  function migrate<T>(value: T): T {
    if (!value || typeof value !== 'object') return value;
    if (Array.isArray(value)) {
      const items = value.map(migrate);
      return (items.some((item, i) => item !== value[i]) ? items : value) as T;
    }
    const source = value as Record<string, unknown>;
    let result = source;
    for (const [key, item] of Object.entries(source)) {
      const next = key === 'profileArticle' && typeof item === 'string'
        ? normalizeProfileArticle(item) : migrate(item);
      if (next !== item) {
        if (result === source) result = { ...source };
        result[key] = next;
      }
    }
    return result as T;
  }
  const walls = migrate(project.walls);
  return walls === project.walls ? project : { ...project, walls };
}
