import React, { useRef, useEffect, useLayoutEffect, useMemo, useState, useCallback } from 'react';
import { Box, Group, ActionIcon, Tooltip, Slider, Text, Button, Paper, Badge, NumberInput, SimpleGrid, Divider, Stack, TextInput, Modal, Alert } from '@mantine/core';
import { Camera, ZoomIn, ZoomOut, RotateCw, Download, Compass, Save, Pencil, Trash2, Archive } from 'lucide-react';
import { useProjectStore } from '../../../application/stores/useProjectStore';
import { useEditorStore } from '../../../application/stores/useEditorStore';
import { useSlopeJointStore } from '../../../application/stores/useSlopeJointStore';
import { prepareWall3DScene, renderWall3DScene } from '../../../application/services/Wall3DScene';
import { createWallViewsZip, downloadBlob, safeExportName } from '../../../application/services/WallViewExport';
import { DEFAULT_WALL_CAMERA, normalizeWallCamera, savedWallViews, type WallView } from '../../../core/models/WallView';
import { useAppTheme } from '../../theme/useAppTheme';

export const Axonometric3DView: React.FC = () => {
  const t = useAppTheme();
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);

  const [angleDeg, setAngleDeg] = useState<number>(DEFAULT_WALL_CAMERA.angleDeg);
  const [elevationDeg, setElevationDeg] = useState<number>(DEFAULT_WALL_CAMERA.elevationDeg);
  const [zoomScale, setZoomScale] = useState<number>(0.24);      // Масштаб
  const [panOffset, setPanOffset] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState<boolean>(false);
  const dragStart = useRef<{ x: number; y: number } | null>(null);
  const [activeViewId, setActiveViewId] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<{ id: string; name: string } | null>(null);
  const [exportingViews, setExportingViews] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);

  const { project, saveWallView, renameWallView, removeWallView } = useProjectStore();
  const { showTextures, showProfiles } = useEditorStore();
  const slopeEditor = useSlopeJointStore();
  const selectedWall = project.walls.find((w) => w.id === project.selectedWallId);
  const views = useMemo(() => savedWallViews(selectedWall ?? {}), [selectedWall?.savedViews]);
  const camera = normalizeWallCamera({ angleDeg, elevationDeg })!;

  useLayoutEffect(() => {
    const wall = useProjectStore.getState().project.walls.find(w => w.id === project.selectedWallId);
    const first = savedWallViews(wall ?? {})[0];
    setAngleDeg(first?.angleDeg ?? DEFAULT_WALL_CAMERA.angleDeg);
    setElevationDeg(first?.elevationDeg ?? DEFAULT_WALL_CAMERA.elevationDeg);
    setActiveViewId(first?.id ?? null);
    setZoomScale(0.24); setPanOffset({ x: 0, y: 0 });
    setRenaming(null); setExportError(null);
    dragStart.current = null;
    setIsDragging(false);
  }, [project.id, project.selectedWallId]);

  const applyView = (view: WallView) => {
    setAngleDeg(view.angleDeg); setElevationDeg(view.elevationDeg);
    setZoomScale(0.24); setPanOffset({ x: 0, y: 0 });
    setActiveViewId(view.id);
  };
  const exportSavedViews = async () => {
    if (!selectedWall || exportingViews) return;
    setExportingViews(true); setExportError(null);
    try {
      const zip = await createWallViewsZip(selectedWall, project.materials, wallNumber);
      downloadBlob(new Blob([new Uint8Array(zip)], { type: 'application/zip' }),
        `${safeExportName(project.name)}_${safeExportName(selectedWall.name)}_3D.zip`);
    } catch (error) {
      setExportError(error instanceof Error ? error.message : 'Не удалось экспортировать ракурсы.');
    } finally { setExportingViews(false); }
  };
  const wallNumber = project.walls.findIndex(w => w.id === selectedWall?.id) + 1;
  const scene = useMemo(() => selectedWall ? prepareWall3DScene(selectedWall, project.materials, wallNumber) : null,
    [selectedWall, project.materials, wallNumber]);
  const renderScene = useCallback(() => {
    const ctx = canvasRef.current?.getContext('2d');
    if (!ctx || !scene) return;
    const target = slopeEditor.target;
    const selectedOpeningId = target?.projectId === project.id && target.wallId === selectedWall?.id &&
      target.openingId === project.selectedOpeningId ? target.openingId : undefined;
    renderWall3DScene(ctx, scene, { angleDeg, elevationDeg }, { palette: t, textures: showTextures,
      profiles: showProfiles, zoom: zoomScale / 0.24, panOffset, selectedOpeningId, selectedCorner: slopeEditor.corner });
  }, [scene, angleDeg, elevationDeg, zoomScale, panOffset, showTextures, showProfiles,
    slopeEditor, project.id, project.selectedOpeningId, selectedWall?.id, t.isDark]);

  const renderSceneRef = useRef(renderScene);
  const frameRef = useRef<number | null>(null);
  const scheduleRender = useCallback(() => {
    if (frameRef.current !== null) return;
    frameRef.current = requestAnimationFrame(() => {
      frameRef.current = null;
      renderSceneRef.current();
    });
  }, []);

  useLayoutEffect(() => {
    renderSceneRef.current = renderScene;
    scheduleRender();
  }, [renderScene, scheduleRender]);

  useEffect(() => {
    const handleResize = () => {
      if (containerRef.current && canvasRef.current) {
        const canvas = canvasRef.current;
        const { clientWidth, clientHeight } = containerRef.current;
        if (canvas.width !== clientWidth || canvas.height !== clientHeight) {
          canvas.width = clientWidth;
          canvas.height = clientHeight;
          scheduleRender();
        }
      }
    };

    handleResize();

    const ro = new ResizeObserver(() => {
      handleResize();
    });

    if (containerRef.current) {
      ro.observe(containerRef.current);
    }

    window.addEventListener('resize', handleResize);
    return () => {
      ro.disconnect();
      window.removeEventListener('resize', handleResize);
      if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
      frameRef.current = null;
    };
  }, [scheduleRender]);

  const handleMouseDown = (e: React.MouseEvent) => {
    setIsDragging(true);
    dragStart.current = { x: e.clientX, y: e.clientY };
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!dragStart.current) return;
    const dx = e.clientX - dragStart.current.x;
    const dy = e.clientY - dragStart.current.y;
    dragStart.current = { x: e.clientX, y: e.clientY };

    if (e.shiftKey || e.buttons === 4) {
      // Панорамирование при зажатом Shift или колесе мыши
      setPanOffset((prev) => ({ x: prev.x + dx, y: prev.y + dy }));
    } else {
      // Полное свободное вращение вокруг объекта 360° без ограничений
      setAngleDeg((prev) => {
        let newAngle = prev + dx * 0.5;
        // Нормализация угла в удобный диапазон [-180, 180]
        while (newAngle > 180) newAngle -= 360;
        while (newAngle < -180) newAngle += 360;
        return Math.round(newAngle * 10) / 10;
      });
      // Полный наклон камеры от вида снизу (-89°) до вида сверху (+89°)
      setElevationDeg((prev) => {
        const newElev = prev - dy * 0.4;
        return Math.max(-89, Math.min(89, Math.round(newElev * 10) / 10));
      });
    }
  };

  const handleMouseUp = () => {
    dragStart.current = null;
    setIsDragging(false);
  };

  const handleWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    const factor = e.deltaY < 0 ? 1.1 : 0.9;
    setZoomScale((prev) => Math.max(0.05, Math.min(2.5, prev * factor)));
  };

  const handleExportPNG = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    // Flush a pending frame so export uses the latest camera position.
    if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
    frameRef.current = null;
    renderSceneRef.current();
    const link = document.createElement('a');
    link.download = `${project.name || 'AllWall'}_3D_Render_${Math.round(angleDeg)}deg.png`;
    link.href = canvas.toDataURL('image/png', 1.0);
    link.click();
  };

  return (
    <Box
      ref={containerRef}
      style={{
        width: '100%',
        height: '100%',
        backgroundColor: t.canvas3dBg,
        position: 'relative',
        overflow: 'hidden',
        cursor: isDragging ? 'grabbing' : 'grab',
      }}
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseUp}
      onWheel={handleWheel}
    >
      <canvas ref={canvasRef} style={{ display: 'block', width: '100%', height: '100%' }} />

      {/* Верхняя информационная панель */}
      <Paper
        p="xs"
        style={{
          position: 'absolute',
          top: 16,
          left: 16,
          backgroundColor: t.canvas3dPanelOverlay,
          backdropFilter: 'blur(8px)',
          border: `1px solid ${t.border}`,
          zIndex: 10,
        }}
      >
        <Group gap="xs">
          <Badge color="blue" variant="light" leftSection={<Camera size={12} />}>
            3D Обзор
          </Badge>
          <Text size="xs" c={t.textDimmed}>
            Поворот: <strong style={{ color: t.textPrimary }}>{Math.round(angleDeg)}°</strong> | Наклон: <strong style={{ color: t.textPrimary }}>{Math.round(elevationDeg)}°</strong>
          </Text>
        </Group>
      </Paper>

      {/* Панель ручного ввода углов и быстрого переключения пресетов */}
      <Paper
        p="sm"
        onMouseDown={event => event.stopPropagation()}
        onWheel={event => event.stopPropagation()}
        style={{
          position: 'absolute',
          bottom: 20,
          right: 20,
          backgroundColor: t.canvas3dPanelOverlay,
          backdropFilter: 'blur(12px)',
          border: `1px solid ${t.border}`,
          borderRadius: 8,
          zIndex: 10,
          width: 360,
          maxWidth: 'calc(100% - 40px)',
          maxHeight: 'calc(100% - 90px)',
          overflowY: 'auto',
          boxShadow: t.isDark ? '0 8px 24px rgba(0, 0, 0, 0.5)' : '0 8px 24px rgba(0, 0, 0, 0.08)',
        }}
      >
        <Stack gap="xs">
          <Group justify="space-between">
            <Group gap={6}>
              <Compass size={14} color="#74C0FC" />
              <Text size="xs" fw={700} c="bright">
                Управление 3D ракурсом
              </Text>
            </Group>
            <Tooltip label="Стандартный ракурс">
              <ActionIcon
                size="xs"
                variant="subtle"
                color="gray"
                onClick={() => {
                  setAngleDeg(DEFAULT_WALL_CAMERA.angleDeg);
                  setElevationDeg(DEFAULT_WALL_CAMERA.elevationDeg);
                  setZoomScale(0.24);
                  setActiveViewId(null);
                  setPanOffset({ x: 0, y: 0 });
                }}
              >
                <RotateCw size={12} />
              </ActionIcon>
            </Tooltip>
          </Group>

          {/* Ручной ввод параметров угла и наклона */}
          <SimpleGrid cols={2} spacing="xs">
            <NumberInput
              size="xs"
              label="Поворот (°)"
              value={angleDeg}
              onChange={(val) => typeof val === 'number' && setAngleDeg(val)}
              min={-360}
              max={360}
              step={5}
              decimalScale={1}
              suffix="°"
            />
            <NumberInput
              size="xs"
              label="Наклон (°)"
              value={elevationDeg}
              onChange={(val) => typeof val === 'number' && setElevationDeg(val)}
              min={-89}
              max={89}
              step={5}
              decimalScale={1}
              suffix="°"
            />
          </SimpleGrid>

          {/* Ползунок плавного поворота */}
          <Box>
            <Text size="10px" c="dimmed" mb={2}>
              Ползунок поворота (-180° ... +180°):
            </Text>
            <Slider
              size="xs"
              min={-180}
              max={180}
              value={Math.round(angleDeg)}
              onChange={setAngleDeg}
              label={(v) => `${v}°`}
            />
          </Box>

          {/* Быстрые пресеты видов */}
          <Box>
            <Text size="10px" c="dimmed" mb={4}>
              Готовые ракурсы:
            </Text>
            <Group gap={4}>
              <Button
                size="compact-xs"
                variant="default"
                onClick={() => {
                  setAngleDeg(30);
                  setElevationDeg(25);
                }}
              >
                30° Аксоно
              </Button>
              <Button
                size="compact-xs"
                variant="default"
                onClick={() => {
                  setAngleDeg(45);
                  setElevationDeg(35);
                }}
              >
                45° Изо
              </Button>
              <Button
                size="compact-xs"
                variant="default"
                onClick={() => {
                  setAngleDeg(0);
                  setElevationDeg(0);
                }}
              >
                0° Фасад
              </Button>
              <Button
                size="compact-xs"
                variant="default"
                onClick={() => {
                  setAngleDeg(90);
                  setElevationDeg(0);
                }}
              >
                90° Сбоку
              </Button>
              <Button
                size="compact-xs"
                variant="default"
                onClick={() => {
                  setAngleDeg(0);
                  setElevationDeg(85);
                }}
              >
                🔝 План
              </Button>
            </Group>
          </Box>

          <Divider color={t.border} />

          <Button size="xs" variant="light" leftSection={<Save size={14} />} disabled={!selectedWall}
            onClick={() => selectedWall && setActiveViewId(saveWallView(selectedWall.id, { angleDeg, elevationDeg }))}>
            Сохранить ракурс
          </Button>
          <Text size="xs" fw={600}>Ракурсы этой стены · {views.length}</Text>
          {views.length === 0 ? (
            <Text size="xs" c="dimmed">Выберите угол и сохраните его для экспорта.</Text>
          ) : (
            <Stack gap={6} style={{ maxHeight: 180, overflowY: 'auto' }}>
              {views.map(view => {
                const active = activeViewId === view.id && camera.angleDeg === view.angleDeg && camera.elevationDeg === view.elevationDeg;
                return (
                  <Group key={view.id} gap={4} wrap="nowrap">
                    <Button size="xs" variant={active ? 'light' : 'subtle'} color={active ? 'blue' : 'gray'}
                      aria-label={`Открыть ракурс ${view.name}`} aria-pressed={active} onClick={() => applyView(view)}
                      style={{ flex: 1, minWidth: 0, height: 'auto', padding: '6px 8px' }}
                      styles={{ inner: { justifyContent: 'flex-start' }, label: { display: 'block', minWidth: 0 } }}>
                      <Text size="xs" fw={600} truncate>{view.name}</Text>
                      <Text size="10px" c="dimmed">Поворот {view.angleDeg}° · наклон {view.elevationDeg}°</Text>
                    </Button>
                    <ActionIcon variant="subtle" color="gray" size="sm" aria-label={`Переименовать ${view.name}`}
                      onClick={() => setRenaming({ id: view.id, name: view.name })}><Pencil size={14} /></ActionIcon>
                    <ActionIcon variant="subtle" color="red" size="sm" aria-label={`Удалить ${view.name}`}
                      onClick={() => { if (selectedWall) removeWallView(selectedWall.id, view.id); }}><Trash2 size={14} /></ActionIcon>
                  </Group>
                );
              })}
            </Stack>
          )}
          {views.length > 0 && (
            <Button size="xs" color="teal" variant="light" leftSection={<Archive size={14} />}
              loading={exportingViews} onClick={exportSavedViews}>Все ракурсы в PNG · ZIP ({views.length})</Button>
          )}
          {exportError && <Alert color="red" p="xs">{exportError}</Alert>}

          <Divider color={t.border} />

          {/* Зум и Экспорт */}
          <Group justify="space-between">
            <Group gap={4}>
              <ActionIcon size="sm" variant="default" onClick={() => setZoomScale((z) => Math.max(0.05, z - 0.05))}>
                <ZoomOut size={14} />
              </ActionIcon>
              <ActionIcon size="sm" variant="default" onClick={() => setZoomScale((z) => Math.min(2.5, z + 0.05))}>
                <ZoomIn size={14} />
              </ActionIcon>
            </Group>

            <Button
              size="xs"
              variant="filled"
              color="teal"
              leftSection={<Download size={14} />}
              onClick={handleExportPNG}
            >
              Экспорт PNG
            </Button>
          </Group>
          <Modal opened={!!renaming} onClose={() => setRenaming(null)} title="Название ракурса" size="sm" centered>
            <form onSubmit={event => {
              event.preventDefault();
              if (selectedWall && renaming?.name.trim()) {
                renameWallView(selectedWall.id, renaming.id, renaming.name); setRenaming(null);
              }
            }}>
              <TextInput label="Название" value={renaming?.name ?? ''} maxLength={80} data-autofocus
                onChange={event => {
                  const name = event.currentTarget.value;
                  setRenaming(current => current ? { ...current, name } : null);
                }} />
              <Group justify="flex-end" mt="md">
                <Button variant="default" onClick={() => setRenaming(null)}>Отмена</Button>
                <Button type="submit" disabled={!renaming?.name.trim()}>Сохранить</Button>
              </Group>
            </form>
          </Modal>
        </Stack>
      </Paper>
    </Box>
  );
};
