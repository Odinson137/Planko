import { Wall, createDefaultWall } from './Wall';
import { Material, DEFAULT_MATERIALS } from './Material';

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

export function createDefaultProject(): Project {
  const initialWall = createDefaultWall('wall-1', 'Стена 1 (Гостиная)');
  return {
    id: `proj-${Date.now()}`,
    name: 'Новый проект раскладки',
    walls: [initialWall],
    materials: DEFAULT_MATERIALS,
    selectedWallId: initialWall.id,
    selectedOpeningId: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}
