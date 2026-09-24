import { useState } from 'react';
import { ActionIcon, Badge, ColorSwatch, Group, Paper, Select, Stack, Text, Tooltip } from '@mantine/core';
import { ALLWALL_PROFILES_CATALOG, findProfileByArticle } from '../../../core/models/Profile';
import { useAppTheme } from '../../theme/useAppTheme';

export const PROFILE_TYPE_OPTIONS = [
  { value: 'ALL', label: 'Все типы профилей' },
  { value: 'JOINT', label: '🔗 Соединительные' },
  { value: 'LED', label: '💡 Светодиодные (LED)' },
  { value: 'END', label: '🏁 Торцевые' },
  { value: 'CORNER', label: '📐 Угловые' },
  { value: 'BASEBOARD', label: '🔲 Плинтусы' },
  { value: 'SHADOW', label: '🌑 Теневые' },
];
export const getProfilesByType = (type: string) => ALLWALL_PROFILES_CATALOG.filter(p => type === 'ALL' || p.functionalRole === type);
const COLORS = [
  { name: 'Чёрный', hex: '#212529' }, { name: 'Золото', hex: '#c9a25b' },
  { name: 'Розовое золото', hex: '#b76e79' }, { name: 'Серебро', hex: '#adb5bd' },
];

/** Shared catalog controls for panel joints and slope joints. Gap is deliberately independent. */
export function ProfileCatalogSettings({ article, color = '#212529', onProfile, onColor }: {
  article?: string; color?: string;
  onProfile: (article: string) => void; onColor: (color: string) => void;
}) {
  const t = useAppTheme();
  const [filter, setFilter] = useState('ALL');
  const profile = findProfileByArticle(article ?? '');
  const options = getProfilesByType(filter);
  // A filter is a browsing aid: it does not remove the assigned model.
  const visibleOptions = profile && !options.includes(profile) ? [profile, ...options] : options;
  return <Stack gap="xs">
    <Select size="xs" label="Тип профиля AllWall" value={filter} data={PROFILE_TYPE_OPTIONS}
      onChange={value => setFilter(value ?? 'ALL')} allowDeselect={false} />
    <Select size="xs" label="Модель профиля AllWall" placeholder="Выберите артикул из каталога..."
      searchable clearable value={article || null}
      data={[...visibleOptions.map(p => ({ value: p.article, label: `${p.article} • ${p.name} (${p.visibleWidth} мм)` })),
        ...(article && !profile ? [{ value: article, label: `${article} (нет в каталоге)` }] : [])]}
      onChange={value => onProfile(value ?? '')} />
    <div><Text size="xs" fw={500} mb={4}>Цвет профиля AllWall:</Text>
      <Group gap="xs">{COLORS.map(c => <Tooltip key={c.hex} label={c.name}>
        <ActionIcon size={30} variant={color.toLowerCase() === c.hex ? 'outline' : 'subtle'} color="blue"
          aria-label={c.name} aria-pressed={color.toLowerCase() === c.hex} onClick={() => onColor(c.hex)}>
          <ColorSwatch color={c.hex} size={20} /></ActionIcon>
      </Tooltip>)}</Group>
    </div>
    {profile && <Paper p="xs" radius="sm" style={{ backgroundColor: t.bgCard, border: '1px solid #339af0' }}>
      <Stack gap={4}>
        <Group justify="space-between"><Badge size="xs">{profile.article}</Badge><Badge color="gray" size="xs">Хлыст {profile.stockLength} мм</Badge></Group>
        <Text size="xs" fw={600}>{profile.name}</Text><Text size="xs" c="dimmed">{profile.description}</Text>
        <Group gap={4}>
          <Badge size="xs" variant="outline" color="cyan">Видимая ширина: {profile.visibleWidth} мм</Badge>
          {profile.metalThickness !== undefined && <Badge size="xs" variant="outline" color="indigo">Металл: {profile.metalThickness.toLocaleString('ru-RU')} мм</Badge>}
          <Badge size="xs" variant="outline" color="teal">Панели: {profile.allowedThicknesses.join('/')} мм</Badge>
        </Group>
      </Stack>
    </Paper>}
  </Stack>;
}
