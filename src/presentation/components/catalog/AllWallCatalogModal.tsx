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
  Box,
} from '@mantine/core';
import {
  Layers,
  ExternalLink,
  Check,
  Trash2,
  Eye,
  Edit3,
  AlertTriangle,
  Columns2,
  Zap,
} from 'lucide-react';
import { useProjectStore } from '../../../application/stores/useProjectStore';
import {
  AllWallPanelModel,
  AllWallDecor,
  SlatProfileShape,
} from '../../../core/models/AllWallCatalog';
import {
  ALLWALL_PROFILES_CATALOG,
  AllWallProfileItem,
} from '../../../core/models/Profile';
import { Material } from '../../../core/models/Material';
import { useAppTheme } from '../../theme/useAppTheme';

interface AllWallCatalogModalProps {
  opened: boolean;
  onClose: () => void;
}

export const AllWallCatalogModal: React.FC<AllWallCatalogModalProps> = ({ opened, onClose }) => {
  const t = useAppTheme();
  const {
    project,
    selectedJointId,
    selectedJointIds,
    setWallMaterial,
    updateCatalogPanel,
    deleteCatalogPanel,
    setJointProfile,
    setJointProfileForSelected,
  } = useProjectStore();

  const [activeTab, setActiveTab] = useState<string | null>('PANELS');
  const [panelCategoryFilter, setPanelCategoryFilter] = useState<string>('ALL');
  const [panelThicknessFilter, setPanelThicknessFilter] = useState<string>('ALL');
  const [selectedDecorByModel, setSelectedDecorByModel] = useState<Record<string, AllWallDecor>>({});
  const [profileRoleFilter, setProfileRoleFilter] = useState<string>('ALL');
  const [profileThicknessFilter, setProfileThicknessFilter] = useState<string>('ALL');

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

  // Фильтрация панелей AllWall по категории и толщине
  const filteredModels = useMemo(() => {
    return allModels.filter((model) => {
      if (panelCategoryFilter !== 'ALL' && model.category !== panelCategoryFilter) {
        return false;
      }
      if (panelThicknessFilter !== 'ALL') {
        const targetThick = Number(panelThicknessFilter);
        if (targetThick === 15) {
          if (!model.thicknessOptions.some((t) => t >= 15)) return false;
        } else {
          if (!model.thicknessOptions.includes(targetThick)) return false;
        }
      }
      return true;
    });
  }, [allModels, panelCategoryFilter, panelThicknessFilter]);

  // Фильтрация профилей AllWall по роли и толщине
  const filteredProfiles = useMemo(() => {
    return ALLWALL_PROFILES_CATALOG.filter((p) => {
      const matchesRole = profileRoleFilter === 'ALL' || p.functionalRole === profileRoleFilter;
      const matchesThickness =
        profileThicknessFilter === 'ALL' ||
        p.allowedThicknesses.includes(Number(profileThicknessFilter));

      return matchesRole && matchesThickness;
    });
  }, [profileRoleFilter, profileThicknessFilter]);

  const handleApplyProfileToJoint = (profile: AllWallProfileItem) => {
    if (!selectedWall) return;
    if (selectedJointIds && selectedJointIds.length > 1) {
      setJointProfileForSelected(selectedWall.id, profile.article, profile.defaultColorHex);
    } else if (selectedJointId) {
      setJointProfile(selectedWall.id, selectedJointId, profile.article, profile.defaultColorHex);
    }
    onClose();
  };

  const handleApplyToWall = (model: AllWallPanelModel, decorToApply?: AllWallDecor) => {
    if (!selectedWall) return;
    const currentProjectMat = project.materials.find((m) => m.id === model.id);
    const activeDecor =
      decorToApply ||
      selectedDecorByModel[model.id] ||
      model.decors.find((d) => d.code === currentProjectMat?.decorCode) ||
      model.decors.find((d) => d.color.toLowerCase() === currentProjectMat?.color?.toLowerCase()) ||
      model.decors[0];

    setWallMaterial(selectedWall.id, model.id, activeDecor);
    onClose();
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
        centered
        styles={{
          content: {
            backgroundColor: t.bgApp,
            border: `1px solid ${t.border}`,
            height: '90vh',
            maxHeight: '90vh',
            display: 'flex',
            flexDirection: 'column',
            overflow: 'hidden',
          },
          header: {
            backgroundColor: t.bgHeader,
            borderBottom: `1px solid ${t.border}`,
            flexShrink: 0,
          },
          body: {
            padding: '16px',
            flex: 1,
            display: 'flex',
            flexDirection: 'column',
            overflow: 'hidden',
            minHeight: 0,
          },
        }}
      >
        <Stack gap="md" style={{ flex: 1, height: '100%', minHeight: 0, overflow: 'hidden' }}>
          {/* Вкладки каталога: 1. Стеновые панели AllWall, 2. Профили и фурнитура */}
          <Box style={{ flexShrink: 0 }}>
            <Tabs value={activeTab} onChange={setActiveTab} variant="outline" radius="md">
              <Tabs.List style={{ borderColor: t.border }}>
                <Tabs.Tab value="PANELS" leftSection={<Layers size={16} />}>
                  1. Стеновые панели AllWall ({allModels.length})
                </Tabs.Tab>
                <Tabs.Tab value="PROFILES" leftSection={<Columns2 size={16} />}>
                  2. Профили и фурнитура ({ALLWALL_PROFILES_CATALOG.length})
                </Tabs.Tab>
              </Tabs.List>
            </Tabs>
          </Box>

          {/* Фильтры для вкладки Панелей */}
          {activeTab === 'PANELS' && (
            <Box style={{ flexShrink: 0 }}>
              <Paper p="xs" radius="md" style={{ backgroundColor: t.bgCard, border: `1px solid ${t.border}` }}>
                <Stack gap="xs">
                  <Group justify="space-between" align="center" style={{ flexWrap: 'wrap' }}>
                    <Group gap={6}>
                      <Text size="xs" fw={600} c="dimmed">
                        Категория панелей:
                      </Text>
                      {[
                        { value: 'ALL', label: `Все (${allModels.length})` },
                        {
                          value: 'SHEET',
                          label: `📄 Сплошные (${allModels.filter((m) => m.category === 'SHEET').length})`,
                        },
                        {
                          value: 'SLAT',
                          label: `🪵 Реечные GW (${allModels.filter((m) => m.category === 'SLAT').length})`,
                        },
                        {
                          value: 'HQ',
                          label: `✨ HQ Мрамор & Золото (${allModels.filter((m) => m.category === 'HQ').length})`,
                        },
                      ].map((f) => (
                        <Button
                          key={f.value}
                          size="compact-xs"
                          variant={panelCategoryFilter === f.value ? 'filled' : 'subtle'}
                          color={f.value === 'HQ' ? 'yellow' : f.value === 'SLAT' ? 'teal' : 'blue'}
                          onClick={() => setPanelCategoryFilter(f.value)}
                        >
                          {f.label}
                        </Button>
                      ))}
                    </Group>

                    <Group gap={6}>
                      <Text size="xs" fw={600} c="dimmed">
                        Толщина:
                      </Text>
                      {[
                        { value: 'ALL', label: 'Все толщины' },
                        { value: '5', label: '5 мм' },
                        { value: '8', label: '8 мм' },
                        { value: '15', label: '15+ мм (рейки)' },
                      ].map((t) => (
                        <Button
                          key={t.value}
                          size="compact-xs"
                          variant={panelThicknessFilter === t.value ? 'filled' : 'subtle'}
                          color="cyan"
                          onClick={() => setPanelThicknessFilter(t.value)}
                        >
                          {t.label}
                        </Button>
                      ))}
                    </Group>
                  </Group>
                </Stack>
              </Paper>
            </Box>
          )}

          {/* Фильтры для вкладки Профилей */}
          {activeTab === 'PROFILES' && (
            <Box style={{ flexShrink: 0 }}>
              <Paper p="xs" radius="md" style={{ backgroundColor: t.bgCard, border: `1px solid ${t.border}` }}>
                <Stack gap="xs">
                  <Group justify="space-between" align="center" style={{ flexWrap: 'wrap' }}>
                    <Group gap={6}>
                      <Text size="xs" fw={600} c="dimmed">
                        Назначение профиля:
                      </Text>
                      {[
                        { value: 'ALL', label: `Все (${ALLWALL_PROFILES_CATALOG.length})` },
                        { value: 'LED', label: '💡 LED (10 мм)' },
                        { value: 'JOINT', label: '🔗 Соединительные' },
                        { value: 'END', label: '🏁 Торцевые' },
                        { value: 'CORNER', label: '📐 Угловые' },
                        { value: 'BASEBOARD', label: '🔲 Плинтусы' },
                        { value: 'SHADOW', label: '🌑 Теневые' },
                      ].map((f) => (
                        <Button
                          key={f.value}
                          size="compact-xs"
                          variant={profileRoleFilter === f.value ? 'filled' : 'subtle'}
                          color={f.value === 'LED' ? 'yellow' : 'blue'}
                          onClick={() => setProfileRoleFilter(f.value)}
                        >
                          {f.label}
                        </Button>
                      ))}
                    </Group>

                    <Group gap={6}>
                      <Text size="xs" fw={600} c="dimmed">
                        Толщина плит:
                      </Text>
                      {[
                        { value: 'ALL', label: 'Все толщины' },
                        { value: '5', label: '5 мм' },
                        { value: '8', label: '8 мм' },
                      ].map((tVal) => (
                        <Button
                          key={tVal.value}
                          size="compact-xs"
                          variant={profileThicknessFilter === tVal.value ? 'filled' : 'subtle'}
                          color="cyan"
                          onClick={() => setProfileThicknessFilter(tVal.value)}
                        >
                          {tVal.label}
                        </Button>
                      ))}
                    </Group>
                  </Group>
                </Stack>
              </Paper>
            </Box>
          )}

          {/* Сетка карточек: Профили ИЛИ Панели */}
          <ScrollArea style={{ flex: 1, minHeight: 0 }} offsetScrollbars scrollbars="y">
            {activeTab === 'PROFILES' ? (
              <SimpleGrid cols={{ base: 1, md: 2, lg: 3 }} spacing="md" p="xs">
                {filteredProfiles.map((prof) => {
                  const hasJointSelected = Boolean(
                    selectedJointId || (selectedJointIds && selectedJointIds.length > 0)
                  );

                  return (
                    <Card
                      key={prof.article}
                      padding="md"
                      radius="md"
                      style={{
                        backgroundColor: t.bgCard,
                        border: prof.isLEDCompatible ? '1px solid #fab005' : `1px solid ${t.border}`,
                        display: 'flex',
                        flexDirection: 'column',
                        justifyContent: 'space-between',
                      }}
                    >
                      <div>
                        <Group justify="space-between" align="flex-start" mb="xs">
                          <div>
                            <Group gap={6} mb={4}>
                              <Badge
                                size="sm"
                                color={prof.isLEDCompatible ? 'yellow' : 'blue'}
                                variant="filled"
                              >
                                {prof.article}
                              </Badge>
                              <Badge size="xs" color="gray" variant="outline">
                                Хлыст {prof.stockLength} мм
                              </Badge>
                            </Group>
                            <Text fw={700} size="sm" c={t.textPrimary}>
                              {prof.name}
                            </Text>
                          </div>
                        </Group>

                        <Text size="xs" c={t.textDimmed} mb="sm">
                          {prof.description}
                        </Text>

                        {/* Характеристики профиля */}
                        <Group gap={6} mb="sm" style={{ flexWrap: 'wrap' }}>
                          <Badge size="xs" variant="outline" color="cyan">
                            📏 Видимая ширина: {prof.visibleWidth} мм
                          </Badge>
                          {prof.metalThickness && (
                            <Badge size="xs" variant="outline" color="indigo">
                              🛡️ Толщина металла: {prof.metalThickness.toLocaleString('ru-RU')} мм
                            </Badge>
                          )}
                          <Badge size="xs" variant="outline" color="teal">
                            📐 Панели: {prof.allowedThicknesses.join(' / ')} мм
                          </Badge>
                          {prof.dimensionsNote && (
                            <Badge size="xs" variant="outline" color="grape">
                              📦 {prof.dimensionsNote}
                            </Badge>
                          )}
                          {prof.isLEDCompatible && (
                            <Badge size="xs" color="yellow" variant="light" leftSection={<Zap size={10} />}>
                              Паз 10 мм под RGB ленту
                            </Badge>
                          )}
                        </Group>

                        {/* Цвета профиля AllWall */}
                        <Text size="xs" c="dimmed" mb={4}>
                          Доступные цвета отделки ({prof.availableColors.length}):
                        </Text>
                        <Group gap="xs" mb="sm">
                          {prof.availableColors.map((c) => (
                            <Tooltip key={c.code} label={c.name} withArrow>
                              <Group gap={4}>
                                <ColorSwatch color={c.hex} size={16} />
                                <Text size="xs" c="dimmed">
                                  {c.name}
                                </Text>
                              </Group>
                            </Tooltip>
                          ))}
                        </Group>
                      </div>

                      {/* Нижние действия */}
                      <Group justify="space-between" mt="sm">
                        <Badge size="xs" color="dark" variant="filled">
                          AllWall Original
                        </Badge>

                        {hasJointSelected ? (
                          <Button
                            size="xs"
                            color={prof.isLEDCompatible ? 'yellow' : 'blue'}
                            variant="filled"
                            leftSection={<Check size={14} />}
                            onClick={() => handleApplyProfileToJoint(prof)}
                          >
                            Применить к шву
                          </Button>
                        ) : (
                          <Badge size="xs" color="blue" variant="light">
                            Стандарт 3.0 м
                          </Badge>
                        )}
                      </Group>
                    </Card>
                  );
                })}
              </SimpleGrid>
            ) : (
              <SimpleGrid cols={{ base: 1, md: 2, lg: 3 }} spacing="md" p="xs">
                {filteredModels.map((model) => {
                  const currentProjectMat = project.materials.find((m) => m.id === model.id);
                  const isWallUsingThisModel = selectedWall?.zone.materialId === model.id;
                  const currentWallDecor = isWallUsingThisModel
                    ? model.decors.find((d) => d.code === currentProjectMat?.decorCode) ||
                      model.decors.find((d) => d.color.toLowerCase() === currentProjectMat?.color?.toLowerCase())
                    : undefined;
                  const activeDecor = selectedDecorByModel[model.id] || currentWallDecor || model.decors[0];
                  const isCurrentDecorApplied =
                    isWallUsingThisModel &&
                    (currentWallDecor
                      ? activeDecor?.code === currentWallDecor.code
                      : currentProjectMat?.decorCode
                      ? activeDecor?.code === currentProjectMat.decorCode
                      : true);

                  return (
                    <Card
                      key={model.id}
                      padding="md"
                      radius="md"
                      style={{
                        backgroundColor: t.bgCard,
                        border: isCurrentDecorApplied
                          ? '2px solid #339af0'
                          : isWallUsingThisModel
                          ? '2px dashed #339af0'
                          : `1px solid ${t.border}`,
                        display: 'flex',
                        flexDirection: 'column',
                        justifyContent: 'space-between',
                      }}
                    >
                      <div>
                        <Group justify="space-between" align="flex-start" mb="xs">
                          <div style={{ flex: 1 }}>
                            <Text fw={700} size="sm" c={t.textPrimary}>
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

                        <Text size="xs" c={t.textDimmed} mb="sm" lineClamp={2}>
                          {model.description}
                        </Text>

                        {/* Выбранный декор и его код */}
                        {activeDecor && (
                          <Paper p="xs" mb="xs" radius="sm" style={{ backgroundColor: t.bgCardSubtle }}>
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
                          variant={isCurrentDecorApplied ? 'filled' : 'light'}
                          leftSection={isCurrentDecorApplied ? <Check size={14} /> : <Eye size={14} />}
                          onClick={() => handleApplyToWall(model, activeDecor)}
                        >
                          {isCurrentDecorApplied ? 'Выбрано на стене' : 'Применить к стене'}
                        </Button>
                      </Group>
                    </Card>
                  );
                })}
              </SimpleGrid>
            )}
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
          content: { backgroundColor: t.bgCard, border: `1px solid ${t.border}` },
          header: { backgroundColor: t.bgHeader, borderBottom: `1px solid ${t.border}` },
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
                    style={{ backgroundColor: t.bgCardSubtle, color: t.textPrimary, textTransform: 'none' }}
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
          content: { backgroundColor: t.bgCard, border: `1px solid ${t.border}` },
          header: { backgroundColor: t.bgHeader, borderBottom: `1px solid ${t.border}` },
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
