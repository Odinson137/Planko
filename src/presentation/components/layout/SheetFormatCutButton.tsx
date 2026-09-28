import { useState } from 'react';
import { Alert, Badge, Button, Divider, Group, Modal, Paper, Select, SimpleGrid, Stack, Text } from '@mantine/core';
import { Grid, Layers, Link } from 'lucide-react';
import { DEFAULT_SHEET_CUT_GAP_MM, type ProfileType } from '../../../core/models/Profile';
import type { SheetFormatCutOptions } from '../../../application/stores/useProjectStore';
import { PanelGapInput } from './PanelGapInput';
import { ProfileCatalogSettings } from './ProfileCatalogSettings';
import { PanelMaterialSettings } from './PanelMaterialSettings';
import { materialSheetFormat, type Material, type PanelMaterialSelection } from '../../../core/models/Material';
import { useAppTheme } from '../../theme/useAppTheme';

export function SheetFormatCutButton({ materials, material, panelWidth, panelHeight, profileType, onApply }: {
  materials: Material[];
  material: PanelMaterialSelection;
  panelWidth: number;
  panelHeight: number;
  profileType: ProfileType;
  onApply: (options: SheetFormatCutOptions) => void;
}) {
  const t = useAppTheme();
  const [opened, setOpened] = useState(false);
  const [draftMaterial, setDraftMaterial] = useState(material);
  const [gap, setGap] = useState(DEFAULT_SHEET_CUT_GAP_MM);
  const [jointType, setJointType] = useState('PROFILE');
  const [article, setArticle] = useState('MC-06');
  const [color, setColor] = useState('#212529');
  const [error, setError] = useState<string | null>(null);
  const selectedMaterial = materials.find(m => m.id === draftMaterial.materialId);
  const hasMaterial = selectedMaterial && !selectedMaterial.isVoid && selectedMaterial.type !== 'NONE';
  const format = materialSheetFormat(selectedMaterial);
  const needsCut = panelWidth > format.width + 1e-5 || panelHeight > format.height + 1e-5;

  const open = () => {
    const defaultArticle = profileType === 'JOINT_7' ? 'MC-06-7'
      : profileType === 'JOINT_3' || profileType === 'H_JOINT' ? 'MC-06' : '';
    setGap(DEFAULT_SHEET_CUT_GAP_MM);
    setDraftMaterial({ ...material });
    setJointType(defaultArticle ? 'PROFILE' : 'GAP');
    setArticle(defaultArticle);
    setColor('#212529');
    setError(null);
    setOpened(true);
  };

  return <>
    <Button size="xs" variant="light" color="teal" leftSection={<Grid size={14} />} onClick={open}
      style={{ fontWeight: 600 }}>
      📐 Раскроить по формату листа
    </Button>
    <Modal opened={opened} onClose={() => setOpened(false)} title="Раскрой по формату листа" centered size={920}>
      <Stack gap="md">
        <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="md">
          <Paper component="section" aria-label="Материал панели" p="md" withBorder radius="md"
            style={{ backgroundColor: t.bgCard, borderTop: '3px solid var(--mantine-color-blue-5)' }}>
            <Stack gap="sm">
              <Group gap="xs"><Layers size={18} color="var(--mantine-color-blue-5)" /><Text fw={600}>Материал панели</Text></Group>
              <Divider />
              <PanelMaterialSettings key={String(opened)} materials={materials} value={draftMaterial} allowVoid={false}
                onChange={patch => { setDraftMaterial(current => ({ ...current, ...patch })); setError(null); }} />
              {hasMaterial && <Badge color="blue" variant="light" size="lg">Формат листа: {format.width} × {format.height} мм</Badge>}
            </Stack>
          </Paper>
          <Paper component="section" aria-label="Стыки между панелями" p="md" withBorder radius="md"
            style={{ backgroundColor: t.bgCard, borderTop: '3px solid var(--mantine-color-teal-5)' }}>
            <Stack gap="sm">
              <Group gap="xs"><Link size={18} color="var(--mantine-color-teal-5)" /><Text fw={600}>Стыки между панелями</Text></Group>
              <Divider />
              <Select size="xs" label="Стык между панелями" value={jointType} allowDeselect={false}
                data={[{ value: 'GAP', label: 'Без профиля' }, { value: 'PROFILE', label: 'Профиль AllWall' }]}
                onChange={value => { setJointType(value ?? 'GAP'); setError(null); }} />
              {jointType === 'PROFILE' && <ProfileCatalogSettings article={article} color={color}
                onProfile={value => { setArticle(value); setError(null); }} onColor={setColor} />}
              <Divider />
              <PanelGapInput value={gap} onChange={value => { setGap(value); setError(null); }} />
            </Stack>
          </Paper>
        </SimpleGrid>
        <Text size="sm" c="dimmed">
          Слева направо: целый лист + зазор. Все зазоры вычитаются из крайней правой панели.
          Профиль и расстояние между панелями выбираются независимо.
        </Text>
        {!hasMaterial && <Alert color="blue">Выберите материал панели для раскроя.</Alert>}
        {hasMaterial && !needsCut && <Alert color="blue">Панель помещается в выбранный формат листа. Будет применён материал без дополнительных разрезов.</Alert>}
        {error && <Alert color="red" role="alert">{error}</Alert>}
        <Group justify="flex-end">
          <Button variant="default" onClick={() => setOpened(false)}>Отмена</Button>
          <Button color="teal" disabled={!hasMaterial || (needsCut && jointType === 'PROFILE' && !article)} onClick={() => {
            try {
              onApply({ gap, material: draftMaterial, profileArticle: jointType === 'PROFILE' ? article : undefined,
                profileColor: jointType === 'PROFILE' ? color : undefined });
              setOpened(false);
            } catch (reason) {
              setError(reason instanceof Error ? reason.message : 'Не удалось раскроить панель.');
            }
          }}>{needsCut ? 'Раскроить' : 'Применить материал'}</Button>
        </Group>
      </Stack>
    </Modal>
  </>;
}
