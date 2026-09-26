import React, { useState } from 'react';
import {
  Modal,
  Group,
  Button,
  ActionIcon,
  Tooltip,
  Divider,
  Text,
  Menu,
  SegmentedControl,
} from '@mantine/core';
import {
  DoorOpen,
  RectangleVertical,
  AppWindow,
  Tv,
  Square,
  Maximize2,
  Layers,
  Palette,
  Save,
  FolderKanban,
  Check,
  Download,
  FileText,
  Boxes,
  Wrench,
  Ruler,
  Loader2,
  PanelLeftClose,
  PanelLeftOpen,
} from 'lucide-react';
import { useEditorStore } from '../../../application/stores/useEditorStore';
import { useProjectStore } from '../../../application/stores/useProjectStore';
import { useWallEditorStore } from '../../../application/stores/useWallEditorStore';
import { AllWallCatalogModal } from '../catalog/AllWallCatalogModal';
import { PdfExportService } from '../../../application/services/PdfExportService';
import { useAppTheme } from '../../theme/useAppTheme';
import type { OpeningType } from '../../../core/models/Opening';

export const TopToolbar: React.FC = () => {
  const t = useAppTheme();
  const {
    viewMode,
    setViewMode,
    editMode,
    setEditMode,
    resetView,
    showTextures,
    toggleTextures,
    showLeftSidebar,
    toggleLeftSidebar,
    setCurrentScreen,
  } = useEditorStore();

  const {
    project,
    isDirty,
    lastSavedAt,
    saveCurrentProject,
    addOpening,
    selectJoint,
    selectPanel,
    selectOpening,
    selectWallBend,
  } = useProjectStore();

  const [catalogOpened, setCatalogOpened] = useState(false);
  const [isSavedRecently, setIsSavedRecently] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const [exportingType, setExportingType] = useState<string | null>(null);

  const selectedWallId = project.selectedWallId;
  const showSavedConfirmation = isSavedRecently && !isDirty;

  const handleSave = async () => {
    await saveCurrentProject();
    setIsSavedRecently(true);
    setTimeout(() => setIsSavedRecently(false), 2500);
  };

  const handleExportPanelsLayout = async () => {
    try {
      setExportingType('PANELS');
      await PdfExportService.exportPanelsLayoutPdf(project);
    } catch (e) {
      console.error('Export panels layout failed', e);
      setExportError(e instanceof Error ? e.message : 'Не удалось создать PDF.');
    } finally {
      setExportingType(null);
    }
  };

  const handleExport3DAlbum = async () => {
    try {
      setExportingType('3D');
      await PdfExportService.exportAxonometric3DPdf(project);
    } catch (e) {
      console.error('Export 3D failed', e);
      setExportError(e instanceof Error ? e.message : 'Не удалось создать PDF.');
    } finally {
      setExportingType(null);
    }
  };

  const handleExportInstaller = async () => {
    try {
      setExportingType('INSTALLER');
      await PdfExportService.exportInstallerPdf(project);
    } catch (e) {
      console.error('Export installer doc failed', e);
      setExportError(e instanceof Error ? e.message : 'Не удалось создать PDF.');
    } finally {
      setExportingType(null);
    }
  };

  const handleExportCuttingDetails = async () => {
    try {
      setExportingType('CUTTING_DETAILS');
      await PdfExportService.exportCuttingDetailsPdf(project);
    } catch (e) {
      console.error('Export cutting details failed', e);
      setExportError(e instanceof Error ? e.message : 'Не удалось создать PDF.');
    } finally {
      setExportingType(null);
    }
  };

  const handleAddOpening = (type: OpeningType) => {
    if (selectedWallId) {
      addOpening(selectedWallId, type);
    }
  };

  return (
    <>
      <Modal opened={!!exportError} onClose={() => setExportError(null)} title="Экспорт требует исправления">
        <Text size="sm">{exportError}</Text>
      </Modal>
      <Group
        role="toolbar"
        aria-label="Верхнее меню"
        justify="space-between"
        wrap="nowrap"
        gap="xs"
        px="md"
        py={6}
        style={{ flexShrink: 0, overflowX: 'auto', borderBottom: `1px solid ${t.border}`, backgroundColor: t.bgHeader }}
      >
        {/* Меню проектов, Сохранение и Экспорт */}
        <Group gap="xs" wrap="nowrap" style={{ flexShrink: 0 }}>
          {/* Кнопка скрытия / показа списка стен */}
          <Tooltip label={showLeftSidebar ? "Скрыть меню стен" : "Показать меню стен"} position="bottom">
            <ActionIcon
              size="sm"
              variant={showLeftSidebar ? "light" : "default"}
              color={showLeftSidebar ? "blue" : "gray"}
              onClick={toggleLeftSidebar}
              styles={{
                root: {
                  border: `1px solid ${t.border}`,
                  backgroundColor: t.isDark ? (showLeftSidebar ? undefined : '#26282D') : (showLeftSidebar ? undefined : '#F1F5F9'),
                },
              }}
            >
              {showLeftSidebar ? <PanelLeftClose size={15} /> : <PanelLeftOpen size={15} />}
            </ActionIcon>
          </Tooltip>

          {/* Кнопка возврата в меню проектов */}
          <Tooltip label="Меню проектов" position="bottom">
            <Button
              size="xs"
              variant="subtle"
              color="gray"
              leftSection={<FolderKanban size={15} color="#3884FF" />}
              onClick={() => setCurrentScreen('WELCOME')}
              styles={{
                root: {
                  fontWeight: 700,
                  backgroundColor: t.isDark ? '#26282D' : '#F1F5F9',
                  border: `1px solid ${t.border}`,
                  color: t.textPrimary,
                  paddingLeft: 8,
                  paddingRight: 10,
                },
              }}
            >
              Проекты
            </Button>
          </Tooltip>

          {/* Кнопка "Сохранить проект" */}
          <Tooltip label="Сохранить проект в хранилище (Ctrl + S)" position="bottom">
            <Button
              size="xs"
              variant={showSavedConfirmation ? 'light' : isDirty ? 'filled' : 'light'}
              color={showSavedConfirmation ? 'green' : isDirty ? 'blue' : 'gray'}
              leftSection={showSavedConfirmation ? <Check size={14} color="#10B981" /> : <Save size={14} />}
              onClick={handleSave}
              styles={{
                root: {
                  fontWeight: 600,
                  fontSize: 12,
                },
              }}
            >
              {showSavedConfirmation
                ? 'Сохранено!'
                : isDirty
                ? 'Сохранить*'
                : lastSavedAt
                ? `Сохранено (${lastSavedAt})`
                : 'Сохранить'}
            </Button>
          </Tooltip>

          {/* Меню Экспорта в различные форматы */}
          <Menu shadow="md" width={300} trigger="hover" openDelay={100} closeDelay={200} position="bottom-start">
            <Menu.Target>
              <Button
                size="xs"
                variant="light"
                color="violet"
                leftSection={exportingType ? <Loader2 size={14} /> : <Download size={14} />}
                disabled={Boolean(exportingType)}
                styles={{
                  root: {
                    fontWeight: 600,
                    fontSize: 12,
                  },
                }}
              >
                {exportingType ? 'Экспорт...' : 'Экспорт ▾'}
              </Button>
            </Menu.Target>

            <Menu.Dropdown>
              <Menu.Label>Форматы экспорта в PDF</Menu.Label>
              <Menu.Item
                leftSection={<FileText size={16} color="#3b82f6" />}
                onClick={handleExportPanelsLayout}
              >
                <div>
                  <Text size="xs" fw={700} c="blue.6">1. Раскладка панелей (PDF)</Text>
                  <Text size="10px" c="dimmed">План стены + карты раскроя листов и реек</Text>
                </div>
              </Menu.Item>
              <Menu.Item
                leftSection={<Boxes size={16} color="#10b981" />}
                onClick={handleExport3DAlbum}
              >
                <div>
                  <Text size="xs" fw={700} c="green.6">2. 3D Аксонометрия (PDF)</Text>
                  <Text size="10px" c="dimmed">3D альбом всех стен с текстурами и размерами</Text>
                </div>
              </Menu.Item>
              <Menu.Item
                leftSection={<Wrench size={16} color="#f59e0b" />}
                onClick={handleExportInstaller}
              >
                <div>
                  <Text size="xs" fw={700} c="yellow.7">3. Для монтажников (PDF)</Text>
                  <Text size="10px" c="dimmed">Сводка панелей, 2D стыки и расчет 3м профилей</Text>
                </div>
              </Menu.Item>
              <Menu.Item
                leftSection={<Ruler size={16} color="#7c3aed" />}
                onClick={handleExportCuttingDetails}
              >
                <div>
                  <Text size="xs" fw={700} c="violet.6">4. Детали для раскроя (PDF)</Text>
                  <Text size="10px" c="dimmed">Чертежи деталей, размеры, вырезы и косые резы</Text>
                </div>
              </Menu.Item>
            </Menu.Dropdown>
          </Menu>

          <Divider orientation="vertical" />

          {/* Переключатель 2D / 3D */}
          <SegmentedControl
            size="xs"
            value={viewMode}
            onChange={(val: any) => setViewMode(val)}
            data={[
              { label: '📐 2D Чертёж', value: '2D' },
              { label: '🧊 3D Вид', value: '3D' },
            ]}
          />

          {viewMode === '2D' && (
            <>
              <Divider orientation="vertical" />
              <SegmentedControl
                size="xs"
                value={editMode}
                onChange={(val: any) => {
                  setEditMode(val);
                  if (val === 'WALLS') {
                    selectJoint(null);
                    selectPanel(null, null, null);
                    selectOpening(null);
                    selectWallBend(null);
                  }
                  if (val === 'PANELS' || val === 'TEXTURES') {
                    selectJoint(null);
                  } else if (val === 'JOINTS') {
                    selectPanel(null, null, null);
                    selectOpening(null);
                  }
                }}
                data={[
                  { label: 'Стены', value: 'WALLS' },
                  { label: '📄 Панели', value: 'PANELS' },
                  { label: 'Стыки', value: 'JOINTS' },
                  { label: 'Текстуры', value: 'TEXTURES' },
                ]}
                color={editMode === 'JOINTS' ? 'yellow' : 'blue'}
              />
            </>
          )}

          {/* Кнопка открытия каталога AllWall */}
          <Button
            size="xs"
            variant="gradient"
            gradient={{ from: 'blue', to: 'cyan', deg: 90 }}
            leftSection={<Layers size={14} />}
            onClick={() => setCatalogOpened(true)}
          >
            AllWall
          </Button>
        </Group>

        {/* Инструменты добавления проемов */}
        <Group gap={6} wrap="nowrap" style={{ flexShrink: 0 }}>
          {/* Меню добавления проемов и зон */}
          <Menu shadow="md" width={200} position="bottom-start">
            <Menu.Target>
              <Button
                size="xs"
                variant="default"
                leftSection={<DoorOpen size={14} />}
                disabled={!selectedWallId || (editMode === 'WALLS' && viewMode === '2D')}
              >
                Проём / Зона
              </Button>
            </Menu.Target>

            <Menu.Dropdown>
              <Menu.Label>Вырезы и проёмы</Menu.Label>
              <Menu.Item
                leftSection={<DoorOpen size={15} />}
                onClick={() => handleAddOpening('DOOR')}
              >
                Дверь
              </Menu.Item>
              <Menu.Item
                leftSection={<RectangleVertical size={15} />}
                onClick={() => handleAddOpening('PORTAL')}
              >
                Портал
              </Menu.Item>
              <Menu.Item
                leftSection={<AppWindow size={15} />}
                onClick={() => handleAddOpening('WINDOW')}
              >
                Окно
              </Menu.Item>
              <Menu.Item
                leftSection={<Square size={15} />}
                onClick={() => handleAddOpening('NICHE')}
              >
                Ниша
              </Menu.Item>
              <Menu.Divider />
              <Menu.Label>Декоративные зоны</Menu.Label>
              <Menu.Item
                leftSection={<Tv size={15} />}
                onClick={() => handleAddOpening('TV_ZONE')}
              >
                ТВ-зона
              </Menu.Item>
            </Menu.Dropdown>
          </Menu>
        </Group>

        {/* Отображение текстур и центрирование холста */}
        <Group gap={6} wrap="nowrap" style={{ flexShrink: 0 }}>
          <Tooltip label={showTextures ? 'Скрыть текстуры — показывать только цвет' : 'Показать текстуры во всех режимах'} position="bottom">
            <ActionIcon
              aria-label="Показывать текстуры"
              aria-pressed={showTextures}
              variant={showTextures ? 'light' : 'subtle'}
              color={showTextures ? 'blue' : 'gray'}
              onClick={toggleTextures}
            >
              <Palette size={16} />
            </ActionIcon>
          </Tooltip>

          <Divider orientation="vertical" />

          <Tooltip label="Центрировать вид" position="bottom">
            <ActionIcon variant="subtle" color="gray" onClick={() => {
              if (editMode === 'WALLS' && viewMode === '2D') useWallEditorStore.getState().setCamera(null);
              else resetView();
            }}>
              <Maximize2 size={16} />
            </ActionIcon>
          </Tooltip>
        </Group>
      </Group>

      {/* Модальное окно каталога AllWall */}
      <AllWallCatalogModal opened={catalogOpened} onClose={() => setCatalogOpened(false)} />
    </>
  );
};
