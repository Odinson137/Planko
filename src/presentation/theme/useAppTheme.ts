import { useMantineColorScheme, useComputedColorScheme } from '@mantine/core';

export interface AppThemeTokens {
  colorScheme: 'light' | 'dark';
  isDark: boolean;
  setColorScheme: (val: 'light' | 'dark' | 'auto') => void;
  toggleColorScheme: () => void;

  // Семантические цвета интерфейса
  bgApp: string;
  bgSidebar: string;
  bgHeader: string;
  bgCard: string;
  bgCardHover: string;
  bgCardActive: string;
  bgCardSubtle: string;
  bgInput: string;
  bgNavActive: string;

  // Границы
  border: string;
  borderSubtle: string;
  borderInput: string;
  borderHover: string;

  // Текст
  textPrimary: string;
  textSecondary: string;
  textDimmed: string;
  textMuted: string;

  // 2D & 3D Холст
  canvasBg: string;
  canvasGrid: string;
  canvasWallBg: string;
  canvasWallStroke: string;
  canvasDimensionColor: string;
  canvasBadgeBg: string;
  canvasBadgeText: string;

  // 3D Холст
  canvas3dBg: string;
  canvas3dFloor: string;
  canvas3dGrid: string;
  canvas3dWallBack: string;
  canvas3dWallTop: string;
  canvas3dPanelOverlay: string;
}

export const useAppTheme = (): AppThemeTokens => {
  const { setColorScheme, toggleColorScheme } = useMantineColorScheme();
  const computedColorScheme = useComputedColorScheme('light', { getInitialValueInEffect: true });
  const isDark = computedColorScheme === 'dark';

  if (isDark) {
    return {
      colorScheme: 'dark',
      isDark: true,
      setColorScheme,
      toggleColorScheme,

      bgApp: '#1E1F22',
      bgSidebar: '#141517',
      bgHeader: '#1A1B1E',
      bgCard: '#26282E',
      bgCardHover: '#2E3138',
      bgCardActive: '#2B3956',
      bgCardSubtle: '#25262B',
      bgInput: '#26282E',
      bgNavActive: '#2B3956',

      border: '#2B2D30',
      borderSubtle: '#31343C',
      borderInput: '#363940',
      borderHover: '#454952',

      textPrimary: '#DFE1E5',
      textSecondary: '#9DA5B4',
      textDimmed: '#80848E',
      textMuted: '#5C5F66',

      canvasBg: '#18191C',
      canvasGrid: '#222327',
      canvasWallBg: '#222327',
      canvasWallStroke: '#373A40',
      canvasDimensionColor: '#4dabf7',
      canvasBadgeBg: '#101113',
      canvasBadgeText: '#74c0fc',

      canvas3dBg: '#121316',
      canvas3dFloor: '#18191c',
      canvas3dGrid: '#22252a',
      canvas3dWallBack: '#1c1e22',
      canvas3dWallTop: '#2c2f35',
      canvas3dPanelOverlay: 'rgba(26, 27, 30, 0.92)',
    };
  }

  // Светлая тема
  return {
    colorScheme: 'light',
    isDark: false,
    setColorScheme,
    toggleColorScheme,

    bgApp: '#F4F5F7',
    bgSidebar: '#FFFFFF',
    bgHeader: '#FFFFFF',
    bgCard: '#FFFFFF',
    bgCardHover: '#F8F9FA',
    bgCardActive: '#E7F5FF',
    bgCardSubtle: '#F8F9FA',
    bgInput: '#FFFFFF',
    bgNavActive: '#E7F5FF',

    border: '#E2E8F0',
    borderSubtle: '#EDF2F7',
    borderInput: '#CBD5E1',
    borderHover: '#94A3B8',

    textPrimary: '#1E293B',
    textSecondary: '#475569',
    textDimmed: '#64748B',
    textMuted: '#94A3B8',

    canvasBg: '#F8FAFC',
    canvasGrid: '#E2E8F0',
    canvasWallBg: '#E9ECEF',
    canvasWallStroke: '#CBD5E1',
    canvasDimensionColor: '#1971c2',
    canvasBadgeBg: '#FFFFFF',
    canvasBadgeText: '#1971c2',

    canvas3dBg: '#F1F5F9',
    canvas3dFloor: '#E2E8F0',
    canvas3dGrid: '#CBD5E1',
    canvas3dWallBack: '#D1D5DB',
    canvas3dWallTop: '#E5E7EB',
    canvas3dPanelOverlay: 'rgba(255, 255, 255, 0.94)',
  };
};
