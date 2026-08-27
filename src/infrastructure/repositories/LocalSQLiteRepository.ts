import { Project, ProjectMetadata, getProjectMetadata } from '../../core/models/Project';

export interface IProjectRepository {
  getProject(id: string): Promise<Project | null>;
  saveProject(project: Project): Promise<void>;
  listProjects(): Promise<ProjectMetadata[]>;
  deleteProject(id: string): Promise<void>;
  clearAllProjects(): Promise<void>;
  renameProject(id: string, newName: string): Promise<boolean>;
  duplicateProject(id: string, newName?: string): Promise<Project | null>;
  exportProjectAsJson(project: Project): void;
  importProjectFromJson(jsonString: string): Promise<Project>;
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
    const updated: Project = {
      ...project,
      updatedAt: new Date().toISOString(),
    };
    localStorage.setItem(`${this.storageKey}_${project.id}`, JSON.stringify(updated));
  }

  async listProjects(): Promise<ProjectMetadata[]> {
    const list: ProjectMetadata[] = [];

    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key?.startsWith(`${this.storageKey}_`)) {
        try {
          const raw = localStorage.getItem(key);
          if (raw) {
            const project = JSON.parse(raw) as Project;
            if (project.id && project.name) {
              list.push(getProjectMetadata(project));
            }
          }
        } catch {
          // ignore corrupted items
        }
      }
    }

    // Сортировка по дате обновления (сначала самые свежие)
    return list.sort((a, b) => new Date(b.updatedAt || 0).getTime() - new Date(a.updatedAt || 0).getTime());
  }

  async deleteProject(id: string): Promise<void> {
    localStorage.removeItem(`${this.storageKey}_${id}`);
  }

  async clearAllProjects(): Promise<void> {
    const keysToRemove: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key?.startsWith(`${this.storageKey}_`)) {
        keysToRemove.push(key);
      }
    }
    keysToRemove.forEach((k) => localStorage.removeItem(k));
  }

  async renameProject(id: string, newName: string): Promise<boolean> {
    const project = await this.getProject(id);
    if (!project) return false;
    project.name = newName.trim();
    project.updatedAt = new Date().toISOString();
    await this.saveProject(project);
    return true;
  }

  async duplicateProject(id: string, newName?: string): Promise<Project | null> {
    const original = await this.getProject(id);
    if (!original) return null;

    const duplicated: Project = {
      ...JSON.parse(JSON.stringify(original)),
      id: `proj-${Date.now()}`,
      name: newName || `${original.name} (Копия)`,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    await this.saveProject(duplicated);
    return duplicated;
  }

  exportProjectAsJson(project: Project): void {
    const jsonStr = JSON.stringify(project, null, 2);
    const blob = new Blob([jsonStr], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const safeName = project.name.replace(/[^a-zA-Z0-9а-яА-ЯёЁ_-]/g, '_');
    a.href = url;
    a.download = `${safeName || 'project'}.planko.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  async importProjectFromJson(jsonString: string): Promise<Project> {
    const parsed = JSON.parse(jsonString) as Project;
    if (!parsed.walls || !Array.isArray(parsed.walls)) {
      throw new Error('Некорректный формат файла проекта AllWall CAD');
    }

    const imported: Project = {
      ...parsed,
      id: `proj-${Date.now()}`,
      name: parsed.name ? `${parsed.name} (Импорт)` : 'Импортированный проект',
      updatedAt: new Date().toISOString(),
      createdAt: parsed.createdAt || new Date().toISOString(),
    };

    await this.saveProject(imported);
    return imported;
  }
}

export const localProjectRepository = new LocalSQLiteRepository();

