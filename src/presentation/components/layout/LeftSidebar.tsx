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
import { Plus, Layout, DoorOpen, AppWindow, Tv, Square, Trash2 } from 'lucide-react';
import { useProjectStore } from '../../../application/stores/useProjectStore';
import { OpeningType } from '../../../core/models/Opening';

export const LeftSidebar: React.FC = () => {
  const { project, selectedWallBendId, selectWall, selectOpening, selectWallBend, addWall, removeOpening, deleteWallBend } = useProjectStore();
  const selectedWallId = project.selectedWallId;
  const selectedOpeningId = project.selectedOpeningId;

  const currentWall = project.walls.find((w) => w.id === selectedWallId);

  const getOpeningIcon = (type: OpeningType) => {
    switch (type) {
      case 'DOOR':
        return <DoorOpen size={14} color="#4dabf7" />;
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
        borderRight: '1px solid #2C2E33',
        backgroundColor: '#141517',
        width: 260,
        minWidth: 260,
      }}
    >
      <Group justify="space-between" px="xs" pt="xs">
        <Title order={6} c="dimmed" style={{ textTransform: 'uppercase', letterSpacing: '1px' }}>
          Стены ({project.walls.length})
        </Title>
        <Button
          size="compact-xs"
          variant="light"
          leftSection={<Plus size={12} />}
          onClick={addWall}
        >
          Стена
        </Button>
      </Group>

      <ScrollArea style={{ flex: 1 }}>
        <Stack gap={4}>
          {project.walls.map((wall) => {
            const isWallSelected = wall.id === selectedWallId;
            const bendsCount = wall.bends?.length || 0;
            const totalElements = wall.openings.length + bendsCount;

            return (
              <div key={wall.id}>
                <NavLink
                  active={isWallSelected && !selectedOpeningId && !selectedWallBendId}
                  label={wall.name}
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

                {/* Список изгибов и углов стены */}
                {isWallSelected && wall.bends && wall.bends.length > 0 && (
                  <Stack gap={2} pl="lg" mt={2}>
                    {wall.bends.map((bend) => {
                      const arcLen = Math.round((Math.PI * bend.radius * (bend.angleDeg || 90)) / 180);
                      return (
                        <NavLink
                          key={bend.id}
                          active={bend.id === selectedWallBendId}
                          label={bend.name || (bend.type === 'ARCH_VAULT' ? 'Свод' : 'Угол')}
                          description={`X: ${bend.x} мм, R: ${bend.radius}`}
                          leftSection={<Text size="xs" fw={700} c="cyan.4" style={{ fontFamily: 'JetBrains Mono' }}>⌒</Text>}
                          rightSection={
                            <Group gap={4}>
                              <Badge size="xs" variant="light" color="cyan">
                                {arcLen} мм
                              </Badge>
                              <Tooltip label="Удалить">
                                <ActionIcon
                                  size="xs"
                                  variant="subtle"
                                  color="red"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    deleteWallBend(wall.id, bend.id);
                                  }}
                                >
                                  <Trash2 size={12} />
                                </ActionIcon>
                              </Tooltip>
                            </Group>
                          }
                          onClick={() => {
                            selectWall(wall.id);
                            selectWallBend(bend.id);
                          }}
                          style={{
                            borderRadius: 4,
                            fontSize: '12px',
                          }}
                        />
                      );
                    })}
                  </Stack>
                )}

                {/* Список проемов текущей стены */}
                {isWallSelected && wall.openings.length > 0 && (
                  <Stack gap={2} pl="lg" mt={2}>
                    {wall.openings.map((op) => (
                      <NavLink
                        key={op.id}
                        active={op.id === selectedOpeningId}
                        label={op.name}
                        description={`${op.width}×${op.height} мм`}
                        leftSection={getOpeningIcon(op.type)}
                        rightSection={
                          <Group gap={4}>
                            <Badge
                              size="xs"
                              variant="light"
                              color={op.isCutout === false ? 'yellow' : 'gray'}
                            >
                              {op.isCutout === false ? 'Декор' : 'Вырез'}
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

      <Divider color="#2C2E33" />

      {/* Информационный футер */}
      <Stack gap={2} p="xs">
        <Text size="xs" c="dimmed">
          Активная стена:
        </Text>
        <Text size="xs" fw={500} c="bright">
          {currentWall ? `${currentWall.name} (${currentWall.width}×${currentWall.height} мм)` : 'Не выбрана'}
        </Text>
      </Stack>
    </Stack>
  );
};
