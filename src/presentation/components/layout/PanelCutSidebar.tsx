import React, { useMemo } from 'react';
import { Stack, Text, Button, Group, Select, NumberInput, SimpleGrid, Divider, Alert, ScrollArea } from '@mantine/core';
import { Scissors, X } from 'lucide-react';
import { usePanelCutStore } from '../../../application/stores/usePanelCutStore';
import { useProjectStore } from '../../../application/stores/useProjectStore';
import { cuttableWall, findCutPanel, panelBounds, previewPanelCut } from '../../../core/geometry/PanelCutEngine';
import { useAppTheme } from '../../theme/useAppTheme';

export const PanelCutSidebar: React.FC = () => {
  const theme = useAppTheme();
  const cut = usePanelCutStore();
  const project = useProjectStore(s => s.project);
  const wall = project.walls.find(w => w.id === cut.wallId);
  const source = useMemo(() => wall && cuttableWall(wall, project.materials), [wall, project.materials]);
  const panel = source && findCutPanel(source, cut.panelId);
  const preview = useMemo(() => panel && cut.p1 && cut.p2 ? previewPanelCut(panel, cut.p1, cut.p2) : null, [panel, cut.p1, cut.p2]);
  const length = cut.p1 && cut.p2 ? Math.hypot(cut.p2.x - cut.p1.x, cut.p2.y - cut.p1.y) : 0;
  const angle = cut.p1 && cut.p2 ? (Math.atan2(cut.p2.y - cut.p1.y, cut.p2.x - cut.p1.x) * 180 / Math.PI + 180) % 180 : 0;

  return <ScrollArea style={{ width: 320, flexShrink: 0, borderLeft: `1px solid ${theme.border}`, background: theme.bgCard }}>
    <Stack p="md" gap="sm">
      <Group justify="space-between"><Text fw={700}>Разрез панели</Text><Button size="compact-xs" variant="subtle" onClick={cut.finish} leftSection={<X size={14} />}>Готово</Button></Group>
      <Text size="sm">Выберите панель, затем две точки на её краях. Проверьте разрез и нажмите «Разрезать».</Text>
      <Select label="Панель для разреза" placeholder="Выберите на стене или из списка" searchable
        value={panel?.id ?? null} onChange={id => { if (id) cut.choosePanel(id); }}
        data={(source?.panels ?? []).map(p => ({ value: p.id, label: `${p.partLabel} · ${panelBounds(p.points).width.toFixed(1)} × ${panelBounds(p.points).height.toFixed(1)} мм` }))} />
      <Group grow>
        <Button variant="light" size="xs" disabled={!panel} onClick={() => {
          if (!panel) return; const b = panelBounds(panel.points);
          cut.setPoint('p1', { x: b.x + b.width / 2, y: b.y });
          cut.setPoint('p2', { x: b.x + b.width / 2, y: b.y + b.height });
        }}>Вертикально</Button>
        <Button variant="light" size="xs" disabled={!panel} onClick={() => {
          if (!panel) return; const b = panelBounds(panel.points);
          cut.setPoint('p1', { x: b.x, y: b.y + b.height / 2 });
          cut.setPoint('p2', { x: b.x + b.width, y: b.y + b.height / 2 });
        }}>Горизонтально</Button>
      </Group>
      <Divider label="Точные координаты" />
      <Text size="xs" c="dimmed">X — от левого края стены, Y — от пола. Все размеры в мм.</Text>
      <SimpleGrid cols={2}>
        {(['p1', 'p2'] as const).flatMap((key, index) => (['x', 'y'] as const).map(axis => <NumberInput
          key={`${key}-${axis}`} label={`${axis.toUpperCase()}${index + 1} (мм)`} disabled={!panel}
          value={cut[key]?.[axis] ?? ''} decimalScale={2} step={1}
          onChange={value => { if (typeof value === 'number' && Number.isFinite(value)) cut.setPoint(key, { ...(cut[key] ?? { x: 0, y: 0 }), [axis]: value }); }} />))}
      </SimpleGrid>
      {cut.p1 && cut.p2 && <Text size="sm">Длина линии: {length.toFixed(1)} мм · Угол: {angle.toFixed(1)}°</Text>}
      {cut.snap?.edgeSegment && <Text size="xs" c="teal">До концов края: {cut.snap.edgeSegment.dist1} / {cut.snap.edgeSegment.dist2} мм</Text>}
      {preview && <Text size="sm" c="teal">Получится деталей: {preview.polygons.length}. Зазор: 0 мм.</Text>}
      {cut.p1 && cut.p2 && !preview && <Text size="sm" c="red">Линия не разделяет панель. Соедините два разных края.</Text>}
      {cut.error && <Alert color="red">{cut.error}</Alert>}
      <Button leftSection={<Scissors size={16} />} disabled={!preview} onClick={cut.apply}>Разрезать</Button>
      <Button variant="default" onClick={cut.clearLine} disabled={!cut.p1 && !cut.p2}>Сбросить линию</Button>
      <Text size="xs" c="dimmed">Shift — угол с шагом 45°. Enter — разрезать. Esc — сбросить линию / выйти. Ctrl+Z — отменить последнее действие. Ctrl+Shift+Z — повторить.</Text>
      <Text size="xs" c="dimmed">Профиль и монтажный зазор можно задать после разреза в меню стыков.</Text>
    </Stack>
  </ScrollArea>;
};
