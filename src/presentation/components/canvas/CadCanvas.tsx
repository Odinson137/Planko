import React, { useEffect, useCallback } from 'react';
import { Stage, Layer, Rect, Text, Line, Group } from 'react-konva';
import { useElementSize } from '@mantine/hooks';
import { useProjectStore } from '../../../application/stores/useProjectStore';
import { useEditorStore } from '../../../application/stores/useEditorStore';
import { LayoutEngine } from '../../../core/layout/LayoutEngine';
import { Opening } from '../../../core/models/Opening';

export const CadCanvas: React.FC = () => {
  const { ref: containerRef, width: containerWidth, height: containerHeight } = useElementSize();
  const {
    project,
    selectedColumnIndex,
    selectedSegmentIndex,
    selectedPieceIds,
    selectedJointId,
    selectedJointIds,
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
    activeTool,
  } = useEditorStore();

  const selectedWall = project.walls.find((w) => w.id === project.selectedWallId);
  const selectedMaterial = project.materials.find(
    (m) => m.id === (selectedWall?.zone.materialId || 'mat-sheet-1220')
  );

  // Расчет 2D раскладки ячеек и стыков
  const layout =
    selectedWall && selectedMaterial
      ? LayoutEngine.calculateWallLayout(selectedWall, selectedMaterial, project.materials)
      : null;

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
            {/* Тень и подложка стены */}
            <Rect
              name="wall-background"
              x={0}
              y={0}
              width={wallW}
              height={wallH}
              fill="#222327"
              stroke="#373A40"
              strokeWidth={3 / zoom}
              shadowBlur={30}
              shadowColor="#000000"
              shadowOpacity={0.6}
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
              const slatStep = 145;

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
                    fill={isVoid ? 'rgba(24, 25, 29, 0.7)' : (panel.materialColor || '#d6cbbe')}
                    stroke={
                      isPanelSelected
                        ? '#40C057'
                        : (isVoid ? '#373A40' : '#141517')
                    }
                    strokeWidth={isPanelSelected ? 4 / zoom : 1}
                    dash={isVoid ? [12, 8] : undefined}
                    opacity={isVoid ? 0.75 : 0.94}
                    shadowColor={isPanelSelected ? '#40C057' : undefined}
                    shadowBlur={isPanelSelected ? 16 : 0}
                    shadowOpacity={0.85}
                  />

                  {/* Отрисовка ламелей реек */}
                  {isSlat && (
                    <Group listening={false}>
                      {Array.from({ length: Math.floor(panel.width / slatStep) }).map((_, idx) => {
                        const slatX = panelX + (idx + 1) * slatStep;
                        if (slatX >= panelX + panel.width) return null;
                        return (
                          <Line
                            key={`slat-v-${panel.id}-${idx}`}
                            points={[slatX, panelY, slatX, panelY + panel.height]}
                            stroke="#4A3423"
                            strokeWidth={2 / zoom}
                            opacity={0.65}
                          />
                        );
                      })}
                    </Group>
                  )}

                  {/* Текстовые метки ячейки (деталь и размеры) */}
                  {panel.width > 70 && panel.height > 40 && (
                    <Group x={panelX + 10} y={panelY + 10} listening={false}>
                      <Text
                        text={isVoid ? '⭕ ПУСТОТА' : (isSlat ? `🪵 [${panel.partLabel}]` : `[${panel.partLabel}]`)}
                        fontSize={Math.max(11, 14 / Math.max(0.5, zoom))}
                        fill={isVoid ? '#868E96' : '#1A1B1E'}
                        fontFamily="JetBrains Mono"
                        fontStyle="bold"
                      />
                      <Text
                        y={Math.max(14, 18 / Math.max(0.5, zoom))}
                        text={`${Math.round(panel.width)} × ${Math.round(panel.height)}`}
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
                      stroke={isJointSelected ? '#74C0FC' : undefined}
                      strokeWidth={isJointSelected ? 2 / zoom : 0}
                      shadowColor={isJointSelected ? '#339AF0' : isLED ? '#FFD43B' : undefined}
                      shadowBlur={isJointSelected ? 20 : isLED ? 15 : 0}
                      shadowOpacity={isJointSelected || isLED ? 1 : 0}
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
                    const newX = Math.round(e.target.x());
                    const newY = Math.round(wallH - e.target.y() - op.height);

                    const clampedX = Math.max(0, Math.min(newX, wallW - op.width));
                    const clampedY = Math.max(0, Math.min(newY, wallH - op.height));

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
                    shadowColor={isSelected ? '#339AF0' : (op.isCutout === false ? '#000000' : undefined)}
                    shadowBlur={isSelected ? 20 : (op.isCutout === false ? 12 : 0)}
                    shadowOpacity={0.8}
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
