import React from 'react';
import {
  Stack,
  Title,
  NumberInput,
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
} from '@mantine/core';
import {
  RotateCcw,
  Split,
  Columns2,
  Ban,
  Trash2,
  X,
  Zap,
  Sparkles,
  Combine,
  AlertTriangle,
  CheckCircle2,
  Link,
} from 'lucide-react';
import { useProjectStore, JointPreset } from '../../../application/stores/useProjectStore';
import { LayoutEngine } from '../../../core/layout/LayoutEngine';
import { ProfileType } from '../../../core/models/Profile';
import { MATERIAL_NONE_ID } from '../../../core/models/Material';

export const RightSidebar: React.FC = () => {
  const {
    project,
    selectedColumnIndex,
    selectedSegmentIndex,
    selectedCellKeys,
    selectedJointId,
    selectedJointIds,
    selectOpening,
    selectPanel,
    selectJoint,
    updateWallDimensions,
    setWallMaterial,
    setWallJointProfile,
    setWallStartOffset,
    updateOpening,
    removeOpening,
    mergeSelectedCells,
    setMaterialForSelectedCells,
    validateSelectedJoints,
    mergeSelectedJoints,
    syncSelectedJointsParams,
    setJointPresetForSelected,
    setJointWidthForSelected,
    setJointLEDForSelected,
    setJointWidth,
    setJointLED,
    setJointPreset,
    updatePanelConfig,
    updatePanelSegment,
    setCellMaterial,
    clearCellMaterial,
    splitPanelHorizontally,
    splitColumnVertically,
    resetPanelConfig,
  } = useProjectStore();

  const selectedWallId = project.selectedWallId;
  const selectedOpeningId = project.selectedOpeningId;

  const currentWall = project.walls.find((w) => w.id === selectedWallId);
  const currentOpening = currentWall?.openings.find((op) => op.id === selectedOpeningId);
  const currentMaterial = project.materials.find(
    (m) => m.id === (currentWall?.zone.materialId || 'mat-sheet-1220')
  );

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

            {/* Массовое управление параметрами всех выбранных швов */}
            <div>
              <Text size="xs" mb={6} c="dimmed">
                Установить параметры для всех выбранных:
              </Text>
              <Group gap={4} grow mb={4}>
                <Button
                  size="compact-xs"
                  variant="default"
                  color="gray"
                  onClick={() => setJointPresetForSelected(currentWall.id, 'NONE')}
                >
                  0 мм
                </Button>
                <Button
                  size="compact-xs"
                  variant="default"
                  color="blue"
                  onClick={() => setJointPresetForSelected(currentWall.id, '5')}
                >
                  5 мм
                </Button>
                <Button
                  size="compact-xs"
                  variant="default"
                  color="blue"
                  onClick={() => setJointPresetForSelected(currentWall.id, '8')}
                >
                  8 мм
                </Button>
                <Button
                  size="compact-xs"
                  variant="default"
                  color="cyan"
                  onClick={() => setJointPresetForSelected(currentWall.id, '10')}
                >
                  10 мм
                </Button>
              </Group>

              <Button
                size="xs"
                fullWidth
                variant="light"
                color="yellow"
                leftSection={<Zap size={14} />}
                onClick={() => setJointPresetForSelected(currentWall.id, 'LED_10')}
              >
                ✨ Включить LED 10 мм для всех
              </Button>
            </div>

            <NumberInput
              size="xs"
              label="Точная ширина для всех выбранных (мм)"
              description="Устанавливает заданную толщину для всех выделенных швов"
              value={validation.widths[0] ?? 8}
              clampBehavior="blur"
              allowNegative={false}
              allowDecimal={false}
              min={0}
              max={100}
              step={1}
              onChange={(val) =>
                setJointWidthForSelected(
                  currentWall.id,
                  typeof val === 'number' ? val : (val === '' ? 0 : Number(val))
                )
              }
            />

            <Paper p="xs" withBorder style={{ backgroundColor: '#1A1B1E', borderColor: '#2C2E33' }}>
              <Group justify="space-between">
                <div>
                  <Text size="xs" fw={500}>
                    LED-подсветка для всех
                  </Text>
                  <Text size="xs" c="dimmed">
                    Включить/выключить LED для группы
                  </Text>
                </div>
                <Switch
                  checked={validation.sameLED && validation.ledStates[0] === true}
                  color="yellow"
                  onChange={(e) =>
                    setJointLEDForSelected(currentWall.id, e.currentTarget.checked)
                  }
                />
              </Group>
            </Paper>
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
    const isHoriz = selectedJoint?.orientation === 'HORIZONTAL' || selectedJointId.includes('-h-');

    // Определение активного пресета
    let activePreset: JointPreset | null = null;
    if (isLED && currentWidth === 10) {
      activePreset = 'LED_10';
    } else if (!isLED && currentWidth === 0) {
      activePreset = 'NONE';
    } else if (!isLED && currentWidth === 5) {
      activePreset = '5';
    } else if (!isLED && currentWidth === 8) {
      activePreset = '8';
    } else if (!isLED && currentWidth === 10) {
      activePreset = '10';
    }

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

            {/* Быстрые пресеты ширины шва */}
            <div>
              <Text size="xs" mb={6} c="dimmed">
                Быстрый выбор шва:
              </Text>
              <Group gap={4} grow mb={4}>
                <Button
                  size="compact-xs"
                  variant={activePreset === 'NONE' ? 'filled' : 'default'}
                  color="gray"
                  onClick={() => setJointPreset(currentWall.id, selectedJointId, 'NONE')}
                >
                  0 мм
                </Button>
                <Button
                  size="compact-xs"
                  variant={activePreset === '5' ? 'filled' : 'default'}
                  color="blue"
                  onClick={() => setJointPreset(currentWall.id, selectedJointId, '5')}
                >
                  5 мм
                </Button>
                <Button
                  size="compact-xs"
                  variant={activePreset === '8' ? 'filled' : 'default'}
                  color="blue"
                  onClick={() => setJointPreset(currentWall.id, selectedJointId, '8')}
                >
                  8 мм
                </Button>
                <Button
                  size="compact-xs"
                  variant={activePreset === '10' ? 'filled' : 'default'}
                  color="cyan"
                  onClick={() => setJointPreset(currentWall.id, selectedJointId, '10')}
                >
                  10 мм
                </Button>
              </Group>

              {/* Кнопка светодиодной подсветки (LED ставится только при нажатии!) */}
              <Button
                size="xs"
                fullWidth
                variant={isLED ? 'filled' : 'light'}
                color="yellow"
                leftSection={isLED ? <Zap size={14} /> : <Sparkles size={14} />}
                onClick={() =>
                  setJointPreset(currentWall.id, selectedJointId, isLED ? '8' : 'LED_10')
                }
              >
                {isLED ? '⚡ Выключить LED-подсветку' : '✨ Светодиодная подсветка (LED 10 мм)'}
              </Button>
            </div>

            {/* Произвольный ввод ширины шва (мм). Ввод 10 НЕ включает LED! */}
            <NumberInput
              size="xs"
              label="Точная ширина шва (мм)"
              description="Ввод любого значения (например, 10 мм — это обычный шов, не LED)"
              value={currentWidth}
              clampBehavior="blur"
              allowNegative={false}
              allowDecimal={false}
              min={0}
              max={100}
              step={1}
              onChange={(val) =>
                setJointWidth(
                  currentWall.id,
                  selectedJointId,
                  typeof val === 'number' ? val : (val === '' ? 0 : Number(val))
                )
              }
            />

            {/* Переключатель светодиодной подсветки */}
            <Paper p="xs" withBorder style={{ backgroundColor: '#1A1B1E', borderColor: '#2C2E33' }}>
              <Group justify="space-between">
                <div>
                  <Text size="xs" fw={500}>
                    Светодиодная лента (LED)
                  </Text>
                  <Text size="xs" c="dimmed">
                    Подсветка профиля в стыке
                  </Text>
                </div>
                <Switch
                  checked={isLED}
                  color="yellow"
                  onChange={(e) =>
                    setJointLED(currentWall.id, selectedJointId, e.currentTarget.checked)
                  }
                />
              </Group>
            </Paper>

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

            <Group grow>
              <NumberInput
                size="xs"
                label="Ширина (мм)"
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

            <NumberInput
              size="xs"
              label="Глубина откоса (мм)"
              value={currentOpening.slopeDepth ?? 0}
              clampBehavior="blur"
              allowNegative={false}
              allowDecimal={false}
              min={0}
              max={1000}
              step={10}
              onChange={(val) =>
                updateOpening(currentWall.id, {
                  id: currentOpening.id,
                  slopeDepth: typeof val === 'number' ? val : (val === '' ? 0 : Number(val)),
                })
              }
            />

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
  // РЕЖИМ 3.1: Выбрано НЕСКОЛЬКО блоков через Shift (Мульти-выбор & Объединение)
  // =========================================================================
  if (selectedCellKeys.length > 1) {
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
                  ВЫБРАНО БЛОКОВ: {selectedCellKeys.length} шт
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
  if (selectedColumnIndex !== null) {
    const selectedCustomPanel = currentWall.customPanels[selectedColumnIndex];
    const activeSegmentIndex = selectedSegmentIndex ?? 0;
    const selectedSegment = selectedCustomPanel?.segments?.[activeSegmentIndex];
    const actualPanelPiece = layoutResult?.panels.find(
      (p) =>
        p.originalColumnIndex === selectedColumnIndex &&
        p.originalSegmentIndex === activeSegmentIndex
    );

    const selectedPanelWidth =
      actualPanelPiece !== undefined
        ? actualPanelPiece.width
        : (selectedCustomPanel?.customWidth ?? currentMaterial?.width ?? 1220);

    const selectedPanelHeight =
      actualPanelPiece !== undefined
        ? actualPanelPiece.height
        : (selectedSegment?.height ?? currentWall.height);

    const selectedPanelMaterialId =
      selectedSegment?.customMaterialId ??
      selectedCustomPanel?.customMaterialId ??
      currentWall.zone.materialId ??
      'mat-sheet-1220';

    const isCellVoid = selectedPanelMaterialId === MATERIAL_NONE_ID;

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
                <Title order={6} c={isCellVoid ? 'gray.4' : 'green.4'}>
                  ЯЧЕЙКА: К#{selectedColumnIndex + 1} Р#{activeSegmentIndex + 1}
                </Title>
                <Text size="xs" c="dimmed">
                  {isCellVoid ? 'Пустое пространство' : `Деталь ${selectedSegment?.partLabel || `1.${selectedColumnIndex + 1}`}`}
                </Text>
              </div>
              <Group gap={6}>
                <Badge size="xs" color={isCellVoid ? 'gray' : 'green'}>
                  {isCellVoid ? 'Пустота' : 'Плита'}
                </Badge>
                <Tooltip label="Снять выделение">
                  <ActionIcon size="xs" variant="subtle" color="gray" onClick={() => selectPanel(null, null)}>
                    <X size={14} />
                  </ActionIcon>
                </Tooltip>
              </Group>
            </Group>

            <Divider color="#2C2E33" />

            {/* Быстрые кнопки назначения материала */}
            <div>
              <Text size="xs" mb={6} c="dimmed">
                Материал плиты:
              </Text>
              <Group gap={4} grow>
                <Button
                  size="compact-xs"
                  variant={selectedPanelMaterialId === 'mat-sheet-1220' ? 'filled' : 'default'}
                  color="blue"
                  onClick={() =>
                    setCellMaterial(
                      currentWall.id,
                      selectedColumnIndex,
                      activeSegmentIndex,
                      'mat-sheet-1220'
                    )
                  }
                >
                  Лист
                </Button>
                <Button
                  size="compact-xs"
                  variant={selectedPanelMaterialId === 'mat-slat-16' ? 'filled' : 'default'}
                  color="orange"
                  onClick={() =>
                    setCellMaterial(
                      currentWall.id,
                      selectedColumnIndex,
                      activeSegmentIndex,
                      'mat-slat-16'
                    )
                  }
                >
                  Рейка 16
                </Button>
                <Button
                  size="compact-xs"
                  variant={selectedPanelMaterialId === 'mat-slat-15' ? 'filled' : 'default'}
                  color="yellow"
                  onClick={() =>
                    setCellMaterial(
                      currentWall.id,
                      selectedColumnIndex,
                      activeSegmentIndex,
                      'mat-slat-15'
                    )
                  }
                >
                  Рейка 15
                </Button>
                <Button
                  size="compact-xs"
                  variant={isCellVoid ? 'filled' : 'subtle'}
                  color="gray"
                  leftSection={<Ban size={10} />}
                  onClick={() =>
                    clearCellMaterial(currentWall.id, selectedColumnIndex, activeSegmentIndex)
                  }
                >
                  Пусто
                </Button>
              </Group>
            </div>

            {/* Размеры выбранной ячейки */}
            <Group grow>
              <NumberInput
                size="xs"
                label="Ширина (мм)"
                value={selectedPanelWidth || ''}
                clampBehavior="blur"
                allowNegative={false}
                allowDecimal={false}
                min={10}
                max={25000}
                step={10}
                onChange={(val) =>
                  updatePanelConfig(currentWall.id, selectedColumnIndex, {
                    customWidth: typeof val === 'number' ? val : (val === '' ? 0 : Number(val)),
                  })
                }
              />
              <NumberInput
                size="xs"
                label="Высота (мм)"
                value={selectedPanelHeight || ''}
                clampBehavior="blur"
                allowNegative={false}
                allowDecimal={false}
                min={10}
                max={10000}
                step={10}
                onChange={(val) =>
                  updatePanelSegment(currentWall.id, selectedColumnIndex, activeSegmentIndex, {
                    height: typeof val === 'number' ? val : (val === '' ? 0 : Number(val)),
                  })
                }
              />
            </Group>

            <Divider color="#2C2E33" />

            {/* Инструменты деления сетки */}
            <Group grow>
              <Button
                size="xs"
                variant="light"
                color="blue"
                leftSection={<Split size={12} />}
                onClick={() =>
                  splitPanelHorizontally(
                    currentWall.id,
                    selectedColumnIndex,
                    activeSegmentIndex,
                    Math.round(selectedPanelHeight / 2)
                  )
                }
              >
                Разрез по гориз.
              </Button>
              <Button
                size="xs"
                variant="light"
                color="cyan"
                leftSection={<Columns2 size={12} />}
                onClick={() =>
                  splitColumnVertically(
                    currentWall.id,
                    selectedColumnIndex,
                    Math.round(selectedPanelWidth / 2)
                  )
                }
              >
                Разрез по верт.
              </Button>
            </Group>

            {selectedCustomPanel && (
              <Button
                size="xs"
                variant="subtle"
                color="gray"
                leftSection={<RotateCcw size={12} />}
                onClick={() => resetPanelConfig(currentWall.id, selectedColumnIndex)}
              >
                Сбросить колонку к стандарту
              </Button>
            )}
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

          {/* Базовый материал стены */}
          <Title order={6} size="xs" c="dimmed">
            Основной материал покрытия
          </Title>

          <Select
            size="xs"
            label="Материал по умолчанию"
            value={currentWall.zone.materialId}
            onChange={(val) => val && setWallMaterial(currentWall.id, val)}
            data={project.materials.map((mat) => ({
              value: mat.id,
              label: mat.name,
            }))}
          />

          {currentMaterial && (
            <Paper p="xs" withBorder style={{ backgroundColor: '#1A1B1E', borderColor: '#2C2E33' }}>
              <Group gap="xs">
                <ColorSwatch color={currentMaterial.color} size={18} />
                <div>
                  <Text size="xs" fw={500}>
                    {currentMaterial.type === 'SHEET' ? 'Лист' : (currentMaterial.type === 'SLAT' ? 'Рейка' : 'Без отделки')}: {currentMaterial.width}×{currentMaterial.height} мм
                  </Text>
                  <Text size="xs" c="dimmed">
                    Толщина: {currentMaterial.thickness} мм
                  </Text>
                </div>
              </Group>
            </Paper>
          )}

          <Divider color="#2C2E33" />

          {/* Базовый профиль швов */}
          <Title order={6} size="xs" c="dimmed">
            Швы и профили по умолчанию
          </Title>

          <div>
            <Text size="xs" mb={4} c="dimmed">
              Шов между панелями:
            </Text>
            <SegmentedControl
              size="xs"
              fullWidth
              value={currentWall.zone.jointProfileType || 'JOINT_8'}
              onChange={(val) => setWallJointProfile(currentWall.id, val as ProfileType)}
              data={[
                { label: '8 мм (Стандарт)', value: 'JOINT_8' },
                { label: '0.8 мм', value: 'H_JOINT' },
                { label: 'LED 10 мм', value: 'LED_10' },
              ]}
            />
          </div>

          <NumberInput
            size="xs"
            label="Смещение первого шва (мм)"
            value={currentWall.zone.startOffsetX ?? 0}
            clampBehavior="blur"
            allowNegative={false}
            allowDecimal={false}
            min={0}
            max={currentMaterial?.width || 1220}
            step={10}
            onChange={(val) =>
              setWallStartOffset(
                currentWall.id,
                typeof val === 'number' ? val : (val === '' ? 0 : Number(val))
              )
            }
          />

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
                  <Text size="xs" c="green.4">Площадь зашивки материалом:</Text>
                  <Text size="xs" fw={600} c="green.4">{layoutResult.summary.coveredAreaSqM} м²</Text>
                </Group>
                {layoutResult.summary.voidAreaSqM > 0 && (
                  <Group justify="space-between" mb={4}>
                    <Text size="xs" c="gray.4">Пустое пространство:</Text>
                    <Text size="xs" fw={600} c="gray.4">{layoutResult.summary.voidAreaSqM} м²</Text>
                  </Group>
                )}
                {layoutResult.summary.cutoutsAreaSqM > 0 && (
                  <Group justify="space-between" mb={4}>
                    <Text size="xs" c="dimmed">Площадь проемов (двери/окна):</Text>
                    <Text size="xs" fw={600}>{layoutResult.summary.cutoutsAreaSqM} м²</Text>
                  </Group>
                )}
                <Divider my={4} color="#2C2E33" />
                <Group justify="space-between" mb={4}>
                  <Text size="xs" c="dimmed">Панелей в смете:</Text>
                  <Text size="xs" fw={600}>{layoutResult.summary.totalPanelsNeeded} шт</Text>
                </Group>
                <Group justify="space-between">
                  <Text size="xs" c="dimmed">Погонаж профилей (В+Г):</Text>
                  <Text size="xs" fw={600} c="yellow.4">{layoutResult.summary.profileLinearMeters} пог. м</Text>
                </Group>
              </Paper>
            </Stack>
          )}
        </Stack>
      </ScrollArea>
    </Stack>
  );
};
