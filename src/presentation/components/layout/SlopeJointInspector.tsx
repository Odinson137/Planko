import { useEffect } from 'react';
import { Alert, Badge, Button, Group, Paper, Stack, Text } from '@mantine/core';
import { RotateCcw, Undo2, Redo2 } from 'lucide-react';
import { useSlopeJointStore } from '../../../application/stores/useSlopeJointStore';
import { useProjectStore } from '../../../application/stores/useProjectStore';
import { calculateSlopeGeometry, SLOPE_SIDE_LABELS, slopeJointHasProfile } from '../../../core/geometry/SlopeJointGeometry';
import { type Opening } from '../../../core/models/Opening';
import { useAppTheme } from '../../theme/useAppTheme';
import { PanelGapInput } from './PanelGapInput';
import { ProfileCatalogSettings } from './ProfileCatalogSettings';

export function SlopeJointInspector({ wallId, opening }: { wallId: string; opening: Opening }) {
  const t = useAppTheme(), editor = useSlopeJointStore();
  const projectId = useProjectStore(state => state.project.id);
  const { joints, faces } = calculateSlopeGeometry(opening);
  const invalidFaces = Object.values(faces).filter(face => face.enabled && face.length <= 0);
  const sameTarget = editor.target?.projectId === projectId && editor.target.wallId === wallId && editor.target.openingId === opening.id;
  const current = joints.find(j => sameTarget && j.corner === editor.corner && j.available) ?? joints.find(j => j.available);
  useEffect(() => {
    if (current && (!sameTarget || editor.corner !== current.corner)) editor.select(wallId, opening.id, current.corner);
  }, [wallId, opening.id, sameTarget, current?.corner, editor.corner, editor.select]);
  const change = (patch: Parameters<typeof editor.change>[3]) => current && editor.change(wallId, opening.id, current.corner, patch);
  const installed = joints.filter(j => j.available && j.sides.every(side => faces[side].length > 0) && slopeJointHasProfile(j));
  return <Paper p="xs" withBorder style={{ backgroundColor: t.bgCard, borderColor: t.border }} data-testid="slope-joint-inspector">
    <Stack gap="xs">
      <Text size="sm" fw={600}>Стыки откосов</Text>
      <Text size="xs" c="dimmed">Выберите угол между двумя откосами.</Text>
      {invalidFaces.length > 0 && <Alert color="red" role="alert">
        После изменения проёма зазор полностью убирает откос: {invalidFaces.map(face => SLOPE_SIDE_LABELS[face.side].toLowerCase()).join(', ')}.
        Уменьшите зазор. Эти детали и их профили временно исключены из расчёта.
      </Alert>}
      <div style={{ position: 'relative', height: 186, background: t.bgCardSubtle, borderRadius: 6 }}>
        <svg width="100%" height="186" viewBox="0 0 260 186" preserveAspectRatio="none" aria-label="Схема внутренних стыков откосов" role="img">
          {[
            { side: 'top', points: '38,28 222,28 182,58 78,58' },
            { side: 'right', points: '222,28 222,158 182,128 182,58' },
            { side: 'bottom', points: '38,158 222,158 182,128 78,128' },
            { side: 'left', points: '38,28 78,58 78,128 38,158' },
          ].map(face => <polygon key={face.side} points={face.points}
            fill={current?.sides.some(side => side === face.side) ? t.bgCardActive : t.bgCardSubtle} />)}
          <path d="M38 28H222V158H38Z M78 58H182V128H78Z" fill="none" stroke={t.border} />
          {joints.map((j, i) => {
            const left = i % 2 === 0, top = i < 2;
            return <line key={j.id} x1={left ? 38 : 222} y1={top ? 28 : 158} x2={left ? 78 : 182} y2={top ? 58 : 128}
              stroke={current?.id === j.id ? '#339af0' : j.isLED ? '#ffd43b' : j.profileColor ?? t.textDimmed}
              strokeWidth={current?.id === j.id ? 5 : slopeJointHasProfile(j) ? 3 : 1}
              opacity={j.available ? 1 : .25} strokeDasharray={slopeJointHasProfile(j) ? undefined : '4 3'} />;
          })}
          <text x="130" y="17" textAnchor="middle" fill={t.textDimmed} fontSize="11">Верхний</text>
          <text x="130" y="180" textAnchor="middle" fill={t.textDimmed} fontSize="11">Нижний</text>
          <text x="130" y="97" textAnchor="middle" fill={t.textDimmed} fontSize="12">Проём</text>
        </svg>
        {joints.map((j, i) => <Button key={j.id} size="compact-sm" radius="xl" disabled={!j.available}
          aria-label={`Стык ${i + 1}: ${j.name}`} aria-pressed={current?.id === j.id}
          variant={current?.id === j.id ? 'filled' : 'default'}
          onClick={() => editor.select(wallId, opening.id, j.corner)}
          style={{ position: 'absolute', width: 34, height: 34, left: i % 2 === 0 ? '15%' : '85%', top: i < 2 ? 28 : 158, transform: 'translate(-50%, -50%)' }}>{i + 1}</Button>)}
      </div>
      {!current ? <Text size="xs" c="dimmed">Нет доступных стыков. Включите два соседних откоса с ненулевой глубиной.</Text> : <>
        <Group justify="space-between"><Text size="xs" fw={600}>{current.name}</Text><Badge size="xs" variant="light">{current.length.toLocaleString('ru-RU')} мм</Badge></Group>
        <PanelGapInput key={`gap-${opening.id}-${current.corner}`} label="Зазор между откосами (мм)" value={current.width} onChange={width => change({ width })} />
        <Text size="xs" fw={500}>Откуда брать зазор:</Text>
        <Group grow gap={6}>{(['FIRST', 'SECOND'] as const).map((side, i) => <Button key={side} size="xs"
          variant={current.takeSide === 'BOTH' || current.takeSide === side ? 'filled' : 'default'}
          aria-pressed={current.takeSide === 'BOTH' || current.takeSide === side}
          onClick={() => change({ takeSide: current.takeSide === side ? 'BOTH' : side })}>
          {SLOPE_SIDE_LABELS[current.sides[i]]}</Button>)}</Group>
        <Group justify="space-between"><Text size="xs" c="dimmed">{current.takeSide === 'BOTH' ? 'Поровну с обоих откосов' : `Только ${SLOPE_SIDE_LABELS[current.sides[current.takeSide === 'FIRST' ? 0 : 1]].toLowerCase()} откос`}</Text>
          <Button size="compact-xs" variant="subtle" leftSection={<RotateCcw size={12} />} onClick={() => change({ takeSide: 'BOTH' })}>Авто</Button></Group>
        <ProfileCatalogSettings key={`profile-${opening.id}-${current.corner}`} article={current.profileArticle} color={current.profileColor} isLED={current.isLED}
          onProfile={profileArticle => change({ profileArticle })} onColor={profileColor => change({ profileColor })} onLED={isLED => change({ isLED })} />
        <Text size="xs" c="dimmed">Длина — по общей границе откосов. Зазор вычитается из выбранных торцов по всей их глубине.</Text>
        <Button size="xs" variant="light" aria-label="Применить все настройки ко всем стыкам"
          onClick={() => editor.change(wallId, opening.id, current.corner, {}, true)}>Применить ко всем стыкам</Button>
      </>}
      {sameTarget && editor.error && <Alert color="red" role="alert">{editor.error}</Alert>}
      <Group gap={6}>
        <Button size="compact-xs" variant="default" leftSection={<Undo2 size={12} />} disabled={!sameTarget || !editor.past.length} onClick={editor.undo}>Отменить</Button>
        <Button size="compact-xs" variant="default" leftSection={<Redo2 size={12} />} disabled={!sameTarget || !editor.future.length} onClick={editor.redo}>Повторить</Button>
      </Group>
      <Text size="xs" c="dimmed">Профилей: {installed.length} · {installed.reduce((sum, j) => sum + j.length, 0).toLocaleString('ru-RU')} мм</Text>
    </Stack>
  </Paper>;
}
