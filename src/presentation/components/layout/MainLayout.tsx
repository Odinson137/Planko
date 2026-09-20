import React from 'react';
import { Box, Flex, ActionIcon, Tooltip } from '@mantine/core';
import { PanelLeftOpen } from 'lucide-react';
import { TopToolbar } from './TopToolbar';
import { LeftSidebar } from './LeftSidebar';
import { RightSidebar } from './RightSidebar';
import { CadCanvas } from '../canvas/CadCanvas';
import { Axonometric3DView } from '../canvas/Axonometric3DView';
import { PanelCutSidebar } from './PanelCutSidebar';
import { useEditorStore } from '../../../application/stores/useEditorStore';
import { useAppTheme } from '../../theme/useAppTheme';

export const MainLayout: React.FC = () => {
  const { viewMode, showLeftSidebar, toggleLeftSidebar, activeTool } = useEditorStore();
  const t = useAppTheme();

  return (
    <Flex direction="column" h="100vh" w="100vw" style={{ overflow: 'hidden', backgroundColor: t.bgApp }}>
      {/* Верхний тулбар */}
      <TopToolbar />

      {/* Основная рабочая область (3 колонки: Стены слева | Холст по центру | Инспектор справа) */}
      <Flex style={{ flex: 1, minWidth: 0, overflow: 'hidden', position: 'relative' }}>
        {/* Левая панель со списком стен */}
        {showLeftSidebar && <LeftSidebar />}

        {/* Центральная область: 2D CAD Холст или 3D Аксонометрия */}
        <Box style={{ flex: 1, minWidth: 0, position: 'relative', height: '100%', overflow: 'hidden' }}>
          {/* Плавающая кнопка для повторного открытия меню стен, если оно скрыто */}
          {!showLeftSidebar && (
            <Tooltip label="Показать меню стен" position="right" withArrow>
              <ActionIcon
                variant="filled"
                color="blue"
                size="md"
                radius="md"
                style={{
                  position: 'absolute',
                  top: 10,
                  left: 10,
                  zIndex: 30,
                  boxShadow: '0 2px 8px rgba(0, 0, 0, 0.3)',
                }}
                onClick={toggleLeftSidebar}
              >
                <PanelLeftOpen size={18} />
              </ActionIcon>
            </Tooltip>
          )}

          {viewMode === '3D' ? <Axonometric3DView /> : <CadCanvas />}
        </Box>

        {/* Правая панель инспектора */}
        {activeTool === 'CUT_PANEL' && viewMode === '2D' ? <PanelCutSidebar /> : <RightSidebar />}
      </Flex>

    </Flex>
  );
};
