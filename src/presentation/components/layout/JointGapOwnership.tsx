import { ActionIcon, Alert, Badge, Box, Group, Paper, Text, Tooltip } from '@mantine/core';
import { RefreshCw } from 'lucide-react';
import { useState } from 'react';
import type { Wall, WallJointLine } from '../../../core/models/Wall';
import { edgeBelongsToJoint, getPanelJointSide } from '../../../core/geometry/PanelJointBinding';
import { getPanelEdges } from '../../../core/geometry/PanelEdges';

/** A compact, deliberately schematic view of the two sides of one shared gap. */
export function JointGapOwnership({ wall, joint, panelId, onSwitch }: {
  wall: Wall; joint: WallJointLine; panelId?: string; onSwitch: () => void;
}) {
  const [error, setError] = useState<{ jointId: string; message: string } | null>(null);
  if (!joint.gapOwnerSide) return (
    <Paper withBorder p="xs" radius="sm">
      <Text size="xs" fw={600}>Общий стык · главная сторона не выбрана</Text>
      <Text size="xs" c="dimmed" mt={4}>Введите зазор, в том числе 0 мм, чтобы назначить эту панель главной.</Text>
    </Paper>
  );
  const adjacent = (wall.panels ?? []).filter(panel => getPanelEdges(panel.points).some(edge => edgeBelongsToJoint(edge, joint)));
  const horizontal = Math.abs(joint.p2.x - joint.p1.x) > Math.abs(joint.p2.y - joint.p1.y);
  const coordinate = (side: number) => {
    const points = adjacent.filter(panel => getPanelJointSide(panel, joint) === side).flatMap(panel => panel.points);
    return points.reduce((sum, p) => sum + (horizontal ? -p.y : p.x), 0) / Math.max(1, points.length);
  };
  const sides = [-1, 1].sort((a, b) => coordinate(a) - coordinate(b));
  const owners = adjacent.filter(panel => getPanelJointSide(panel, joint) === joint.gapOwnerSide);
  const ownerNames = owners.map(panel => panel.partLabel).join(', ');
  const selectedOwner = owners.some(panel => panel.id === panelId);
  const canSwitch = adjacent.some(panel => getPanelJointSide(panel, joint) !== joint.gapOwnerSide);
  return (
    <Paper withBorder p="xs" radius="sm" aria-label="Главная сторона стыка">
      <Group gap={6} mb={6} justify="space-between" wrap="nowrap">
        <Badge size="xs" color={selectedOwner ? 'orange' : 'cyan'} variant="light">
          {panelId ? selectedOwner ? 'Главная сторона' : 'Связанная сторона' : 'Главная сторона закреплена'}
        </Badge>
        <Tooltip label={canSwitch ? `Перенести весь зазор ${joint.width} мм на соседнюю панель` : 'Нет соседней панели для смены стороны'} multiline w={240} withArrow>
          <ActionIcon size="sm" variant="light" color="orange" aria-label="Сменить главную сторону"
            disabled={!canSwitch} onClick={() => {
              try { onSwitch(); setError(null); }
              catch (cause) { setError({ jointId: joint.id, message: cause instanceof Error ? cause.message : 'Не удалось перенести зазор.' }); }
            }}>
            <RefreshCw size={15} />
          </ActionIcon>
        </Tooltip>
      </Group>
      <Text size="xs" fw={600} mb="xs">Один зазор: {joint.width} мм</Text>
      {error?.jointId === joint.id && <Alert color="red" role="alert" mb="xs">{error.message}</Alert>}
      <Box style={{ display: 'flex', gap: 8, flexDirection: horizontal ? 'column' : 'row' }}>
        {sides.map(side => {
          const panels = adjacent.filter(panel => getPanelJointSide(panel, joint) === side);
          const master = side === joint.gapOwnerSide;
          const selected = panels.some(panel => panel.id === panelId);
          return <Box key={side} p={8} style={{ flex: 1, minWidth: 0, borderRadius: 4,
            background: master ? 'var(--mantine-color-orange-light)' : 'var(--mantine-color-cyan-light)',
            border: `2px ${selected ? 'solid' : 'dashed'} var(--mantine-color-${master ? 'orange' : 'cyan'}-5)` }}>
            <Text size="xs" fw={700}>{master ? 'Главная' : 'Соседняя'}{selected ? ' · выбрана' : ''}</Text>
            <Text size="xs">Панель {panels.map(panel => panel.partLabel).join(', ') || '—'}</Text>
            <Text size="xs" c={master ? 'orange.8' : 'cyan.8'} mt={4}>
              {master ? '− размер при + зазоре' : 'Размер фиксирован'}
            </Text>
          </Box>;
        })}
      </Box>
      <Text size="xs" c="dimmed" mt="xs">
        При изменении с любой стороны зазор берётся из {owners.length > 1 ? 'панелей' : 'панели'} {ownerNames}.
      </Text>
    </Paper>
  );
}
