import React, { useState, useEffect, useRef } from 'react';
import {
  Box,
  Flex,
  Text,
  TextInput,
  Button,
  Stack,
  Group,
  Badge,
  ActionIcon,
  Tooltip,
  ScrollArea,
  Modal,
  ThemeIcon,
  Paper,
  Divider,
} from '@mantine/core';
import {
  Search,
  Plus,
  FolderOpen,
  Trash2,
  Copy,
  Download,
  Layers,
  Keyboard,
  Settings,
  Clock,
  GitBranch,
  CheckCircle2,
  AlertTriangle,
  FileCode,
  Edit2,
} from 'lucide-react';
import { ProjectMetadata } from '../../../core/models/Project';
import { localProjectRepository } from '../../../infrastructure/repositories/LocalSQLiteRepository';
import { useProjectStore } from '../../../application/stores/useProjectStore';
import { useEditorStore } from '../../../application/stores/useEditorStore';
import { NewProjectModal } from './NewProjectModal';

// Палитра цветных плашек проектов
const AVATAR_COLORS = [
  { bg: '#2563EB', text: '#FFFFFF' }, // Blue
  { bg: '#059669', text: '#FFFFFF' }, // Green
  { bg: '#D97706', text: '#FFFFFF' }, // Amber
  { bg: '#7C3AED', text: '#FFFFFF' }, // Purple
  { bg: '#E11D48', text: '#FFFFFF' }, // Rose
  { bg: '#0891B2', text: '#FFFFFF' }, // Cyan
  { bg: '#65A30D', text: '#FFFFFF' }, // Lime
  { bg: '#C026D3', text: '#FFFFFF' }, // Fuchsia
];

function getProjectInitials(name: string): string {
  if (!name) return 'PL';
  const clean = name.replace(/[^a-zA-Zа-яА-ЯёЁ0-9\s]/g, '').trim();
  const words = clean.split(/\s+/).filter(Boolean);
  if (words.length >= 2) {
    return (words[0][0] + words[1][0]).toUpperCase();
  }
  if (words.length === 1 && words[0].length >= 2) {
    return words[0].slice(0, 2).toUpperCase();
  }
  return name.slice(0, 2).toUpperCase();
}

function getAvatarColor(id: string): { bg: string; text: string } {
  let hash = 0;
  for (let i = 0; i < id.length; i++) {
    hash = (hash << 5) - hash + id.charCodeAt(i);
    hash |= 0;
  }
  const index = Math.abs(hash) % AVATAR_COLORS.length;
  return AVATAR_COLORS[index];
}

export const ProjectWelcomeScreen: React.FC = () => {
  const [projects, setProjects] = useState<ProjectMetadata[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [activeTab, setActiveTab] = useState<'PROJECTS' | 'SHORTCUTS' | 'SETTINGS'>('PROJECTS');
  const [isNewProjectModalOpen, setIsNewProjectModalOpen] = useState(false);
  const [deleteTargetId, setDeleteTargetId] = useState<string | null>(null);
  const [renameTarget, setRenameTarget] = useState<{ id: string; name: string } | null>(null);
  const [renameName, setRenameName] = useState('');
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);

  const { project, loadProjectById, createNewProject, duplicateProject, deleteProjectById, importProjectFromFile, setProjectName } = useProjectStore();
  const { setCurrentScreen } = useEditorStore();

  const loadProjectsList = async () => {
    const list = await localProjectRepository.listProjects();
    setProjects(list);
  };

  const handleRenameSubmit = async () => {
    if (!renameTarget || !renameName.trim()) return;
    await localProjectRepository.renameProject(renameTarget.id, renameName.trim());
    if (project.id === renameTarget.id) {
      setProjectName(renameName.trim());
    }
    await loadProjectsList();
    setRenameTarget(null);
    showToast('Название проекта обновлено');
  };

  useEffect(() => {
    loadProjectsList();
  }, []);

  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 3500);
  };

  const handleOpenProject = async (id: string) => {
    const success = await loadProjectById(id);
    if (success) {
      setCurrentScreen('EDITOR');
    } else {
      showToast('Ошибка: Не удалось загрузить проект');
    }
  };

  const handleCreateProject = (name: string, width: number, height: number, roomName?: string) => {
    setIsNewProjectModalOpen(false);
    createNewProject(name, width, height, roomName);
    setCurrentScreen('EDITOR');
  };

  const handleDuplicate = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const duplicated = await duplicateProject(id);
    if (duplicated) {
      showToast(`Проект дублирован: ${duplicated.name}`);
      await loadProjectsList();
    }
  };

  const handleDeleteConfirm = async () => {
    if (deleteTargetId) {
      await deleteProjectById(deleteTargetId);
      setDeleteTargetId(null);
      showToast('Проект удален');
      await loadProjectsList();
    }
  };

  const handleExport = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const proj = await localProjectRepository.getProject(id);
    if (proj) {
      localProjectRepository.exportProjectAsJson(proj);
      showToast('Проект экспортирован в JSON');
    }
  };

  const handleImportFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      const text = await file.text();
      const imported = await importProjectFromFile(text);
      showToast(`Проект успешно импортирован: ${imported.name}`);
      await loadProjectsList();
      setCurrentScreen('EDITOR');
    } catch (err: any) {
      showToast('Ошибка импорта: ' + (err.message || 'Неверный формат'));
    }
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const filteredProjects = projects.filter((p) =>
    p.name.toLowerCase().includes(searchQuery.toLowerCase().trim())
  );

  return (
    <Box
      w="100vw"
      h="100vh"
      style={{
        backgroundColor: '#1E1F22',
        color: '#DFE1E5',
        display: 'flex',
        flexDirection: 'column',
        userSelect: 'none',
        fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
      }}
    >
      {/* Скрытый инпут для импорта файла */}
      <input
        type="file"
        ref={fileInputRef}
        style={{ display: 'none' }}
        accept=".json,.planko"
        onChange={handleImportFile}
      />

      {/* Верхний заголовок окна */}
      <Flex
        justify="space-between"
        align="center"
        px="md"
        py={6}
        style={{
          borderBottom: '1px solid #2B2D30',
          backgroundColor: '#1E1F22',
          height: 38,
        }}
      >
        <Group gap="xs">
          <ThemeIcon size={20} radius="sm" color="blue" variant="filled">
            <Text fw={900} size="xs" style={{ fontFamily: 'monospace' }}>
              PL
            </Text>
          </ThemeIcon>
          <Text size="xs" fw={600} c="#9DA5B4">
            Welcome to Planko CAD
          </Text>
        </Group>
        <Group gap={6}>
          <Box w={10} h={10} style={{ borderRadius: '50%', backgroundColor: '#4B5563' }} />
          <Box w={10} h={10} style={{ borderRadius: '50%', backgroundColor: '#4B5563' }} />
          <Box w={10} h={10} style={{ borderRadius: '50%', backgroundColor: '#4B5563' }} />
        </Group>
      </Flex>

      {/* Основная рабочая область из 2 колонок */}
      <Flex style={{ flex: 1, overflow: 'hidden' }}>
        {/* Левая боковая панель */}
        <Stack
          w={240}
          h="100%"
          p="sm"
          gap="xs"
          justify="space-between"
          style={{
            borderRight: '1px solid #2B2D30',
            backgroundColor: '#1E1F22',
            flexShrink: 0,
          }}
        >
          <Stack gap="md">
            {/* Брендовый блок */}
            <Group gap="sm" px="xs" pt="xs">
              <Box
                style={{
                  width: 38,
                  height: 38,
                  borderRadius: 8,
                  backgroundColor: '#3574F0',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontWeight: 900,
                  fontSize: 16,
                  color: '#FFFFFF',
                  boxShadow: '0 4px 12px rgba(53, 116, 240, 0.35)',
                }}
              >
                PL
              </Box>
              <Stack gap={0}>
                <Text fw={700} size="sm" c="#FFFFFF">
                  Planko CAD
                </Text>
                <Text size="xs" c="dimmed">
                  2026.1.0 CAD Edition
                </Text>
              </Stack>
            </Group>

            {/* Навигационные пункты */}
            <Stack gap={3} mt="xs">
              <Button
                variant={activeTab === 'PROJECTS' ? 'light' : 'subtle'}
                color={activeTab === 'PROJECTS' ? 'blue' : 'gray'}
                justify="space-between"
                fullWidth
                size="sm"
                leftSection={<Layers size={16} />}
                rightSection={
                  <Badge size="xs" variant="filled" color={activeTab === 'PROJECTS' ? 'blue' : 'dark'}>
                    {projects.length}
                  </Badge>
                }
                onClick={() => setActiveTab('PROJECTS')}
                styles={{
                  root: {
                    borderRadius: 6,
                    backgroundColor: activeTab === 'PROJECTS' ? '#2B3956' : 'transparent',
                    color: activeTab === 'PROJECTS' ? '#FFFFFF' : '#ADB0B8',
                  },
                }}
              >
                Проекты (Projects)
              </Button>

              <Button
                variant={activeTab === 'SHORTCUTS' ? 'light' : 'subtle'}
                color={activeTab === 'SHORTCUTS' ? 'blue' : 'gray'}
                justify="flex-start"
                fullWidth
                size="sm"
                leftSection={<Keyboard size={16} />}
                onClick={() => setActiveTab('SHORTCUTS')}
                styles={{
                  root: {
                    borderRadius: 6,
                    backgroundColor: activeTab === 'SHORTCUTS' ? '#2B3956' : 'transparent',
                    color: activeTab === 'SHORTCUTS' ? '#FFFFFF' : '#ADB0B8',
                  },
                }}
              >
                Горячие клавиши
              </Button>

              <Button
                variant={activeTab === 'SETTINGS' ? 'light' : 'subtle'}
                color={activeTab === 'SETTINGS' ? 'blue' : 'gray'}
                justify="flex-start"
                fullWidth
                size="sm"
                leftSection={<Settings size={16} />}
                onClick={() => setActiveTab('SETTINGS')}
                styles={{
                  root: {
                    borderRadius: 6,
                    backgroundColor: activeTab === 'SETTINGS' ? '#2B3956' : 'transparent',
                    color: activeTab === 'SETTINGS' ? '#FFFFFF' : '#ADB0B8',
                  },
                }}
              >
                Настройки
              </Button>
            </Stack>
          </Stack>

          {/* Нижний блок: статус и версия */}
          <Paper p="xs" radius="sm" style={{ backgroundColor: '#26282D', border: '1px solid #33363D' }}>
            <Group gap="xs">
              <CheckCircle2 size={15} color="#10B981" />
              <Stack gap={0}>
                <Text size="xs" fw={600} c="#E5E7EB">
                  Offline-Ready
                </Text>
                <Text size="xs" c="dimmed" style={{ fontSize: 11 }}>
                  Локальное хранилище
                </Text>
              </Stack>
            </Group>
          </Paper>
        </Stack>

        {/* Правая часть: контент в зависимости от вкладки */}
        <Box style={{ flex: 1, display: 'flex', flexDirection: 'column', backgroundColor: '#1E1F22' }}>
          {activeTab === 'PROJECTS' && (
            <>
              {/* Верхняя панель: Поиск проектов + Кнопки New Solution / Open */}
              <Flex
                justify="space-between"
                align="center"
                px="lg"
                py="sm"
                style={{ borderBottom: '1px solid #2B2D30', minHeight: 56 }}
              >
                <TextInput
                  placeholder="Поиск проектов..."
                  leftSection={<Search size={15} color="#80848E" />}
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.currentTarget.value)}
                  w={340}
                  styles={{
                    input: {
                      backgroundColor: '#26282E',
                      borderColor: '#363940',
                      color: '#DFE1E5',
                      height: 34,
                      fontSize: 13,
                    },
                  }}
                />

                <Group gap="xs">
                  <Button
                    variant="filled"
                    color="blue"
                    size="xs"
                    leftSection={<Plus size={14} />}
                    onClick={() => setIsNewProjectModalOpen(true)}
                    styles={{
                      root: {
                        backgroundColor: '#3574F0',
                        fontWeight: 600,
                        paddingLeft: 12,
                        paddingRight: 14,
                      },
                    }}
                  >
                    Новый проект
                  </Button>

                  <Button
                    variant="default"
                    size="xs"
                    leftSection={<FolderOpen size={14} />}
                    onClick={() => fileInputRef.current?.click()}
                    styles={{
                      root: {
                        backgroundColor: '#2B2D30',
                        borderColor: '#3E4249',
                        color: '#DFE1E5',
                      },
                    }}
                  >
                    Открыть (Импорт)
                  </Button>
                </Group>
              </Flex>

              {/* Всплывающее уведомление (Toast) */}
              {toastMessage && (
                <Box px="lg" pt="xs">
                  <Paper p="xs" radius="sm" style={{ backgroundColor: '#1E3A5F', border: '1px solid #3B82F6' }}>
                    <Group justify="space-between">
                      <Text size="xs" c="#BFDBFE" fw={600}>
                        {toastMessage}
                      </Text>
                      <ActionIcon size="xs" variant="subtle" color="gray" onClick={() => setToastMessage(null)}>
                        ✕
                      </ActionIcon>
                    </Group>
                  </Paper>
                </Box>
              )}

              {/* Список проектов */}
              <ScrollArea style={{ flex: 1 }} p="md">
                {filteredProjects.length === 0 ? (
                  <Stack align="center" justify="center" h={300} gap="sm">
                    <ThemeIcon size={48} radius="xl" variant="light" color="gray">
                      <FileCode size={24} />
                    </ThemeIcon>
                    <Text size="sm" c="dimmed">
                      {searchQuery ? 'Проекты не найдены' : 'Список проектов пуст'}
                    </Text>
                    <Button size="xs" variant="light" color="blue" onClick={() => setIsNewProjectModalOpen(true)}>
                      Создать первый проект
                    </Button>
                  </Stack>
                ) : (
                  <Stack gap={4}>
                    {filteredProjects.map((item) => {
                      const avatar = getAvatarColor(item.id);
                      const initials = getProjectInitials(item.name);
                      const formattedDate = item.updatedAt
                        ? new Date(item.updatedAt).toLocaleString('ru-RU', {
                            day: '2-digit',
                            month: '2-digit',
                            year: 'numeric',
                            hour: '2-digit',
                            minute: '2-digit',
                          })
                        : '—';

                      return (
                        <Paper
                          key={item.id}
                          p="sm"
                          radius="sm"
                          onClick={() => handleOpenProject(item.id)}
                          style={{
                            backgroundColor: '#26282E',
                            border: '1px solid #31343C',
                            cursor: 'pointer',
                            transition: 'background-color 0.15s ease, border-color 0.15s ease',
                          }}
                          styles={{
                            root: {
                              '&:hover': {
                                backgroundColor: '#2E3138',
                                borderColor: '#454952',
                              },
                            },
                          }}
                        >
                          <Group justify="space-between" align="center" wrap="nowrap">
                            {/* Левая часть: 2-буквенный аватар и название */}
                            <Group gap="sm" wrap="nowrap" style={{ overflow: 'hidden' }}>
                              <Box
                                style={{
                                  width: 36,
                                  height: 36,
                                  borderRadius: 6,
                                  backgroundColor: avatar.bg,
                                  color: avatar.text,
                                  display: 'flex',
                                  alignItems: 'center',
                                  justifyContent: 'center',
                                  fontWeight: 700,
                                  fontSize: 13,
                                  flexShrink: 0,
                                }}
                              >
                                {initials}
                              </Box>

                              <Stack gap={2} style={{ overflow: 'hidden' }}>
                                <Text fw={600} size="sm" c="#FFFFFF" truncate>
                                  {item.name}
                                </Text>
                                <Group gap="xs" wrap="nowrap">
                                  <Group gap={4}>
                                    <GitBranch size={12} color="#80848E" />
                                    <Text size="xs" c="dimmed" style={{ fontSize: 12 }}>
                                      {item.dimensionsSummary}
                                    </Text>
                                  </Group>
                                  <Divider orientation="vertical" style={{ height: 10 }} />
                                  <Group gap={4}>
                                    <Clock size={12} color="#80848E" />
                                    <Text size="xs" c="dimmed" style={{ fontSize: 12 }}>
                                      {formattedDate}
                                    </Text>
                                  </Group>
                                </Group>
                              </Stack>
                            </Group>

                            {/* Правая часть: быстрые действия */}
                            <Group gap={6} wrap="nowrap" onClick={(e) => e.stopPropagation()}>
                              <Tooltip label="Переименовать проект">
                                <ActionIcon
                                  size="sm"
                                  variant="subtle"
                                  color="gray"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setRenameTarget({ id: item.id, name: item.name });
                                    setRenameName(item.name);
                                  }}
                                >
                                  <Edit2 size={15} />
                                </ActionIcon>
                              </Tooltip>

                              <Tooltip label="Дублировать проект">
                                <ActionIcon
                                  size="sm"
                                  variant="subtle"
                                  color="gray"
                                  onClick={(e) => handleDuplicate(item.id, e)}
                                >
                                  <Copy size={15} />
                                </ActionIcon>
                              </Tooltip>

                              <Tooltip label="Экспорт проекта (.json)">
                                <ActionIcon
                                  size="sm"
                                  variant="subtle"
                                  color="gray"
                                  onClick={(e) => handleExport(item.id, e)}
                                >
                                  <Download size={15} />
                                </ActionIcon>
                              </Tooltip>

                              <Tooltip label="Удалить проект">
                                <ActionIcon
                                  size="sm"
                                  variant="subtle"
                                  color="red"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setDeleteTargetId(item.id);
                                  }}
                                >
                                  <Trash2 size={15} />
                                </ActionIcon>
                              </Tooltip>
                            </Group>
                          </Group>
                        </Paper>
                      );
                    })}
                  </Stack>
                )}
              </ScrollArea>
            </>
          )}

          {activeTab === 'SHORTCUTS' && (
            <ScrollArea style={{ flex: 1 }} p="xl">
              <Stack gap="lg" maw={700}>
                <Stack gap={4}>
                  <Text fw={700} size="lg" c="#FFF">
                    Горячие клавиши и навигация
                  </Text>
                  <Text size="xs" c="dimmed">
                    Быстрые сочетания клавиш для эффективной работы в Planko CAD
                  </Text>
                </Stack>

                <Stack gap="xs">
                  {[
                    { key: 'Ctrl + S / Cmd + S', desc: 'Сохранить проект в локальную базу данных' },
                    { key: 'Shift + Клик', desc: 'Мульти-выбор панелей или стыков для пакетного редактирования' },
                    { key: 'G', desc: 'Включить / отключить координатную CAD-сетку' },
                    { key: 'Колесико мыши', desc: 'Масштабирование (Zoom In / Zoom Out)' },
                    { key: 'Зажатый пробел / Средняя кнопка', desc: 'Панорамирование рабочей области холста' },
                    { key: 'Delete / Backspace', desc: 'Удалить выбранный проем или фигурный раскрой' },
                  ].map((sc, i) => (
                    <Paper key={i} p="sm" radius="sm" style={{ backgroundColor: '#26282E', border: '1px solid #33363D' }}>
                      <Group justify="space-between">
                        <Text size="xs" c="#E5E7EB">
                          {sc.desc}
                        </Text>
                        <Badge variant="outline" color="blue" size="sm">
                          {sc.key}
                        </Badge>
                      </Group>
                    </Paper>
                  ))}
                </Stack>
              </Stack>
            </ScrollArea>
          )}

          {activeTab === 'SETTINGS' && (
            <ScrollArea style={{ flex: 1 }} p="xl">
              <Stack gap="lg" maw={600}>
                <Text fw={700} size="lg" c="#FFF">
                  Настройки приложения
                </Text>
                <Paper p="md" radius="sm" style={{ backgroundColor: '#26282E', border: '1px solid #33363D' }}>
                  <Stack gap="md">
                    <Group justify="space-between">
                      <Stack gap={2}>
                        <Text size="sm" fw={600} c="#FFF">
                          Очистить список проектов
                        </Text>
                        <Text size="xs" c="dimmed">
                          Удалить все сохраненные проекты из локального хранилища
                        </Text>
                      </Stack>
                      <Button
                        size="xs"
                        variant="light"
                        color="red"
                        onClick={async () => {
                          await localProjectRepository.clearAllProjects();
                          await loadProjectsList();
                          showToast('Локальное хранилище очищено');
                        }}
                      >
                        Очистить всё
                      </Button>
                    </Group>
                  </Stack>
                </Paper>
              </Stack>
            </ScrollArea>
          )}
        </Box>
      </Flex>

      {/* Модальное окно создания нового проекта */}
      <NewProjectModal
        opened={isNewProjectModalOpen}
        onClose={() => setIsNewProjectModalOpen(false)}
        onCreate={handleCreateProject}
      />

      {/* Модальное окно переименования проекта */}
      <Modal
        opened={!!renameTarget}
        onClose={() => setRenameTarget(null)}
        title={
          <Group gap="xs">
            <Edit2 size={16} color="#3884FF" />
            <Text fw={700} size="sm">
              Переименование проекта
            </Text>
          </Group>
        }
        size="sm"
        centered
        styles={{
          header: { backgroundColor: '#1E1F22', borderBottom: '1px solid #2B2D30' },
          content: { backgroundColor: '#1E1F22', border: '1px solid #383A42' },
          body: { padding: 20 },
        }}
      >
        <Stack gap="md">
          <TextInput
            label="Новое название проекта"
            value={renameName}
            onChange={(e) => setRenameName(e.currentTarget.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleRenameSubmit()}
            data-autofocus
            styles={{
              input: { backgroundColor: '#2B2D30', borderColor: '#3E4249', color: '#FFF' },
              label: { color: '#C0C4CC', fontSize: 13, marginBottom: 4 },
            }}
          />
          <Group justify="flex-end" gap="xs">
            <Button size="xs" variant="subtle" color="gray" onClick={() => setRenameTarget(null)}>
              Отмена
            </Button>
            <Button size="xs" variant="filled" color="blue" onClick={handleRenameSubmit}>
              Сохранить
            </Button>
          </Group>
        </Stack>
      </Modal>

      {/* Модальное окно подтверждения удаления */}
      <Modal
        opened={!!deleteTargetId}
        onClose={() => setDeleteTargetId(null)}
        title={
          <Group gap="xs">
            <AlertTriangle size={18} color="#EF4444" />
            <Text fw={700} size="sm">
              Удаление проекта
            </Text>
          </Group>
        }
        size="sm"
        centered
        styles={{
          header: { backgroundColor: '#1E1F22', borderBottom: '1px solid #2B2D30' },
          content: { backgroundColor: '#1E1F22', border: '1px solid #383A42' },
        }}
      >
        <Stack gap="md">
          <Text size="xs" c="#D1D5DB">
            Вы уверены, что хотите удалить этот проект? Это действие нельзя отменить.
          </Text>
          <Group justify="flex-end" gap="xs">
            <Button size="xs" variant="subtle" color="gray" onClick={() => setDeleteTargetId(null)}>
              Отмена
            </Button>
            <Button size="xs" variant="filled" color="red" onClick={handleDeleteConfirm}>
              Удалить
            </Button>
          </Group>
        </Stack>
      </Modal>
    </Box>
  );
};
