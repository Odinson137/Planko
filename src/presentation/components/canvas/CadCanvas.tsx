import { SlopeUnfoldLayer } from './SlopeUnfoldLayer';
import { SlopeJointMarks } from './SlopeJointMarks';
import { slopeJointHasProfile } from '../../../core/geometry/SlopeJointGeometry';
import { getPanelEdges, findPanelForEdge } from '../../../core/geometry/PanelEdges';
import { getResolvedPanelEdges } from '../../../core/geometry/PanelJointBinding';
import { getPieceTexture } from '../../../core/textures/PieceTextures';

import React, { useEffect, useCallback, useMemo } from 'react';
import { Stage, Layer, Rect, Text, Line, Group } from 'react-konva';
import { useElementSize } from '@mantine/hooks';
import { useProjectStore } from '../../../application/stores/useProjectStore';
import { useEditorStore } from '../../../application/stores/useEditorStore';
import { LayoutEngine } from '../../../core/layout/LayoutEngine';
import { Opening, ensureOpeningSlopes, ensureOpeningFraming, isDoorOrPortal, isPortalOpening } from '../../../core/models/Opening';
import { TextureRegistry } from '../../../core/textures/TextureRegistry';
import { PolygonSlicingEngine } from '../../../core/geometry/PolygonSlicingEngine';
import { MATERIAL_NONE_ID } from '../../../core/models/Material';
import { useAppTheme } from '../../theme/useAppTheme';
import { PanelCutLayer } from './PanelCutLayer';

const INNER_CORNER_GRADIENT_STOPS = [0, 'rgba(255, 255, 255, 0.18)', 0.5, 'rgba(0, 0, 0, 0.52)', 1, 'rgba(255, 255, 255, 0.18)'];
const OUTER_CORNER_GRADIENT_STOPS = [0, 'rgba(0, 0, 0, 0.48)', 0.4, 'rgba(255, 255, 255, 0.28)', 0.6, 'rgba(255, 255, 255, 0.28)', 1, 'rgba(0, 0, 0, 0.48)'];

export const CadCanvas: React.FC = () => {
  const t = useAppTheme();
  const { ref: containerRef, width: containerWidth, height: containerHeight } = useElementSize();
  const {
    project,
    selectedColumnIndex,
    selectedSegmentIndex,
    selectedPieceIds,
    selectedJointId,
    selectedJointIds,
    selectedSubPieceId,
    selectedPanelEdge,
    setSelectedPanelEdge,
    selectOpening,
    selectPanel,
    toggleCellSelection,
    selectJoint,
    updateOpening,
  } = useProjectStore();
  const {
    zoom,
    setZoom,
    panX,
    panY,
    setPan,
    showGrid,
    showDimensions,
    showProfiles,
    showTextures,
    activeTool,
    editMode,
  } = useEditorStore();

  const selectedWall = project.walls.find((w) => w.id === project.selectedWallId);
  const selectedMaterial = project.materials.find(
    (m) => m.id === (selectedWall?.zone.materialId || MATERIAL_NONE_ID)
  ) || project.materials.find((m) => m.id === MATERIAL_NONE_ID) || project.materials[0];

  const selectedWallIndex = selectedWall ? project.walls.findIndex((w) => w.id === selectedWall.id) : -1;
  const selectedWallNumber = selectedWallIndex >= 0 ? selectedWallIndex + 1 : 1;

  // Мемоизированный расчет 2D раскладки (пересчитывается ТОЛЬКО при изменении параметров стены, а не при зуме/пане)
  const layout = useMemo(() => {
    if (!selectedWall || !selectedMaterial) return null;
    return LayoutEngine.calculateWallLayout(selectedWall, selectedMaterial, project.materials, selectedWallNumber);
  }, [selectedWall, selectedMaterial, project.materials, selectedWallNumber]);

  // Центрирование стены при первой загрузке или сбросе
  const centerWall = useCallback(
    (w: number, h: number, wallW: number, wallH: number) => {
      if (w <= 0 || h <= 0) return;
      const padding = 120;
      const availableW = w - padding * 2;
      const availableH = h - padding * 2;
      const scaleW = availableW / wallW;
      const scaleH = availableH / wallH;
      const initialScale = Math.min(scaleW, scaleH, 0.35);

      const initialPanX = (w - wallW * initialScale) / 2;
      const initialPanY = (h - wallH * initialScale) / 2;

      setZoom(initialScale);
      setPan(initialPanX, initialPanY);
    },
    [setZoom, setPan]
  );

  useEffect(() => {
    if (selectedWall && containerWidth > 0 && containerHeight > 0 && panX === 0 && panY === 0) {
      centerWall(containerWidth, containerHeight, selectedWall.width, selectedWall.height);
    }
  }, [selectedWall?.id, containerWidth, containerHeight, centerWall, panX, panY]);

  // Плавный зум к позиции курсора (Figma / CAD)
  const handleWheel = (e: any) => {
    e.evt.preventDefault();
    const stage = e.target.getStage();
    if (!stage) return;

    const oldScale = zoom;
    const pointer = stage.getPointerPosition();
    if (!pointer) return;

    const scaleBy = 1.1;
    const newScale = e.evt.deltaY < 0 ? oldScale * scaleBy : oldScale / scaleBy;
    const clampedScale = Math.max(0.04, Math.min(newScale, 2.5));

    const mousePointTo = {
      x: (pointer.x - panX) / oldScale,
      y: (pointer.y - panY) / oldScale,
    };

    const newPanX = pointer.x - mousePointTo.x * clampedScale;
    const newPanY = pointer.y - mousePointTo.y * clampedScale;

    setZoom(clampedScale);
    setPan(newPanX, newPanY);
  };

  const getOpeningColor = (type: Opening['type']) => {
    switch (type) {
      case 'DOOR':
      case 'PORTAL':
        return '#339af0';
      case 'WINDOW':
        return '#20c997';
      case 'TV_ZONE':
        return '#fab005';
      case 'NICHE':
        return '#fd7e14';
    }
  };

  if (!selectedWall) {
    return null;
  }

  const wallW = selectedWall.width;
  const wallH = selectedWall.height;

  return (
    <div
      ref={containerRef}
      style={{
        width: '100%',
        height: '100%',
        backgroundColor: t.canvasBg,
        position: 'relative',
        overflow: 'hidden',
        cursor: activeTool === 'CUT_PANEL' ? 'crosshair' : activeTool === 'SELECT' ? 'default' : 'grab',
      }}
    >
      {containerWidth > 0 && containerHeight > 0 && (
        <Stage
          width={containerWidth}
          height={containerHeight}
          x={panX}
          y={panY}
          scaleX={zoom}
          scaleY={zoom}
          onWheel={handleWheel}
          draggable={activeTool !== 'CUT_PANEL'}
          onDragStart={(e) => {
            if (e.target !== e.currentTarget) {
              e.cancelBubble = true;
            }
          }}
          onDragEnd={(e) => {
            if (e.target === e.currentTarget) {
              setPan(e.target.x(), e.target.y());
            }
          }}
          onClick={(e) => {
            if (e.target === e.currentTarget || e.target.name() === 'wall-background') {
              selectOpening(null);
              selectPanel(null, null, null);
              selectJoint(null);
            }
          }}
        >
          {/* Слой 1: Сетка фона */}
          {showGrid && (
            <Layer listening={false}>
              {Array.from({ length: 60 }).map((_, i) => (
                <Line
                  key={`grid-v-${i}`}
                  points={[(i - 20) * 500, -5000, (i - 20) * 500, 10000]}
                  stroke={t.canvasGrid}
                  strokeWidth={1 / zoom}
                />
              ))}
              {Array.from({ length: 40 }).map((_, i) => (
                <Line
                  key={`grid-h-${i}`}
                  points={[-5000, (i - 10) * 500, 15000, (i - 10) * 500]}
                  stroke={t.canvasGrid}
                  strokeWidth={1 / zoom}
                />
              ))}
            </Layer>
          )}

          {/* Слой 2: Стена, плиты, кликабельные стыки/края, проемы и размеры */}
          <Layer listening={activeTool !== 'CUT_PANEL'}>
            {/* Подложка стены */}
            <Rect
              name="wall-background"
              x={0}
              y={0}
              width={wallW}
              height={wallH}
              fill={t.canvasWallBg}
              stroke={t.canvasWallStroke}
              strokeWidth={3 / zoom}
            />

            {/* Отрисовка панелей с исходным аккуратным стилем */}
            {layout?.panels.map((panel) => {
              const panelX = panel.x;
              const panelY = wallH - (panel.y + panel.height);
              const isPolygon = Boolean(panel.polygonPoints && panel.polygonPoints.length >= 3);

              const isPanelSelected =
                selectedJointId === null &&
                (
                  panel.subPieceId
                    ? (selectedSubPieceId === panel.subPieceId || selectedPieceIds.includes(panel.id))
                    : (!selectedSubPieceId && (
                        selectedPieceIds.includes(panel.id) ||
                        (selectedPieceIds.length === 0 &&
                          selectedColumnIndex === panel.originalColumnIndex &&
                          (selectedSegmentIndex === null || selectedSegmentIndex === panel.originalSegmentIndex))
                      ))
                );

              const isVoid = panel.isVoid;
              const isSlat = panel.materialType === 'SLAT';
              const patternCanvas = !isVoid && showTextures
                ? getPieceTexture(panel) ?? TextureRegistry.getPatternCanvasWithTransform(
                    panel.textureCategory || 'WOOD',
                    panel.materialColor || '#d6cbbe',
                    (panel.reliefType as any) || 'FLAT',
                    panel.decorCode,
                    panel.patternAngleDeg || 0,
                    panel.patternFlipX || false
                  )
                : null;

              const polyLinePoints = isPolygon
                ? panel.polygonPoints!.flatMap((pt) => [pt.x, wallH - pt.y])
                : [];

              const isPanelsMode = (editMode === 'PANELS' || editMode === 'TEXTURES');
              const isJointsMode = editMode === 'JOINTS';

              return (
                <Group
                  key={panel.id}
                  opacity={1}
                  listening={isPanelsMode || isJointsMode}
                  onClick={(e) => {
                    e.cancelBubble = true;
                    if (isPanelsMode) {
                      if (e.evt.shiftKey) {
                        toggleCellSelection(panel.id, panel.originalColumnIndex, panel.originalSegmentIndex, true);
                      } else if (panel.subPieceId) {
                        selectPanel(panel.id, panel.originalColumnIndex, panel.originalSegmentIndex, panel.subPieceId);
                      } else {
                        toggleCellSelection(panel.id, panel.originalColumnIndex, panel.originalSegmentIndex, false);
                      }
                    } else if (isJointsMode) {
                      selectPanel(panel.id, panel.originalColumnIndex, panel.originalSegmentIndex, panel.subPieceId);
                      setSelectedPanelEdge({
                        wallId: selectedWall.id,
                        panelId: panel.id,
                        edge: getPanelEdges(findPanelForEdge(selectedWall.panels, panel.id)?.points ?? panel.polygonPoints ?? [])[0]?.key ?? 'right',
                      });
                    }
                  }}
                >
                  {/* Внутренняя область панели с маской полигона (для обрезки текстуры, реек и светотеней) */}
                  <Group
                    clipFunc={
                      isPolygon && panel.polygonPoints && panel.polygonPoints.length >= 3
                        ? (ctx) => {
                            ctx.beginPath();
                            const firstPt = panel.polygonPoints![0];
                            ctx.moveTo(firstPt.x, wallH - firstPt.y);
                            for (let i = 1; i < panel.polygonPoints!.length; i++) {
                              const pt = panel.polygonPoints![i];
                              ctx.lineTo(pt.x, wallH - pt.y);
                            }
                            ctx.closePath();
                          }
                        : undefined
                    }
                  >
                    {isPolygon ? (
                      <Line
                        points={polyLinePoints}
                        closed
                        fill={isVoid ? 'rgba(24, 25, 29, 0.7)' : (patternCanvas ? undefined : (panel.materialColor || '#d6cbbe'))}
                        fillPriority={patternCanvas ? 'pattern' : 'color'}
                        fillPatternImage={isVoid || !patternCanvas ? undefined : (patternCanvas as any)}
                        fillPatternX={patternCanvas ? panelX : undefined}
                        fillPatternY={patternCanvas ? panelY : undefined}
                        fillPatternScale={
                          patternCanvas
                            ? {
                                x: Math.max(panel.width, 100) / patternCanvas.width,
                                y: Math.max(panel.height, 100) / patternCanvas.height,
                              }
                            : undefined
                        }
                        fillPatternRepeat="repeat"
                        opacity={isVoid ? 0.75 : 0.98}
                      />
                    ) : (
                      <Rect
                        x={panelX}
                        y={panelY}
                        width={panel.width}
                        height={panel.height}
                        fill={isVoid ? 'rgba(24, 25, 29, 0.7)' : (patternCanvas ? undefined : (panel.materialColor || '#d6cbbe'))}
                        fillPriority={patternCanvas ? 'pattern' : 'color'}
                        fillPatternImage={isVoid || !patternCanvas ? undefined : (patternCanvas as any)}
                        fillPatternScale={
                          patternCanvas
                            ? {
                                x: panel.width / patternCanvas.width,
                                y: panel.height / patternCanvas.height,
                              }
                            : undefined
                        }
                        fillPatternRepeat="no-repeat"
                        opacity={isVoid ? 0.75 : 0.98}
                      />
                    )}

                    {/* Рельефная светотень для рейки-волны (GW90) */}
                    {showTextures && panel.reliefType === 'WAVE_GW90' && !isVoid && (
                      <Group listening={false}>
                        {Array.from({ length: Math.ceil(panel.width / 40) }).map((_, wIdx) => {
                          const waveX = panelX + wIdx * 40;
                          const waveW = Math.min(40, panelX + panel.width - waveX);
                          if (waveW <= 1) return null;
                          return (
                            <Rect
                              key={`wave-${panel.id}-${wIdx}`}
                              x={waveX}
                              y={panelY}
                              width={waveW}
                              height={panel.height}
                              fillLinearGradientStartPoint={{ x: 0, y: 0 }}
                              fillLinearGradientEndPoint={{ x: waveW, y: 0 }}
                              fillLinearGradientColorStops={[
                                0, 'rgba(0, 0, 0, 0.26)',
                                0.45, 'rgba(255, 255, 255, 0.18)',
                                0.55, 'rgba(255, 255, 255, 0.18)',
                                1, 'rgba(0, 0, 0, 0.26)'
                              ]}
                            />
                          );
                        })}
                      </Group>
                    )}

                    {/* Рельефная светотень для комбинированного желоба (GW30) */}
                    {showTextures && panel.reliefType === 'CONCAVE_GW30' && !isVoid && (
                      <Group listening={false}>
                        {Array.from({ length: Math.ceil(panel.width / 75) }).map((_, gIdx) => {
                          const gx = panelX + gIdx * 75;
                          const gw = Math.min(75, panelX + panel.width - gx);
                          if (gw <= 1) return null;
                          const troughW = Math.max(1, gw - 24);
                          return (
                            <Group key={`gw30-${panel.id}-${gIdx}`}>
                              <Rect
                                x={gx + 12}
                                y={panelY}
                                width={troughW}
                                height={panel.height}
                                fillLinearGradientStartPoint={{ x: 0, y: 0 }}
                                fillLinearGradientEndPoint={{ x: troughW, y: 0 }}
                                fillLinearGradientColorStops={[
                                  0, 'rgba(255, 255, 255, 0.12)',
                                  0.5, 'rgba(0, 0, 0, 0.32)',
                                  1, 'rgba(255, 255, 255, 0.12)'
                                ]}
                              />
                              <Line
                                points={[gx + 12, panelY, gx + 12, panelY + panel.height]}
                                stroke="rgba(0, 0, 0, 0.38)"
                                strokeWidth={1.5 / zoom}
                              />
                              <Line
                                points={[gx + gw - 12, panelY, gx + gw - 12, panelY + panel.height]}
                                stroke="rgba(0, 0, 0, 0.38)"
                                strokeWidth={1.5 / zoom}
                              />
                            </Group>
                          );
                        })}
                      </Group>
                    )}

                    {/* Разметка стандартных прямоугольных реек */}
                    {showTextures && (panel.reliefType === 'STEP_SLAT' || (isSlat && panel.reliefType !== 'WAVE_GW90' && panel.reliefType !== 'CONCAVE_GW30')) && !isVoid && (
                      <Group listening={false}>
                        {Array.from({ length: Math.floor(panel.width / 50) }).map((_, sIdx) => {
                          const slatX = panelX + (sIdx + 1) * 50;
                          if (slatX >= panelX + panel.width) return null;
                          return (
                            <Line
                              key={`slat-${panel.id}-${sIdx}`}
                              points={[slatX, panelY, slatX, panelY + panel.height]}
                              stroke="rgba(0, 0, 0, 0.28)"
                              strokeWidth={1.5 / zoom}
                            />
                          );
                        })}
                      </Group>
                    )}

                    {/* Отрисовка цилиндрической светотени и пропилов для зон сгиба на панели */}
                    {panel.bendsInfo && panel.bendsInfo.length > 0 && !isVoid && (
                      <Group listening={false}>
                        {panel.bendsInfo.map((bend, bIdx) => {
                          const bendSubX = panelX + bend.flatLeft;
                          const bendSubW = bend.bendWidth;

                          if (bend.radius <= 0 || bendSubW <= 1) {
                            // Острый угол (R = 0): линия перегиба на листе и бейдж
                            return (
                              <Group key={`panel-bend-${panel.id}-${bIdx}`}>
                                <Line
                                  points={[bendSubX, panelY, bendSubX, panelY + panel.height]}
                                  stroke="#339af0"
                                  strokeWidth={1.8 / zoom}
                                  dash={[6, 4]}
                                />
                                <Group x={bendSubX - 45} y={panelY + 8}>
                                  <Rect
                                    width={90}
                                    height={18}
                                    fill="#101113"
                                    stroke="#4dabf7"
                                    strokeWidth={1.2 / zoom}
                                    cornerRadius={3}
                                  />
                                  <Text
                                    x={4}
                                    y={3}
                                    text={`📐 ${bend.type === 'INNER_CORNER' ? 'ВНУТР' : 'ВНЕШН'} ${bend.angleDeg || 90}°`}
                                    fontSize={8.5}
                                    fontFamily="JetBrains Mono"
                                    fontStyle="bold"
                                    fill="#74c0fc"
                                  />
                                </Group>
                              </Group>
                            );
                          }

                          return (
                            <Group key={`panel-bend-${panel.id}-${bIdx}`}>
                              {/* Светотеневой объемный градиент на участке сгиба */}
                              <Rect
                                x={bendSubX}
                                y={panelY}
                                width={bendSubW}
                                height={panel.height}
                                fillLinearGradientStartPoint={{ x: 0, y: 0 }}
                                fillLinearGradientEndPoint={{ x: bendSubW, y: 0 }}
                                fillLinearGradientColorStops={
                                  bend.type === 'INNER_CORNER'
                                    ? INNER_CORNER_GRADIENT_STOPS
                                    : OUTER_CORNER_GRADIENT_STOPS
                                }
                                opacity={0.9}
                              />

                              {/* Пунктирные направляющие линий сгиба (керф-бендинг) */}
                              {Array.from({ length: Math.min(8, Math.max(3, Math.floor(bendSubW / 45))) }).map((_, lIdx, arr) => {
                                const stepX = bendSubX + ((lIdx + 1) * bendSubW) / (arr.length + 1);
                                return (
                                  <Line
                                    key={`bend-line-${panel.id}-${bIdx}-${lIdx}`}
                                    points={[stepX, panelY, stepX, panelY + panel.height]}
                                    stroke="rgba(255, 255, 255, 0.22)"
                                    dash={[6, 6]}
                                    strokeWidth={1 / zoom}
                                  />
                                );
                              })}

                              {/* Бейдж радиуса на участке сгиба */}
                              {bendSubW >= 60 && (
                                <Group x={bendSubX + Math.max(4, (bendSubW - 130) / 2)} y={panelY + 8}>
                                  <Rect
                                    width={Math.min(bendSubW - 8, 130)}
                                    height={20}
                                    fill="#101113"
                                    stroke="#4dabf7"
                                    strokeWidth={1.2 / zoom}
                                    cornerRadius={4}
                                  />
                                  <Text
                                    x={6}
                                    y={4}
                                    text={`⌒ ${bend.type === 'INNER_CORNER' ? 'ВНУТР' : 'ВНЕШН'} R=${bend.radius}`}
                                    fontSize={9}
                                    fontFamily="JetBrains Mono"
                                    fontStyle="bold"
                                    fill="#74c0fc"
                                  />
                                </Group>
                              )}
                            </Group>
                          );
                        })}
                      </Group>
                    )}
                  </Group>

                  {/* Внешний контур панели и выделения (поверх всех реек и рельефов) */}
                  {isPolygon ? (
                    <Line
                      points={polyLinePoints}
                      closed
                      stroke={
                        isPanelSelected
                          ? '#40C057'
                          : (isVoid ? '#373A40' : '#141517')
                      }
                      strokeWidth={isPanelSelected ? 3 / zoom : 1}
                      dash={isVoid ? [12, 8] : undefined}
                    />
                  ) : (
                    <Rect
                      x={panelX}
                      y={panelY}
                      width={panel.width}
                      height={panel.height}
                      stroke={
                        isPanelSelected
                          ? '#40C057'
                          : (isVoid ? '#373A40' : '#141517')
                      }
                      strokeWidth={isPanelSelected ? 3 / zoom : 1}
                      dash={isVoid ? [12, 8] : undefined}
                    />
                  )}

                  {/* Текстовые метки ячейки / полигона */}
                  {isPolygon && panel.polygonPoints ? (
                    (() => {
                      const centroid = PolygonSlicingEngine.calculateCentroid(panel.polygonPoints);
                      const cX = centroid.x;
                      const cY = wallH - centroid.y;
                      return (
                        panel.width > 60 && panel.height > 35 && (
                          <Group x={cX - 30} y={cY - 12} listening={false}>
                            <Text
                              text={
                                isVoid
                                  ? '⭕ ПУСТО'
                                  : `[${panel.partLabel}] ${panel.decorCode ? `(${panel.decorCode})` : ''}`
                              }
                              fontSize={Math.max(11, 14 / Math.max(0.5, zoom))}
                              fill={isVoid ? '#868E96' : '#1A1B1E'}
                              fontFamily="JetBrains Mono"
                              fontStyle="bold"
                            />
                            <Text
                              y={Math.max(14, 18 / Math.max(0.5, zoom))}
                              text={`${Math.round(panel.width)} × ${Math.round(panel.height)}${panel.thickness ? ` × ${panel.thickness}мм` : ''}`}
                              fontSize={Math.max(10, 12 / Math.max(0.5, zoom))}
                              fill={isVoid ? '#5C5F66' : '#2C2E33'}
                              fontFamily="JetBrains Mono"
                            />
                            {panel.note && panel.note.trim().length > 0 && (
                              <Text
                                y={Math.max(26, 32 / Math.max(0.5, zoom))}
                                text={`💬 ${panel.note}`}
                                fontSize={Math.max(9, 11 / Math.max(0.5, zoom))}
                                fill="#D97706"
                                fontStyle="italic"
                                fontFamily="JetBrains Mono"
                              />
                            )}
                          </Group>
                        )
                      );
                    })()
                  ) : (
                    panel.width > 70 && panel.height > 40 && (
                      <Group x={panelX + 10} y={panelY + (panel.radiusConfig ? 38 : 10)} listening={false}>
                        <Text
                          text={
                            isVoid
                              ? '⭕ ПУСТОТА'
                              : `[${panel.partLabel}] ${panel.decorCode ? `(${panel.decorCode})` : ''}`
                          }
                          fontSize={Math.max(11, 14 / Math.max(0.5, zoom))}
                          fill={isVoid ? '#868E96' : '#1A1B1E'}
                          fontFamily="JetBrains Mono"
                          fontStyle="bold"
                        />
                        <Text
                          y={Math.max(14, 18 / Math.max(0.5, zoom))}
                          text={`${Math.round(panel.width)} × ${Math.round(panel.height)}${panel.thickness ? ` × ${panel.thickness}мм` : ''}${panel.radiusConfig ? ` (⌒ R${panel.radiusConfig.radius})` : ''}`}
                          fontSize={Math.max(10, 12 / Math.max(0.5, zoom))}
                          fill={isVoid ? '#5C5F66' : '#2C2E33'}
                          fontFamily="JetBrains Mono"
                        />
                        {panel.note && panel.note.trim().length > 0 && (
                          <Text
                            y={Math.max(26, 32 / Math.max(0.5, zoom))}
                            text={`💬 ${panel.note}`}
                            fontSize={Math.max(9, 11 / Math.max(0.5, zoom))}
                            fill="#D97706"
                            fontStyle="italic"
                            fontFamily="JetBrains Mono"
                          />
                        )}
                      </Group>
                    )
                  )}
                </Group>
              );
            })}

            {/* Отрисовка интерактивных проемов */}
            {selectedWall.openings.map((op) => {
              const isApplied = op.isApplied ?? false;
              const isPanelsMode = (editMode === 'PANELS' || editMode === 'TEXTURES');
              const canDrag = isPanelsMode && !isApplied;
              const opX = op.x;
              const opY = wallH - (op.y + op.height);
              const isSelected = op.id === project.selectedOpeningId;
              const isPortal = isPortalOpening(op);
              const openingStroke = isSelected ? '#339AF0' : (!isApplied ? '#FF922B' : getOpeningColor(op.type));
              const openingStrokeWidth = isSelected ? 4 / zoom : (!isApplied ? 2.5 / zoom : (op.isCutout !== false ? 2 / zoom : 3 / zoom));

              return (
                <Group
                  key={op.id}
                  x={opX}
                  y={opY}
                  draggable={canDrag}
                  listening={isPanelsMode || editMode === 'JOINTS'}
                  onDragStart={(e) => {
                    e.cancelBubble = true;
                    selectOpening(op.id);
                  }}
                  onDragMove={(e) => {
                    e.cancelBubble = true;
                  }}
                  onClick={(e) => {
                    e.cancelBubble = true;
                    selectOpening(op.id);
                  }}
                  onDragEnd={(e) => {
                    if (!canDrag) return;
                    e.cancelBubble = true;
                    let rawX = Math.round(e.target.x());
                    let rawY = Math.round(wallH - e.target.y() - op.height);

                    // 1. Умная привязка по высоте (Y):
                    if (isDoorOrPortal(op) || Math.abs(rawY) <= 50) {
                      rawY = 0; // Дверь и портал примагничиваются к полу
                    } else if (Math.abs(rawY - (wallH - op.height)) <= 30) {
                      rawY = wallH - op.height; // Примагничивание к верхнему краю стены
                    } else {
                      rawY = Math.round(rawY / 10) * 10;
                    }

                    // 2. Умная привязка по горизонтали (X):
                    const wallCenterX = Math.round((wallW - op.width) / 2);
                    if (Math.abs(rawX - wallCenterX) <= 30) {
                      rawX = wallCenterX; // Центр стены
                    } else {
                      // Проверка привязки к вертикальным стыкам сетки
                      let snapped = false;
                      if (layout?.joints) {
                        for (const j of layout.joints) {
                          if (j.orientation === 'VERTICAL') {
                            if (Math.abs(rawX - j.x) <= 20) {
                              rawX = j.x;
                              snapped = true;
                              break;
                            }
                            if (Math.abs(rawX + op.width - j.x) <= 20) {
                              rawX = j.x - op.width;
                              snapped = true;
                              break;
                            }
                          }
                        }
                      }
                      if (!snapped) {
                        rawX = Math.round(rawX / 10) * 10;
                      }
                    }

                    const clampedX = Math.max(0, Math.min(rawX, wallW - op.width));
                    const clampedY = Math.max(0, Math.min(rawY, wallH - op.height));

                    e.target.position({
                      x: clampedX,
                      y: wallH - (clampedY + op.height),
                    });

                    updateOpening(selectedWall.id, {
                      id: op.id,
                      x: clampedX,
                      y: clampedY,
                    });
                  }}
                >
                  {(ensureOpeningSlopes(op).showUnfold2D || editMode === 'TEXTURES') &&
                    <SlopeUnfoldLayer opening={op} faces={layout?.slopes ?? []} zoom={zoom} textures={showTextures} />}

                  <Rect
                    width={op.width}
                    height={op.height}
                    fill={!isApplied ? 'rgba(255, 146, 43, 0.08)' : (op.isCutout !== false ? '#141517' : 'rgba(26, 27, 30, 0.82)')}
                    stroke={openingStroke}
                    strokeWidth={openingStrokeWidth}
                    strokeEnabled={!isPortal}
                    dash={!isApplied ? [8, 6] : (op.isCutout === false ? [10, 6] : undefined)}
                    cornerRadius={op.type === 'TV_ZONE' ? 4 : 0}
                  />

                  {isPortal && (
                    <Line
                      points={[0, op.height, 0, 0, op.width, 0, op.width, op.height]}
                      stroke={openingStroke}
                      strokeWidth={openingStrokeWidth}
                      dash={!isApplied ? [8, 6] : undefined}
                      listening={false}
                    />
                  )}

                  {/* Внутренняя рамка глубины откоса для визуализации объема */}
                  {op.isCutout !== false && (() => {
                    const slopes = ensureOpeningSlopes(op);
                    if (!slopes.enabled) return null;
                    const opDepth = op.depth ?? 150;
                    const effectiveD = slopes.fitToOpeningDepth ? opDepth : (slopes.depth || 150);
                    const frameD = Math.min(24, Math.max(8, effectiveD / 10));
                    if (isPortal) {
                      return (
                        <Line
                          points={[frameD, op.height, frameD, frameD, op.width - frameD, frameD, op.width - frameD, op.height]}
                          stroke="rgba(255, 255, 255, 0.12)"
                          strokeWidth={1 / zoom}
                          listening={false}
                        />
                      );
                    }
                    return (
                      <Rect
                        x={frameD}
                        y={frameD}
                        width={Math.max(10, op.width - frameD * 2)}
                        height={Math.max(10, op.height - frameD * 2)}
                        stroke="rgba(255, 255, 255, 0.12)"
                        strokeWidth={1 / zoom}
                        fill="rgba(0, 0, 0, 0.25)"
                        listening={false}
                      />
                    );
                  })()}

                  {op.type === 'TV_ZONE' && (
                    <Rect
                      x={6}
                      y={6}
                      width={Math.max(10, op.width - 12)}
                      height={Math.max(10, op.height - 12)}
                      stroke="#495057"
                      strokeWidth={1 / zoom}
                      listening={false}
                    />
                  )}

                  {(() => {
                    const slopes = ensureOpeningSlopes(op);
                    const opDepth = op.depth ?? 150;
                    const effectiveD = slopes.fitToOpeningDepth ? opDepth : slopes.depth;

                    const slopeInfo =
                      op.isCutout !== false && slopes.enabled
                        ? `\n📐 Откосы: ${
                            slopes.fitToOpeningDepth
                              ? `по проему (${opDepth} мм)`
                              : `${effectiveD} мм (${slopes.depthMode === 'CUSTOM' ? 'индивид.' : 'общая'})`
                          }${
                            (layout?.slopeJoints ?? []).some(j => j.openingId === op.id && slopeJointHasProfile(j))
                              ? `\nСтыки откосов: ${(layout?.slopeJoints ?? []).filter(j => j.openingId === op.id && slopeJointHasProfile(j)).length}`
                              : ''
                          }`
                        : '';

                    const statusBadge = !isApplied
                      ? '\n⚙ Черновик: настройте и нажмите "Применить"'
                      : '\n🔒 Встроен в стену';

                    return (
                      <Text
                        x={15}
                        y={15}
                        text={`${op.isCutout === false ? '📺 ' : ''}${op.name}\n${op.width} × ${op.height} мм${
                          op.isCutout === false ? '\n(поверх плит)' : slopeInfo
                        }${statusBadge}`}
                        fontSize={Math.max(12, 16 / Math.max(0.5, zoom))}
                        fill={!isApplied ? '#FFD43B' : (op.isCutout === false ? '#FFD43B' : '#C1C2C5')}
                        fontFamily="Inter"
                        fontStyle="bold"
                        listening={false}
                      />
                    );
                  })()}
                  {showProfiles && <SlopeJointMarks opening={op} wallId={selectedWall.id} projectId={project.id}
                    joints={layout?.slopeJoints ?? []} zoom={zoom} selected={isSelected} />}
                </Group>
              );
            })}

            {/* ИНТЕРАКТИВНЫЕ СТЫКИ И КРАЯ ПЛИТ (Поверх проемов и панелей для четкого отображения и кликабельности) */}
            {showProfiles &&
              layout?.joints.map((joint) => {
                const selectableJointId = joint.sourceJointId ?? joint.id;
                const isJointsMode = editMode === 'JOINTS';
                const isHoriz = joint.orientation === 'HORIZONTAL';
                const selectedJointConfig = selectedJointId ? selectedWall.customJoints[selectedJointId] : null;
                const selectedGroupId = selectedJointConfig?.groupId;

                const isJointSelected =
                  selectedJointIds.includes(selectableJointId) ||
                  selectedJointId === selectableJointId ||
                  (Boolean(selectedGroupId) && joint.groupId === selectedGroupId);

                const isLED = joint.isLED;
                const visualWidth = isJointsMode || isJointSelected
                  ? Math.max(joint.visibleWidth ?? joint.width, 3.5 / zoom)
                  : Math.max(joint.visibleWidth ?? joint.width, 1.5 / zoom);

                const fillColor = isJointSelected
                  ? '#339AF0'
                  : isLED
                  ? '#FFD43B'
                  : isJointsMode
                  ? (joint.width > 0 ? '#4DABF7' : '#74C0FC')
                  : (joint.width > 0 ? '#343A40' : 'rgba(255, 255, 255, 0.15)');

                const hitPadding = Math.max(26 / zoom, 20);

                // Наклонные / произвольные стыки раскроя
                if (joint.p1 && joint.p2) {
                  const p1C = { x: joint.p1.x, y: wallH - joint.p1.y };
                  const p2C = { x: joint.p2.x, y: wallH - joint.p2.y };
                  const midC = { x: (p1C.x + p2C.x) / 2, y: (p1C.y + p2C.y) / 2 };

                  return (
                    <Group
                      key={joint.id}
                      listening={false}
                    >
                      <Line
                        points={[p1C.x, p1C.y, p2C.x, p2C.y]}
                        stroke="rgba(0, 0, 0, 0.001)"
                        strokeWidth={hitPadding}
                        lineCap="round"
                        hitStrokeWidth={hitPadding}
                      />
                      <Line
                        points={[p1C.x, p1C.y, p2C.x, p2C.y]}
                        stroke={fillColor}
                        strokeWidth={visualWidth}
                        lineCap="square"
                      />

                      {isJointSelected && !joint.id.startsWith('edge-') && (
                        <Group x={midC.x + 10} y={midC.y - 12} listening={false}>
                          <Rect
                            width={120}
                            height={22}
                            fill={t.canvasBadgeBg}
                            stroke={t.isDark ? '#339AF0' : '#1971c2'}
                            strokeWidth={1}
                            cornerRadius={3}
                          />
                          <Text
                            x={6}
                            y={5}
                            text={isLED ? '⚡ LED 10 мм' : `Зазор: ${joint.width} мм • Видимая: ${joint.visibleWidth ?? joint.width} мм`}
                            fontSize={11}
                            fill={t.canvasBadgeText}
                            fontFamily="JetBrains Mono"
                            fontStyle="bold"
                          />
                        </Group>
                      )}
                    </Group>
                  );
                }

                const jointX = joint.x;
                const jointY = isHoriz
                  ? wallH - joint.y - (joint.width > 0 ? joint.width : 0)
                  : wallH - (joint.y + joint.length);
                const jointW = isHoriz ? joint.length : visualWidth;
                const jointH = isHoriz ? visualWidth : joint.length;

                const hitX = isHoriz ? jointX : jointX - (hitPadding - visualWidth) / 2;
                const hitY = isHoriz ? jointY - (hitPadding - visualWidth) / 2 : jointY;
                const hitW = isHoriz ? joint.length : hitPadding;
                const hitH = isHoriz ? hitPadding : joint.length;

                return (
                  <Group
                    key={joint.id}
                    listening={false}
                  >
                    <Rect
                      x={hitX}
                      y={hitY}
                      width={hitW}
                      height={hitH}
                      fill="rgba(0, 0, 0, 0.001)"
                    />
                    <Rect
                      x={jointX}
                      y={jointY}
                      width={jointW}
                      height={jointH}
                      fill={fillColor}
                      stroke={isJointSelected ? (t.isDark ? '#FFFFFF' : '#1971c2') : isJointsMode ? '#74C0FC' : isLED ? '#FFF3BF' : undefined}
                      strokeWidth={isJointSelected ? 2 / zoom : isJointsMode ? 1 / zoom : isLED ? 1 / zoom : 0}
                    />

                    {isJointSelected && !joint.id.startsWith('edge-') && (
                      <Group
                        x={jointX + (isHoriz ? 10 : 6)}
                        y={jointY + (isHoriz ? -26 : 20)}
                        listening={false}
                      >
                        <Rect
                          width={120}
                          height={22}
                          fill={t.canvasBadgeBg}
                          stroke={t.isDark ? '#339AF0' : '#1971c2'}
                          strokeWidth={1}
                          cornerRadius={3}
                        />
                        <Text
                          x={6}
                          y={5}
                          text={isLED ? '⚡ LED 10 мм' : `Зазор: ${joint.width} мм • Видимая: ${joint.visibleWidth ?? joint.width} мм`}
                          fontSize={11}
                          fill={t.canvasBadgeText}
                          fontFamily="JetBrains Mono"
                          fontStyle="bold"
                        />
                      </Group>
                    )}
                  </Group>
                );
              })}

            {/* ОТМЕТКИ УГЛОВ НА РАЗВЁРТКЕ: геометрия редактируется в режиме «Стены» */}
            {selectedWall.bends?.map((bend) => {
              const arcLen = Math.round((Math.PI * bend.radius * (bend.angleDeg || 90)) / 180);

              return (
                <Group
                  key={bend.id}
                  x={bend.x}
                  y={0}
                  listening={false}
                >
                  {bend.radius <= 0 || arcLen <= 0 ? (
                    <>
                      {/* Острый угол (R = 0): вертикальная осевая линия перегиба стены */}
                      <Line
                        points={[0, 0, 0, wallH]}
                        stroke={'#4DABF7'}
                        strokeWidth={1.8 / zoom}
                        dash={[8, 5]}
                      />
                      {/* Верхняя плашка с названием угла */}
                      <Group x={-80} y={-36} listening={false}>
                        <Rect
                          width={160}
                          height={24}
                          fill={t.canvasBadgeBg}
                          stroke={'#4DABF7'}
                          strokeWidth={1.5}
                          cornerRadius={4}
                        />
                        <Text
                          x={6}
                          y={6}
                          text={`📐 ${bend.name || (bend.type === 'INNER_CORNER' ? 'Внутр' : 'Внешн')} ${bend.angleDeg || 90}° (R=0)`}
                          fontSize={9.5}
                          fontFamily="JetBrains Mono"
                          fontStyle="bold"
                          fill={t.canvasBadgeText}
                        />
                      </Group>
                    </>
                  ) : (
                    <>
                      {/* Полупрозрачная направляющая полоса зоны сгиба на стене */}
                      <Rect
                        width={arcLen}
                        height={wallH}
                        fill={'rgba(77, 171, 247, 0.07)'}
                        stroke={'#4DABF7'}
                        strokeWidth={1.2 / zoom}
                        dash={[8, 6]}
                      />

                      {/* Верхняя плашка с названием угла и радиусом */}
                      <Group x={Math.max(4, (arcLen - 170) / 2)} y={-36} listening={false}>
                        <Rect
                          width={Math.min(arcLen - 8, 170)}
                          height={24}
                          fill={t.canvasBadgeBg}
                          stroke={'#4DABF7'}
                          strokeWidth={1.5}
                          cornerRadius={4}
                        />
                        <Text
                          x={6}
                          y={6}
                          text={`⌒ ${bend.name || (bend.type === 'INNER_CORNER' ? 'Внутр' : 'Внешн')} R=${bend.radius} (${arcLen} мм)`}
                          fontSize={10}
                          fontFamily="JetBrains Mono"
                          fontStyle="bold"
                          fill={t.canvasBadgeText}
                        />
                      </Group>
                    </>
                  )}
                </Group>
              );
            })}

            {/* СЛОЙ: ИНТЕРАКТИВНОЕ ОБРАМЛЕНИЕ ПРОЕМОВ (В РЕЖИМЕ 'JOINTS') */}
            {editMode === 'JOINTS' && selectedWall.openings && selectedWall.openings.map((op) => {
              if (op.isCutout === false) return null;
              const isSelected = op.id === project.selectedOpeningId;
              const opX = op.x;
              const opY = wallH - (op.y + op.height);
              const opW = op.width;
              const opH = op.height;
              const framing = ensureOpeningFraming(op);

              const sides: ('left' | 'top' | 'right' | 'bottom')[] =
                isDoorOrPortal(op) ? ['left', 'top', 'right'] : ['left', 'top', 'right', 'bottom'];

              return (
                <Group key={`op-framing-overlay-${op.id}`} name="op-framing-overlay" listening={true}>
                  {/* Рамка проема */}
                  <Rect
                    x={opX}
                    y={opY}
                    width={opW}
                    height={opH}
                    stroke={isSelected ? '#339AF0' : 'rgba(51, 154, 240, 0.45)'}
                    strokeWidth={isSelected ? 2.5 / zoom : 1.5 / zoom}
                    dash={[6 / zoom, 4 / zoom]}
                    listening={true}
                    onClick={(e) => {
                      e.cancelBubble = true;
                      selectOpening(op.id);
                      setSelectedPanelEdge(null);
                      selectJoint(null);
                    }}
                  />

                  {sides.map((side) => {
                    const edgeConf = framing[side];
                    const w = edgeConf?.width ?? 0;
                    const isLED = edgeConf?.isLED ?? false;
                    const hasJoint = w > 0 || isLED || Boolean(edgeConf?.profileArticle);

                    const isLeft = side === 'left';
                    const isRight = side === 'right';
                    const isTop = side === 'top';
                    const isBottom = side === 'bottom';

                    const edgeLinePoints = isLeft
                      ? [opX, opY, opX, opY + opH]
                      : isRight
                      ? [opX + opW, opY, opX + opW, opY + opH]
                      : isTop
                      ? [opX, opY, opX + opW, opY]
                      : [opX, opY + opH, opX + opW, opY + opH];

                    const badgeW = hasJoint ? 76 : 58;
                    const badgeH = 24;

                    const bX = isLeft
                      ? opX + 8
                      : isRight
                      ? opX + opW - badgeW - 8
                      : opX + (opW - badgeW) / 2;
                    const bY = isTop
                      ? opY + 8
                      : isBottom
                      ? opY + opH - badgeH - 8
                      : opY + (opH - badgeH) / 2;

                    const sideName = isLeft ? 'Лево' : isRight ? 'Право' : isTop ? 'Верх' : 'Низ';
                    const arrowIcon = isLeft ? '◂' : isRight ? '▸' : isTop ? '▴' : '▾';

                    const onClickSide = (e: any) => {
                      e.cancelBubble = true;
                      selectOpening(op.id);
                      setSelectedPanelEdge(null);
                      selectJoint(null);
                    };

                    return (
                      <Group key={`op-edge-${op.id}-${side}`} listening={true}>
                        <Line
                          points={edgeLinePoints}
                          stroke={isSelected ? (hasJoint ? '#FAB005' : '#339AF0') : hasJoint ? '#FFD43B' : 'rgba(51, 154, 240, 0.45)'}
                          strokeWidth={isSelected ? 3.5 / zoom : 2 / zoom}
                          hitStrokeWidth={Math.max(26 / zoom, 20)}
                          onClick={onClickSide}
                          onMouseEnter={(e) => {
                            const stage = e.target.getStage();
                            if (stage) stage.container().style.cursor = 'pointer';
                          }}
                          onMouseLeave={(e) => {
                            const stage = e.target.getStage();
                            if (stage) stage.container().style.cursor = 'default';
                          }}
                        />

                        <Group
                          x={bX}
                          y={bY}
                          listening={true}
                          onClick={onClickSide}
                          onMouseEnter={(e) => {
                            const stage = e.target.getStage();
                            if (stage) stage.container().style.cursor = 'pointer';
                          }}
                          onMouseLeave={(e) => {
                            const stage = e.target.getStage();
                            if (stage) stage.container().style.cursor = 'default';
                          }}
                        >
                          <Rect
                            width={badgeW}
                            height={badgeH}
                            fill={isSelected ? '#1971C2' : hasJoint ? '#212529' : 'rgba(33, 37, 41, 0.88)'}
                            stroke={isSelected ? '#FFFFFF' : hasJoint ? '#FAB005' : '#495057'}
                            strokeWidth={isSelected ? 1.5 : 1}
                            cornerRadius={3}
                          />
                          <Text
                            x={3}
                            y={5}
                            text={
                              hasJoint
                                ? `${arrowIcon} ${isLED ? '⚡' : ''}${w}мм`
                                : `${arrowIcon} ${sideName}`
                            }
                            fontSize={11}
                            fill="#FFFFFF"
                            fontFamily="JetBrains Mono"
                            fontStyle="bold"
                            align="center"
                            width={badgeW - 6}
                            listening={false}
                          />
                        </Group>
                      </Group>
                    );
                  })}
                </Group>
              );
            })}

            {/* Слой 3: Габаритные размеры стены (исходный чистый стиль) */}
            {showDimensions && (
              <Group listening={false}>
                {/* Верхний горизонтальный размер */}
                <Line
                  points={[0, -60, wallW, -60]}
                  stroke={t.isDark ? '#909296' : '#64748B'}
                  strokeWidth={2 / zoom}
                />
                <Line
                  points={[0, -40, 0, -80]}
                  stroke={t.isDark ? '#909296' : '#64748B'}
                  strokeWidth={2 / zoom}
                />
                <Line
                  points={[wallW, -40, wallW, -80]}
                  stroke={t.isDark ? '#909296' : '#64748B'}
                  strokeWidth={2 / zoom}
                />
                <Text
                  x={wallW / 2 - 80}
                  y={-100}
                  text={`◄  ${wallW} мм  ►`}
                  fontSize={Math.max(16, 24 / Math.max(0.5, zoom))}
                  fill={t.isDark ? '#E9ECEF' : '#1E293B'}
                  fontFamily="JetBrains Mono"
                  fontStyle="bold"
                />

                {/* Левый вертикальный размер */}
                <Line
                  points={[-60, 0, -60, wallH]}
                  stroke={t.isDark ? '#909296' : '#64748B'}
                  strokeWidth={2 / zoom}
                />
                <Line
                  points={[-40, 0, -80, 0]}
                  stroke={t.isDark ? '#909296' : '#64748B'}
                  strokeWidth={2 / zoom}
                />
                <Line
                  points={[-40, wallH, -80, wallH]}
                  stroke={t.isDark ? '#909296' : '#64748B'}
                  strokeWidth={2 / zoom}
                />
                <Text
                  x={-180}
                  y={wallH / 2 - 12}
                  text={`${wallH} мм`}
                  fontSize={Math.max(16, 24 / Math.max(0.5, zoom))}
                  fill={t.isDark ? '#E9ECEF' : '#1E293B'}
                  fontFamily="JetBrains Mono"
                  fontStyle="bold"
                />
              </Group>
            )}
          </Layer>
          {/* Выбор граней поверх геометрии, обрамления проемов и размеров, включая зоны клика. */}
          <Layer listening={activeTool !== 'CUT_PANEL'}>
            {/* СЛОЙ: ИНТЕРАКТИВНЫЙ ИНСПЕКТОР ТОРЦЕВ ВЫБРАННОЙ ПАНЕЛИ (В РЕЖИМЕ 'JOINTS') */}
            {editMode === 'JOINTS' && layout?.panels && (() => {
              const activePanelId =
                selectedPanelEdge?.panelId ||
                (selectedPieceIds.length > 0 ? selectedPieceIds[0] : null) ||
                selectedSubPieceId;

              if (!activePanelId) return null;

              const panel = layout.panels.find(
                (p) => p.id === activePanelId || p.subPieceId === activePanelId || p.id.startsWith(`${activePanelId}-part-`)
              );
              if (!panel) return null;

              const wallPanel = findPanelForEdge(selectedWall.panels, panel.id);
              const points = wallPanel?.points ?? panel.polygonPoints ?? [];
              const contour = wallPanel ? getResolvedPanelEdges(selectedWall, wallPanel) : getPanelEdges(points);
              const currentSide = contour.find(e => e.key === selectedPanelEdge?.edge)?.key ?? contour[0]?.key;

              return (
                <Group name="active-panel-edge-overlay" listening={true}>
                  {contour.map((edge) => {
                    const side = edge.key;
                    const edgeConf = edge.config;
                    const w = edgeConf?.width ?? 0;
                    const isLED = edgeConf?.isLED ?? false;
                    const hasJoint = w > 0 || isLED || Boolean(edgeConf?.profileArticle);
                    const isEdgeSelected = currentSide === side;
                    const edgeLinePoints = [edge.p1.x, wallH - edge.p1.y, edge.p2.x, wallH - edge.p2.y];
                    const badgeW = hasJoint ? 90 / zoom : 74 / zoom;
                    const badgeH = 22 / zoom;
                    const bX = (edge.p1.x + edge.p2.x) / 2 - badgeW / 2;
                    const bY = wallH - (edge.p1.y + edge.p2.y) / 2 - badgeH / 2;

                    const onClickSide = (e: any) => {
                      e.cancelBubble = true;
                      setSelectedPanelEdge({
                        wallId: selectedWall.id,
                        panelId: wallPanel?.id ?? panel.id,
                        edge: side,
                      });
                    };

                    return (
                      <Group key={`active-edge-${side}`} listening={true}>
                        {/* Кликабельная грань детали */}
                        <Line
                          points={edgeLinePoints}
                          stroke={isEdgeSelected ? '#339AF0' : hasJoint ? '#FFD43B' : 'rgba(51, 154, 240, 0.45)'}
                          strokeWidth={isEdgeSelected ? 3.5 / zoom : 2 / zoom}
                          hitStrokeWidth={Math.max(26 / zoom, 20)}
                          onClick={onClickSide}
                          onMouseEnter={(e) => {
                            const stage = e.target.getStage();
                            if (stage) stage.container().style.cursor = 'pointer';
                          }}
                          onMouseLeave={(e) => {
                            const stage = e.target.getStage();
                            if (stage) stage.container().style.cursor = 'default';
                          }}
                        />

                        {/* Минималистичный шильдик выбора грани */}
                        <Group
                          x={bX}
                          y={bY}
                          listening={true}
                          onClick={onClickSide}
                          onMouseEnter={(e) => {
                            const stage = e.target.getStage();
                            if (stage) stage.container().style.cursor = 'pointer';
                          }}
                          onMouseLeave={(e) => {
                            const stage = e.target.getStage();
                            if (stage) stage.container().style.cursor = 'default';
                          }}
                        >
                          <Rect
                            width={badgeW}
                            height={badgeH}
                            fill={isEdgeSelected ? '#1971C2' : hasJoint ? '#212529' : 'rgba(33, 37, 41, 0.88)'}
                            stroke={isEdgeSelected ? '#FFFFFF' : hasJoint ? '#FAB005' : '#495057'}
                            strokeWidth={isEdgeSelected ? 1.5 : 1}
                            cornerRadius={3}
                          />
                          <Text
                            x={3 / zoom}
                            y={5 / zoom}
                            text={
                              hasJoint
                                ? `${edge.shortLabel} ${isLED ? '⚡' : ''}${w}мм`
                                : edge.shortLabel
                            }
                            fontSize={10 / zoom}
                            fill="#FFFFFF"
                            fontFamily="JetBrains Mono"
                            fontStyle="bold"
                            align="center"
                            width={badgeW - 6 / zoom}
                            listening={false}
                          />
                        </Group>
                      </Group>
                    );
                  })}
                </Group>
              );
            })()}
          </Layer>
          {activeTool === 'CUT_PANEL' && <PanelCutLayer width={containerWidth} height={containerHeight} zoom={zoom} panX={panX} panY={panY} />}
        </Stage>
      )}
    </div>
  );
};
