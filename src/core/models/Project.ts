import { Wall, createDefaultWall } from './Wall';
import { Material, DEFAULT_MATERIALS } from './Material';

export interface ProjectMetadata {
  id: string;
  name: string;
  wallsCount: number;
  dimensionsSummary: string;
  materialsCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface Project {
  id: string;
  name: string;
  walls: Wall[];
  materials: Material[];
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
  };
}

export function createDefaultProject(name: string = 'Новый проект раскладки', wallWidth = 3600, wallHeight = 2750, roomName?: string): Project {
  const initialWall = createDefaultWall('wall-1', 'Стена 1', roomName);
  initialWall.width = wallWidth;
  initialWall.height = wallHeight;

  return {
    id: `proj-${Date.now()}`,
    name,
    walls: [initialWall],
    materials: DEFAULT_MATERIALS,
    selectedWallId: initialWall.id,
    selectedOpeningId: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}
