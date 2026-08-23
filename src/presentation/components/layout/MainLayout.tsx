import React from 'react';
import { Box, Flex } from '@mantine/core';
import { TopToolbar } from './TopToolbar';
import { LeftSidebar } from './LeftSidebar';
import { RightSidebar } from './RightSidebar';
import { CadCanvas } from '../canvas/CadCanvas';
import { Axonometric3DView } from '../canvas/Axonometric3DView';
import { useEditorStore } from '../../../application/stores/useEditorStore';

export const MainLayout: React.FC = () => {
  const { viewMode } = useEditorStore();

  return (
    <Flex direction="column" h="100vh" w="100vw" style={{ overflow: 'hidden', backgroundColor: '#1A1B1E' }}>
      {/* Верхний тулбар */}
      <TopToolbar />

      {/* Основная рабочая область (3 колонки: Стены слева | Холст по центру | Инспектор справа) */}
      <Flex style={{ flex: 1, overflow: 'hidden' }}>
        {/* Левая панель */}
        <LeftSidebar />

        {/* Центральная область: 2D CAD Холст или 3D Аксонометрия */}
        <Box style={{ flex: 1, position: 'relative', height: '100%' }}>
          {viewMode === '3D' ? <Axonometric3DView /> : <CadCanvas />}
        </Box>

        {/* Правая панель инспектора */}
        <RightSidebar />
      </Flex>
    </Flex>
  );
};
