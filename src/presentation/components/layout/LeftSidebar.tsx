import React from 'react';
import {
  Stack,
  Title,
  Button,
  NavLink,
  Badge,
  Group,
  Text,
  Divider,
  ScrollArea,
  ActionIcon,
  Tooltip,
} from '@mantine/core';
import { Plus, Layout, DoorOpen, RectangleVertical, AppWindow, Tv, Square, Trash2, PanelLeftClose } from 'lucide-react';
import { useProjectStore } from '../../../application/stores/useProjectStore';
import { useEditorStore } from '../../../application/stores/useEditorStore';
import { Opening, getOpeningTypeLabel } from '../../../core/models/Opening';
import { useAppTheme } from '../../theme/useAppTheme';

export const LeftSidebar: React.FC = () => {
  const t = useAppTheme();
  const { toggleLeftSidebar, editMode, viewMode, setViewMode, setEditMode } = useEditorStore();
  const editingWalls = editMode === 'WALLS' && viewMode === '2D';
  const { project, selectWall, selectOpening, addWall, removeOpening } = useProjectStore();
  const selectedWallId = project.selectedWallId;
  const selectedOpeningId = project.selectedOpeningId;

  const currentWall = project.walls.find((w) => w.id === selectedWallId);

  const getOpeningIcon = (opening: Opening) => {
    switch (opening.type) {
      case 'DOOR':
        return opening.isPortal ? <RectangleVertical size={14} color="#4dabf7" /> : <DoorOpen size={14} color="#4dabf7" />;
      case 'PORTAL':
        return <RectangleVertical size={14} color="#4dabf7" />;
      case 'WINDOW':
        return <AppWindow size={14} color="#38d9a9" />;
      case 'TV_ZONE':
        return <Tv size={14} color="#ffd43b" />;
      case 'NICHE':
        return <Square size={14} color="#ff922b" />;
    }
  };

  return (
    <Stack
      h="100%"
      gap="xs"
      p="xs"
      style={{
        borderRight: `1px solid ${t.border}`,
        backgroundColor: t.bgSidebar,
        width: 260,
        minWidth: 260,
        flexShrink: 0,
      }}
    >
      <Group justify="space-between" px="xs" pt="xs" wrap="nowrap">
        <Title order={6} c={t.textDimmed} style={{ textTransform: 'uppercase', letterSpacing: '1px', fontSize: 11, whiteSpace: 'nowrap' }}>
          Стены ({project.walls.length})
        </Title>
        <Group gap={4} wrap="nowrap">
          <Button
            size="compact-xs"
            variant="light"
            leftSection={<Plus size={12} />}
            onClick={() => { addWall(); setViewMode('2D'); setEditMode('WALLS'); }}
          >
            Стена
          </Button>
          <Tooltip label="Скрыть меню стен" position="right" withArrow>
            <ActionIcon
              size="xs"
              variant="subtle"
              color="gray"
              onClick={toggleLeftSidebar}
            >
              <PanelLeftClose size={15} />
            </ActionIcon>
          </Tooltip>
        </Group>
      </Group>

      <ScrollArea style={{ flex: 1 }}>
        <Stack gap={4}>
          {project.walls.map((wall) => {
            const isWallSelected = wall.id === selectedWallId;
            const totalElements = wall.openings.length;

            return (
              <div key={wall.id}>
                <NavLink
                  active={isWallSelected && !selectedOpeningId}
                  label={
                    <Group justify="space-between" wrap="nowrap" gap={4}>
                      <Text size="xs" fw={500} truncate style={{ flex: 1, color: isWallSelected ? undefined : t.textPrimary }}>
                        {wall.name}
                      </Text>
                      {wall.roomName && (
                        <Badge size="xs" variant="light" color="yellow" radius="sm" style={{ textTransform: 'none' }}>
                          {wall.roomName}
                        </Badge>
                      )}
                    </Group>
                  }
                  description={`${wall.width} × ${wall.height} мм`}
                  leftSection={<Layout size={16} />}
                  rightSection={
                    totalElements > 0 ? (
                      <Badge size="xs" variant="dot" color="blue">
                        {totalElements}
                      </Badge>
                    ) : undefined
                  }
                  onClick={() => selectWall(wall.id)}
                  style={{
                    borderRadius: 4,
                    marginBottom: 2,
                  }}
                />

                {/* Список проемов текущей стены */}
                {!editingWalls && isWallSelected && wall.openings.length > 0 && (
                  <Stack gap={2} pl="lg" mt={2}>
                    {wall.openings.map((op) => (
                      <NavLink
                        key={op.id}
                        active={op.id === selectedOpeningId}
                        label={op.name}
                        description={`${getOpeningTypeLabel(op)} · ${op.width}×${op.height} мм`}
                        leftSection={getOpeningIcon(op)}
                        rightSection={
                          <Group gap={4}>
                            <Badge
                              size="xs"
                              variant="light"
                              color={op.isCutout === false ? 'yellow' : (op.slopes?.enabled ? 'blue' : 'gray')}
                            >
                              {op.isCutout === false ? 'Декор' : (op.slopes?.enabled ? 'Откос' : 'Вырез')}
                            </Badge>
                            <Tooltip label="Удалить">
                              <ActionIcon
                                size="xs"
                                variant="subtle"
                                color="red"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  removeOpening(wall.id, op.id);
                                }}
                              >
                                <Trash2 size={12} />
                              </ActionIcon>
                            </Tooltip>
                          </Group>
                        }
                        onClick={() => {
                          selectWall(wall.id);
                          selectOpening(op.id);
                        }}
                        style={{
                          borderRadius: 4,
                          fontSize: '12px',
                        }}
                      />
                    ))}
                  </Stack>
                )}
              </div>
            );
          })}
        </Stack>
      </ScrollArea>

      <Divider color={t.border} />

      {/* Информационный футер */}
      <Stack gap={2} p="xs">
        <Text size="xs" c={t.textDimmed}>
          Активная стена:
        </Text>
        <Text size="xs" fw={500} c={t.textPrimary}>
          {currentWall
            ? `${currentWall.name}${currentWall.roomName ? ` [${currentWall.roomName}]` : ''} (${currentWall.width}×${currentWall.height} мм)`
            : 'Не выбрана'}
        </Text>
      </Stack>
    </Stack>
  );
};
