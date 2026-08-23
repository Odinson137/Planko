import { create } from 'zustand';

export type ActiveTool = 'SELECT' | 'PAN' | 'ADD_DOOR' | 'ADD_WINDOW' | 'ADD_TV_ZONE' | 'ADD_NICHE';

interface EditorState {
  activeTool: ActiveTool;
  zoom: number;
  panX: number;
  panY: number;
  showGrid: boolean;
  showDimensions: boolean;
  showProfiles: boolean;

  setActiveTool: (tool: ActiveTool) => void;
  setZoom: (zoom: number) => void;
  setPan: (x: number, y: number) => void;
  toggleGrid: () => void;
  toggleDimensions: () => void;
  toggleProfiles: () => void;
  resetView: () => void;
}

export const useEditorStore = create<EditorState>((set) => ({
  activeTool: 'SELECT',
  zoom: 1,
  panX: 0,
  panY: 0,
  showGrid: true,
  showDimensions: true,
  showProfiles: true,

  setActiveTool: (tool: ActiveTool) => set({ activeTool: tool }),
  setZoom: (zoom: number) => set({ zoom: Math.max(0.1, Math.min(zoom, 5)) }),
  setPan: (panX: number, panY: number) => set({ panX, panY }),
  toggleGrid: () => set((state) => ({ showGrid: !state.showGrid })),
  toggleDimensions: () => set((state) => ({ showDimensions: !state.showDimensions })),
  toggleProfiles: () => set((state) => ({ showProfiles: !state.showProfiles })),
  resetView: () => set({ zoom: 1, panX: 0, panY: 0 }),
}));
