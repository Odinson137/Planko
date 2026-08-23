import React, { useState, useMemo } from 'react';
import {
  Modal,
  Tabs,
  Card,
  Text,
  Badge,
  Group,
  Stack,
  Button,
  TextInput,
  SimpleGrid,
  ColorSwatch,
  Tooltip,
  Paper,
  Divider,
  ActionIcon,
  NumberInput,
  Select,
  MultiSelect,
  ColorInput,
  ScrollArea,
  Alert,
} from '@mantine/core';
import {
  Search,
  Plus,
  Layers,
  Sparkles,
  ExternalLink,
  Check,
  Trash2,
  Eye,
  Sliders,
  Edit3,
  AlertTriangle,
} from 'lucide-react';
import { useProjectStore } from '../../../application/stores/useProjectStore';
import {
  AllWallPanelModel,
  AllWallDecor,
  SlatProfileShape,
} from '../../../core/models/AllWallCatalog';
import { Material } from '../../../core/models/Material';

interface AllWallCatalogModalProps {
  opened: boolean;
  onClose: () => void;
}

export const AllWallCatalogModal: React.FC<AllWallCatalogModalProps> = ({ opened, onClose }) => {
  const {
    project,
    setWallMaterial,
    addCustomCatalogPanel,
    updateCatalogPanel,
    deleteCatalogPanel,
  } = useProjectStore();

  const [activeTab, setActiveTab] = useState<string | null>('SHEET');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedDecorByModel, setSelectedDecorByModel] = useState<Record<string, AllWallDecor>>({});

  // Состояние создания новой кастомной панели
  const [isCreatingCustom, setIsCreatingCustom] = useState(false);
  const [customName, setCustomName] = useState('');
  const [customCategory, setCustomCategory] = useState<'SHEET' | 'SLAT' | 'HQ'>('SHEET');
  const [customWidth, setCustomWidth] = useState<number>(1220);
  const [customHeight, setCustomHeight] = useState<number>(2800);
  const [customThicknesses, setCustomThicknesses] = useState<string[]>(['5', '8']);
  const [customTextureCategory, setCustomTextureCategory] = useState<string>('WOOD');
  const [customReliefType, setCustomReliefType] = useState<SlatProfileShape>('FLAT');
  const [customColorsList, setCustomColorsList] = useState<{ code: string; color: string; name: string }[]>([
    { code: 'CUSTOM-01', color: '#c4b5a2', name: 'Кастомный цвет 1' },
  ]);
  const [newColorCode, setNewColorCode] = useState('7001');
  const [newColorHex, setNewColorHex] = useState('#a0784a');
  const [newColorName, setNewColorName] = useState('Светлый дуб');

  // Состояние редактирования существующей панели
  const [editingModel, setEditingModel] = useState<AllWallPanelModel | null>(null);
  const [editName, setEditName] = useState('');
  const [editCategory, setEditCategory] = useState<'SHEET' | 'SLAT' | 'HQ'>('SHEET');
  const [editWidth, setEditWidth] = useState<number>(1220);
  const [editHeight, setEditHeight] = useState<number>(2800);
  const [editThicknesses, setEditThicknesses] = useState<string[]>(['5', '8']);
  const [editTextureCategory, setEditTextureCategory] = useState<string>('WOOD');
  const [editReliefType, setEditReliefType] = useState<SlatProfileShape>('FLAT');
  const [editDecors, setEditDecors] = useState<AllWallDecor[]>([]);
  const [editNewColorCode, setEditNewColorCode] = useState('');
  const [editNewColorHex, setEditNewColorHex] = useState('#a0784a');
  const [editNewColorName, setEditNewColorName] = useState('');

  // Состояние удаления панели с подтверждением
  const [deletingModel, setDeletingModel] = useState<AllWallPanelModel | null>(null);

  const selectedWall = project.walls.find((w) => w.id === project.selectedWallId);

  // Список всех доступных моделей, строящийся напрямую из материалов проекта
  const allModels: AllWallPanelModel[] = useMemo(() => {
    return project.materials
      .filter((m) => !m.isVoid && m.type !== 'NONE')
      .map((m) => {
        const decors =
          m.availableDecors && m.availableDecors.length > 0
            ? m.availableDecors
            : [
                {
                  code: m.decorCode || '001',
                  name: m.decorName || m.name,
                  color: m.color,
                  category: (m.textureCategory as any) || 'WOOD',
                },
              ];

        return {
          id: m.id,
          name: m.name,
          category: (m.type as 'SHEET' | 'SLAT' | 'HQ') || 'SHEET',
          width: m.width,
          height: m.height,
          thicknessOptions:
            m.thicknessOptions && m.thicknessOptions.length > 0
              ? m.thicknessOptions
              : [m.thickness],
          defaultThickness: m.thickness,
          reliefType: m.reliefType || 'FLAT',
          textureCategory: (m.textureCategory as any) || 'WOOD',
          decors,
          description: m.isCustom ? 'Пользовательская панель' : 'Модель AllWall',
          url: '',
          isCustom: m.isCustom ?? false,
        };
      });
  }, [project.materials]);

  // Фильтрация по поисковому запросу и вкладке
  const filteredModels = useMemo(() => {
    return allModels.filter((model) => {
      const matchesTab = model.category === activeTab;
      if (!searchQuery.trim()) return matchesTab;

      const q = searchQuery.toLowerCase().trim();
      const matchesName = model.name.toLowerCase().includes(q);
      const matchesDescription = model.description.toLowerCase().includes(q);
      const matchesDecorCode = model.decors.some(
        (d) => d.code.toLowerCase().includes(q) || d.name.toLowerCase().includes(q)
      );

      return (matchesName || matchesDescription || matchesDecorCode) && (matchesTab || searchQuery.length > 2);
    });
  }, [allModels, activeTab, searchQuery]);

  const handleApplyToWall = (model: AllWallPanelModel) => {
    if (!selectedWall) return;
    setWallMaterial(selectedWall.id, model.id);
    onClose();
  };

  const handleAddCustomColor = () => {
    if (!newColorHex) return;
    setCustomColorsList((prev) => [
      ...prev,
      {
        code: newColorCode || `DEC-${prev.length + 1}`,
        color: newColorHex,
        name: newColorName || `Цвет ${prev.length + 1}`,
      },
    ]);
    setNewColorCode('');
  };

  const handleSaveCustomPanel = () => {
    if (!customName.trim()) return;

    const parsedThicknesses = customThicknesses.map((t) => Number(t)).filter((t) => !isNaN(t) && t > 0);
    const defThick = parsedThicknesses[0] || 5;

    const newMat: Material = {
      id: `custom-mat-${Date.now()}`,
      name: customName.trim(),
      type: customCategory,
      width: customWidth,
      height: customHeight,
      thickness: defThick,
      thicknessOptions: parsedThicknesses,
      color: customColorsList[0]?.color || '#d6cbbe',
      decorCode: customColorsList[0]?.code || '001',
      decorName: customColorsList[0]?.name || customName,
      reliefType: customReliefType,
      textureCategory: customTextureCategory as any,
      isCustom: true,
      availableDecors: customColorsList.map((c) => ({
        code: c.code,
        name: c.name,
        color: c.color,
        category: customTextureCategory as any,
      })),
    };

    addCustomCatalogPanel(newMat);
    setIsCreatingCustom(false);
    setCustomName('');
  };

  const handleStartEdit = (model: AllWallPanelModel) => {
    setEditingModel(model);
    setEditName(model.name);
    setEditCategory(model.category);
    setEditWidth(model.width);
    setEditHeight(model.height);
    setEditThicknesses(model.thicknessOptions.map(String));
    setEditTextureCategory(model.textureCategory);
    setEditReliefType(model.reliefType);
    setEditDecors([...model.decors]);
    setEditNewColorCode('');
    setEditNewColorName('');
  };

  const handleAddEditColor = () => {
    if (!editNewColorHex) return;
    setEditDecors((prev) => [
      ...prev,
      {
        code: editNewColorCode.trim() || `DEC-${prev.length + 1}`,
        color: editNewColorHex,
        name: editNewColorName.trim() || `Цвет ${prev.length + 1}`,
        category: editTextureCategory as any,
      },
    ]);
    setEditNewColorCode('');
    setEditNewColorName('');
  };

  const handleSaveEditedPanel = () => {
    if (!editingModel || !editName.trim()) return;

    const parsedThicknesses = editThicknesses
      .map((t) => Number(t))
      .filter((t) => !isNaN(t) && t > 0);
    const defThick = parsedThicknesses[0] || 5;

    const updates: Partial<Material> = {
      name: editName.trim(),
      type: editCategory,
      width: editWidth,
      height: editHeight,
      thickness: defThick,
      thicknessOptions: parsedThicknesses,
      reliefType: editReliefType,
      textureCategory: editTextureCategory as any,
      availableDecors: editDecors,
      color: editDecors[0]?.color || '#d6cbbe',
      decorCode: editDecors[0]?.code || '001',
      decorName: editDecors[0]?.name || editName,
    };

    updateCatalogPanel(editingModel.id, updates);
    setEditingModel(null);
  };

  return (
    <>
      <Modal
        opened={opened}
        onClose={onClose}
        title={
          <Group gap="sm">
            <Layers size={22} color="#339af0" />
            <div>
              <Text fw={700} size="lg">
                Каталог стеновых панелей и декоров AllWall
              </Text>
              <Text size="xs" c="dimmed">
                Официальные модели allwall.by: размеры, толщины, формы реек и заводские коды декоров
              </Text>
            </div>
          </Group>
        }
        size="90%"
        styles={{
          content: { backgroundColor: '#141517', border: '1px solid #2C2E33' },
          header: { backgroundColor: '#1A1B1E', borderBottom: '1px solid #2C2E33' },
          body: { padding: '16px' },
        }}
      >
        <Stack gap="md">
          {/* Верхняя панель управления: Поиск и переключатель создания */}
          <Group justify="space-between" align="center">
            <TextInput
              placeholder="🔍 Поиск по названию или коду декора (например: 7029, 5134, GW90, RY8056)..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.currentTarget.value)}
              style={{ flex: 1, maxWidth: 500 }}
              leftSection={<Search size={16} />}
              styles={{ input: { backgroundColor: '#1A1B1E', borderColor: '#2C2E33' } }}
            />

            <Button
              leftSection={<Plus size={16} />}
              variant={isCreatingCustom ? 'filled' : 'light'}
              color="blue"
              onClick={() => setIsCreatingCustom(!isCreatingCustom)}
            >
              {isCreatingCustom ? 'Закрыть конструктор' : 'Создать свою панель'}
            </Button>
          </Group>

          {/* Форма создания своей панели */}
          {isCreatingCustom && (
            <Paper p="md" radius="md" style={{ backgroundColor: '#1A1B1E', border: '1px solid #339af0' }}>
              <Stack gap="sm">
                <Group justify="space-between">
                  <Text fw={600} size="sm" c="blue.4">
                    Конструктор новой панели с индивидуальными характеристиками
                  </Text>
                  <Badge color="blue">Пользовательский шаблон</Badge>
                </Group>

                <SimpleGrid cols={{ base: 1, sm: 3 }} spacing="sm">
                  <TextInput
                    label="Название панели"
                    placeholder="Например: Стеновая панель Дуб Премиум"
                    value={customName}
                    onChange={(e) => setCustomName(e.currentTarget.value)}
                    required
                  />
                  <Select
                    label="Категория"
                    value={customCategory}
                    onChange={(v) => setCustomCategory((v as any) || 'SHEET')}
                    data={[
                      { value: 'SHEET', label: 'Сплошная панель' },
                      { value: 'SLAT', label: 'Реечная панель' },
                      { value: 'HQ', label: 'HQ-панель (высокий глянец)' },
                    ]}
                  />
                  <Select
                    label="Фактура / Текстура"
                    value={customTextureCategory}
                    onChange={(v) => setCustomTextureCategory(v || 'WOOD')}
                    data={[
                      { value: 'WOOD', label: '🪵 Дерево / Шпон' },
                      { value: 'FABRIC', label: '🧵 Ткань / Лен / Рогожка' },
                      { value: 'STONE', label: '🪨 Камень / Бетон' },
                      { value: 'MIRROR', label: '🪞 Зеркало / Глянец' },
                      { value: 'METAL', label: '🪙 Металл / Брашинг' },
                      { value: 'SOFT_TOUCH', label: '✨ Soft Touch / Кожа' },
                      { value: 'MARBLE_HQ', label: '🏛️ Мрамор HQ' },
                      { value: 'GOLD_HQ', label: '👑 Золото HQ' },
                    ]}
                  />
                </SimpleGrid>

                <SimpleGrid cols={{ base: 1, sm: 4 }} spacing="sm">
                  <NumberInput
                    label="Ширина (мм)"
                    value={customWidth}
                    onChange={(v) => setCustomWidth(Number(v) || 1220)}
                    min={50}
                    max={6000}
                  />
                  <NumberInput
                    label="Высота (мм)"
                    value={customHeight}
                    onChange={(v) => setCustomHeight(Number(v) || 2800)}
                    min={100}
                    max={6000}
                  />
                  <MultiSelect
                    label="Доступные толщины (мм)"
                    data={['5', '8', '9', '10', '11', '12', '14', '15', '16', '17', '18', '22', '25']}
                    value={customThicknesses}
                    onChange={setCustomThicknesses}
                  />
                  <Select
                    label="Форма 3D-рельефа"
                    value={customReliefType}
                    onChange={(v) => setCustomReliefType((v as any) || 'FLAT')}
                    data={[
                      { value: 'FLAT', label: 'Плоская плита' },
                      { value: 'WAVE_GW90', label: 'Волна (Гофре GW90)' },
                      { value: 'CONCAVE_GW30', label: 'Желоб + Рейки (GW30)' },
                      { value: 'STEP_SLAT', label: 'Прямоугольные рейки' },
                    ]}
                  />
                </SimpleGrid>

                {/* Настройка списка цветов для панели */}
                <Divider my="xs" label="Цвета и декоры для этой панели" labelPosition="center" />
                <Group align="flex-end" gap="sm">
                  <TextInput
                    label="Код декора"
                    placeholder="7001"
                    value={newColorCode}
                    onChange={(e) => setNewColorCode(e.currentTarget.value)}
                    style={{ width: 110 }}
                  />
                  <TextInput
                    label="Название цвета"
                    placeholder="Светлый беж"
                    value={newColorName}
                    onChange={(e) => setNewColorName(e.currentTarget.value)}
                    style={{ flex: 1 }}
                  />
                  <ColorInput
                    label="Цвет (HEX)"
                    placeholder="#a0784a"
                    value={newColorHex}
                    onChange={setNewColorHex}
                    format="hex"
                    style={{ width: 140 }}
                  />

                  <Button variant="light" color="teal" onClick={handleAddCustomColor}>
                    + Добавить цвет
                  </Button>
                </Group>

                {/* Список добавленных цветов */}
                <Group gap="xs" mt={4}>
                  {customColorsList.map((c, idx) => (
                    <Badge
                      key={idx}
                      variant="filled"
                      style={{ backgroundColor: '#25262B', color: '#E9ECEF', textTransform: 'none' }}
                      leftSection={<ColorSwatch color={c.color} size={10} />}
                      rightSection={
                        customColorsList.length > 1 ? (
                          <ActionIcon
                            size="xs"
                            color="red"
                            variant="subtle"
                            onClick={() => setCustomColorsList(customColorsList.filter((_, i) => i !== idx))}
                          >
                            <Trash2 size={10} />
                          </ActionIcon>
                        ) : undefined
                      }
                    >
                      <strong>{c.code}</strong>: {c.name}
                    </Badge>
                  ))}
                </Group>

                <Group justify="flex-end" mt="sm">
                  <Button variant="default" onClick={() => setIsCreatingCustom(false)}>
                    Отмена
                  </Button>
                  <Button color="blue" onClick={handleSaveCustomPanel}>
                    Сохранить панель в каталог
                  </Button>
                </Group>
              </Stack>
            </Paper>
          )}

          {/* Вкладки типов панелей */}
          <Tabs value={activeTab} onChange={setActiveTab} variant="outline" radius="md">
            <Tabs.List style={{ borderColor: '#2C2E33' }}>
              <Tabs.Tab value="SHEET" leftSection={<Layers size={16} />}>
                1. Сплошные панели AllWall ({allModels.filter((m) => m.category === 'SHEET').length})
              </Tabs.Tab>
              <Tabs.Tab value="SLAT" leftSection={<Sliders size={16} />}>
                2. Реечные панели GW10–GW99 ({allModels.filter((m) => m.category === 'SLAT').length})
              </Tabs.Tab>
              <Tabs.Tab value="HQ" leftSection={<Sparkles size={16} />}>
                3. HQ-панели (Глянец & Золото) ({allModels.filter((m) => m.category === 'HQ').length})
              </Tabs.Tab>
            </Tabs.List>
          </Tabs>

          {/* Сетка карточек панелей */}
          <ScrollArea h={560} offsetScrollbars>
            <SimpleGrid cols={{ base: 1, md: 2, lg: 3 }} spacing="md" p="xs">
              {filteredModels.map((model) => {
                const activeDecor = selectedDecorByModel[model.id] || model.decors[0];
                const isCurrentWallMaterial = selectedWall?.zone.materialId === model.id;

                return (
                  <Card
                    key={model.id}
                    padding="md"
                    radius="md"
                    style={{
                      backgroundColor: '#1A1B1E',
                      border: isCurrentWallMaterial ? '2px solid #339af0' : '1px solid #2C2E33',
                      display: 'flex',
                      flexDirection: 'column',
                      justifyContent: 'space-between',
                    }}
                  >
                    <div>
                      <Group justify="space-between" align="flex-start" mb="xs">
                        <div style={{ flex: 1 }}>
                          <Text fw={700} size="sm" c="gray.1">
                            {model.name}
                          </Text>
                          <Text size="xs" c="dimmed">
                            {model.width} × {model.height} мм | Толщины:{' '}
                            <strong style={{ color: '#74C0FC' }}>
                              {model.thicknessOptions.join(', ')} мм
                            </strong>
                          </Text>
                        </div>

                        <Group gap={4}>
                          <Tooltip label="Редактировать параметры панели">
                            <ActionIcon
                              size="sm"
                              color="blue"
                              variant="subtle"
                              onClick={() => handleStartEdit(model)}
                            >
                              <Edit3 size={15} />
                            </ActionIcon>
                          </Tooltip>

                          <Tooltip label="Удалить панель из каталога">
                            <ActionIcon
                              size="sm"
                              color="red"
                              variant="subtle"
                              onClick={() => setDeletingModel(model)}
                            >
                              <Trash2 size={15} />
                            </ActionIcon>
                          </Tooltip>
                        </Group>
                      </Group>

                      <Text size="xs" c="gray.4" mb="sm" lineClamp={2}>
                        {model.description}
                      </Text>

                      {/* Выбранный декор и его код */}
                      {activeDecor && (
                        <Paper p="xs" mb="xs" radius="sm" style={{ backgroundColor: '#25262B' }}>
                          <Group justify="space-between" align="center">
                            <Group gap="xs">
                              <ColorSwatch color={activeDecor.color} size={20} />
                              <div>
                                <Group gap={4}>
                                  <Badge
                                    size="xs"
                                    color="dark"
                                    style={{ backgroundColor: '#000', color: '#fff' }}
                                  >
                                    {activeDecor.code}
                                  </Badge>
                                  <Text size="xs" fw={600}>
                                    {activeDecor.name}
                                  </Text>
                                </Group>
                              </div>
                            </Group>
                            <Text size="xs" c="dimmed">
                              {activeDecor.color}
                            </Text>
                          </Group>
                        </Paper>
                      )}

                      {/* Линейка свотчей с заводскими кодами AllWall */}
                      <Text size="xs" c="dimmed" mb={4}>
                        Доступные декоры ({model.decors.length} шт):
                      </Text>
                      <Group gap={6} mb="md" style={{ flexWrap: 'wrap' }}>
                        {model.decors.slice(0, 14).map((decor) => {
                          const isSelected = activeDecor?.code === decor.code;
                          return (
                            <Tooltip
                              key={decor.code}
                              label={
                                <div style={{ textAlign: 'center' }}>
                                  <Badge size="xs" color="dark" style={{ backgroundColor: '#000', color: '#fff' }}>
                                    {decor.code}
                                  </Badge>
                                  <div style={{ fontSize: 11, marginTop: 2 }}>{decor.name}</div>
                                </div>
                              }
                              withArrow
                            >
                              <div
                                onClick={() =>
                                  setSelectedDecorByModel((prev) => ({
                                    ...prev,
                                    [model.id]: decor,
                                  }))
                                }
                                style={{
                                  cursor: 'pointer',
                                  padding: 2,
                                  borderRadius: '50%',
                                  border: isSelected ? '2px solid #339af0' : '2px solid transparent',
                                  transform: isSelected ? 'scale(1.15)' : 'scale(1)',
                                  transition: 'all 0.15s ease',
                                }}
                              >
                                <ColorSwatch color={decor.color} size={18} />
                              </div>
                            </Tooltip>
                          );
                        })}
                        {model.decors.length > 14 && (
                          <Text size="xs" c="dimmed">
                            +{model.decors.length - 14}
                          </Text>
                        )}
                      </Group>
                    </div>

                    {/* Нижние действия */}
                    <Group justify="space-between" mt="sm">
                      {model.url ? (
                        <Button
                          component="a"
                          href={model.url}
                          target="_blank"
                          size="xs"
                          variant="subtle"
                          color="gray"
                          leftSection={<ExternalLink size={12} />}
                        >
                          allwall.by
                        </Button>
                      ) : (
                        <div />
                      )}

                      <Button
                        size="xs"
                        color="blue"
                        variant={isCurrentWallMaterial ? 'filled' : 'light'}
                        leftSection={isCurrentWallMaterial ? <Check size={14} /> : <Eye size={14} />}
                        onClick={() => handleApplyToWall(model)}
                      >
                        {isCurrentWallMaterial ? 'Выбрано на стене' : 'Применить к стене'}
                      </Button>
                    </Group>
                  </Card>
                );
              })}
            </SimpleGrid>
          </ScrollArea>
        </Stack>
      </Modal>

      {/* Модальное окно редактирования панели */}
      <Modal
        opened={editingModel !== null}
        onClose={() => setEditingModel(null)}
        title={
          <Group gap="sm">
            <Edit3 size={20} color="#339af0" />
            <Text fw={700}>Редактирование панели: {editingModel?.name}</Text>
          </Group>
        }
        size="lg"
        centered
        styles={{
          content: { backgroundColor: '#141517', border: '1px solid #2C2E33' },
          header: { backgroundColor: '#1A1B1E', borderBottom: '1px solid #2C2E33' },
          body: { padding: '16px' },
        }}
      >
        {editingModel && (
          <Stack gap="md">
            <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="sm">
              <TextInput
                label="Название модели"
                value={editName}
                onChange={(e) => setEditName(e.currentTarget.value)}
                required
              />
              <Select
                label="Категория"
                value={editCategory}
                onChange={(v) => setEditCategory((v as any) || 'SHEET')}
                data={[
                  { value: 'SHEET', label: 'Сплошная панель' },
                  { value: 'SLAT', label: 'Реечная панель' },
                  { value: 'HQ', label: 'HQ-панель (высокий глянец)' },
                ]}
              />
            </SimpleGrid>

            <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="sm">
              <NumberInput
                label="Ширина (мм)"
                value={editWidth}
                onChange={(v) => setEditWidth(Number(v) || 1220)}
                min={50}
                max={10000}
              />
              <NumberInput
                label="Высота (мм)"
                value={editHeight}
                onChange={(v) => setEditHeight(Number(v) || 2800)}
                min={50}
                max={10000}
              />
            </SimpleGrid>

            <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="sm">
              <MultiSelect
                label="Доступные толщины (мм)"
                data={['5', '8', '9', '10', '11', '12', '14', '15', '16', '17', '18', '22', '25']}
                value={editThicknesses}
                onChange={setEditThicknesses}
              />
              <Select
                label="Фактура / Текстура"
                value={editTextureCategory}
                onChange={(v) => setEditTextureCategory(v || 'WOOD')}
                data={[
                  { value: 'WOOD', label: '🪵 Дерево / Шпон' },
                  { value: 'FABRIC', label: '🧵 Ткань / Лен / Рогожка' },
                  { value: 'STONE', label: '🪨 Камень / Бетон' },
                  { value: 'MIRROR', label: '🪞 Зеркало / Глянец' },
                  { value: 'METAL', label: '🪙 Металл / Брашинг' },
                  { value: 'SOFT_TOUCH', label: '✨ Soft Touch / Кожа' },
                  { value: 'MARBLE_HQ', label: '🏛️ Мрамор HQ' },
                  { value: 'GOLD_HQ', label: '👑 Золото HQ' },
                ]}
              />
            </SimpleGrid>

            <Select
              label="Форма 3D-рельефа"
              value={editReliefType}
              onChange={(v) => setEditReliefType((v as any) || 'FLAT')}
              data={[
                { value: 'FLAT', label: 'Плоская плита' },
                { value: 'WAVE_GW90', label: 'Волна (Гофре GW90)' },
                { value: 'CONCAVE_GW30', label: 'Желоб + Рейки (GW30)' },
                { value: 'STEP_SLAT', label: 'Прямоугольные рейки' },
              ]}
            />

            {/* Редактирование декоров панели */}
            <Divider my="xs" label={`Декоры и цвета (${editDecors.length} шт)`} labelPosition="center" />
            <Group align="flex-end" gap="sm">
              <TextInput
                label="Код"
                placeholder="7001"
                value={editNewColorCode}
                onChange={(e) => setEditNewColorCode(e.currentTarget.value)}
                style={{ width: 100 }}
              />
              <TextInput
                label="Название декора"
                placeholder="Новый декор"
                value={editNewColorName}
                onChange={(e) => setEditNewColorName(e.currentTarget.value)}
                style={{ flex: 1 }}
              />
              <ColorInput
                label="Цвет (HEX)"
                placeholder="#a0784a"
                value={editNewColorHex}
                onChange={setEditNewColorHex}
                format="hex"
                style={{ width: 140 }}
              />

              <Button variant="light" color="teal" onClick={handleAddEditColor}>
                + Добавить декор
              </Button>
            </Group>

            <ScrollArea h={120} offsetScrollbars>
              <Group gap="xs" p="xs">
                {editDecors.map((d, idx) => (
                  <Badge
                    key={`${d.code}-${idx}`}
                    variant="filled"
                    style={{ backgroundColor: '#25262B', color: '#E9ECEF', textTransform: 'none' }}
                    leftSection={<ColorSwatch color={d.color} size={10} />}
                    rightSection={
                      editDecors.length > 1 ? (
                        <ActionIcon
                          size="xs"
                          color="red"
                          variant="subtle"
                          onClick={() => setEditDecors(editDecors.filter((_, i) => i !== idx))}
                        >
                          <Trash2 size={10} />
                        </ActionIcon>
                      ) : undefined
                    }
                  >
                    <strong>{d.code}</strong>: {d.name}
                  </Badge>
                ))}
              </Group>
            </ScrollArea>

            <Group justify="flex-end" gap="xs" mt="md">
              <Button variant="default" onClick={() => setEditingModel(null)}>
                Отмена
              </Button>
              <Button color="blue" onClick={handleSaveEditedPanel}>
                Сохранить изменения
              </Button>
            </Group>
          </Stack>
        )}
      </Modal>

      {/* Модальное окно подтверждения удаления */}
      <Modal
        opened={deletingModel !== null}
        onClose={() => setDeletingModel(null)}
        title={
          <Group gap="xs">
            <AlertTriangle color="#fa5252" size={20} />
            <Text fw={700}>Подтверждение удаления панели</Text>
          </Group>
        }
        centered
        size="md"
        styles={{
          content: { backgroundColor: '#141517', border: '1px solid #2C2E33' },
          header: { backgroundColor: '#1A1B1E', borderBottom: '1px solid #2C2E33' },
        }}
      >
        <Stack gap="md">
          <Text size="sm">
            Вы действительно хотите удалить панель <strong>«{deletingModel?.name}»</strong> (
            {deletingModel?.width} × {deletingModel?.height} мм) из каталога?
          </Text>
          <Alert color="red" variant="light" icon={<AlertTriangle size={16} />}>
            Модель будет удалена из каталога материалов текущего проекта.
          </Alert>
          <Group justify="flex-end" gap="xs">
            <Button variant="default" onClick={() => setDeletingModel(null)}>
              Отмена
            </Button>
            <Button
              color="red"
              onClick={() => {
                if (deletingModel) {
                  deleteCatalogPanel(deletingModel.id);
                  setDeletingModel(null);
                }
              }}
            >
              Удалить панель
            </Button>
          </Group>
        </Stack>
      </Modal>
    </>
  );
};
