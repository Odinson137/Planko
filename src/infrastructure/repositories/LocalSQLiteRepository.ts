import { Project } from '../../core/models/Project';

export interface IProjectRepository {
  getProject(id: string): Promise<Project | null>;
  saveProject(project: Project): Promise<void>;
  listProjects(): Promise<Array<{ id: string; name: string; updatedAt: string }>>;
  deleteProject(id: string): Promise<void>;
}

/**
 * Локальная реализация репозитория (поддерживает работу в Web/Electron/Tauri)
 */
export class LocalSQLiteRepository implements IProjectRepository {
  private storageKey = 'planko_projects_db';

  async getProject(id: string): Promise<Project | null> {
    const data = localStorage.getItem(`${this.storageKey}_${id}`);
    if (!data) return null;
    try {
      return JSON.parse(data) as Project;
    } catch {
      return null;
    }
  }

  async saveProject(project: Project): Promise<void> {
    const updated = {
      ...project,
      updatedAt: new Date().toISOString(),
    };
    localStorage.setItem(`${this.storageKey}_${project.id}`, JSON.stringify(updated));
  }

  async listProjects(): Promise<Array<{ id: string; name: string; updatedAt: string }>> {
    const list: Array<{ id: string; name: string; updatedAt: string }> = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key?.startsWith(`${this.storageKey}_`)) {
        try {
          const item = JSON.parse(localStorage.getItem(key) || '{}');
          if (item.id && item.name) {
            list.push({
              id: item.id,
              name: item.name,
              updatedAt: item.updatedAt || '',
            });
          }
        } catch {
          // ignore
        }
      }
    }
    return list;
  }

  async deleteProject(id: string): Promise<void> {
    localStorage.removeItem(`${this.storageKey}_${id}`);
  }
}
