import React, { useEffect } from 'react';
import { MantineProvider } from '@mantine/core';
import '@mantine/core/styles.css';
import { theme } from '../presentation/theme/theme';
import { MainLayout } from '../presentation/components/layout/MainLayout';
import { ProjectWelcomeScreen } from '../presentation/components/welcome/ProjectWelcomeScreen';
import { useEditorStore } from '../application/stores/useEditorStore';
import { useProjectStore } from '../application/stores/useProjectStore';

export const App: React.FC = () => {
  const { currentScreen } = useEditorStore();
  const { saveCurrentProject } = useProjectStore();

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Перехват Ctrl+S / Cmd+S для сохранения проекта
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        saveCurrentProject();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [saveCurrentProject]);

  return (
    <MantineProvider theme={theme} defaultColorScheme="dark">
      {currentScreen === 'WELCOME' ? <ProjectWelcomeScreen /> : <MainLayout />}
    </MantineProvider>
  );
};

