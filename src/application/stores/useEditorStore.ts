import { create } from 'zustand';

export type ActiveTool = 'SELECT' | 'PAN' | 'ADD_DOOR' | 'ADD_WINDOW' | 'ADD_TV_ZONE' | 'ADD_NICHE';

export type ViewMode = '2D' | '3D';
export type EditMode = 'PANELS' | 'JOINTS' | 'TEXTURES';
export type AppScreen = 'WELCOME' | 'EDITOR';

interface EditorState {
  currentScreen: AppScreen;
  activeTool: ActiveTool;
  viewMode: ViewMode;
  editMode: EditMode;
  zoom: number;
  panX: number;
  panY: number;
  showGrid: boolean;
  showDimensions: boolean;
  showProfiles: boolean;
  showTextures: boolean;
  showLeftSidebar: boolean;
  saveNotification: string | null;

  setCurrentScreen: (screen: AppScreen) => void;
  setActiveTool: (tool: ActiveTool) => void;
  setViewMode: (mode: ViewMode) => void;
  setEditMode: (mode: EditMode) => void;
  toggleEditMode: () => void;
  toggleViewMode: () => void;
  setZoom: (zoom: number) => void;
  setPan: (x: number, y: number) => void;
  toggleGrid: () => void;
  toggleDimensions: () => void;
  toggleProfiles: () => void;
  toggleTextures: () => void;
  setShowLeftSidebar: (show: boolean) => void;
  toggleLeftSidebar: () => void;
  resetView: () => void;
  setSaveNotification: (message: string | null) => void;
}

export const useEditorStore = create<EditorState>((set) => ({
  currentScreen: 'WELCOME', // По умолчанию при запуске открывается экран выбора проектов
  activeTool: 'SELECT',
  viewMode: '2D',
  editMode: 'PANELS',
  zoom: 1,
  panX: 0,
  panY: 0,
  showGrid: true,
  showDimensions: true,
  showProfiles: true,
  showTextures: true,
  showLeftSidebar: true,
  saveNotification: null,

  setCurrentScreen: (screen: AppScreen) => set({ currentScreen: screen }),
  setActiveTool: (tool: ActiveTool) => set({ activeTool: tool }),
  setViewMode: (viewMode: ViewMode) => set({ viewMode }),
  setEditMode: (editMode: EditMode) => set({ editMode }),
  toggleEditMode: () => set((state) => ({ editMode: state.editMode === 'PANELS' ? 'JOINTS' : 'PANELS' })),
  toggleViewMode: () => set((state) => ({ viewMode: state.viewMode === '2D' ? '3D' : '2D' })),
  setZoom: (zoom: number) => set({ zoom: Math.max(0.1, Math.min(zoom, 5)) }),
  setPan: (panX: number, panY: number) => set({ panX, panY }),
  toggleGrid: () => set((state) => ({ showGrid: !state.showGrid })),
  toggleDimensions: () => set((state) => ({ showDimensions: !state.showDimensions })),
  toggleProfiles: () => set((state) => ({ showProfiles: !state.showProfiles })),
  toggleTextures: () => set((state) => ({ showTextures: !state.showTextures })),
  setShowLeftSidebar: (show: boolean) => set({ showLeftSidebar: show }),
  toggleLeftSidebar: () => set((state) => ({ showLeftSidebar: !state.showLeftSidebar })),
  resetView: () => set({ zoom: 1, panX: 0, panY: 0 }),
  setSaveNotification: (saveNotification: string | null) => set({ saveNotification }),
}));

