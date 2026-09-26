import { Wall, createDefaultWall } from './Wall';
import { Material, DEFAULT_MATERIALS } from './Material';

// Increment when older projects need a compatibility warning. Saving alone is not a migration.
export const CURRENT_PROJECT_FORMAT_VERSION = 1;

export interface ProjectMetadata {
  id: string;
  name: string;
  wallsCount: number;
  dimensionsSummary: string;
  materialsCount: number;
  createdAt: string;
  updatedAt: string;
  isLegacy: boolean;
}

export interface Project {
  id: string;
  /** Missing in older projects. Preserve on save, duplication and import. */
  formatVersion?: number;
  name: string;
  walls: Wall[];
  materials: Material[];
  excludedCatalogPanelIds?: string[];
  selectedWallId: string | null;
  selectedOpeningId: string | null;
  createdAt: string;
  updatedAt: string;
}

export function getProjectMetadata(project: Project): ProjectMetadata {
  const firstWall = project.walls[0];
  const dims = firstWall ? `${firstWall.width} × ${firstWall.height} мм` : '—';
  const totalWalls = project.walls.length;
  const summary = totalWalls > 1 ? `${dims} (${totalWalls} стен)` : dims;

  return {
    id: project.id,
    name: project.name,
    wallsCount: totalWalls,
    dimensionsSummary: summary,
    materialsCount: project.materials.length,
    createdAt: project.createdAt,
    updatedAt: project.updatedAt,
    isLegacy: (project.formatVersion ?? 0) < CURRENT_PROJECT_FORMAT_VERSION,
  };
}

export function createDefaultProject(name: string = 'Новый проект раскладки', wallWidth = 3600, wallHeight = 2750, roomName?: string): Project {
  const initialWall = createDefaultWall('wall-1', 'Стена 1', roomName);
  initialWall.width = wallWidth;
  initialWall.height = wallHeight;
  initialWall.panels![0].points = [
    { x: 0, y: 0 }, { x: wallWidth, y: 0 },
    { x: wallWidth, y: wallHeight }, { x: 0, y: wallHeight },
  ];

  return {
    id: `proj-${Date.now()}`,
    formatVersion: CURRENT_PROJECT_FORMAT_VERSION,
    name,
    walls: [initialWall],
    materials: DEFAULT_MATERIALS,
    selectedWallId: initialWall.id,
    selectedOpeningId: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}
