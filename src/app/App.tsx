import React from 'react';
import { MantineProvider } from '@mantine/core';
import '@mantine/core/styles.css';
import { theme } from '../presentation/theme/theme';
import { MainLayout } from '../presentation/components/layout/MainLayout';

export const App: React.FC = () => {
  return (
    <MantineProvider theme={theme} defaultColorScheme="dark">
      <MainLayout />
    </MantineProvider>
  );
};
