import React, { useState } from 'react';
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
  SegmentedControl,
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
  Layers,
  Palette,
} from 'lucide-react';
import { useEditorStore } from '../../../application/stores/useEditorStore';
import { useProjectStore } from '../../../application/stores/useProjectStore';
import { AllWallCatalogModal } from '../catalog/AllWallCatalogModal';

export const TopToolbar: React.FC = () => {
  const {
    activeTool,
    setActiveTool,
    viewMode,
    setViewMode,
    editMode,
    setEditMode,
    zoom,
    setZoom,
    resetView,
    showGrid,
    toggleGrid,
    showDimensions,
    toggleDimensions,
    showTextures,
    toggleTextures,
  } = useEditorStore();

  const { project, addOpening, addWallBend } = useProjectStore();
  const [catalogOpened, setCatalogOpened] = useState(false);
  const selectedWallId = project.selectedWallId;

  const handleAddOpening = (type: 'DOOR' | 'WINDOW' | 'TV_ZONE' | 'NICHE') => {
    if (selectedWallId) {
      addOpening(selectedWallId, type);
    }
  };

  const handleAddRadius = (type: 'OUTER_CORNER' | 'INNER_CORNER', radius: number, angleDeg?: number) => {
    if (selectedWallId) {
      addWallBend(selectedWallId, type, undefined, radius, angleDeg);
    }
  };

  return (
    <>
      <Group justify="space-between" px="md" py={6} style={{ borderBottom: '1px solid #2C2E33', backgroundColor: '#1A1B1E' }}>
        {/* Логотип и переключатель 2D / 3D */}
        <Group gap="sm">
          <Title order={4} style={{ color: '#E9ECEF', letterSpacing: '0.5px' }}>
            PLANKO
          </Title>
          <Badge size="xs" variant="outline" color="yellow">
            v0.1 CAD
          </Badge>
          <Divider orientation="vertical" />
          <SegmentedControl
            size="xs"
            value={viewMode}
            onChange={(val: any) => setViewMode(val)}
            data={[
              { label: '📐 2D Чертёж', value: '2D' },
              { label: '🧊 3D Вид (30°)', value: '3D' },
            ]}
          />

          {viewMode === '2D' && (
            <>
              <Divider orientation="vertical" />
              <SegmentedControl
                size="xs"
                value={editMode}
                onChange={(val: any) => setEditMode(val)}
                data={[
                  { label: '📄 Панели', value: 'PANELS' },
                  { label: '⚡ Стыки & LED', value: 'JOINTS' },
                ]}
                color={editMode === 'JOINTS' ? 'yellow' : 'blue'}
              />
            </>
          )}

          {/* Кнопка открытия каталога AllWall */}
          <Button
            size="xs"
            variant="gradient"
            gradient={{ from: 'blue', to: 'cyan', deg: 90 }}
            leftSection={<Layers size={14} />}
            onClick={() => setCatalogOpened(true)}
          >
            Каталог AllWall
          </Button>
        </Group>

        {/* Инструменты добавления радиусов, проемов и курсор */}
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

          {/* Меню добавления углов и поворотов */}
          <Menu shadow="md" width={200} position="bottom-start">
            <Menu.Target>
              <Button
                size="xs"
                variant="light"
                color="cyan"
                leftSection={<Text size="xs" fw={700} style={{ fontFamily: 'JetBrains Mono' }}>⌒</Text>}
                disabled={!selectedWallId}
              >
                + Угол стены
              </Button>
            </Menu.Target>

            <Menu.Dropdown>
              <Menu.Label>Углы и повороты</Menu.Label>
              <Menu.Item onClick={() => handleAddRadius('OUTER_CORNER', 0, 90)}>
                ⌒ Внешний угол
              </Menu.Item>
              <Menu.Item onClick={() => handleAddRadius('INNER_CORNER', 0, 90)}>
                ╭ Внутренний угол
              </Menu.Item>
            </Menu.Dropdown>
          </Menu>

          <Divider orientation="vertical" />

          {/* Меню добавления проемов и зон */}
          <Menu shadow="md" width={200} position="bottom-start">
            <Menu.Target>
              <Button
                size="xs"
                variant="default"
                leftSection={<DoorOpen size={14} />}
                disabled={!selectedWallId}
              >
                + Проём / Зона
              </Button>
            </Menu.Target>

            <Menu.Dropdown>
              <Menu.Label>Вырезы и проёмы</Menu.Label>
              <Menu.Item
                leftSection={<DoorOpen size={15} />}
                onClick={() => handleAddOpening('DOOR')}
              >
                Дверь
              </Menu.Item>
              <Menu.Item
                leftSection={<AppWindow size={15} />}
                onClick={() => handleAddOpening('WINDOW')}
              >
                Окно
              </Menu.Item>
              <Menu.Item
                leftSection={<Square size={15} />}
                onClick={() => handleAddOpening('NICHE')}
              >
                Ниша
              </Menu.Item>
              <Menu.Divider />
              <Menu.Label>Декоративные зоны</Menu.Label>
              <Menu.Item
                leftSection={<Tv size={15} />}
                onClick={() => handleAddOpening('TV_ZONE')}
              >
                ТВ-зона
              </Menu.Item>
            </Menu.Dropdown>
          </Menu>
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

          <Tooltip label={showTextures ? 'Текстуры материалов (ВКЛ)' : 'Текстуры материалов (ВЫКЛ / Сплошной цвет)'} position="bottom">
            <ActionIcon
              variant={showTextures ? 'light' : 'subtle'}
              color={showTextures ? 'blue' : 'gray'}
              onClick={toggleTextures}
            >
              <Palette size={16} />
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

      {/* Модальное окно каталога AllWall */}
      <AllWallCatalogModal opened={catalogOpened} onClose={() => setCatalogOpened(false)} />
    </>
  );
};
