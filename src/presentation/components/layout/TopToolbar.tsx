import React from 'react';
import {
  Group,
  Button,
  ActionIcon,
  Tooltip,
  Title,
  Badge,
  Divider,
  Text,
  Menu,
} from '@mantine/core';
import {
  MousePointer,
  DoorOpen,
  AppWindow,
  Tv,
  Square,
  ZoomIn,
  ZoomOut,
  Maximize2,
  Grid,
  Ruler,
  LayoutGrid,
} from 'lucide-react';
import { useEditorStore } from '../../../application/stores/useEditorStore';
import { useProjectStore } from '../../../application/stores/useProjectStore';

export const TopToolbar: React.FC = () => {
  const {
    activeTool,
    setActiveTool,
    zoom,
    setZoom,
    resetView,
    showGrid,
    toggleGrid,
    showDimensions,
    toggleDimensions,
  } = useEditorStore();

  const { project, addOpening, applyGridPreset } = useProjectStore();
  const selectedWallId = project.selectedWallId;

  const handleAddOpening = (type: 'DOOR' | 'WINDOW' | 'TV_ZONE' | 'NICHE') => {
    if (selectedWallId) {
      addOpening(selectedWallId, type);
    }
  };

  return (
    <Group justify="space-between" px="md" py={6} style={{ borderBottom: '1px solid #2C2E33', backgroundColor: '#1A1B1E' }}>
      {/* Логотип и проект */}
      <Group gap="xs">
        <Title order={4} style={{ color: '#E9ECEF', letterSpacing: '0.5px' }}>
          PLANKO
        </Title>
        <Badge size="xs" variant="outline" color="yellow">
          v0.1 CAD
        </Badge>
        <Divider orientation="vertical" />
        <Text size="xs" c="dimmed">
          {project.name}
        </Text>
      </Group>

      {/* Инструменты добавления сетки, проемов и курсор */}
      <Group gap={6}>
        <Tooltip label="Выбор и перемещение (V)" position="bottom">
          <ActionIcon
            variant={activeTool === 'SELECT' ? 'filled' : 'subtle'}
            color={activeTool === 'SELECT' ? 'blue' : 'gray'}
            onClick={() => setActiveTool('SELECT')}
          >
            <MousePointer size={16} />
          </ActionIcon>
        </Tooltip>

        <Divider orientation="vertical" />

        {/* Меню пресетов сетки */}
        <Menu shadow="md" width={250} position="bottom-start">
          <Menu.Target>
            <Button
              size="xs"
              variant="light"
              color="grape"
              leftSection={<LayoutGrid size={14} />}
              disabled={!selectedWallId}
            >
              Сетка / Шаблоны
            </Button>
          </Menu.Target>

          <Menu.Dropdown>
            <Menu.Label>Быстрая разметка стены</Menu.Label>
            <Menu.Item onClick={() => selectedWallId && applyGridPreset(selectedWallId, 'STANDARD_1220')}>
              📄 Листовые панели 1220 мм
            </Menu.Item>
            <Menu.Item onClick={() => selectedWallId && applyGridPreset(selectedWallId, 'SLATS_145')}>
              🪵 Реечные панели 145 мм
            </Menu.Item>
            <Menu.Item onClick={() => selectedWallId && applyGridPreset(selectedWallId, 'TIERS_900_1800')}>
              📏 3 Уровня (Цоколь 900 + LED + Верх)
            </Menu.Item>
            <Menu.Item onClick={() => selectedWallId && applyGridPreset(selectedWallId, 'CENTER_TV_NICHE')}>
              📺 ТВ по центру (Пустота + Рейки по бокам)
            </Menu.Item>
          </Menu.Dropdown>
        </Menu>

        <Divider orientation="vertical" />

        <Tooltip label="Добавить дверь" position="bottom">
          <Button
            size="xs"
            variant="default"
            leftSection={<DoorOpen size={14} />}
            onClick={() => handleAddOpening('DOOR')}
            disabled={!selectedWallId}
          >
            + Дверь
          </Button>
        </Tooltip>

        <Tooltip label="Добавить окно" position="bottom">
          <Button
            size="xs"
            variant="default"
            leftSection={<AppWindow size={14} />}
            onClick={() => handleAddOpening('WINDOW')}
            disabled={!selectedWallId}
          >
            + Окно
          </Button>
        </Tooltip>

        <Tooltip label="Добавить ТВ-зону" position="bottom">
          <Button
            size="xs"
            variant="default"
            leftSection={<Tv size={14} />}
            onClick={() => handleAddOpening('TV_ZONE')}
            disabled={!selectedWallId}
          >
            + ТВ-зона
          </Button>
        </Tooltip>

        <Tooltip label="Добавить нишу" position="bottom">
          <Button
            size="xs"
            variant="default"
            leftSection={<Square size={14} />}
            onClick={() => handleAddOpening('NICHE')}
            disabled={!selectedWallId}
          >
            + Ниша
          </Button>
        </Tooltip>
      </Group>

      {/* Управление холстом (зум, сетка, размеры) */}
      <Group gap={6}>
        <Tooltip label="Сетка (G)" position="bottom">
          <ActionIcon
            variant={showGrid ? 'light' : 'subtle'}
            color={showGrid ? 'blue' : 'gray'}
            onClick={toggleGrid}
          >
            <Grid size={16} />
          </ActionIcon>
        </Tooltip>

        <Tooltip label="Размерные цепочки" position="bottom">
          <ActionIcon
            variant={showDimensions ? 'light' : 'subtle'}
            color={showDimensions ? 'blue' : 'gray'}
            onClick={toggleDimensions}
          >
            <Ruler size={16} />
          </ActionIcon>
        </Tooltip>

        <Divider orientation="vertical" />

        <ActionIcon variant="subtle" color="gray" onClick={() => setZoom(zoom - 0.1)}>
          <ZoomOut size={16} />
        </ActionIcon>
        <Text size="xs" c="dimmed" style={{ minWidth: 45, textAlign: 'center' }}>
          {Math.round(zoom * 100)}%
        </Text>
        <ActionIcon variant="subtle" color="gray" onClick={() => setZoom(zoom + 0.1)}>
          <ZoomIn size={16} />
        </ActionIcon>
        <Tooltip label="Центрировать вид" position="bottom">
          <ActionIcon variant="subtle" color="gray" onClick={resetView}>
            <Maximize2 size={16} />
          </ActionIcon>
        </Tooltip>
      </Group>
    </Group>
  );
};
