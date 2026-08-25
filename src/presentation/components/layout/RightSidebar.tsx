import React, { useState } from 'react';
import {
  Stack,
  Title,
  NumberInput,
  TextInput,
  ColorInput,
  Select,
  SegmentedControl,
  Divider,
  ScrollArea,
  Text,
  Paper,
  Group,
  ColorSwatch,
  Badge,
  Button,
  ActionIcon,
  Tooltip,
  Switch,
  Alert,
  Box,
  Slider,
} from '@mantine/core';
import {
  Split,
  Columns2,
  Ban,
  Trash2,
  X,
  Sparkles,
  Combine,
  AlertTriangle,
  CheckCircle2,
  Link,
  Search,
  Scissors,
} from 'lucide-react';
import { useProjectStore } from '../../../application/stores/useProjectStore';
import { useEditorStore } from '../../../application/stores/useEditorStore';
import { LayoutEngine } from '../../../core/layout/LayoutEngine';
import { MATERIAL_NONE_ID } from '../../../core/models/Material';
import { findDecorByCode } from '../../../core/models/AllWallCatalog';
import {
  ALLWALL_PROFILES_CATALOG,
  findProfileByArticle,
} from '../../../core/models/Profile';
import { PolygonSlicingEngine } from '../../../core/geometry/PolygonSlicingEngine';
import {
  ensureOpeningSlopes,
  SlopeConfig,
  SlopeSideConfig,
  SlopeJointProfileType,
} from '../../../core/models/Opening';

const ALL_PROFILE_WIDTH_OPTIONS = [
  { value: '0', label: '0 мм (без профиля)' },
  ...Array.from(new Set(ALLWALL_PROFILES_CATALOG.map((p) => p.visibleWidth)))
    .sort((a, b) => a - b)
    .map((w) => ({
      value: String(w),
      label: `${w} мм`,
    })),
];

const PROFILE_TYPE_OPTIONS = [
  { value: 'ALL', label: 'Все типы профилей' },
  { value: 'JOINT', label: '🔗 Соединительные' },
  { value: 'LED', label: '💡 Светодиодные (LED)' },
  { value: 'END', label: '🏁 Торцевые' },
  { value: 'CORNER', label: '📐 Угловые' },
  { value: 'BASEBOARD', label: '🔲 Плинтусы' },
  { value: 'SHADOW', label: '🌑 Теневые' },
];

const getFilteredProfilesStrict = (width: number, type: string) => {
  if (width === 0) return [];

  return ALLWALL_PROFILES_CATALOG.filter((p) => {
    // 1. Четкое равенство по видимой ширине
    if (p.visibleWidth !== width) return false;

    // 2. Фильтр по типу профиля
    if (type !== 'ALL' && p.functionalRole !== type) return false;

    return true;
  });
};

export const RightSidebar: React.FC = () => {
  const { editMode } = useEditorStore();
  const [selectedProfileType, setSelectedProfileType] = useState<string>('ALL');
  const {
    project,
    selectedColumnIndex,
    selectedSegmentIndex,
    selectedCellKeys,
    selectedPieceIds,
    selectedJointId,
    selectedJointIds,
    selectedWallBendId,
    selectedSubPieceId,
    selectOpening,
    selectPanel,
    selectSubPiece,
    selectJoint,
    selectWallBend,
    openSlicingModal,
    updateWallDimensions,
    updateOpening,
    applyOpening,
    removeOpening,
    updateWallBend,
    deleteWallBend,
    mergeSelectedCells,
    setMaterialForSelectedCells,
    validateSelectedJoints,
    mergeSelectedJoints,
    syncSelectedJointsParams,
    setJointPresetForSelected,
    setJointWidthForSelected,
    setJointProfileForSelected,
    setJointColorForSelected,
    setJointWidth,
    setJointPreset,
    setJointProfile,
    setJointColor,
    updatePanelSegment,
    setCellProperties,
    clearCellMaterial,
    splitPanelHorizontally,
    splitColumnVertically,
    setPiecePatternAngle,
    updateSubPieceLabel,
  } = useProjectStore();

  const selectedWallId = project.selectedWallId;
  const selectedOpeningId = project.selectedOpeningId;

  const currentWall = project.walls.find((w) => w.id === selectedWallId);
  const currentOpening = currentWall?.openings.find((op) => op.id === selectedOpeningId);
  const currentWallBend = currentWall?.bends?.find((b) => b.id === selectedWallBendId);
  const currentMaterial = project.materials.find(
    (m) => m.id === (currentWall?.zone.materialId || MATERIAL_NONE_ID)
  ) || project.materials.find((m) => m.id === MATERIAL_NONE_ID) || project.materials[0];

  // Расчет раскладки и расхода в реальном времени
  const layoutResult =
    currentWall && currentMaterial
      ? LayoutEngine.calculateWallLayout(currentWall, currentMaterial, project.materials)
      : null;

  if (!currentWall) {
    return (
      <Stack
        h="100%"
        p="md"
        justify="center"
        align="center"
        style={{
          borderLeft: '1px solid #2C2E33',
          backgroundColor: '#141517',
          width: 320,
          minWidth: 320,
        }}
      >
        <Text size="sm" c="dimmed">
          Выберите стену для редактирования
        </Text>
      </Stack>
    );
  }

  // =========================================================================
  // РЕЖИМ 1.1: Выбрано НЕСКОЛЬКО швов через Shift (Мульти-выбор & Соединение)
  // =========================================================================
  if (selectedJointIds.length > 1) {
    const validation = validateSelectedJoints(currentWall.id);

    return (
      <Stack
        h="100%"
        gap="xs"
        p="xs"
        style={{
          borderLeft: '1px solid #2C2E33',
          backgroundColor: '#141517',
          width: 320,
          minWidth: 320,
        }}
      >
        <ScrollArea style={{ flex: 1 }}>
          <Stack gap="md" p="xs">
            <Group justify="space-between" align="center">
              <div>
                <Title order={6} c="blue.4">
                  ВЫБРАНО ШВОВ: {selectedJointIds.length} шт
                </Title>
                <Text size="xs" c="dimmed">
                  Групповые операции со стыками (через Shift)
                </Text>
              </div>
              <Tooltip label="Снять выделение">
                <ActionIcon size="xs" variant="subtle" color="gray" onClick={() => selectJoint(null)}>
                  <X size={14} />
                </ActionIcon>
              </Tooltip>
            </Group>

            <Divider color="#2C2E33" />

            {/* Результат проверки условий объединения */}
            {validation.canMerge ? (
              <Alert
                icon={<CheckCircle2 size={16} />}
                title="Швы готовы к соединению"
                color="teal"
                variant="light"
              >
                <Text size="xs">
                  Все выбранные швы лежат на одной прямой ({validation.orientation === 'HORIZONTAL' ? 'по горизонтали' : 'по вертикали'}), имеют одинаковую толщину ({validation.widths[0]} мм) и тип ({validation.ledStates[0] ? 'LED 10 мм' : 'без подсветки'}).
                </Text>
              </Alert>
            ) : (
              <Alert
                icon={<AlertTriangle size={16} />}
                title="Невозможно соединить швы"
                color="orange"
                variant="light"
              >
                <Text size="xs" mb={6}>
                  {validation.errorMessage}
                </Text>
                <Stack gap={3}>
                  <Text size="xs" c={validation.isCollinear ? 'teal.4' : 'red.4'}>
                    • Положение: {validation.isCollinear ? 'На одной линии' : 'На разных уровнях/линиях'}
                  </Text>
                  <Text size="xs" c={validation.sameWidth ? 'teal.4' : 'orange.4'}>
                    • Толщина: {validation.sameWidth ? `Одинаковая (${validation.widths[0]} мм)` : `Разная (${validation.widths.join(' мм, ')} мм)`}
                  </Text>
                  <Text size="xs" c={validation.sameLED ? 'teal.4' : 'orange.4'}>
                    • Подсветка: {validation.sameLED ? (validation.ledStates[0] ? 'LED у всех' : 'Обычный шов у всех') : 'Разный тип (LED / без LED)'}
                  </Text>
                </Stack>
              </Alert>
            )}

            {/* Кнопка соединения швов в одну непрерывную линию */}
            <Button
              size="sm"
              fullWidth
              variant={validation.canMerge ? 'filled' : 'light'}
              color="teal"
              disabled={!validation.canMerge}
              leftSection={<Link size={16} />}
              onClick={() => mergeSelectedJoints(currentWall.id)}
            >
              🔗 Соединить швы в единую линию
            </Button>

            {!validation.canMerge && (!validation.sameWidth || !validation.sameLED) && (
              <Button
                size="xs"
                variant="light"
                color="blue"
                leftSection={<Sparkles size={14} />}
                onClick={() => syncSelectedJointsParams(currentWall.id)}
              >
                ⚡ Сделать параметры всех выбранных одинаковыми
              </Button>
            )}

            <Divider color="#2C2E33" />

            {/* ФИЛЬТР 1: Селектор всех размеров шва (для всех) */}
            <Select
              size="xs"
              label="Ширина шва / профиля (для всех)"
              placeholder="Выберите ширину..."
              value={validation.sameWidth ? String(validation.widths[0]) : null}
              data={ALL_PROFILE_WIDTH_OPTIONS}
              allowDeselect={false}
              onChange={(val) => {
                const w = val ? Number(val) : 0;
                if (w === 0) {
                  setJointPresetForSelected(currentWall.id, 'NONE');
                } else {
                  setJointWidthForSelected(currentWall.id, w);
                }
              }}
            />

            {/* ФИЛЬТР 2 & НАСТРОЙКА: Отображаются ТОЛЬКО если ширина > 0 */}
            {!(validation.sameWidth && validation.widths[0] === 0) && (
              <>
                {/* Фильтр по типу профиля */}
                <Select
                  size="xs"
                  label="Тип профиля AllWall"
                  value={selectedProfileType}
                  data={PROFILE_TYPE_OPTIONS}
                  onChange={(val) => {
                    const newType = val || 'ALL';
                    setSelectedProfileType(newType);
                    selectedJointIds.forEach((id) => {
                      const custom = currentWall.customJoints[id];
                      if (custom?.profileArticle) {
                        const prof = findProfileByArticle(custom.profileArticle);
                        if (prof && newType !== 'ALL' && prof.functionalRole !== newType) {
                          setJointProfile(currentWall.id, id, '', custom.profileColor || '#212529');
                        }
                      }
                    });
                  }}
                  allowDeselect={false}
                />

                {/* Выбор модели профиля AllWall для группы */}
                <Select
                  size="xs"
                  label="Модель профиля AllWall (для всех)"
                  placeholder="Привязать артикул AllWall..."
                  searchable
                  clearable
                  data={getFilteredProfilesStrict(
                    validation.sameWidth ? validation.widths[0] : 0,
                    selectedProfileType
                  ).map((p) => ({
                    value: p.article,
                    label: `${p.article} • ${p.name} (${p.visibleWidth} мм)`,
                  }))}
                  onChange={(val) => {
                    if (val) {
                      setJointProfileForSelected(currentWall.id, val);
                    } else {
                      setJointPresetForSelected(currentWall.id, 'NONE');
                    }
                  }}
                />

                {/* Выбор цвета профиля AllWall для группы */}
                <Select
                  size="xs"
                  label="Цвет профиля AllWall (для всех)"
                  placeholder="Цвет отделки профиля..."
                  data={[
                    { value: '#212529', label: '⬛ Чёрный (Black)' },
                    { value: '#c9a25b', label: '🟨 Золотистый (Golden)' },
                    { value: '#b76e79', label: '🟧 Розовое золото (Rose gold)' },
                    { value: '#adb5bd', label: '⬜ Серебристый (Silver)' },
                  ]}
                  onChange={(val) => {
                    if (val) {
                      setJointColorForSelected(currentWall.id, val);
                    }
                  }}
                />
              </>
            )}
          </Stack>
        </ScrollArea>
      </Stack>
    );
  }

  // =========================================================================
  // РЕЖИМ 1.2: Выбран ОДИН конкретный стык / край плиты
  // =========================================================================
  if (selectedJointId) {
    const selectedJoint = layoutResult?.joints.find((j) => j.id === selectedJointId);
    const customConfig = currentWall.customJoints[selectedJointId];

    const currentWidth = customConfig !== undefined ? customConfig.width : (selectedJoint?.width ?? 8);
    const isLED = customConfig !== undefined ? customConfig.isLED : (selectedJoint?.isLED ?? false);
    const profileArticle = customConfig?.profileArticle || selectedJoint?.profileArticle;
    const profileColor = customConfig?.profileColor || selectedJoint?.profileColor || '#212529';
    const activeProfileObj = profileArticle ? findProfileByArticle(profileArticle) : undefined;
    const isHoriz = selectedJoint?.orientation === 'HORIZONTAL' || selectedJointId.includes('-h-');

    return (
      <Stack
        h="100%"
        gap="xs"
        p="xs"
        style={{
          borderLeft: '1px solid #2C2E33',
          backgroundColor: '#141517',
          width: 320,
          minWidth: 320,
        }}
      >
        <ScrollArea style={{ flex: 1 }}>
          <Stack gap="md" p="xs">
            <Group justify="space-between" align="center">
              <div>
                <Title order={6} c={isLED ? 'yellow.4' : 'blue.4'}>
                  {isHoriz ? 'ГОРИЗОНТАЛЬНЫЙ СТЫК' : 'ВЕРТИКАЛЬНЫЙ СТЫК'}
                </Title>
                <Text size="xs" c="dimmed">
                  {selectedJoint?.name || (isHoriz ? 'Стык между рядами' : 'Стык между колонками')}
                </Text>
              </div>
              <Group gap={6}>
                <Badge size="xs" color={isLED ? 'yellow' : 'blue'}>
                  {isLED ? '⚡ LED 10 мм' : `Шов ${currentWidth} мм`}
                </Badge>
                <Tooltip label="Снять выделение">
                  <ActionIcon size="xs" variant="subtle" color="gray" onClick={() => selectJoint(null)}>
                    <X size={14} />
                  </ActionIcon>
                </Tooltip>
              </Group>
            </Group>

            <Divider color="#2C2E33" />

            {/* ФИЛЬТР 1: Селектор всех размеров шва */}
            <Select
              size="xs"
              label="Ширина шва / профиля"
              placeholder="Выберите ширину..."
              value={String(currentWidth)}
              data={ALL_PROFILE_WIDTH_OPTIONS}
              allowDeselect={false}
              onChange={(val) => {
                const w = val ? Number(val) : 0;
                if (w === 0) {
                  setJointPreset(currentWall.id, selectedJointId, 'NONE');
                } else {
                  setJointWidth(currentWall.id, selectedJointId, w);
                }
              }}
            />

            {/* ФИЛЬТР 2: Тип, модель и цвет профиля (скрываются, если выбрано 0 мм) */}
            {currentWidth !== 0 && (
              <>
                {/* Фильтр по типу профиля */}
                <Select
                  size="xs"
                  label="Тип профиля AllWall"
                  value={selectedProfileType}
                  data={PROFILE_TYPE_OPTIONS}
                  onChange={(val) => {
                    const newType = val || 'ALL';
                    setSelectedProfileType(newType);
                    if (profileArticle) {
                      const prof = findProfileByArticle(profileArticle);
                      if (prof && newType !== 'ALL' && prof.functionalRole !== newType) {
                        setJointProfile(currentWall.id, selectedJointId, '', profileColor);
                      }
                    }
                  }}
                  allowDeselect={false}
                />

                {/* Выбор модели профиля AllWall */}
                <Select
                  size="xs"
                  label="Модель профиля AllWall"
                  placeholder="Выберите артикул из каталога..."
                  searchable
                  clearable
                  value={profileArticle || null}
                  data={getFilteredProfilesStrict(currentWidth, selectedProfileType).map((p) => ({
                    value: p.article,
                    label: `${p.article} • ${p.name} (${p.visibleWidth} мм)`,
                  }))}
                  onChange={(val) => {
                    if (val) {
                      setJointProfile(currentWall.id, selectedJointId, val, profileColor);
                    } else {
                      setJointProfile(currentWall.id, selectedJointId, '', profileColor);
                    }
                  }}
                />

                {/* Выбор цвета профиля AllWall */}
                <div>
                  <Text size="xs" fw={500} mb={4}>
                    Цвет профиля AllWall:
                  </Text>
                  <Group gap="xs">
                    {[
                      { code: 'BLACK', name: 'Чёрный', hex: '#212529' },
                      { code: 'GOLD', name: 'Золото', hex: '#c9a25b' },
                      { code: 'ROSE_GOLD', name: 'Розовое золото', hex: '#b76e79' },
                      { code: 'SILVER', name: 'Серебро', hex: '#adb5bd' },
                    ].map((c) => {
                      const isSel = profileColor.toLowerCase() === c.hex.toLowerCase();
                      return (
                        <Tooltip key={c.code} label={c.name} withArrow>
                          <Paper
                            p={2}
                            radius="xl"
                            style={{
                              cursor: 'pointer',
                              border: isSel ? '2px solid #339af0' : '2px solid transparent',
                              backgroundColor: '#25262B',
                              transform: isSel ? 'scale(1.15)' : 'scale(1)',
                              transition: 'all 0.15s ease',
                            }}
                            onClick={() => setJointColor(currentWall.id, selectedJointId, c.hex)}
                          >
                            <ColorSwatch color={c.hex} size={20} />
                          </Paper>
                        </Tooltip>
                      );
                    })}
                  </Group>
                </div>

                {/* Карточка привязанного профиля */}
                {activeProfileObj && (
                  <Paper p="xs" radius="sm" style={{ backgroundColor: '#1A1B1E', border: '1px solid #339af0' }}>
                    <Stack gap={4}>
                      <Group justify="space-between">
                        <Badge color="blue" size="xs">
                          {activeProfileObj.article}
                        </Badge>
                        <Badge color="gray" size="xs">
                          Хлыст {activeProfileObj.stockLength} мм
                        </Badge>
                      </Group>
                      <Text size="xs" fw={600}>
                        {activeProfileObj.name}
                      </Text>
                      <Text size="xs" c="dimmed">
                        {activeProfileObj.description}
                      </Text>
                      <Group gap={4} mt={2}>
                        <Badge size="xs" variant="outline" color="cyan">
                          Ширина: {activeProfileObj.visibleWidth} мм
                        </Badge>
                        <Badge size="xs" variant="outline" color="teal">
                          Панели: {activeProfileObj.allowedThicknesses.join('/')} мм
                        </Badge>
                      </Group>
                    </Stack>
                  </Paper>
                )}
              </>
            )}

            {/* Информация о стыке */}
            {selectedJoint && (
              <Paper p="xs" withBorder style={{ backgroundColor: '#1A1B1E', borderColor: '#2C2E33' }}>
                <Group justify="space-between" mb={4}>
                  <Text size="xs" c="dimmed">Положение {isHoriz ? 'от пола Y' : 'от края X'}:</Text>
                  <Text size="xs" fw={600} style={{ fontFamily: 'JetBrains Mono' }}>
                    {Math.round(isHoriz ? selectedJoint.y : selectedJoint.x)} мм
                  </Text>
                </Group>
                <Group justify="space-between">
                  <Text size="xs" c="dimmed">Длина линии стыка:</Text>
                  <Text size="xs" fw={600} style={{ fontFamily: 'JetBrains Mono' }}>
                    {Math.round(selectedJoint.length)} мм
                  </Text>
                </Group>
              </Paper>
            )}
          </Stack>
        </ScrollArea>
      </Stack>
    );
  }

  // =========================================================================
  // РЕЖИМ 2: Выбран конкретный проем
  // =========================================================================
  if (currentOpening) {
    return (
      <Stack
        h="100%"
        gap="xs"
        p="xs"
        style={{
          borderLeft: '1px solid #2C2E33',
          backgroundColor: '#141517',
          width: 320,
          minWidth: 320,
        }}
      >
        <ScrollArea style={{ flex: 1 }}>
          <Stack gap="md" p="xs">
            <Group justify="space-between" align="center">
              <div>
                <Title order={6} c="blue.4">
                  {currentOpening.name}
                </Title>
                <Text size="xs" c="dimmed">
                  Параметры проема
                </Text>
              </div>
              <Group gap={6}>
                <Badge size="xs" color="blue">
                  {currentOpening.type}
                </Badge>
                <Tooltip label="Снять выделение">
                  <ActionIcon size="xs" variant="subtle" color="gray" onClick={() => selectOpening(null)}>
                    <X size={14} />
                  </ActionIcon>
                </Tooltip>
              </Group>
            </Group>

            <Divider color="#2C2E33" />

            {!currentOpening.isApplied ? (
              <Paper
                p="xs"
                radius="sm"
                style={{
                  backgroundColor: 'rgba(255, 146, 43, 0.08)',
                  border: '1px dashed #FF922B',
                }}
              >
                <Stack gap={8}>
                  <Group justify="space-between" align="center">
                    <Badge color="orange" size="xs">
                      Черновик (позиционирование)
                    </Badge>
                  </Group>
                  <Text size="xs" c="dimmed">
                    Переместите проем по стене или задайте точные размеры и координаты, затем нажмите кнопку:
                  </Text>
                  <Button
                    size="xs"
                    color="orange"
                    variant="filled"
                    leftSection={<Scissors size={14} />}
                    fullWidth
                    onClick={() => applyOpening(currentWall.id, currentOpening.id)}
                  >
                    Встроить проем в стену (Применить)
                  </Button>
                </Stack>
              </Paper>
            ) : (
              <Paper
                p="xs"
                radius="sm"
                style={{
                  backgroundColor: 'rgba(64, 192, 87, 0.08)',
                  border: '1px solid #40C057',
                }}
              >
                <Stack gap={4}>
                  <Group gap={6}>
                    <Badge color="green" size="xs">
                      Зафиксирован в стене
                    </Badge>
                  </Group>
                  <Text size="xs" c="dimmed">
                    Проем физически вырезан из материала стены. Панели вокруг (фрамуга, простенки) независимы.
                  </Text>
                </Stack>
              </Paper>
            )}

            <Group grow>
              <NumberInput
                size="xs"
                label="Ширина (мм)"
                disabled={currentOpening.isApplied}
                value={currentOpening.width || ''}
                clampBehavior="blur"
                allowNegative={false}
                allowDecimal={false}
                min={10}
                max={Math.max(100, currentWall.width)}
                step={10}
                onChange={(val) =>
                  updateOpening(currentWall.id, {
                    id: currentOpening.id,
                    width: typeof val === 'number' ? val : (val === '' ? 0 : Number(val)),
                  })
                }
              />
              <NumberInput
                size="xs"
                label="Высота (мм)"
                disabled={currentOpening.isApplied}
                value={currentOpening.height || ''}
                clampBehavior="blur"
                allowNegative={false}
                allowDecimal={false}
                min={10}
                max={Math.max(100, currentWall.height)}
                step={10}
                onChange={(val) =>
                  updateOpening(currentWall.id, {
                    id: currentOpening.id,
                    height: typeof val === 'number' ? val : (val === '' ? 0 : Number(val)),
                  })
                }
              />
            </Group>

            <Group grow>
              <NumberInput
                size="xs"
                label="Отступ слева X (мм)"
                disabled={currentOpening.isApplied}
                value={currentOpening.x ?? 0}
                clampBehavior="blur"
                allowNegative={false}
                allowDecimal={false}
                min={0}
                max={Math.max(0, currentWall.width - currentOpening.width)}
                step={10}
                onChange={(val) =>
                  updateOpening(currentWall.id, {
                    id: currentOpening.id,
                    x: typeof val === 'number' ? val : (val === '' ? 0 : Number(val)),
                  })
                }
              />
              <NumberInput
                size="xs"
                label="От пола Y (мм)"
                disabled={currentOpening.isApplied}
                value={currentOpening.y ?? 0}
                clampBehavior="blur"
                allowNegative={false}
                allowDecimal={false}
                min={0}
                max={Math.max(0, currentWall.height - currentOpening.height)}
                step={10}
                onChange={(val) =>
                  updateOpening(currentWall.id, {
                    id: currentOpening.id,
                    y: typeof val === 'number' ? val : (val === '' ? 0 : Number(val)),
                  })
                }
              />
            </Group>

            <div>
              <Text size="xs" mb={4} c="dimmed">
                Режим размещения:
              </Text>
              <SegmentedControl
                size="xs"
                fullWidth
                value={currentOpening.isCutout !== false ? 'CUTOUT' : 'OVERLAY'}
                onChange={(val) =>
                  updateOpening(currentWall.id, {
                    id: currentOpening.id,
                    isCutout: val === 'CUTOUT',
                  })
                }
                data={[
                  { label: '✂️ Вырез в плитах', value: 'CUTOUT' },
                  { label: '📺 Декор поверх плит', value: 'OVERLAY' },
                ]}
              />
            </div>

            {/* Глубина проема в стене (для вырезов) */}
            {currentOpening.isCutout !== false && (
              <div>
                <Group justify="space-between" mb={2}>
                  <Text size="xs" c="dimmed" fw={500}>
                    Глубина проема в стене:
                  </Text>
                  <Text size="xs" c="dimmed">
                    {currentOpening.depth ?? (currentOpening.type === 'DOOR' ? 150 : currentOpening.type === 'WINDOW' ? 200 : 150)} мм
                  </Text>
                </Group>
                <NumberInput
                  size="xs"
                  value={currentOpening.depth ?? (currentOpening.type === 'DOOR' ? 150 : currentOpening.type === 'WINDOW' ? 200 : 150)}
                  clampBehavior="blur"
                  allowNegative={false}
                  allowDecimal={false}
                  min={0}
                  max={1000}
                  step={10}
                  onChange={(val) => {
                    const num = typeof val === 'number' ? val : (val === '' ? 0 : Number(val));
                    updateOpening(currentWall.id, {
                      id: currentOpening.id,
                      depth: num,
                    });
                  }}
                />
                <Group gap={4} mt={3}>
                  {[100, 150, 200, 250, 300].map((dPreset) => (
                    <Button
                      key={dPreset}
                      size="compact-xs"
                      variant="subtle"
                      color="gray"
                      onClick={() =>
                        updateOpening(currentWall.id, {
                          id: currentOpening.id,
                          depth: dPreset,
                        })
                      }
                    >
                      {dPreset} мм
                    </Button>
                  ))}
                </Group>
              </div>
            )}

            {/* БЛОК НАСТРОЙКИ ОТКОСОВ (Только для режима Выреза) */}
            {currentOpening.isCutout !== false && (() => {
              const slopes = ensureOpeningSlopes(currentOpening);
              const defaultOpDepth = currentOpening.depth ?? (currentOpening.type === 'DOOR' ? 150 : currentOpening.type === 'WINDOW' ? 200 : 150);

              const handleUpdateSlopes = (patch: Partial<SlopeConfig>) => {
                const next: SlopeConfig = { ...slopes, ...patch };
                updateOpening(currentWall.id, {
                  id: currentOpening.id,
                  slopes: next,
                  slopeDepth: next.depth,
                });
              };

              const handleUpdateSide = (
                side: 'top' | 'bottom' | 'left' | 'right',
                patch: Partial<SlopeSideConfig>
              ) => {
                const next: SlopeConfig = {
                  ...slopes,
                  [side]: { ...slopes[side], ...patch },
                };
                updateOpening(currentWall.id, {
                  id: currentOpening.id,
                  slopes: next,
                });
              };

              const materialOptions = [
                { value: '', label: `📌 Как у стены (${currentMaterial?.name || 'Основной'})` },
                ...project.materials
                  .filter((m) => !m.isVoid)
                  .map((m) => ({
                    value: m.id,
                    label: m.decorName ? `${m.name} (${m.decorName})` : m.name,
                  })),
              ];

              return (
                <Paper
                  p="xs"
                  withBorder
                  style={{
                    backgroundColor: '#1A1B1E',
                    borderColor: slopes.enabled ? '#1971c2' : '#2C2E33',
                  }}
                >
                  <Stack gap="xs">
                    <Group justify="space-between" align="center">
                      <Group gap={6}>
                        <Title order={6} size="xs" c={slopes.enabled ? 'blue.4' : 'dimmed'}>
                          📐 Облицовка откосов
                        </Title>
                        {slopes.enabled && (
                          <Badge size="xs" color="blue" variant="light">
                            ВКЛ
                          </Badge>
                        )}
                      </Group>
                      <Switch
                        size="xs"
                        checked={slopes.enabled}
                        onChange={(e) => handleUpdateSlopes({ enabled: e.currentTarget.checked })}
                      />
                    </Group>

                    {slopes.enabled && (
                      <>
                        <Divider color="#2C2E33" />

                        {/* Активные грани откоса */}
                        <div>
                          <Text size="xs" mb={4} c="dimmed" fw={500}>
                            Облицовываемые стороны:
                          </Text>
                          <Group gap={4} grow>
                            <Button
                              size="compact-xs"
                              variant={slopes.top.enabled ? 'filled' : 'default'}
                              color={slopes.top.enabled ? 'blue' : 'gray'}
                              onClick={() => handleUpdateSide('top', { enabled: !slopes.top.enabled })}
                            >
                              ⬆ Верх
                            </Button>
                            <Button
                              size="compact-xs"
                              variant={slopes.bottom.enabled ? 'filled' : 'default'}
                              color={slopes.bottom.enabled ? 'blue' : 'gray'}
                              onClick={() => handleUpdateSide('bottom', { enabled: !slopes.bottom.enabled })}
                            >
                              ⬇ Низ
                            </Button>
                            <Button
                              size="compact-xs"
                              variant={slopes.left.enabled ? 'filled' : 'default'}
                              color={slopes.left.enabled ? 'blue' : 'gray'}
                              onClick={() => handleUpdateSide('left', { enabled: !slopes.left.enabled })}
                            >
                              ⬅ Лево
                            </Button>
                            <Button
                              size="compact-xs"
                              variant={slopes.right.enabled ? 'filled' : 'default'}
                              color={slopes.right.enabled ? 'blue' : 'gray'}
                              onClick={() => handleUpdateSide('right', { enabled: !slopes.right.enabled })}
                            >
                              ➡ Право
                            </Button>
                          </Group>
                        </div>

                        {/* Селектор: Откосы под глубину проема */}
                        <Paper p={8} withBorder style={{ backgroundColor: '#141517' }}>
                          <Group justify="space-between" align="center">
                            <div>
                              <Text size="xs" fw={500}>
                                🔗 Откосы под глубину проема
                              </Text>
                              <Text size="10px" c="dimmed">
                                {slopes.fitToOpeningDepth !== false
                                  ? `Авто = ${defaultOpDepth} мм`
                                  : 'Ручная ширина откосов'}
                              </Text>
                            </div>
                            <Switch
                              size="xs"
                              checked={slopes.fitToOpeningDepth !== false}
                              onChange={(e) =>
                                handleUpdateSlopes({ fitToOpeningDepth: e.currentTarget.checked })
                              }
                            />
                          </Group>
                        </Paper>

                        {/* Ручной ввод ширины откосов (только если fitToOpeningDepth выключен) */}
                        {slopes.fitToOpeningDepth === false && (
                          <div>
                            <Text size="xs" mb={4} c="dimmed" fw={500}>
                              Ширина откосов:
                            </Text>
                            <SegmentedControl
                              size="xs"
                              fullWidth
                              mb={6}
                              value={slopes.depthMode}
                              onChange={(val) =>
                                handleUpdateSlopes({ depthMode: val as 'SAME' | 'CUSTOM' })
                              }
                              data={[
                                { label: '🔗 Одинаковая', value: 'SAME' },
                                { label: '🔀 Раздельно', value: 'CUSTOM' },
                              ]}
                            />

                            {slopes.depthMode === 'SAME' ? (
                              <Stack gap={4}>
                                <NumberInput
                                  size="xs"
                                  label="Общая ширина откоса (мм)"
                                  value={slopes.depth ?? 0}
                                  clampBehavior="blur"
                                  allowNegative={false}
                                  allowDecimal={false}
                                  min={0}
                                  max={1000}
                                  step={10}
                                  onChange={(val) => {
                                    const num =
                                      typeof val === 'number' ? val : val === '' ? 0 : Number(val);
                                    handleUpdateSlopes({ depth: num });
                                  }}
                                />
                                <Group gap={4} mt={2}>
                                  {[100, 150, 200, 250].map((preset) => (
                                    <Button
                                      key={preset}
                                      size="compact-xs"
                                      variant="subtle"
                                      color="gray"
                                      onClick={() => handleUpdateSlopes({ depth: preset })}
                                    >
                                      {preset}
                                    </Button>
                                  ))}
                                </Group>
                              </Stack>
                            ) : (
                              <Stack gap={6}>
                                {slopes.top.enabled && (
                                  <NumberInput
                                    size="xs"
                                    label="⬆ Верхний откос (мм)"
                                    value={slopes.top.depth ?? slopes.depth}
                                    clampBehavior="blur"
                                    allowNegative={false}
                                    allowDecimal={false}
                                    min={0}
                                    max={1000}
                                    step={10}
                                    onChange={(val) =>
                                      handleUpdateSide('top', {
                                        depth:
                                          typeof val === 'number' ? val : val === '' ? 0 : Number(val),
                                      })
                                    }
                                  />
                                )}
                                {slopes.bottom.enabled && (
                                  <NumberInput
                                    size="xs"
                                    label="⬇ Подоконник / Низ (мм)"
                                    value={slopes.bottom.depth ?? slopes.depth}
                                    clampBehavior="blur"
                                    allowNegative={false}
                                    allowDecimal={false}
                                    min={0}
                                    max={1000}
                                    step={10}
                                    onChange={(val) =>
                                      handleUpdateSide('bottom', {
                                        depth:
                                          typeof val === 'number' ? val : val === '' ? 0 : Number(val),
                                      })
                                    }
                                  />
                                )}
                                {slopes.left.enabled && (
                                  <NumberInput
                                    size="xs"
                                    label="⬅ Левый откос (мм)"
                                    value={slopes.left.depth ?? slopes.depth}
                                    clampBehavior="blur"
                                    allowNegative={false}
                                    allowDecimal={false}
                                    min={0}
                                    max={1000}
                                    step={10}
                                    onChange={(val) =>
                                      handleUpdateSide('left', {
                                        depth:
                                          typeof val === 'number' ? val : val === '' ? 0 : Number(val),
                                      })
                                    }
                                  />
                                )}
                                {slopes.right.enabled && (
                                  <NumberInput
                                    size="xs"
                                    label="➡ Правый откос (мм)"
                                    value={slopes.right.depth ?? slopes.depth}
                                    clampBehavior="blur"
                                    allowNegative={false}
                                    allowDecimal={false}
                                    min={0}
                                    max={1000}
                                    step={10}
                                    onChange={(val) =>
                                      handleUpdateSide('right', {
                                        depth:
                                          typeof val === 'number' ? val : val === '' ? 0 : Number(val),
                                      })
                                    }
                                  />
                                )}
                              </Stack>
                            )}
                          </div>
                        )}

                        {/* Режим материалов: Одинаковый / Раздельно по граням */}
                        <div>
                          <Text size="xs" mb={4} c="dimmed" fw={500}>
                            Материал откосов:
                          </Text>
                          <SegmentedControl
                            size="xs"
                            fullWidth
                            mb={6}
                            value={slopes.materialMode}
                            onChange={(val) =>
                              handleUpdateSlopes({ materialMode: val as 'SAME' | 'CUSTOM' })
                            }
                            data={[
                              { label: '🎨 Одинаковый', value: 'SAME' },
                              { label: '🎭 Раздельно', value: 'CUSTOM' },
                            ]}
                          />

                          {slopes.materialMode === 'SAME' ? (
                            <Select
                              size="xs"
                              label="Материал всех откосов"
                              data={materialOptions}
                              value={slopes.materialId || ''}
                              onChange={(val) => handleUpdateSlopes({ materialId: val || null })}
                              searchable
                            />
                          ) : (
                            <Stack gap={6}>
                              {slopes.top.enabled && (
                                <Select
                                  size="xs"
                                  label="⬆ Верхний материал"
                                  data={materialOptions}
                                  value={slopes.top.materialId || slopes.materialId || ''}
                                  onChange={(val) => handleUpdateSide('top', { materialId: val || null })}
                                  searchable
                                />
                              )}
                              {slopes.bottom.enabled && (
                                <Select
                                  size="xs"
                                  label="⬇ Подоконник (материал)"
                                  data={materialOptions}
                                  value={slopes.bottom.materialId || slopes.materialId || ''}
                                  onChange={(val) => handleUpdateSide('bottom', { materialId: val || null })}
                                  searchable
                                />
                              )}
                              {slopes.left.enabled && (
                                <Select
                                  size="xs"
                                  label="⬅ Левый откос (материал)"
                                  data={materialOptions}
                                  value={slopes.left.materialId || slopes.materialId || ''}
                                  onChange={(val) => handleUpdateSide('left', { materialId: val || null })}
                                  searchable
                                />
                              )}
                              {slopes.right.enabled && (
                                <Select
                                  size="xs"
                                  label="➡ Правый откос (материал)"
                                  data={materialOptions}
                                  value={slopes.right.materialId || slopes.materialId || ''}
                                  onChange={(val) => handleUpdateSide('right', { materialId: val || null })}
                                  searchable
                                />
                              )}
                            </Stack>
                          )}
                        </div>

                        {/* Профиль внутренних стыков откосов */}
                        <div>
                          <Select
                            size="xs"
                            label="Профиль между откосами"
                            description="Стык планок во внутренних углах"
                            value={slopes.jointProfileType || 'NONE'}
                            onChange={(val) =>
                              handleUpdateSlopes({
                                jointProfileType: (val as SlopeJointProfileType) || 'NONE',
                              })
                            }
                            data={[
                              { value: 'NONE', label: '🔘 Без профиля (встык 0 мм)' },
                              { value: 'CORNER', label: '📐 Внутренний угловой профиль (2 мм)' },
                              { value: 'LED_10', label: '💡 LED-профиль (10 мм подсветка)' },
                              { value: 'JOINT_8', label: '⬛ Шов 8 мм (стандартный зазор)' },
                            ]}
                          />
                        </div>

                        {/* Развертка на 2D-чертеже */}
                        <Group justify="space-between" align="center" mt={4}>
                          <Text size="xs" c="dimmed">
                            Развертка на 2D-чертеже:
                          </Text>
                          <Switch
                            size="xs"
                            checked={slopes.showUnfold2D}
                            onChange={(e) =>
                              handleUpdateSlopes({ showUnfold2D: e.currentTarget.checked })
                            }
                          />
                        </Group>
                      </>
                    )}
                  </Stack>
                </Paper>
              );
            })()}

            <Divider color="#2C2E33" />

            <Button
              size="xs"
              variant="light"
              color="red"
              leftSection={<Trash2 size={14} />}
              onClick={() => removeOpening(currentWall.id, currentOpening.id)}
            >
              Удалить проем
            </Button>
          </Stack>
        </ScrollArea>
      </Stack>
    );
  }

  // =========================================================================
  // РЕЖИМ 2.2: Выбрана ЗОНА ИЗГИБА / УГОЛ СТЕНЫ (WallBend)
  // =========================================================================
  if (currentWallBend) {
    const arcLen = Math.round((Math.PI * currentWallBend.radius * (currentWallBend.angleDeg || 90)) / 180);

    return (
      <Stack
        h="100%"
        gap="xs"
        p="xs"
        style={{
          borderLeft: '1px solid #2C2E33',
          backgroundColor: '#141517',
          width: 320,
          minWidth: 320,
        }}
      >
        <ScrollArea style={{ flex: 1 }}>
          <Stack gap="md" p="xs">
            <Group justify="space-between" align="center">
              <div>
                <Title order={6} c="cyan.4">
                  ⌒ ИЗГИБ / УГОЛ СТЕНЫ
                </Title>
                <Text size="xs" c="dimmed">
                  Геометрическая зона изгиба стены
                </Text>
              </div>
              <Group gap={6}>
                <Badge size="xs" color="cyan">
                  {currentWallBend.radius === 0 ? 'ОСТРЫЙ' : currentWallBend.type === 'INNER_CORNER' ? 'ВНУТР' : 'ВНЕШН'}
                </Badge>
                <Tooltip label="Снять выделение">
                  <ActionIcon size="xs" variant="subtle" color="gray" onClick={() => selectWallBend(null)}>
                    <X size={14} />
                  </ActionIcon>
                </Tooltip>
              </Group>
            </Group>

            <Divider color="#2C2E33" />

            {/* Тип изгиба */}
            <SegmentedControl
              size="xs"
              fullWidth
              value={currentWallBend.type}
              onChange={(val: any) =>
                updateWallBend(currentWall.id, currentWallBend.id, {
                  type: val,
                  name: val === 'INNER_CORNER' ? 'Внутренний угол' : 'Внешний угол',
                  angleDeg: currentWallBend.angleDeg || 90,
                })
              }
              data={[
                { label: '⌒ Внешн 90°', value: 'OUTER_CORNER' },
                { label: '╭ Внутр 90°', value: 'INNER_CORNER' },
              ]}
            />

            {/* Координата X на стене */}
            <NumberInput
              size="xs"
              label="Позиция X от левого края (мм)"
              description={currentWallBend.radius === 0 ? 'Точка перегиба / угла' : 'Отступ начала зоны скругления'}
              value={currentWallBend.x}
              clampBehavior="blur"
              allowNegative={false}
              allowDecimal={false}
              min={0}
              max={Math.max(0, currentWall.width - arcLen)}
              step={10}
              onChange={(val) =>
                updateWallBend(currentWall.id, currentWallBend.id, {
                  x: typeof val === 'number' ? val : (val === '' ? 0 : Number(val)),
                })
              }
            />

            <Group grow>
              <NumberInput
                size="xs"
                label="Радиус R (мм)"
                value={currentWallBend.radius}
                clampBehavior="blur"
                allowNegative={false}
                allowDecimal={false}
                min={0}
                max={2000}
                step={25}
                onChange={(val) =>
                  updateWallBend(currentWall.id, currentWallBend.id, {
                    radius: typeof val === 'number' ? val : 0,
                  })
                }
              />
              <NumberInput
                size="xs"
                label="Угол охвата (°)"
                value={currentWallBend.angleDeg}
                clampBehavior="blur"
                allowNegative={false}
                allowDecimal={false}
                min={15}
                max={180}
                step={15}
                onChange={(val) =>
                  updateWallBend(currentWall.id, currentWallBend.id, {
                    angleDeg: typeof val === 'number' ? val : 90,
                  })
                }
              />
            </Group>

            {/* Интерактивная векторная мини-схема сечения сверху */}
            <Paper p="xs" withBorder style={{ backgroundColor: '#141517', borderColor: '#2C2E33' }}>
              <Text size="xs" fw={600} mb={6} c="dimmed">
                Схема сечения (Вид сверху):
              </Text>
              <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: 75 }}>
                <svg width="220" height="65" viewBox="0 0 220 65">
                  {currentWallBend.type === 'INNER_CORNER' ? (
                    currentWallBend.radius === 0 ? (
                      <g>
                        <path d="M 30 15 L 100 15 L 100 55 L 190 55" fill="none" stroke="#40c057" strokeWidth="4" strokeLinecap="square" strokeLinejoin="miter" />
                        <rect x="90" y="15" width="10" height="10" fill="none" stroke="#69db7c" strokeWidth="1.5" />
                        <text x="135" y="28" fill="#69db7c" fontSize="11" fontFamily="JetBrains Mono" fontWeight="bold">
                          ╭ Внутр {currentWallBend.angleDeg || 90}°
                        </text>
                        <text x="135" y="44" fill="#ced4da" fontSize="10" fontFamily="JetBrains Mono">
                          Острый (R = 0)
                        </text>
                      </g>
                    ) : (
                      <g>
                        <path d="M 30 15 L 80 15 A 50 50 0 0 1 130 55 L 190 55" fill="none" stroke="#40c057" strokeWidth="4" strokeLinecap="round" />
                        <text x="135" y="28" fill="#69db7c" fontSize="11" fontFamily="JetBrains Mono" fontWeight="bold">
                          ╭ Внутр R={currentWallBend.radius}
                        </text>
                        <text x="135" y="44" fill="#ced4da" fontSize="10" fontFamily="JetBrains Mono">
                          L = {arcLen} мм
                        </text>
                      </g>
                    )
                  ) : (
                    currentWallBend.radius === 0 ? (
                      <g>
                        <path d="M 30 50 L 100 50 L 100 15 L 190 15" fill="none" stroke="#339af0" strokeWidth="4" strokeLinecap="square" strokeLinejoin="miter" />
                        <rect x="90" y="40" width="10" height="10" fill="none" stroke="#74c0fc" strokeWidth="1.5" />
                        <text x="125" y="42" fill="#74c0fc" fontSize="11" fontFamily="JetBrains Mono" fontWeight="bold">
                          ⌒ Внешн {currentWallBend.angleDeg || 90}°
                        </text>
                        <text x="125" y="56" fill="#ced4da" fontSize="10" fontFamily="JetBrains Mono">
                          Острый (R = 0)
                        </text>
                      </g>
                    ) : (
                      <g>
                        <path d="M 30 50 L 80 50 A 50 50 0 0 0 130 15 L 190 15" fill="none" stroke="#339af0" strokeWidth="4" strokeLinecap="round" />
                        <text x="125" y="42" fill="#74c0fc" fontSize="11" fontFamily="JetBrains Mono" fontWeight="bold">
                          ⌒ Внешн R={currentWallBend.radius}
                        </text>
                        <text x="125" y="56" fill="#ced4da" fontSize="10" fontFamily="JetBrains Mono">
                          L = {arcLen} мм
                        </text>
                      </g>
                    )
                  )}
                </svg>
              </div>
            </Paper>

            {/* Информационная плашка с расчетом развертки дуги */}
            <Paper p="xs" withBorder style={{ backgroundColor: '#1A1B1E', borderColor: '#2C2E33' }}>
              <Stack gap={4}>
                {currentWallBend.radius === 0 ? (
                  <>
                    <Group justify="space-between">
                      <Text size="xs" c="dimmed">Тип угла:</Text>
                      <Text size="xs" fw={700} c="cyan.4" style={{ fontFamily: 'JetBrains Mono' }}>
                        Острый угол (R = 0)
                      </Text>
                    </Group>
                    <Group justify="space-between">
                      <Text size="xs" c="dimmed">Вершина перегиба:</Text>
                      <Text size="xs" c="gray.3" style={{ fontFamily: 'JetBrains Mono' }}>
                        {currentWallBend.x} мм от края
                      </Text>
                    </Group>
                    <Text size="xs" c="dimmed" mt={4} style={{ lineHeight: 1.3 }}>
                      💡 Прямой поворот стены (запил под 45° или фрезеровка V-паза). Скругление отсутствует.
                    </Text>
                  </>
                ) : (
                  <>
                    <Group justify="space-between">
                      <Text size="xs" c="dimmed">Развертка дуги (L):</Text>
                      <Text size="xs" fw={700} c="cyan.4" style={{ fontFamily: 'JetBrains Mono' }}>
                        {arcLen} мм
                      </Text>
                    </Group>
                    <Group justify="space-between">
                      <Text size="xs" c="dimmed">Зона скругления:</Text>
                      <Text size="xs" c="gray.3" style={{ fontFamily: 'JetBrains Mono' }}>
                        от {currentWallBend.x} до {currentWallBend.x + arcLen} мм
                      </Text>
                    </Group>
                    <Text size="xs" c="dimmed" mt={4} style={{ lineHeight: 1.3 }}>
                      💡 Листы и рейки автоматически огибают радиус с керф-пропилами.
                    </Text>
                  </>
                )}
              </Stack>
            </Paper>

            {/* Кнопка удаления изгиба */}
            <Button
              size="xs"
              variant="light"
              color="red"
              fullWidth
              leftSection={<Trash2 size={14} />}
              onClick={() => deleteWallBend(currentWall.id, currentWallBend.id)}
            >
              Удалить изгиб со стены
            </Button>
          </Stack>
        </ScrollArea>
      </Stack>
    );
  }

  // =========================================================================
  // РЕЖИМ 3.1: Выбрано НЕСКОЛЬКО блоков через Shift (Мульти-выбор & Объединение)
  // =========================================================================
  if (selectedCellKeys.length > 1 || selectedPieceIds.length > 1) {
    const totalSelectedCount = selectedPieceIds.length > 0 ? selectedPieceIds.length : selectedCellKeys.length;
    return (
      <Stack
        h="100%"
        gap="xs"
        p="xs"
        style={{
          borderLeft: '1px solid #2C2E33',
          backgroundColor: '#141517',
          width: 320,
          minWidth: 320,
        }}
      >
        <ScrollArea style={{ flex: 1 }}>
          <Stack gap="md" p="xs">
            <Group justify="space-between" align="center">
              <div>
                <Title order={6} c="teal.4">
                  ВЫБРАНО ЭЛЕМЕНТОВ: {totalSelectedCount} шт
                </Title>
                <Text size="xs" c="dimmed">
                  Групповые операции (через Shift)
                </Text>
              </div>
              <Tooltip label="Снять выделение">
                <ActionIcon size="xs" variant="subtle" color="gray" onClick={() => selectPanel(null, null)}>
                  <X size={14} />
                </ActionIcon>
              </Tooltip>
            </Group>

            <Divider color="#2C2E33" />

            {/* Кнопка объединения выбранных блоков */}
            <Button
              size="sm"
              fullWidth
              variant="filled"
              color="teal"
              leftSection={<Combine size={16} />}
              onClick={() => mergeSelectedCells(currentWall.id)}
            >
              🔗 Объединить выбранные блоки
            </Button>

            <Divider color="#2C2E33" />

            {/* Быстрое назначение материала всем выбранным */}
            <div>
              <Text size="xs" mb={6} c="dimmed">
                Назначить материал всем выбранным:
              </Text>
              <Group gap={4} grow>
                <Button
                  size="compact-xs"
                  variant="default"
                  color="blue"
                  onClick={() => setMaterialForSelectedCells(currentWall.id, 'mat-sheet-1220')}
                >
                  Лист
                </Button>
                <Button
                  size="compact-xs"
                  variant="default"
                  color="orange"
                  onClick={() => setMaterialForSelectedCells(currentWall.id, 'mat-slat-16')}
                >
                  Рейка 16
                </Button>
                <Button
                  size="compact-xs"
                  variant="default"
                  color="yellow"
                  onClick={() => setMaterialForSelectedCells(currentWall.id, 'mat-slat-15')}
                >
                  Рейка 15
                </Button>
                <Button
                  size="compact-xs"
                  variant="subtle"
                  color="gray"
                  leftSection={<Ban size={10} />}
                  onClick={() => setMaterialForSelectedCells(currentWall.id, MATERIAL_NONE_ID)}
                >
                  Пусто
                </Button>
              </Group>
            </div>

            <Paper p="xs" withBorder style={{ backgroundColor: '#1A1B1E', borderColor: '#2C2E33' }}>
              <Text size="xs" c="dimmed">
                💡 Вы можете объединять соседние вертикальные сегменты или соседние колонки в одну цельную плиту без лишних швов.
              </Text>
            </Paper>
          </Stack>
        </ScrollArea>
      </Stack>
    );
  }

  // =========================================================================
  // РЕЖИМ 3.2: Выбрана ОДНА конкретная ячейка / плита сетки
  // =========================================================================
  if (selectedColumnIndex !== null || selectedPieceIds.length > 0) {
    const selectedPieceId = selectedPieceIds[0];
    const actualPanelPiece = layoutResult?.panels.find(
      (p) =>
        (selectedPieceId && (p.id === selectedPieceId || p.subPieceId === selectedPieceId)) ||
        (selectedColumnIndex !== null &&
          p.originalColumnIndex === selectedColumnIndex &&
          p.originalSegmentIndex === (selectedSegmentIndex ?? 0))
    );

    const activeColumnIndex = actualPanelPiece ? actualPanelPiece.originalColumnIndex : (selectedColumnIndex ?? 0);
    const activeSegmentIndex = actualPanelPiece ? actualPanelPiece.originalSegmentIndex : (selectedSegmentIndex ?? 0);

    const selectedCustomPanel = currentWall.customPanels[activeColumnIndex];
    const selectedSegment = selectedCustomPanel?.segments?.[activeSegmentIndex];

    const selectedPanelWidth =
      actualPanelPiece !== undefined
        ? actualPanelPiece.width
        : (selectedCustomPanel?.customWidth ?? currentMaterial?.width ?? 1220);

    const selectedPanelHeight =
      actualPanelPiece !== undefined
        ? actualPanelPiece.height
        : (selectedSegment?.height ?? currentWall.height);

    const selectedPanelMaterialId =
      actualPanelPiece?.materialId ??
      selectedSegment?.customMaterialId ??
      selectedCustomPanel?.customMaterialId ??
      currentWall.zone.materialId ??
      MATERIAL_NONE_ID;

    return (
      <Stack
        h="100%"
        gap="xs"
        p="xs"
        style={{
          borderLeft: '1px solid #2C2E33',
          backgroundColor: '#141517',
          width: 320,
          minWidth: 320,
        }}
      >
        <ScrollArea style={{ flex: 1 }}>
          <Stack gap="md" p="xs">
            {(() => {
              const activeSubPieces =
                selectedSegment?.subPieces ||
                selectedCustomPanel?.subPieces ||
                [];

              const activeSub = (selectedSubPieceId && activeSubPieces.find((sp) => sp.id === selectedSubPieceId)) || null;
              const activeMaterialId = activeSub ? (activeSub.materialId || selectedPanelMaterialId) : selectedPanelMaterialId;
              const activeMat = project.materials.find((m) => m.id === activeMaterialId);
              const isCurrentVoid = activeMaterialId === MATERIAL_NONE_ID || !activeMat || Boolean(activeMat.isVoid);
              const baseNum = (selectedCustomPanel?.segments && selectedCustomPanel.segments.length > 1)
                ? `1.${activeColumnIndex + 1}.${activeSegmentIndex + 1}`
                : `1.${activeColumnIndex + 1}`;

              const activePartLabel = activeSub
                ? activeSub.partLabel
                : (selectedSegment?.partLabel || baseNum);

              // Bounding box / Dimensions
              const subXs = activeSub ? activeSub.points.map((p) => p.x) : [];
              const subYs = activeSub ? activeSub.points.map((p) => p.y) : [];
              const activeW = activeSub ? Math.round(Math.max(...subXs) - Math.min(...subXs)) : selectedPanelWidth;
              const activeH = activeSub ? Math.round(Math.max(...subYs) - Math.min(...subYs)) : selectedPanelHeight;
              const activeAreaSqM = activeSub
                ? Math.round((PolygonSlicingEngine.calculatePolygonArea(activeSub.points) / 1_000_000) * 1000) / 1000
                : Math.round(((activeW * activeH) / 1_000_000) * 1000) / 1000;

              return (
                <Stack gap="md">
                  <Group justify="space-between" align="center">
                    <div>
                      <Title order={6} c={isCurrentVoid ? 'gray.4' : 'green.4'}>
                        ПАНЕЛЬ: {activePartLabel}
                      </Title>
                      <Text size="xs" c="dimmed">
                        {isCurrentVoid ? 'Пустое пространство' : `Площадь: ${activeAreaSqM} м²`}
                      </Text>
                    </div>
                    <Group gap={6}>
                      <Badge size="xs" color={isCurrentVoid ? 'gray' : 'green'}>
                        {isCurrentVoid ? 'Пустота' : 'Плита'}
                      </Badge>
                      <Tooltip label="Снять выделение">
                        <ActionIcon size="xs" variant="subtle" color="gray" onClick={() => selectPanel(null, null)}>
                          <X size={14} />
                        </ActionIcon>
                      </Tooltip>
                    </Group>
                  </Group>

                  {/* Переключение между деталями раскроя */}
                  {activeSubPieces.length > 1 && (
                    <div>
                      <Text size="xs" fw={600} c="dimmed" mb={4}>
                        Детали раскроя ({activeSubPieces.length} шт):
                      </Text>
                      <Group gap={4} style={{ flexWrap: 'wrap' }}>
                        {activeSubPieces.map((sp, spIdx) => {
                          const isThisActive = activeSub?.id === sp.id;
                          const spMat = project.materials.find((m) => m.id === sp.materialId);
                          const isSpVoid = sp.isVoid || !spMat || spMat.isVoid || sp.materialId === MATERIAL_NONE_ID;
                          return (
                            <Button
                              key={sp.id}
                              size="compact-xs"
                              variant={isThisActive ? 'filled' : 'default'}
                              color={isSpVoid ? 'gray' : 'blue'}
                              leftSection={
                                !isSpVoid && sp.color ? (
                                  <ColorSwatch color={sp.color} size={10} />
                                ) : undefined
                              }
                              onClick={() => selectSubPiece(sp.id)}
                            >
                              {sp.partLabel || `${baseNum}.${spIdx + 1}`}
                            </Button>
                          );
                        })}
                      </Group>
                    </div>
                  )}

                  <Divider color="#2C2E33" />

                  {/* 1. Габариты и маркировка детали */}
                  <Stack gap="xs">
                    <Group justify="space-between" align="center">
                      <Text size="xs" fw={600} c="dimmed">
                        Габариты и площадь:
                      </Text>
                      <Badge size="xs" variant="outline" color="blue">
                        {activeW} × {activeH} мм ({activeAreaSqM} м²)
                      </Badge>
                    </Group>

                    <TextInput
                      size="xs"
                      label="Маркировка детали (номер)"
                      value={activePartLabel || ''}
                      onChange={(e) => {
                        if (activeSub) {
                          updateSubPieceLabel(
                            currentWall.id,
                            activeColumnIndex,
                            activeSegmentIndex,
                            activeSub.id,
                            e.currentTarget.value
                          );
                        } else {
                          updatePanelSegment(currentWall.id, activeColumnIndex, activeSegmentIndex, {
                            partLabel: e.currentTarget.value,
                          });
                        }
                      }}
                      styles={{ input: { backgroundColor: '#1A1B1E', borderColor: '#2C2E33' } }}
                    />

                    <Group grow gap="xs">
                      <TextInput
                        size="xs"
                        label="Ширина"
                        value={`${activeW} мм`}
                        readOnly
                        styles={{ input: { backgroundColor: '#141517', borderColor: '#2C2E33', color: '#C1C2C5' } }}
                      />
                      <TextInput
                        size="xs"
                        label="Высота"
                        value={`${activeH} мм`}
                        readOnly
                        styles={{ input: { backgroundColor: '#141517', borderColor: '#2C2E33', color: '#C1C2C5' } }}
                      />
                    </Group>
                  </Stack>
                </Stack>
              );
            })()}

            <Divider color="#2C2E33" />

            {(() => {
              const activeSubPieces =
                selectedSegment?.subPieces ||
                selectedCustomPanel?.subPieces ||
                [];

              const activeSub = (selectedSubPieceId && activeSubPieces.find((sp) => sp.id === selectedSubPieceId)) || null;
              const effectiveMaterialId = activeSub ? (activeSub.materialId || selectedPanelMaterialId) : selectedPanelMaterialId;
              const targetMat = project.materials.find((m) => m.id === effectiveMaterialId);
              const effectiveIsVoid = effectiveMaterialId === MATERIAL_NONE_ID || !targetMat || Boolean(targetMat.isVoid);
              const effectiveColor = activeSub
                ? (activeSub.color || targetMat?.color || '#d6cbbe')
                : (selectedSegment?.customColor || selectedCustomPanel?.customColor || targetMat?.color || currentMaterial?.color || '#d6cbbe');
              const effectiveDecorCode = activeSub
                ? (activeSub.decorCode !== undefined ? activeSub.decorCode : (targetMat?.decorCode || ''))
                : (selectedSegment?.customDecorCode !== undefined ? selectedSegment.customDecorCode : (selectedCustomPanel?.customDecorCode !== undefined ? selectedCustomPanel.customDecorCode : (targetMat?.decorCode || currentMaterial?.decorCode || '')));

              const thicknessOpts = targetMat?.thicknessOptions && targetMat.thicknessOptions.length > 0
                ? targetMat.thicknessOptions
                : [targetMat?.thickness || 5];
              const currentThick = activeSub?.thickness || selectedSegment?.customThickness || selectedCustomPanel?.customThickness || targetMat?.thickness || 5;
              const decorsList = targetMat?.availableDecors || [];

              return (
                <Stack gap="xs">
                  {/* Выбор модели панели AllWall */}
                  <Group justify="space-between" align="center">
                    <Text size="xs" fw={600} c="dimmed">
                      Модель панели AllWall:
                    </Text>
                    {effectiveIsVoid && <Badge size="xs" color="gray">Пустота</Badge>}
                  </Group>

                  <Select
                    size="xs"
                    value={effectiveMaterialId}
                    onChange={(val) => {
                      if (!val) return;
                      if (val === MATERIAL_NONE_ID) {
                        clearCellMaterial(currentWall.id, activeColumnIndex, activeSegmentIndex);
                        return;
                      }
                      const chosenModel = project.materials.find((m) => m.id === val);
                      const firstDecor = chosenModel?.availableDecors?.[0];
                      setCellProperties(currentWall.id, activeColumnIndex, activeSegmentIndex, {
                        materialId: val,
                        customThickness: chosenModel?.thickness || chosenModel?.thicknessOptions?.[0] || 5,
                        customColor: firstDecor?.color || chosenModel?.color || '#d6cbbe',
                        customDecorCode: firstDecor?.code || chosenModel?.decorCode || '',
                        customTextureCategory: chosenModel?.textureCategory || 'WOOD',
                        customReliefType: chosenModel?.reliefType || 'FLAT',
                      });
                    }}
                    data={[
                      {
                        group: 'Сплошные панели AllWall',
                        items: project.materials
                          .filter((m) => m.type === 'SHEET' && !m.isVoid)
                          .map((m) => ({ value: m.id, label: `📄 ${m.name}` })),
                      },
                      {
                        group: 'Реечные панели GW10–GW99',
                        items: project.materials
                          .filter((m) => m.type === 'SLAT' && !m.isVoid)
                          .map((m) => ({ value: m.id, label: `🪵 ${m.name}` })),
                      },
                      {
                        group: 'HQ-панели (Глянец & Золото)',
                        items: project.materials
                          .filter((m) => m.type === 'HQ' && !m.isVoid)
                          .map((m) => ({ value: m.id, label: `✨ ${m.name}` })),
                      },
                      {
                        group: 'Специальные зоны',
                        items: [{ value: MATERIAL_NONE_ID, label: '⭕ Без материала (Пустота / Зеркало)' }],
                      },
                    ]}
                    styles={{ input: { backgroundColor: '#1A1B1E', borderColor: '#2C2E33' } }}
                  />

                  {!effectiveIsVoid && (
                    <>
                      {/* Толщина */}
                      <Group justify="space-between" align="center" mt={4}>
                        <Text size="xs" fw={600} c="dimmed">
                          Толщина панели:
                        </Text>
                        <Badge size="xs" color="blue" variant="light">
                          {currentThick} мм
                        </Badge>
                      </Group>

                      {thicknessOpts.length > 1 ? (
                        <SegmentedControl
                          size="xs"
                          value={String(currentThick)}
                          onChange={(val) =>
                            setCellProperties(currentWall.id, activeColumnIndex, activeSegmentIndex, {
                              customThickness: Number(val),
                            })
                          }
                          data={thicknessOpts.map((t) => ({ label: `${t} мм`, value: String(t) }))}
                        />
                      ) : (
                        <Paper p={6} radius="sm" style={{ backgroundColor: '#1A1B1E', border: '1px solid #2C2E33' }}>
                          <Text size="xs" c="dimmed">
                            Фиксированная глубина профиля: <strong style={{ color: '#74C0FC' }}>{thicknessOpts[0]} мм</strong>
                          </Text>
                        </Paper>
                      )}

                      {/* Декор и цвет AllWall */}
                      <Group justify="space-between" align="center" mt={4}>
                        <Text size="xs" fw={600} c="dimmed">
                          Декор и цвет AllWall:
                        </Text>
                        {effectiveDecorCode && (
                          <Badge size="xs" color="dark" style={{ backgroundColor: '#000', color: '#fff' }}>
                            {effectiveDecorCode}
                          </Badge>
                        )}
                      </Group>

                      <Group grow gap="xs">
                        <TextInput
                          size="xs"
                          placeholder="Код декора (7029, 5134...)"
                          value={effectiveDecorCode}
                          onChange={(e) => {
                            const val = e.currentTarget.value.trim();
                            const found = findDecorByCode(val);
                            setCellProperties(currentWall.id, activeColumnIndex, activeSegmentIndex, {
                              customDecorCode: val,
                              ...(found ? { customColor: found.color, customTextureCategory: found.category } : {}),
                            });
                          }}
                          leftSection={<Search size={14} />}
                          styles={{ input: { backgroundColor: '#1A1B1E', borderColor: '#2C2E33', fontFamily: 'JetBrains Mono' } }}
                        />
                        <ColorInput
                          size="xs"
                          placeholder="Цвет (#HEX)"
                          value={effectiveColor}
                          onChange={(colorVal) => {
                            setCellProperties(currentWall.id, activeColumnIndex, activeSegmentIndex, {
                              customColor: colorVal,
                            });
                          }}
                          styles={{ input: { backgroundColor: '#1A1B1E', borderColor: '#2C2E33', fontFamily: 'JetBrains Mono' } }}
                        />
                      </Group>

                      {/* Свотчи декоров AllWall */}
                      {decorsList.length > 0 && (
                        <div>
                          <Text size="xs" c="dimmed" mb={4}>
                            Фирменная палитра модели ({decorsList.length}):
                          </Text>
                          <Group gap={6} style={{ flexWrap: 'wrap' }}>
                            {decorsList.map((decor) => {
                              const isSelected =
                                effectiveDecorCode === decor.code ||
                                (effectiveColor && effectiveColor.toLowerCase() === decor.color.toLowerCase());
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
                                      setCellProperties(currentWall.id, activeColumnIndex, activeSegmentIndex, {
                                        customColor: decor.color,
                                        customDecorCode: decor.code,
                                        customTextureCategory: decor.category,
                                      })
                                    }
                                    style={{
                                      cursor: 'pointer',
                                      padding: 2,
                                      borderRadius: '50%',
                                      border: isSelected ? '2px solid #339af0' : '2px solid transparent',
                                      transform: isSelected ? 'scale(1.2)' : 'scale(1)',
                                      transition: 'all 0.15s ease',
                                    }}
                                  >
                                    <ColorSwatch color={decor.color} size={18} />
                                  </div>
                                </Tooltip>
                              );
                            })}
                          </Group>
                        </div>
                      )}
                    </>
                  )}
                </Stack>
              );
            })()}

            {/* ТЕХНОЛОГИЧЕСКАЯ КАРТА ГИБКИ ЛИСТА (ЧПУ / КЕРФ-ПРОПИЛЫ) */}
            {actualPanelPiece?.bendsInfo && actualPanelPiece.bendsInfo.length > 0 && (
              <Paper p="xs" withBorder style={{ backgroundColor: '#101113', borderColor: '#339af0' }}>
                <Stack gap="xs">
                  <Group justify="space-between">
                    <div>
                      <Text size="xs" fw={700} c="cyan.4">
                        ⌒ КАРТА ГИБКИ ЛИСТА
                      </Text>
                      <Text size="xs" c="dimmed">
                        Деталь пересекает изгиб стены
                      </Text>
                    </div>
                    <Badge size="xs" color="cyan" variant="filled">
                      ГНУТЫЙ ЛИСТ
                    </Badge>
                  </Group>

                  <Divider color="#2C2E33" />

                  {actualPanelPiece.bendsInfo.map((bend, bIdx) => (
                    <Stack key={`bend-info-${bIdx}`} gap={4}>
                      <Group justify="space-between">
                        <Text size="xs" c="dimmed">Тип угла:</Text>
                        <Text size="xs" fw={600} c="gray.2">
                          {bend.radius === 0
                            ? (bend.type === 'INNER_CORNER' ? 'Внутренний острый угол (R=0)' : 'Внешний острый угол (R=0)')
                            : (bend.type === 'INNER_CORNER' ? 'Внутренний угол' : 'Внешний угол') + ` (R=${bend.radius} мм)`}
                        </Text>
                      </Group>
                      <Group justify="space-between">
                        <Text size="xs" c="dimmed">1. Левый участок:</Text>
                        <Text size="xs" fw={700} c="teal.4" style={{ fontFamily: 'JetBrains Mono' }}>
                          {bend.flatLeft} мм
                        </Text>
                      </Group>
                      {bend.radius === 0 ? (
                        <Group justify="space-between">
                          <Text size="xs" c="dimmed">2. Линия перегиба (V-паз/45°):</Text>
                          <Text size="xs" fw={700} c="cyan.4" style={{ fontFamily: 'JetBrains Mono' }}>
                            {bend.bendOffsetInSheet} мм от левого края
                          </Text>
                        </Group>
                      ) : (
                        <Group justify="space-between">
                          <Text size="xs" c="dimmed">2. Зона гибки (пропилы):</Text>
                          <Text size="xs" fw={700} c="cyan.4" style={{ fontFamily: 'JetBrains Mono' }}>
                            {bend.bendWidth} мм ({Math.max(3, Math.floor(bend.bendWidth / 30))} пропилов)
                          </Text>
                        </Group>
                      )}
                      <Group justify="space-between">
                        <Text size="xs" c="dimmed">3. Правый участок:</Text>
                        <Text size="xs" fw={700} c="teal.4" style={{ fontFamily: 'JetBrains Mono' }}>
                          {bend.flatRight} мм
                        </Text>
                      </Group>
                    </Stack>
                  ))}

                  <Alert color="cyan" variant="light" p="xs">
                    <Text size="xs">
                      📐 <b>Габарит заготовки:</b> {Math.round(selectedPanelWidth)} × {Math.round(selectedPanelHeight)} мм
                    </Text>
                  </Alert>
                </Stack>
              </Paper>
            )}





            {/* НАПРАВЛЕНИЕ РИСУНКА И ВОЛОКОН */}
            {(() => {
              const activeSubPieces =
                selectedSegment?.subPieces ||
                selectedCustomPanel?.subPieces ||
                [];
              const targetSub = activeSubPieces.find((sp) => sp.id === selectedSubPieceId);

              const currentPatternAngle =
                targetSub?.patternAngleDeg !== undefined
                  ? targetSub.patternAngleDeg
                  : (selectedSegment?.patternAngleDeg !== undefined
                    ? selectedSegment.patternAngleDeg
                    : selectedCustomPanel?.patternAngleDeg || 0);

              return (
                <Stack gap="xs">
                  <Group justify="space-between" align="center">
                    <Text size="xs" fw={700} c="dimmed">
                      НАПРАВЛЕНИЕ РИСУНКА (УГОЛ ВОЛОКОН)
                    </Text>
                    <Badge size="xs" color="indigo" variant="light">
                      {currentPatternAngle}°
                    </Badge>
                  </Group>

                  {/* Быстрые пресеты углов */}
                  <Group grow gap={4}>
                    {[
                      { label: '0°', val: 0 },
                      { label: '45° ↗', val: 45 },
                      { label: '90° ➔', val: 90 },
                      { label: '-45° ↘', val: 135 },
                    ].map((p) => {
                      const isActive =
                        currentPatternAngle === p.val ||
                        (p.val === 135 && (currentPatternAngle === -45 || currentPatternAngle === 135));
                      return (
                        <Button
                          key={p.label}
                          size="xs"
                          variant={isActive ? 'filled' : 'light'}
                          color={isActive ? 'blue' : 'gray'}
                          p={4}
                          onClick={() =>
                            setPiecePatternAngle(
                              currentWall.id,
                              activeColumnIndex,
                              activeSegmentIndex,
                              selectedSubPieceId,
                              p.val,
                              false
                            )
                          }
                        >
                          {p.label}
                        </Button>
                      );
                    })}
                  </Group>

                  {/* Ручной ввод любого произвольного угла + интерактивный слайдер */}
                  <Group gap="xs" align="center" mt={2}>
                    <Box style={{ flex: 1 }}>
                      <Slider
                        size="xs"
                        min={-180}
                        max={180}
                        step={1}
                        value={currentPatternAngle > 180 ? currentPatternAngle - 360 : currentPatternAngle}
                        onChange={(val) =>
                          setPiecePatternAngle(
                            currentWall.id,
                            activeColumnIndex,
                            activeSegmentIndex,
                            selectedSubPieceId,
                            val,
                            false
                          )
                        }
                        marks={[
                          { value: -90, label: '-90°' },
                          { value: 0, label: '0°' },
                          { value: 90, label: '90°' },
                        ]}
                        mb="xs"
                      />
                    </Box>
                    <NumberInput
                      size="xs"
                      suffix="°"
                      min={-360}
                      max={360}
                      step={1}
                      value={currentPatternAngle}
                      onChange={(val) => {
                        const num = typeof val === 'number' ? val : (val === '' ? 0 : Number(val));
                        setPiecePatternAngle(
                          currentWall.id,
                          activeColumnIndex,
                          activeSegmentIndex,
                          selectedSubPieceId,
                          num,
                          false
                        );
                      }}
                      style={{ width: '85px' }}
                      styles={{ input: { backgroundColor: '#1A1B1E', borderColor: '#2C2E33', textAlign: 'center' } }}
                    />
                  </Group>
                </Stack>
              );
            })()}

            <Divider color="#2C2E33" />

            {/* ИНСТРУМЕНТЫ РАЗРЕЗА И ДЕЛЕНИЯ ПАНЕЛИ */}
            <Stack gap="xs">
              <Text size="xs" fw={700} c="dimmed">
                РАЗРЕЗ И ДЕЛЕНИЕ ДЕТАЛИ
              </Text>

              {/* Акцентная кнопка Редактора раскроя (Нож) */}
              <Button
                size="sm"
                variant="filled"
                color="blue"
                leftSection={<Scissors size={16} />}
                onClick={() =>
                  openSlicingModal(
                    currentWall.id,
                    activeColumnIndex,
                    activeSegmentIndex,
                    selectedPieceId || selectedSubPieceId
                  )
                }
                style={{ fontWeight: 600 }}
              >
                Редактор раскроя (CAD-Нож)
              </Button>

              {/* Быстрые кнопки разрезов вертикальным списком */}
              <Button
                size="xs"
                variant="light"
                color="blue"
                leftSection={<Split size={14} />}
                onClick={() =>
                  splitPanelHorizontally(
                    currentWall.id,
                    activeColumnIndex,
                    activeSegmentIndex,
                    Math.round(selectedPanelHeight / 2)
                  )
                }
              >
                Разрез по горизонтали (Пополам)
              </Button>

              <Button
                size="xs"
                variant="light"
                color="cyan"
                leftSection={<Columns2 size={14} />}
                onClick={() =>
                  splitColumnVertically(
                    currentWall.id,
                    activeColumnIndex,
                    Math.round(selectedPanelWidth / 2)
                  )
                }
              >
                Разрез по вертикали (Пополам)
              </Button>

              <Divider color="#2C2E33" my={4} />

              <Button
                size="xs"
                variant="subtle"
                color="red"
                leftSection={<Trash2 size={14} />}
                onClick={() =>
                  clearCellMaterial(currentWall.id, activeColumnIndex, activeSegmentIndex)
                }
              >
                Удалить деталь (Сделать ПУСТО)
              </Button>
            </Stack>
          </Stack>
        </ScrollArea>
      </Stack>
    );
  }

  // =========================================================================
  // РЕЖИМ 4: Ничего не выбрано (контекст ВСЕЙ СТЕНЫ)
  // =========================================================================
  return (
    <Stack
      h="100%"
      gap="xs"
      p="xs"
      style={{
        borderLeft: '1px solid #2C2E33',
        backgroundColor: '#141517',
        width: 320,
        minWidth: 320,
      }}
    >
      <ScrollArea style={{ flex: 1 }}>
        <Stack gap="md" p="xs">
          {editMode === 'JOINTS' && (
            <Alert color="yellow" variant="light" title="⚡ Режим «Стыки и профили»" icon={<Sparkles size={16} />}>
              Все стыки подсвечены на чертеже. Кликните по любому стыку или зажмите Shift для выбора нескольких, чтобы настроить ширину шва, профиль или включить LED-подсветку.
            </Alert>
          )}

          <div>
            <Title order={6} c="dimmed" style={{ textTransform: 'uppercase', letterSpacing: '1px' }}>
              Параметры стены
            </Title>
            <Text size="xs" fw={500} c="bright">
              {currentWall.name}
            </Text>
          </div>

          <Divider color="#2C2E33" />

          {/* Габариты всей стены */}
          <Title order={6} size="xs" c="dimmed">
            Габариты
          </Title>
          <Group grow>
            <NumberInput
              size="xs"
              label="Ширина стены (мм)"
              value={currentWall.width || ''}
              clampBehavior="blur"
              allowNegative={false}
              allowDecimal={false}
              min={100}
              max={30000}
              step={50}
              onChange={(val) =>
                updateWallDimensions(
                  currentWall.id,
                  typeof val === 'number' ? val : (val === '' ? 0 : Number(val)),
                  currentWall.height
                )
              }
            />
            <NumberInput
              size="xs"
              label="Высота стены (мм)"
              value={currentWall.height || ''}
              clampBehavior="blur"
              allowNegative={false}
              allowDecimal={false}
              min={100}
              max={10000}
              step={50}
              onChange={(val) =>
                updateWallDimensions(
                  currentWall.id,
                  currentWall.width,
                  typeof val === 'number' ? val : (val === '' ? 0 : Number(val))
                )
              }
            />
          </Group>

          <Divider color="#2C2E33" />

          {/* Предварительный расчет и баланс площадей */}
          <Title order={6} size="xs" c="dimmed">
            Баланс площадей и смета стены
          </Title>

          {layoutResult && (
            <Stack gap={6}>
              <Paper p="xs" withBorder style={{ backgroundColor: '#1A1B1E', borderColor: '#2C2E33' }}>
                <Group justify="space-between" mb={4}>
                  <Text size="xs" c="dimmed">Общая площадь стены:</Text>
                  <Text size="xs" fw={600}>{layoutResult.summary.wallAreaSqM} м²</Text>
                </Group>
                <Group justify="space-between" mb={4}>
                  <Text size="xs" c="green.4">Чистая зашивка (Нетто):</Text>
                  <Text size="xs" fw={600} c="green.4">{layoutResult.summary.coveredAreaSqM} м²</Text>
                </Group>
                {(layoutResult.summary.slopeAreaSqM ?? 0) > 0 && (
                  <Group justify="space-between" mb={4}>
                    <Text size="xs" c="cyan.4">Площадь откосов:</Text>
                    <Text size="xs" fw={600} c="cyan.4">+{layoutResult.summary.slopeAreaSqM} м²</Text>
                  </Group>
                )}
                {(layoutResult.summary.totalCoveredWithSlopesSqM ?? 0) > 0 && (
                  <Group justify="space-between" mb={4}>
                    <Text size="xs" c="teal.3">Итого облицовка (со стеной):</Text>
                    <Text size="xs" fw={700} c="teal.3">{layoutResult.summary.totalCoveredWithSlopesSqM} м²</Text>
                  </Group>
                )}
                {layoutResult.summary.cutoutsAreaSqM > 0 && (
                  <Group justify="space-between" mb={4}>
                    <Text size="xs" c="blue.4">Площадь проемов (вырезы):</Text>
                    <Text size="xs" fw={600} c="blue.4">{layoutResult.summary.cutoutsAreaSqM} м²</Text>
                  </Group>
                )}
                {layoutResult.summary.voidAreaSqM > 0 && (
                  <Group justify="space-between" mb={4}>
                    <Text size="xs" c="gray.4">Пустое пространство:</Text>
                    <Text size="xs" fw={600} c="gray.4">{layoutResult.summary.voidAreaSqM} м²</Text>
                  </Group>
                )}
                <Divider my={4} color="#2C2E33" />
                <Group justify="space-between" mb={4}>
                  <Text size="xs" c="dimmed">Панелей в смете:</Text>
                  <Text size="xs" fw={600}>{layoutResult.summary.totalPanelsNeeded} шт</Text>
                </Group>
                {layoutResult.summary.cutoutsAreaSqM > 0 && (
                  <Group justify="space-between" mb={4}>
                    <Text size="xs" c="dimmed">Площадь плит (Брутто):</Text>
                    <Text size="xs" fw={600}>{layoutResult.summary.grossCoveredAreaSqM} м²</Text>
                  </Group>
                )}
                <Group justify="space-between" mb={4}>
                  <Text size="xs" c="dimmed">Погонаж профилей (В+Г):</Text>
                  <Text size="xs" fw={600} c="yellow.4">{layoutResult.summary.profileLinearMeters} пог. м</Text>
                </Group>
                {(layoutResult.summary.slopeProfileLinearMeters ?? 0) > 0 && (
                  <Group justify="space-between">
                    <Text size="xs" c="dimmed">В т.ч. профиль откосов:</Text>
                    <Text size="xs" fw={600} c="orange.4">{layoutResult.summary.slopeProfileLinearMeters} пог. м</Text>
                  </Group>
                )}

              </Paper>
            </Stack>
          )}
        </Stack>
      </ScrollArea>
    </Stack>
  );
};
