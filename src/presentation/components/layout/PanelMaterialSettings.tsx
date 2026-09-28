import { useState } from 'react';
import { ActionIcon, Badge, ColorInput, ColorSwatch, Group, Select, Stack, Text, TextInput, Tooltip } from '@mantine/core';
import { Search } from 'lucide-react';
import { MATERIAL_NONE, MATERIAL_NONE_ID, panelMaterialDefaults, type Material, type PanelMaterialSelection } from '../../../core/models/Material';
import { findDecorByCode } from '../../../core/models/AllWallCatalog';

const CATEGORIES = [
  { value: 'ALL', label: 'Все категории' },
  { value: 'SHEET', label: '📄 Сплошные панели' },
  { value: 'SLAT', label: '🪵 Реечные GW' },
  { value: 'HQ', label: '✨ HQ Мрамор & Золото' },
];
const GROUPS = [
  { type: 'SHEET', label: 'Сплошные панели AllWall', icon: '📄' },
  { type: 'SLAT', label: 'Реечные панели GW10–GW99', icon: '🪵' },
  { type: 'HQ', label: 'HQ-панели (Глянец & Золото)', icon: '✨' },
];
const thicknesses = (material: Material) => material.thicknessOptions?.length
  ? material.thicknessOptions : [material.thickness || 5];

/** Shared controls in the panel inspector and the sheet-cut dialog. */
export function PanelMaterialSettings({ materials, value, onChange, allowVoid = true }: {
  materials: Material[];
  value: PanelMaterialSelection;
  onChange: (patch: Partial<PanelMaterialSelection>) => void;
  allowVoid?: boolean;
}) {
  const [category, setCategory] = useState('ALL');
  const [thicknessFilter, setThicknessFilter] = useState('ALL');
  const material = materials.find(m => m.id === value.materialId);
  const isVoid = !material || material.isVoid || material.type === 'NONE';
  const available = materials.filter(m => !m.isVoid && m.type !== 'NONE');
  const filtered = available.filter(m => (category === 'ALL' || m.type === category)
    && (thicknessFilter === 'ALL' || thicknesses(m).includes(Number(thicknessFilter))));
  const options = GROUPS.map(group => ({ group: group.label,
    items: filtered.filter(m => m.type === group.type).map(m => ({ value: m.id, label: `${group.icon} ${m.name}` })),
  })).filter(group => group.items.length > 0);
  // Browsing filters do not clear a material that is already assigned.
  if (material && !isVoid && !filtered.includes(material)) {
    options.unshift({ group: 'Выбранная модель', items: [{ value: material.id, label: material.name }] });
  }
  if (allowVoid) options.push({ group: 'Специальные зоны',
    items: [{ value: MATERIAL_NONE_ID, label: '⭕ Без материала (Пустота / Зеркало)' }] });
  const decorOptions = material?.availableDecors ?? [];
  const availableThicknesses = [...new Set(available.flatMap(thicknesses))].sort((a, b) => a - b);

  return <Stack gap="xs">
    <Select size="xs" label="Категория панелей" value={category} allowDeselect={false}
      data={CATEGORIES} onChange={next => setCategory(next ?? 'ALL')} />
    <Select size="xs" label="Фильтр по толщине" value={thicknessFilter} allowDeselect={false}
      data={[{ value: 'ALL', label: 'Все толщины' }, ...availableThicknesses.map(n => ({ value: String(n), label: `${n} мм` }))]}
      onChange={next => {
        setThicknessFilter(next ?? 'ALL');
        if (next && next !== 'ALL' && material && !isVoid && thicknesses(material).includes(Number(next))) {
          onChange({ thickness: Number(next) });
        }
      }} />
    <Select size="xs" label="Модель панели AllWall" placeholder="Выберите материал панели" searchable allowDeselect={false}
      nothingFoundMessage="Подходящих моделей нет" value={!allowVoid && isVoid ? null : value.materialId} data={options}
      onChange={id => {
        const next = id === MATERIAL_NONE_ID ? MATERIAL_NONE : materials.find(m => m.id === id);
        if (next) onChange({ ...panelMaterialDefaults(next),
          ...(thicknessFilter !== 'ALL' && thicknesses(next).includes(Number(thicknessFilter))
            ? { thickness: Number(thicknessFilter) } : {}) });
      }} />
    {filtered.length === 0 && <Text size="xs" c="dimmed">По выбранным фильтрам моделей нет.</Text>}
    {!isVoid && material && <>
      <Group justify="space-between"><Text size="xs" fw={600}>Декор и цвет AllWall</Text>
        {value.decorCode && <Badge size="xs" color="dark">{value.decorCode}</Badge>}
      </Group>
      <Group grow gap="xs" align="flex-start">
        <TextInput size="xs" label="Код декора" placeholder="7029, 5134..." value={value.decorCode} leftSection={<Search size={14} />}
          onChange={event => {
            const code = event.currentTarget.value.trim();
            const decor = decorOptions.find(d => d.code === code) ?? findDecorByCode(code);
            onChange({ decorCode: code, decorName: decor?.name ?? '',
              ...(decor ? { color: decor.color, textureCategory: decor.category } : {}) });
          }} />
        <ColorInput size="xs" label="Цвет панели" placeholder="#HEX" value={value.color}
          onChange={color => onChange({ color })} />
      </Group>
      {decorOptions.length > 0 && <div>
        <Text size="xs" c="dimmed" mb={4}>Фирменная палитра модели ({decorOptions.length})</Text>
        <Group gap={6}>
          {decorOptions.map(decor => <Tooltip key={decor.code} label={`${decor.code} • ${decor.name}`} withArrow>
            <ActionIcon size={26} color="blue" variant={value.decorCode === decor.code ? 'outline' : 'subtle'}
              aria-label={`${decor.code} • ${decor.name}`} aria-pressed={value.decorCode === decor.code}
              onClick={() => onChange({ decorCode: decor.code, decorName: decor.name, color: decor.color, textureCategory: decor.category })}>
              <ColorSwatch color={decor.color} size={18} />
            </ActionIcon>
          </Tooltip>)}
        </Group>
      </div>}
    </>}
  </Stack>;
}
