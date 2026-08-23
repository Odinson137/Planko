import React, { useEffect, useCallback, useMemo } from 'react';
import { Stage, Layer, Rect, Text, Line, Group } from 'react-konva';
import { useElementSize } from '@mantine/hooks';
import { useProjectStore } from '../../../application/stores/useProjectStore';
import { useEditorStore } from '../../../application/stores/useEditorStore';
import { LayoutEngine } from '../../../core/layout/LayoutEngine';
import { Opening, ensureOpeningSlopes } from '../../../core/models/Opening';
import { TextureRegistry } from '../../../core/textures/TextureRegistry';
import { PolygonSlicingEngine } from '../../../core/geometry/PolygonSlicingEngine';
import { MATERIAL_NONE_ID } from '../../../core/models/Material';

const INNER_CORNER_GRADIENT_STOPS = [0, 'rgba(255, 255, 255, 0.18)', 0.5, 'rgba(0, 0, 0, 0.52)', 1, 'rgba(255, 255, 255, 0.18)'];
const OUTER_CORNER_GRADIENT_STOPS = [0, 'rgba(0, 0, 0, 0.48)', 0.4, 'rgba(255, 255, 255, 0.28)', 0.6, 'rgba(255, 255, 255, 0.28)', 1, 'rgba(0, 0, 0, 0.48)'];

export const CadCanvas: React.FC = () => {
  const { ref: containerRef, width: containerWidth, height: containerHeight } = useElementSize();
  const {
    project,
    selectedColumnIndex,
    selectedSegmentIndex,
    selectedPieceIds,
    selectedJointId,
    selectedJointIds,
    selectedWallBendId,
    selectedSubPieceId,
    selectOpening,
    selectPanel,
    toggleCellSelection,
    selectJoint,
    selectWallBend,
    updateWallBend,
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

  // Мемоизированный расчет 2D раскладки (пересчитывается ТОЛЬКО при изменении параметров стены, а не при зуме/пане)
  const layout = useMemo(() => {
    if (!selectedWall || !selectedMaterial) return null;
    return LayoutEngine.calculateWallLayout(selectedWall, selectedMaterial, project.materials);
  }, [selectedWall, selectedMaterial, project.materials]);

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
        backgroundColor: '#18191C',
        position: 'relative',
        overflow: 'hidden',
        cursor: activeTool === 'SELECT' ? 'default' : 'grab',
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
          draggable
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
                  stroke="#222327"
                  strokeWidth={1 / zoom}
                />
              ))}
              {Array.from({ length: 40 }).map((_, i) => (
                <Line
                  key={`grid-h-${i}`}
                  points={[-5000, (i - 10) * 500, 15000, (i - 10) * 500]}
                  stroke="#222327"
                  strokeWidth={1 / zoom}
                />
              ))}
            </Layer>
          )}

          {/* Слой 2: Стена, плиты, кликабельные стыки/края, проемы и размеры */}
          <Layer>
            {/* Подложка стены */}
            <Rect
              name="wall-background"
              x={0}
              y={0}
              width={wallW}
              height={wallH}
              fill="#222327"
              stroke="#373A40"
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
                ? TextureRegistry.getPatternCanvasWithTransform(
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

              const isPanelsMode = editMode === 'PANELS';

              return (
                <Group
                  key={panel.id}
                  opacity={isPanelsMode ? 1 : 0.4}
                  listening={isPanelsMode}
                  onClick={(e) => {
                    e.cancelBubble = true;
                    if (e.evt.shiftKey) {
                      toggleCellSelection(panel.id, panel.originalColumnIndex, panel.originalSegmentIndex, true);
                    } else if (panel.subPieceId) {
                      selectPanel(panel.id, panel.originalColumnIndex, panel.originalSegmentIndex, panel.subPieceId);
                    } else {
                      toggleCellSelection(panel.id, panel.originalColumnIndex, panel.originalSegmentIndex, false);
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
                        fill={isVoid ? 'rgba(24, 25, 29, 0.7)' : (panel.materialColor || '#d6cbbe')}
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
                        fillPatternRepeat={patternCanvas ? 'repeat' : undefined}
                        opacity={isVoid ? 0.75 : 0.98}
                      />
                    ) : (
                      <Rect
                        x={panelX}
                        y={panelY}
                        width={panel.width}
                        height={panel.height}
                        fill={isVoid ? 'rgba(24, 25, 29, 0.7)' : (panel.materialColor || '#d6cbbe')}
                        fillPatternImage={isVoid || !patternCanvas ? undefined : (patternCanvas as any)}
                        fillPatternScale={
                          patternCanvas
                            ? {
                                x: panel.width / patternCanvas.width,
                                y: panel.height / patternCanvas.height,
                              }
                            : undefined
                        }
                        fillPatternRepeat={patternCanvas ? 'no-repeat' : undefined}
                        opacity={isVoid ? 0.75 : 0.98}
                      />
                    )}

                    {/* Рельефная светотень для рейки-волны (GW90) */}
                    {panel.reliefType === 'WAVE_GW90' && !isVoid && (
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
                    {panel.reliefType === 'CONCAVE_GW30' && !isVoid && (
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
                    {(panel.reliefType === 'STEP_SLAT' || (isSlat && panel.reliefType !== 'WAVE_GW90' && panel.reliefType !== 'CONCAVE_GW30')) && !isVoid && (
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
                                  : (isSlat
                                    ? `🪵 [${panel.partLabel}] ${panel.decorCode ? `(${panel.decorCode})` : ''}`
                                    : `[${panel.partLabel}] ${panel.decorCode ? `(${panel.decorCode})` : ''}`)
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
                              : (isSlat
                                ? `🪵 [${panel.partLabel}] ${panel.decorCode ? `(${panel.decorCode})` : ''}`
                                : `[${panel.partLabel}] ${panel.decorCode ? `(${panel.decorCode})` : ''}`)
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
                      </Group>
                    )
                  )}
                </Group>
              );
            })}

            {/* ИНТЕРАКТИВНЫЕ СТЫКИ И КРАЯ ПЛИТ */}
            {showProfiles &&
              layout?.joints.map((joint) => {
                const isJointsMode = editMode === 'JOINTS';
                const isHoriz = joint.orientation === 'HORIZONTAL';
                const selectedJointConfig = selectedJointId ? selectedWall.customJoints[selectedJointId] : null;
                const selectedGroupId = selectedJointConfig?.groupId;

                const isJointSelected =
                  isJointsMode &&
                  (selectedJointIds.includes(joint.id) ||
                  selectedJointId === joint.id ||
                  (Boolean(selectedGroupId) && joint.groupId === selectedGroupId));

                const isLED = joint.isLED;
                const visualWidth = isJointsMode
                  ? Math.max(joint.width, 3.5 / zoom)
                  : Math.max(joint.width, 1.5 / zoom);

                const fillColor = isJointsMode
                  ? (isJointSelected
                      ? '#339AF0'
                      : isLED
                      ? '#FFD43B'
                      : joint.width > 0
                      ? '#4DABF7'
                      : '#74C0FC')
                  : (isJointSelected
                      ? '#339AF0'
                      : isLED
                      ? '#FFD43B'
                      : joint.width > 0
                      ? '#343A40'
                      : 'rgba(255, 255, 255, 0.08)');

                // Наклонные / произвольные стыки раскроя
                if (joint.p1 && joint.p2) {
                  const p1C = { x: joint.p1.x, y: wallH - joint.p1.y };
                  const p2C = { x: joint.p2.x, y: wallH - joint.p2.y };
                  const midC = { x: (p1C.x + p2C.x) / 2, y: (p1C.y + p2C.y) / 2 };
                  const hitPadding = Math.max(22 / zoom, 16);

                  return (
                    <Group
                      key={joint.id}
                      listening={isJointsMode}
                      onClick={(e) => {
                        e.cancelBubble = true;
                        selectJoint(joint.id, !!e.evt.shiftKey);
                      }}
                    >
                      {isJointsMode && (
                        <Line
                          points={[p1C.x, p1C.y, p2C.x, p2C.y]}
                          stroke="rgba(0, 0, 0, 0.001)"
                          strokeWidth={hitPadding}
                          lineCap="round"
                        />
                      )}
                      <Line
                        points={[p1C.x, p1C.y, p2C.x, p2C.y]}
                        stroke={fillColor}
                        strokeWidth={visualWidth}
                        lineCap="square"
                      />

                      {isJointSelected && (
                        <Group x={midC.x + 10} y={midC.y - 12} listening={false}>
                          <Rect
                            width={120}
                            height={22}
                            fill="#1A1B1E"
                            stroke="#339AF0"
                            strokeWidth={1}
                            cornerRadius={3}
                          />
                          <Text
                            x={6}
                            y={5}
                            text={isLED ? '⚡ LED 10 мм' : `Шов: ${joint.width} мм`}
                            fontSize={11}
                            fill="#74C0FC"
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

                const hitPadding = Math.max(20 / zoom, 14);
                const hitX = isHoriz ? jointX : jointX - (hitPadding - visualWidth) / 2;
                const hitY = isHoriz ? jointY - (hitPadding - visualWidth) / 2 : jointY;
                const hitW = isHoriz ? joint.length : hitPadding;
                const hitH = isHoriz ? hitPadding : joint.length;

                return (
                  <Group
                    key={joint.id}
                    listening={isJointsMode}
                    onClick={(e) => {
                      e.cancelBubble = true;
                      selectJoint(joint.id, !!e.evt.shiftKey);
                    }}
                  >
                    {isJointsMode && (
                      <Rect
                        x={hitX}
                        y={hitY}
                        width={hitW}
                        height={hitH}
                        fill="rgba(0, 0, 0, 0.001)"
                      />
                    )}
                    <Rect
                      x={jointX}
                      y={jointY}
                      width={jointW}
                      height={jointH}
                      fill={fillColor}
                      stroke={isJointSelected ? '#FFFFFF' : isJointsMode ? '#74C0FC' : isLED ? '#FFF3BF' : undefined}
                      strokeWidth={isJointSelected ? 2 / zoom : isJointsMode ? 1 / zoom : isLED ? 1 / zoom : 0}
                    />

                    {isJointSelected && (
                      <Group
                        x={jointX + (isHoriz ? 10 : 6)}
                        y={jointY + (isHoriz ? -26 : 20)}
                        listening={false}
                      >
                        <Rect
                          width={120}
                          height={22}
                          fill="#1A1B1E"
                          stroke="#339AF0"
                          strokeWidth={1}
                          cornerRadius={3}
                        />
                        <Text
                          x={6}
                          y={5}
                          text={isLED ? '⚡ LED 10 мм' : `Шов: ${joint.width} мм`}
                          fontSize={11}
                          fill="#74C0FC"
                          fontFamily="JetBrains Mono"
                          fontStyle="bold"
                        />
                      </Group>
                    )}
                  </Group>
                );
              })}

            {/* Отрисовка интерактивных проемов */}
            {selectedWall.openings.map((op) => {
              const isPanelsMode = editMode === 'PANELS';
              const opX = op.x;
              const opY = wallH - (op.y + op.height);
              const isSelected = op.id === project.selectedOpeningId;

              return (
                <Group
                  key={op.id}
                  x={opX}
                  y={opY}
                  draggable={isPanelsMode}
                  listening={isPanelsMode}
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
                    e.cancelBubble = true;
                    let rawX = Math.round(e.target.x());
                    let rawY = Math.round(wallH - e.target.y() - op.height);

                    // 1. Умная привязка по высоте (Y):
                    if (op.type === 'DOOR' || Math.abs(rawY) <= 50) {
                      rawY = 0; // Дверь примагничивается к полу
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
                  {/* 2D РАЗВЕРТКА ОТКОСОВ (Если включен показ развертки) */}
                  {(() => {
                    if (op.isCutout === false) return null;
                    const slopes = ensureOpeningSlopes(op);
                    if (!slopes.enabled || !slopes.showUnfold2D) return null;

                    const opDepth = op.depth ?? (op.type === 'DOOR' ? 150 : op.type === 'WINDOW' ? 200 : op.type === 'NICHE' ? 150 : 150);

                    const getSideDepth = (sideDepthConfig: number) => {
                      if (slopes.fitToOpeningDepth) return opDepth;
                      return slopes.depthMode === 'SAME' ? slopes.depth : sideDepthConfig;
                    };

                    const getSideColor = (sideMatId?: string | null) => {
                      const targetId =
                        slopes.materialMode === 'SAME'
                          ? slopes.materialId || selectedWall?.zone.materialId
                          : sideMatId || slopes.materialId || selectedWall?.zone.materialId;
                      const mat = project.materials.find((m) => m.id === targetId);
                      return mat?.color || '#2A2B2F';
                    };

                    const topD = getSideDepth(slopes.top.depth);
                    const bottomD = getSideDepth(slopes.bottom.depth);
                    const leftD = getSideDepth(slopes.left.depth);
                    const rightD = getSideDepth(slopes.right.depth);

                    return (
                      <Group listening={false}>
                        {/* Верхняя развертка */}
                        {slopes.top.enabled && topD > 0 && (
                          <Group y={-topD}>
                            <Rect
                              width={op.width}
                              height={topD}
                              fill={getSideColor(slopes.top.materialId)}
                              opacity={0.85}
                              stroke="#339AF0"
                              strokeWidth={1 / zoom}
                              dash={[6, 4]}
                            />
                            <Text
                              x={10}
                              y={Math.max(4, topD / 2 - 6)}
                              text={`⬆ Верхний откос: ${op.width} × ${topD} мм`}
                              fontSize={Math.max(10, 13 / Math.max(0.5, zoom))}
                              fill="#E9ECEF"
                              fontFamily="Inter"
                              fontStyle="bold"
                            />
                          </Group>
                        )}

                        {/* Нижняя развертка / Подоконник */}
                        {slopes.bottom.enabled && bottomD > 0 && (
                          <Group y={op.height}>
                            <Rect
                              width={op.width}
                              height={bottomD}
                              fill={getSideColor(slopes.bottom.materialId)}
                              opacity={0.85}
                              stroke="#339AF0"
                              strokeWidth={1 / zoom}
                              dash={[6, 4]}
                            />
                            <Text
                              x={10}
                              y={Math.max(4, bottomD / 2 - 6)}
                              text={`⬇ ${op.type === 'WINDOW' ? 'Подоконник' : 'Низ'}: ${op.width} × ${bottomD} мм`}
                              fontSize={Math.max(10, 13 / Math.max(0.5, zoom))}
                              fill="#E9ECEF"
                              fontFamily="Inter"
                              fontStyle="bold"
                            />
                          </Group>
                        )}

                        {/* Левая развертка */}
                        {slopes.left.enabled && leftD > 0 && (
                          <Group x={-leftD}>
                            <Rect
                              width={leftD}
                              height={op.height}
                              fill={getSideColor(slopes.left.materialId)}
                              opacity={0.85}
                              stroke="#339AF0"
                              strokeWidth={1 / zoom}
                              dash={[6, 4]}
                            />
                            <Text
                              x={6}
                              y={op.height / 2 - 10}
                              text={`⬅ Левый\n${leftD}×${op.height}`}
                              fontSize={Math.max(9, 12 / Math.max(0.5, zoom))}
                              fill="#E9ECEF"
                              fontFamily="Inter"
                              fontStyle="bold"
                            />
                          </Group>
                        )}

                        {/* Правая развертка */}
                        {slopes.right.enabled && rightD > 0 && (
                          <Group x={op.width}>
                            <Rect
                              width={rightD}
                              height={op.height}
                              fill={getSideColor(slopes.right.materialId)}
                              opacity={0.85}
                              stroke="#339AF0"
                              strokeWidth={1 / zoom}
                              dash={[6, 4]}
                            />
                            <Text
                              x={6}
                              y={op.height / 2 - 10}
                              text={`➡ Правый\n${rightD}×${op.height}`}
                              fontSize={Math.max(9, 12 / Math.max(0.5, zoom))}
                              fill="#E9ECEF"
                              fontFamily="Inter"
                              fontStyle="bold"
                            />
                          </Group>
                        )}
                      </Group>
                    );
                  })()}

                  <Rect
                    width={op.width}
                    height={op.height}
                    fill={op.isCutout !== false ? '#141517' : 'rgba(26, 27, 30, 0.82)'}
                    stroke={isSelected ? '#339AF0' : getOpeningColor(op.type)}
                    strokeWidth={isSelected ? 4 / zoom : (op.isCutout !== false ? 2 / zoom : 3 / zoom)}
                    dash={op.isCutout === false ? [10, 6] : undefined}
                    cornerRadius={op.type === 'TV_ZONE' ? 4 : 0}
                  />

                  {/* Внутренняя рамка глубины откоса для визуализации объема */}
                  {op.isCutout !== false && (() => {
                    const slopes = ensureOpeningSlopes(op);
                    if (!slopes.enabled) return null;
                    const opDepth = op.depth ?? 150;
                    const effectiveD = slopes.fitToOpeningDepth ? opDepth : (slopes.depth || 150);
                    const frameD = Math.min(24, Math.max(8, effectiveD / 10));
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
                              ? `${opDepth} мм (по проему)`
                              : slopes.depthMode === 'SAME'
                              ? `${effectiveD} мм`
                              : `В:${slopes.top.depth} Н:${slopes.bottom.depth} Л:${slopes.left.depth} П:${slopes.right.depth}`
                          }${
                            slopes.jointProfileType && slopes.jointProfileType !== 'NONE'
                              ? ` (${
                                  slopes.jointProfileType === 'LED_10'
                                    ? 'LED'
                                    : slopes.jointProfileType === 'CORNER'
                                    ? 'Уголок'
                                    : 'Шов 8мм'
                                })`
                              : ''
                          }`
                        : '';

                    return (
                      <Text
                        x={15}
                        y={15}
                        text={`${op.isCutout === false ? '📺 ' : ''}${op.name}\n${op.width} × ${op.height} мм${
                          op.isCutout === false ? '\n(поверх плит)' : slopeInfo
                        }`}
                        fontSize={Math.max(12, 16 / Math.max(0.5, zoom))}
                        fill={op.isCutout === false ? '#FFD43B' : '#C1C2C5'}
                        fontFamily="Inter"
                        fontStyle="bold"
                        listening={false}
                      />
                    );
                  })()}
                </Group>
              );
            })}

            {/* ИНТЕРАКТИВНЫЕ МАРКЕРЫ ЗОН ИЗГИБА СТЕНЫ (WallBend) */}
            {selectedWall.bends?.map((bend) => {
              const arcLen = Math.round((Math.PI * bend.radius * (bend.angleDeg || 90)) / 180);
              const isBendSelected = selectedWallBendId === bend.id;

              return (
                <Group
                  key={bend.id}
                  x={bend.x}
                  y={0}
                  draggable
                  dragBoundFunc={(pos) => {
                    const stageX = pos.x;
                    const minX = panX;
                    const maxX = panX + (wallW - arcLen) * zoom;
                    const clampedStageX = Math.max(minX, Math.min(stageX, maxX));
                    return { x: clampedStageX, y: panY };
                  }}
                  onDragStart={(e) => {
                    e.cancelBubble = true;
                    selectWallBend(bend.id);
                  }}
                  onDragEnd={(e) => {
                    e.cancelBubble = true;
                    const currentStageX = e.target.x();
                    const wallX = Math.max(0, Math.min(wallW - arcLen, Math.round((currentStageX - panX) / zoom)));
                    const roundedX = Math.round(wallX / 10) * 10;
                    e.target.position({ x: roundedX, y: 0 });
                    updateWallBend(selectedWall.id, bend.id, { x: roundedX });
                  }}
                  onClick={(e) => {
                    e.cancelBubble = true;
                    selectWallBend(bend.id);
                  }}
                >
                  {bend.radius <= 0 || arcLen <= 0 ? (
                    <>
                      {/* Острый угол (R = 0): вертикальная осевая линия перегиба стены */}
                      <Line
                        points={[0, 0, 0, wallH]}
                        stroke={isBendSelected ? '#339AF0' : '#4DABF7'}
                        strokeWidth={isBendSelected ? 3 / zoom : 1.8 / zoom}
                        dash={[8, 5]}
                      />
                      {/* Верхняя плашка с названием угла */}
                      <Group x={-80} y={-36} listening={false}>
                        <Rect
                          width={160}
                          height={24}
                          fill="#141517"
                          stroke={isBendSelected ? '#339AF0' : '#4DABF7'}
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
                          fill="#74C0FC"
                        />
                      </Group>
                    </>
                  ) : (
                    <>
                      {/* Полупрозрачная направляющая полоса зоны сгиба на стене */}
                      <Rect
                        width={arcLen}
                        height={wallH}
                        fill={isBendSelected ? 'rgba(51, 154, 240, 0.16)' : 'rgba(77, 171, 247, 0.07)'}
                        stroke={isBendSelected ? '#339AF0' : '#4DABF7'}
                        strokeWidth={isBendSelected ? 2.5 / zoom : 1.2 / zoom}
                        dash={[8, 6]}
                      />

                      {/* Верхняя плашка с названием угла и радиусом */}
                      <Group x={Math.max(4, (arcLen - 170) / 2)} y={-36} listening={false}>
                        <Rect
                          width={Math.min(arcLen - 8, 170)}
                          height={24}
                          fill="#141517"
                          stroke={isBendSelected ? '#339AF0' : '#4DABF7'}
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
                          fill="#74C0FC"
                        />
                      </Group>
                    </>
                  )}
                </Group>
              );
            })}

            {/* Слой 3: Габаритные размеры стены (исходный чистый стиль) */}
            {showDimensions && (
              <Group listening={false}>
                {/* Верхний горизонтальный размер */}
                <Line
                  points={[0, -60, wallW, -60]}
                  stroke="#909296"
                  strokeWidth={2 / zoom}
                />
                <Line
                  points={[0, -40, 0, -80]}
                  stroke="#909296"
                  strokeWidth={2 / zoom}
                />
                <Line
                  points={[wallW, -40, wallW, -80]}
                  stroke="#909296"
                  strokeWidth={2 / zoom}
                />
                <Text
                  x={wallW / 2 - 80}
                  y={-100}
                  text={`◄  ${wallW} мм  ►`}
                  fontSize={Math.max(16, 24 / Math.max(0.5, zoom))}
                  fill="#E9ECEF"
                  fontFamily="JetBrains Mono"
                  fontStyle="bold"
                />

                {/* Левый вертикальный размер */}
                <Line
                  points={[-60, 0, -60, wallH]}
                  stroke="#909296"
                  strokeWidth={2 / zoom}
                />
                <Line
                  points={[-40, 0, -80, 0]}
                  stroke="#909296"
                  strokeWidth={2 / zoom}
                />
                <Line
                  points={[-40, wallH, -80, wallH]}
                  stroke="#909296"
                  strokeWidth={2 / zoom}
                />
                <Text
                  x={-180}
                  y={wallH / 2 - 12}
                  text={`${wallH} мм`}
                  fontSize={Math.max(16, 24 / Math.max(0.5, zoom))}
                  fill="#E9ECEF"
                  fontFamily="JetBrains Mono"
                  fontStyle="bold"
                />
              </Group>
            )}
          </Layer>
        </Stage>
      )}
    </div>
  );
};
