import React, { useEffect, useCallback, useMemo } from 'react';
import { Stage, Layer, Rect, Text, Line, Group } from 'react-konva';
import { useElementSize } from '@mantine/hooks';
import { useProjectStore } from '../../../application/stores/useProjectStore';
import { useEditorStore } from '../../../application/stores/useEditorStore';
import { LayoutEngine } from '../../../core/layout/LayoutEngine';
import { Opening } from '../../../core/models/Opening';
import { TextureRegistry } from '../../../core/textures/TextureRegistry';

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
    activeTool,
  } = useEditorStore();

  const selectedWall = project.walls.find((w) => w.id === project.selectedWallId);
  const selectedMaterial = project.materials.find(
    (m) => m.id === (selectedWall?.zone.materialId || 'mat-sheet-1220')
  );

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
              const isPanelSelected =
                (selectedPieceIds.includes(panel.id) ||
                  (selectedPieceIds.length === 0 &&
                    selectedColumnIndex === panel.originalColumnIndex &&
                    (selectedSegmentIndex === null || selectedSegmentIndex === panel.originalSegmentIndex))) &&
                selectedJointId === null;

              const isVoid = panel.isVoid;
              const isSlat = panel.materialType === 'SLAT';
              const patternCanvas = !isVoid
                ? TextureRegistry.getPatternCanvas(
                    panel.textureCategory || 'WOOD',
                    panel.materialColor || '#d6cbbe',
                    (panel.reliefType as any) || 'FLAT',
                    panel.decorCode
                  )
                : null;

              return (
                <Group
                  key={panel.id}
                  onClick={(e) => {
                    e.cancelBubble = true;
                    toggleCellSelection(panel.id, panel.originalColumnIndex, panel.originalSegmentIndex, !!e.evt.shiftKey);
                  }}
                >
                  <Rect
                    x={panelX}
                    y={panelY}
                    width={panel.width}
                    height={panel.height}
                    fill={isVoid ? 'rgba(24, 25, 29, 0.7)' : undefined}
                    fillPatternImage={isVoid ? undefined : (patternCanvas as any)}
                    fillPatternScale={
                      patternCanvas
                        ? {
                            x: panel.width / patternCanvas.width,
                            y: panel.height / patternCanvas.height,
                          }
                        : undefined
                    }
                    fillPatternRepeat="no-repeat"
                    stroke={
                      isPanelSelected
                        ? '#40C057'
                        : (isVoid ? '#373A40' : '#141517')
                    }
                    strokeWidth={isPanelSelected ? 3 / zoom : 1}
                    dash={isVoid ? [12, 8] : undefined}
                    opacity={isVoid ? 0.75 : 0.98}
                  />

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
                        if (bendSubW <= 1) return null;

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
                                  text={`⌒ ${bend.type === 'ARCH_VAULT' ? 'СВОД' : bend.type === 'INNER_CORNER' ? 'ВНУТР' : 'ВНЕШН'} R=${bend.radius}`}
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

                  {/* Текстовые метки ячейки (деталь, код декора и размеры) */}
                  {panel.width > 70 && panel.height > 40 && (
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
                  )}
                </Group>
              );
            })}

            {/* ИНТЕРАКТИВНЫЕ СТЫКИ И КРАЯ ПЛИТ */}
            {showProfiles &&
              layout?.joints.map((joint) => {
                const isHoriz = joint.orientation === 'HORIZONTAL';
                const selectedJointConfig = selectedJointId ? selectedWall.customJoints[selectedJointId] : null;
                const selectedGroupId = selectedJointConfig?.groupId;

                const isJointSelected =
                  selectedJointIds.includes(joint.id) ||
                  selectedJointId === joint.id ||
                  (Boolean(selectedGroupId) && joint.groupId === selectedGroupId);

                const isLED = joint.isLED;

                const visualWidth = Math.max(joint.width, 2 / zoom);
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

                const fillColor = isJointSelected
                  ? '#339AF0'
                  : isLED
                  ? '#FFD43B'
                  : joint.width > 0
                  ? '#343A40'
                  : 'rgba(255, 255, 255, 0.08)';

                return (
                  <Group
                    key={joint.id}
                    onClick={(e) => {
                      e.cancelBubble = true;
                      selectJoint(joint.id, !!e.evt.shiftKey);
                    }}
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
                      stroke={isJointSelected ? '#74C0FC' : isLED ? '#FFF3BF' : undefined}
                      strokeWidth={isJointSelected ? 2 / zoom : isLED ? 1 / zoom : 0}
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
              const opX = op.x;
              const opY = wallH - (op.y + op.height);
              const isSelected = op.id === project.selectedOpeningId;

              return (
                <Group
                  key={op.id}
                  x={opX}
                  y={opY}
                  draggable
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
                  <Rect
                    width={op.width}
                    height={op.height}
                    fill={op.isCutout !== false ? '#141517' : 'rgba(26, 27, 30, 0.82)'}
                    stroke={isSelected ? '#339AF0' : getOpeningColor(op.type)}
                    strokeWidth={isSelected ? 4 / zoom : (op.isCutout !== false ? 2 / zoom : 3 / zoom)}
                    dash={op.isCutout === false ? [10, 6] : undefined}
                    cornerRadius={op.type === 'TV_ZONE' ? 4 : 0}
                  />
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
                  <Text
                    x={15}
                    y={15}
                    text={`${op.isCutout === false ? '📺 ' : ''}${op.name}\n${op.width} × ${op.height} мм${op.isCutout === false ? '\n(поверх плит)' : ''}`}
                    fontSize={Math.max(13, 18 / Math.max(0.5, zoom))}
                    fill={op.isCutout === false ? '#FFD43B' : '#C1C2C5'}
                    fontFamily="Inter"
                    fontStyle="bold"
                    listening={false}
                  />
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
                      text={`⌒ ${bend.name || (bend.type === 'ARCH_VAULT' ? 'Свод' : bend.type === 'INNER_CORNER' ? 'Внутр' : 'Внешн')} R=${bend.radius} (${arcLen} мм)`}
                      fontSize={10}
                      fontFamily="JetBrains Mono"
                      fontStyle="bold"
                      fill="#74C0FC"
                    />
                  </Group>
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
