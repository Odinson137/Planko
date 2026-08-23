import React, { useRef, useEffect, useState, useCallback } from 'react';
import { Box, Group, ActionIcon, Tooltip, Slider, Text, Button, Paper, Badge, NumberInput, SimpleGrid, Divider, Stack } from '@mantine/core';
import { Camera, ZoomIn, ZoomOut, RotateCw, Download, Compass } from 'lucide-react';
import { useProjectStore } from '../../../application/stores/useProjectStore';
import { LayoutEngine } from '../../../core/layout/LayoutEngine';
import { MATERIAL_NONE_ID } from '../../../core/models/Material';

interface Point3D {
  x: number;
  y: number;
  z: number;
}

interface Point2D {
  x: number;
  y: number;
}

export const Axonometric3DView: React.FC = () => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);

  const [angleDeg, setAngleDeg] = useState<number>(34);         // Угол поворота (30-35°)
  const [elevationDeg, setElevationDeg] = useState<number>(26);    // Наклон камеры сверху
  const [zoomScale, setZoomScale] = useState<number>(0.24);      // Масштаб
  const [panOffset, setPanOffset] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState<boolean>(false);
  const [dragStart, setDragStart] = useState<{ x: number; y: number }>({ x: 0, y: 0 });

  const { project } = useProjectStore();
  const selectedWall = project.walls.find((w) => w.id === project.selectedWallId);
  const selectedMaterial = project.materials.find(
    (m) => m.id === (selectedWall?.zone.materialId || 'mat-sheet-1220')
  );

  const layout =
    selectedWall && selectedMaterial
      ? LayoutEngine.calculateWallLayout(selectedWall, selectedMaterial, project.materials)
      : null;

  // Математическая 3D-проекция точки (X, Y, Z) в экранные 2D (x, y)
  const project3D = useCallback(
    (p: Point3D, cx: number, cy: number, scale: number): Point2D => {
      const radA = (angleDeg * Math.PI) / 180;
      const radE = (elevationDeg * Math.PI) / 180;

      // Вращение вокруг вертикальной оси Y
      const xRot = p.x * Math.cos(radA) - p.z * Math.sin(radA);
      const zRot = p.x * Math.sin(radA) + p.z * Math.cos(radA);

      // Проекция с учетом угла наклона камеры сверху
      const screenX = cx + xRot * scale + panOffset.x;
      const screenY = cy - (p.y * Math.cos(radE) - zRot * Math.sin(radE)) * scale + panOffset.y;

      return { x: screenX, y: screenY };
    },
    [angleDeg, elevationDeg, panOffset]
  );

  // Отрисовка всей монолитной 3D-сцены
  const renderScene = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas || !selectedWall || !layout) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const width = canvas.width;
    const height = canvas.height;

    ctx.clearRect(0, 0, width, height);

    const cx = width * 0.38;
    const cy = height * 0.68;
    const scale = zoomScale;

    const wallH = selectedWall.height;
    const wallThick = 150; // Толщина несущей стены (мм)
    const panelThick = 8;  // Толщина декоративной панели (мм)

    // =========================================================================
    // 1. Построение непрерывного 3D пути стены (с поворотом на углах)
    // =========================================================================
    interface WallSegment3D {
      colIdx: number;
      isRadius: boolean;
      radiusType?: string;
      radiusVal?: number;
      width: number;
      // Функция получения точки на лицевой поверхности стены или с отступом вглубь (толщина)
      getWallPoint: (u: number, y: number, depthOffset?: number) => Point3D;
    }

    const wallSegments: WallSegment3D[] = [];
    let curX = 0;
    let curZ = 0;
    let curHeading = 0; // угол направления стены (0 = вдоль +X)

    const allPathPoints: Point3D[] = [{ x: 0, y: 0, z: 0 }];

    const sortedPanels = [...layout.panels].sort((a, b) => a.originalColumnIndex - b.originalColumnIndex);
    const uniqueCols = Array.from(new Set(sortedPanels.map((p) => p.originalColumnIndex))).sort((a, b) => a - b);

    uniqueCols.forEach((colIdx) => {
      const colPanels = sortedPanels.filter((p) => p.originalColumnIndex === colIdx);
      const firstPanel = colPanels[0];
      const pWidth = firstPanel.width;
      const radConfig = firstPanel.radiusConfig;

      const segStartX = curX;
      const segStartZ = curZ;
      const psi = curHeading; // текущий угол ориентации стены

      if (radConfig && radConfig.type === 'OUTER_CORNER') {
        const R = radConfig.radius;
        const arcDeg = radConfig.angleDeg ?? 90;
        const totalTurn = (arcDeg * Math.PI) / 180;

        // Центр скругления (справа по ходу движения стены)
        const cX = segStartX - Math.sin(psi) * R;
        const cZ = segStartZ - Math.cos(psi) * R;

        wallSegments.push({
          colIdx,
          isRadius: true,
          radiusType: radConfig.type,
          radiusVal: R,
          width: pWidth,
          getWallPoint: (uRatio: number, y: number, depthOffset = 0) => {
            const alpha = uRatio * totalTurn;
            const phi = psi - Math.PI / 2 + alpha;
            const effR = Math.max(5, R - depthOffset);
            return {
              x: cX + Math.cos(phi) * effR,
              y,
              z: cZ - Math.sin(phi) * effR,
            };
          },
        });

        // Позиция в конце дуги
        const endPhi = psi - Math.PI / 2 + totalTurn;
        curX = cX + Math.cos(endPhi) * R;
        curZ = cZ - Math.sin(endPhi) * R;
        curHeading = psi + totalTurn;
        allPathPoints.push({ x: curX, y: 0, z: curZ });
      } else if (radConfig && radConfig.type === 'INNER_CORNER') {
        const R = radConfig.radius;
        const arcDeg = radConfig.angleDeg ?? 90;
        const totalTurn = (arcDeg * Math.PI) / 180;

        // Центр скругления (слева по ходу движения стены)
        const cX = segStartX + Math.sin(psi) * R;
        const cZ = segStartZ + Math.cos(psi) * R;

        wallSegments.push({
          colIdx,
          isRadius: true,
          radiusType: radConfig.type,
          radiusVal: R,
          width: pWidth,
          getWallPoint: (uRatio: number, y: number, depthOffset = 0) => {
            const alpha = uRatio * totalTurn;
            const phi = psi + Math.PI / 2 - alpha;
            const effR = Math.max(5, R + depthOffset);
            return {
              x: cX + Math.cos(phi) * effR,
              y,
              z: cZ - Math.sin(phi) * effR,
            };
          },
        });

        const endPhi = psi + Math.PI / 2 - totalTurn;
        curX = cX + Math.cos(endPhi) * R;
        curZ = cZ - Math.sin(endPhi) * R;
        curHeading = psi - totalTurn;
        allPathPoints.push({ x: curX, y: 0, z: curZ });
      } else {
        // Прямая плоская секция
        wallSegments.push({
          colIdx,
          isRadius: false,
          width: pWidth,
          getWallPoint: (uRatio: number, y: number, depthOffset = 0) => {
            const dist = uRatio * pWidth;
            // Вектор перпендикуляра внутрь стены (толщина)
            const normX = -Math.sin(psi) * depthOffset;
            const normZ = -Math.cos(psi) * depthOffset;
            return {
              x: segStartX + Math.cos(psi) * dist + normX,
              y,
              z: segStartZ - Math.sin(psi) * dist + normZ,
            };
          },
        });

        curX += Math.cos(psi) * pWidth;
        curZ -= Math.sin(psi) * pWidth;
        allPathPoints.push({ x: curX, y: 0, z: curZ });
      }
    });

    const segmentMap = new Map<number, WallSegment3D>();
    wallSegments.forEach((s) => segmentMap.set(s.colIdx, s));

    // =========================================================================
    // 2. Отрисовка пола (охватывает всю площадь сложной стены)
    // =========================================================================
    const minX = Math.min(...allPathPoints.map((p) => p.x), 0) - 800;
    const maxX = Math.max(...allPathPoints.map((p) => p.x), 0) + 800;
    const minZ = Math.min(...allPathPoints.map((p) => p.z), 0) - wallThick - 600;
    const maxZ = Math.max(...allPathPoints.map((p) => p.z), 0) + 2000;

    const floorPoints = [
      project3D({ x: minX, y: 0, z: minZ }, cx, cy, scale),
      project3D({ x: maxX, y: 0, z: minZ }, cx, cy, scale),
      project3D({ x: maxX, y: 0, z: maxZ }, cx, cy, scale),
      project3D({ x: minX, y: 0, z: maxZ }, cx, cy, scale),
    ];

    ctx.fillStyle = '#18191c';
    ctx.beginPath();
    ctx.moveTo(floorPoints[0].x, floorPoints[0].y);
    floorPoints.forEach((p) => ctx.lineTo(p.x, p.y));
    ctx.closePath();
    ctx.fill();

    // Сетка плитки
    ctx.strokeStyle = '#22252a';
    ctx.lineWidth = 1;
    for (let x = Math.floor(minX / 500) * 500; x <= maxX; x += 500) {
      const pA = project3D({ x, y: 0, z: minZ }, cx, cy, scale);
      const pB = project3D({ x, y: 0, z: maxZ }, cx, cy, scale);
      ctx.beginPath();
      ctx.moveTo(pA.x, pA.y);
      ctx.lineTo(pB.x, pB.y);
      ctx.stroke();
    }
    for (let z = Math.floor(minZ / 500) * 500; z <= maxZ; z += 500) {
      const pA = project3D({ x: minX, y: 0, z }, cx, cy, scale);
      const pB = project3D({ x: maxX, y: 0, z }, cx, cy, scale);
      ctx.beginPath();
      ctx.moveTo(pA.x, pA.y);
      ctx.lineTo(pB.x, pB.y);
      ctx.stroke();
    }

    // =========================================================================
    // 3. Отрисовка МОНОЛИТНОЙ НЕСУЩЕЙ СТЕНЫ (Верхняя грань и глубина)
    // =========================================================================
    // Отрисовываем непрерывный верхний срез стены (толщину) вдоль ВСЕХ сегментов
    wallSegments.forEach((seg) => {
      const steps = seg.isRadius ? 12 : 1;
      for (let i = 0; i < steps; i++) {
        const u0 = i / steps;
        const u1 = (i + 1) / steps;

        // 4 точки верхней крышки стены (толщина)
        const topF0 = project3D(seg.getWallPoint(u0, wallH, 0), cx, cy, scale);
        const topF1 = project3D(seg.getWallPoint(u1, wallH, 0), cx, cy, scale);
        const topB1 = project3D(seg.getWallPoint(u1, wallH, wallThick), cx, cy, scale);
        const topB0 = project3D(seg.getWallPoint(u0, wallH, wallThick), cx, cy, scale);

        ctx.fillStyle = '#2c2f35';
        ctx.strokeStyle = '#3a3e47';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(topF0.x, topF0.y);
        ctx.lineTo(topF1.x, topF1.y);
        ctx.lineTo(topB1.x, topB1.y);
        ctx.lineTo(topB0.x, topB0.y);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
      }
    });

    // Левый торец стены (толщина)
    const firstSeg = wallSegments[0];
    if (firstSeg) {
      const tL0 = project3D(firstSeg.getWallPoint(0, 0, 0), cx, cy, scale);
      const tL1 = project3D(firstSeg.getWallPoint(0, wallH, 0), cx, cy, scale);
      const tL2 = project3D(firstSeg.getWallPoint(0, wallH, wallThick), cx, cy, scale);
      const tL3 = project3D(firstSeg.getWallPoint(0, 0, wallThick), cx, cy, scale);

      ctx.fillStyle = '#1c1e22';
      ctx.beginPath();
      ctx.moveTo(tL0.x, tL0.y);
      ctx.lineTo(tL1.x, tL1.y);
      ctx.lineTo(tL2.x, tL2.y);
      ctx.lineTo(tL3.x, tL3.y);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    }

    // Правый торец стены (в конце последнего сегмента)
    const lastSeg = wallSegments[wallSegments.length - 1];
    if (lastSeg) {
      const tR0 = project3D(lastSeg.getWallPoint(1, 0, 0), cx, cy, scale);
      const tR1 = project3D(lastSeg.getWallPoint(1, wallH, 0), cx, cy, scale);
      const tR2 = project3D(lastSeg.getWallPoint(1, wallH, wallThick), cx, cy, scale);
      const tR3 = project3D(lastSeg.getWallPoint(1, 0, wallThick), cx, cy, scale);

      ctx.fillStyle = '#222429';
      ctx.beginPath();
      ctx.moveTo(tR0.x, tR0.y);
      ctx.lineTo(tR1.x, tR1.y);
      ctx.lineTo(tR2.x, tR2.y);
      ctx.lineTo(tR3.x, tR3.y);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    }

    // =========================================================================
    // 4. Отрисовка ДЕКОРАТИВНЫХ ПАНЕЛЕЙ И ИЗГИБОВ (с непрерывным стыком!)
    // =========================================================================
    layout.panels.forEach((panel) => {
      const seg = segmentMap.get(panel.originalColumnIndex);
      if (!seg) return;

      const isVoid = panel.isVoid || panel.materialId === MATERIAL_NONE_ID;
      const isSlat = panel.materialType === 'SLAT';
      const baseColor = isVoid ? '#16171a' : (panel.materialColor || '#d6cbbe');

      const yBot = panel.y;
      const yTop = panel.y + panel.height;

      if (seg.isRadius) {
        // Отрисовка цилиндрического изгиба через непрерывные фасеты
        const steps = 16;
        for (let s = 0; s < steps; s++) {
          const u0 = s / steps;
          const u1 = (s + 1) / steps;

          // Лицевая поверхность панели
          const p0 = project3D(seg.getWallPoint(u0, yBot, -panelThick), cx, cy, scale);
          const p1 = project3D(seg.getWallPoint(u1, yBot, -panelThick), cx, cy, scale);
          const p2 = project3D(seg.getWallPoint(u1, yTop, -panelThick), cx, cy, scale);
          const p3 = project3D(seg.getWallPoint(u0, yTop, -panelThick), cx, cy, scale);

          // Объемное цилиндрическое затенение
          const lightFactor =
            seg.radiusType === 'INNER_CORNER'
              ? 0.5 + 0.45 * Math.abs(u0 - 0.5) * 2 // темнее в центре
              : 0.65 + 0.35 * Math.sin(u0 * Math.PI); // яркий блик в центре

          ctx.fillStyle = isVoid ? '#141517' : adjustBrightness(baseColor, lightFactor);
          ctx.beginPath();
          ctx.moveTo(p0.x, p0.y);
          ctx.lineTo(p1.x, p1.y);
          ctx.lineTo(p2.x, p2.y);
          ctx.lineTo(p3.x, p3.y);
          ctx.closePath();
          ctx.fill();

          // Тонкая линия фасета (направляющая сгиба)
          ctx.strokeStyle = 'rgba(0, 0, 0, 0.12)';
          ctx.lineWidth = 0.5;
          ctx.stroke();

          // Верхний торец панели (глубина 8 мм)
          const pt0 = p3;
          const pt1 = p2;
          const pt2 = project3D(seg.getWallPoint(u1, yTop, 0), cx, cy, scale);
          const pt3 = project3D(seg.getWallPoint(u0, yTop, 0), cx, cy, scale);

          ctx.fillStyle = adjustBrightness(baseColor, 0.85);
          ctx.beginPath();
          ctx.moveTo(pt0.x, pt0.y);
          ctx.lineTo(pt1.x, pt1.y);
          ctx.lineTo(pt2.x, pt2.y);
          ctx.lineTo(pt3.x, pt3.y);
          ctx.closePath();
          ctx.fill();
        }
      } else if (isSlat) {
        // Отрисовка реек (ламелей) с выпуклым 3D-профилем
        const slatWidth = 145;
        const count = Math.max(1, Math.floor(panel.width / slatWidth));

        for (let i = 0; i < count; i++) {
          const u0 = (i * slatWidth) / panel.width;
          const u1 = Math.min(1, ((i + 1) * slatWidth - 8) / panel.width);

          const p0 = project3D(seg.getWallPoint(u0, yBot, -16), cx, cy, scale);
          const p1 = project3D(seg.getWallPoint(u1, yBot, -16), cx, cy, scale);
          const p2 = project3D(seg.getWallPoint(u1, yTop, -16), cx, cy, scale);
          const p3 = project3D(seg.getWallPoint(u0, yTop, -16), cx, cy, scale);

          ctx.fillStyle = '#6b4b32';
          ctx.strokeStyle = '#3e2a1b';
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(p0.x, p0.y);
          ctx.lineTo(p1.x, p1.y);
          ctx.lineTo(p2.x, p2.y);
          ctx.lineTo(p3.x, p3.y);
          ctx.closePath();
          ctx.fill();
          ctx.stroke();

          // Верхний торец рейки
          const pt0 = p3;
          const pt1 = p2;
          const pt2 = project3D(seg.getWallPoint(u1, yTop, 0), cx, cy, scale);
          const pt3 = project3D(seg.getWallPoint(u0, yTop, 0), cx, cy, scale);

          ctx.fillStyle = '#8b6443';
          ctx.beginPath();
          ctx.moveTo(pt0.x, pt0.y);
          ctx.lineTo(pt1.x, pt1.y);
          ctx.lineTo(pt2.x, pt2.y);
          ctx.lineTo(pt3.x, pt3.y);
          ctx.closePath();
          ctx.fill();
        }
      } else {
        // Обычная плоская монолитная панель (с толщиной)
        const p0 = project3D(seg.getWallPoint(0, yBot, -panelThick), cx, cy, scale);
        const p1 = project3D(seg.getWallPoint(1, yBot, -panelThick), cx, cy, scale);
        const p2 = project3D(seg.getWallPoint(1, yTop, -panelThick), cx, cy, scale);
        const p3 = project3D(seg.getWallPoint(0, yTop, -panelThick), cx, cy, scale);

        ctx.fillStyle = baseColor;
        ctx.strokeStyle = isVoid ? '#2c2e33' : '#141517';
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        ctx.moveTo(p0.x, p0.y);
        ctx.lineTo(p1.x, p1.y);
        ctx.lineTo(p2.x, p2.y);
        ctx.lineTo(p3.x, p3.y);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();

        // Верхний торец панели (глубина)
        const pt0 = p3;
        const pt1 = p2;
        const pt2 = project3D(seg.getWallPoint(1, yTop, 0), cx, cy, scale);
        const pt3 = project3D(seg.getWallPoint(0, yTop, 0), cx, cy, scale);

        ctx.fillStyle = adjustBrightness(baseColor, 0.82);
        ctx.beginPath();
        ctx.moveTo(pt0.x, pt0.y);
        ctx.lineTo(pt1.x, pt1.y);
        ctx.lineTo(pt2.x, pt2.y);
        ctx.lineTo(pt3.x, pt3.y);
        ctx.closePath();
        ctx.fill();

        if (isVoid) {
          ctx.strokeStyle = '#343a40';
          ctx.setLineDash([4, 4]);
          ctx.beginPath();
          ctx.moveTo(p0.x, p0.y);
          ctx.lineTo(p2.x, p2.y);
          ctx.moveTo(p1.x, p1.y);
          ctx.lineTo(p3.x, p3.y);
          ctx.stroke();
          ctx.setLineDash([]);
        }
      }
    });

    // =========================================================================
    // 5. Отрисовка проемов (Двери с 3D откосами и ТВ)
    // =========================================================================
    selectedWall.openings.forEach((op) => {
      // Ищем позицию проема на стене
      const opX = op.x;
      let accumulatedW = 0;
      let matchedSeg: WallSegment3D | undefined = wallSegments[0];
      let uInSeg = 0;

      for (const s of wallSegments) {
        if (opX >= accumulatedW && opX <= accumulatedW + s.width) {
          matchedSeg = s;
          uInSeg = (opX - accumulatedW) / s.width;
          break;
        }
        accumulatedW += s.width;
      }

      if (!matchedSeg) return;

      const uEndInSeg = Math.min(1, uInSeg + op.width / matchedSeg.width);
      const opP0 = project3D(matchedSeg.getWallPoint(uInSeg, op.y, -panelThick - 2), cx, cy, scale);
      const opP1 = project3D(matchedSeg.getWallPoint(uEndInSeg, op.y, -panelThick - 2), cx, cy, scale);
      const opP2 = project3D(matchedSeg.getWallPoint(uEndInSeg, op.y + op.height, -panelThick - 2), cx, cy, scale);
      const opP3 = project3D(matchedSeg.getWallPoint(uInSeg, op.y + op.height, -panelThick - 2), cx, cy, scale);

      if (op.type === 'DOOR') {
        // Дверное полотно (утоплено внутрь стены на 70 мм)
        const doorDepth = 70;
        const d0 = project3D(matchedSeg.getWallPoint(uInSeg, op.y, doorDepth), cx, cy, scale);
        const d1 = project3D(matchedSeg.getWallPoint(uEndInSeg, op.y, doorDepth), cx, cy, scale);
        const d2 = project3D(matchedSeg.getWallPoint(uEndInSeg, op.y + op.height, doorDepth), cx, cy, scale);
        const d3 = project3D(matchedSeg.getWallPoint(uInSeg, op.y + op.height, doorDepth), cx, cy, scale);

        // Откосы двери
        ctx.fillStyle = '#1c1e22';
        ctx.beginPath();
        ctx.moveTo(opP0.x, opP0.y);
        ctx.lineTo(d0.x, d0.y);
        ctx.lineTo(d3.x, d3.y);
        ctx.lineTo(opP3.x, opP3.y);
        ctx.closePath();
        ctx.fill();

        // Верхний откос
        ctx.fillStyle = '#262930';
        ctx.beginPath();
        ctx.moveTo(opP3.x, opP3.y);
        ctx.lineTo(d3.x, d3.y);
        ctx.lineTo(d2.x, d2.y);
        ctx.lineTo(opP2.x, opP2.y);
        ctx.closePath();
        ctx.fill();

        // Полотно двери
        ctx.fillStyle = '#453325';
        ctx.strokeStyle = '#251b14';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(d0.x, d0.y);
        ctx.lineTo(d1.x, d1.y);
        ctx.lineTo(d2.x, d2.y);
        ctx.lineTo(d3.x, d3.y);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();

        // Ручка
        const handlePos = project3D(matchedSeg.getWallPoint(uEndInSeg - 0.05, op.y + 1000, doorDepth - 10), cx, cy, scale);
        ctx.fillStyle = '#e9ecef';
        ctx.beginPath();
        ctx.arc(handlePos.x, handlePos.y, 4, 0, Math.PI * 2);
        ctx.fill();
      } else if (op.type === 'TV_ZONE') {
        // ТВ накладной
        ctx.fillStyle = '#08080a';
        ctx.strokeStyle = '#343a40';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(opP0.x, opP0.y);
        ctx.lineTo(opP1.x, opP1.y);
        ctx.lineTo(opP2.x, opP2.y);
        ctx.lineTo(opP3.x, opP3.y);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();

        // Экранный блик
        ctx.fillStyle = 'rgba(255, 255, 255, 0.07)';
        ctx.beginPath();
        ctx.moveTo(opP0.x, opP0.y);
        ctx.lineTo(opP1.x, opP1.y);
        ctx.lineTo(opP3.x, opP3.y);
        ctx.closePath();
        ctx.fill();
      }
    });

    // =========================================================================
    // 6. Отрисовка LED-линий и стыков со свечением
    // =========================================================================
    layout.joints.forEach((joint) => {
      if (!joint.isLED) return;

      const seg = segmentMap.get(joint.columnIndex ?? 0) || wallSegments[0];
      if (!seg) return;

      const pStart = project3D(seg.getWallPoint(0, joint.y, -panelThick - 3), cx, cy, scale);
      const pEnd =
        joint.orientation === 'VERTICAL'
          ? project3D(seg.getWallPoint(0, joint.y + joint.length, -panelThick - 3), cx, cy, scale)
          : project3D(seg.getWallPoint(1, joint.y, -panelThick - 3), cx, cy, scale);

      ctx.save();
      ctx.strokeStyle = '#ffd43b';
      ctx.shadowColor = '#ffd43b';
      ctx.shadowBlur = 16;
      ctx.lineWidth = 3.5;
      ctx.beginPath();
      ctx.moveTo(pStart.x, pStart.y);
      ctx.lineTo(pEnd.x, pEnd.y);
      ctx.stroke();

      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 1.5;
      ctx.stroke();
      ctx.restore();
    });
  }, [selectedWall, layout, angleDeg, elevationDeg, zoomScale, panOffset, project3D]);

  function adjustBrightness(hex: string, percent: number): string {
    if (!hex || !hex.startsWith('#')) return hex || '#888';
    let num = parseInt(hex.slice(1), 16);
    let r = Math.min(255, Math.max(0, Math.round(((num >> 16) & 255) * percent)));
    let g = Math.min(255, Math.max(0, Math.round(((num >> 8) & 255) * percent)));
    let b = Math.min(255, Math.max(0, Math.round((num & 255) * percent)));
    return `rgb(${r}, ${g}, ${b})`;
  }

  useEffect(() => {
    const handleResize = () => {
      if (containerRef.current && canvasRef.current) {
        canvasRef.current.width = containerRef.current.clientWidth;
        canvasRef.current.height = containerRef.current.clientHeight;
        renderScene();
      }
    };

    handleResize();
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [renderScene]);

  useEffect(() => {
    renderScene();
  }, [renderScene]);

  const handleMouseDown = (e: React.MouseEvent) => {
    setIsDragging(true);
    setDragStart({ x: e.clientX, y: e.clientY });
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!isDragging) return;
    const dx = e.clientX - dragStart.x;
    const dy = e.clientY - dragStart.y;

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
    setDragStart({ x: e.clientX, y: e.clientY });
  };

  const handleMouseUp = () => setIsDragging(false);

  const handleWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    const factor = e.deltaY < 0 ? 1.1 : 0.9;
    setZoomScale((prev) => Math.max(0.05, Math.min(2.5, prev * factor)));
  };

  const handleExportPNG = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const link = document.createElement('a');
    link.download = `${project.name || 'Planko'}_3D_Render_${Math.round(angleDeg)}deg.png`;
    link.href = canvas.toDataURL('image/png', 1.0);
    link.click();
  };

  return (
    <Box
      ref={containerRef}
      style={{
        width: '100%',
        height: '100%',
        backgroundColor: '#121316',
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
          backgroundColor: 'rgba(26, 27, 30, 0.85)',
          backdropFilter: 'blur(8px)',
          border: '1px solid #2C2E33',
          zIndex: 10,
        }}
      >
        <Group gap="xs">
          <Badge color="blue" variant="light" leftSection={<Camera size={12} />}>
            3D Обзор
          </Badge>
          <Text size="xs" c="dimmed">
            Поворот: <strong style={{ color: '#E9ECEF' }}>{Math.round(angleDeg)}°</strong> | Наклон: <strong style={{ color: '#E9ECEF' }}>{Math.round(elevationDeg)}°</strong>
          </Text>
        </Group>
      </Paper>

      {/* Панель ручного ввода углов и быстрого переключения пресетов */}
      <Paper
        p="sm"
        style={{
          position: 'absolute',
          bottom: 20,
          right: 20,
          backgroundColor: 'rgba(26, 27, 30, 0.95)',
          backdropFilter: 'blur(12px)',
          border: '1px solid #373A40',
          borderRadius: 8,
          zIndex: 10,
          width: 320,
          boxShadow: '0 8px 24px rgba(0, 0, 0, 0.5)',
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
            <Tooltip label="Сбросить к ракурсу 30°">
              <ActionIcon
                size="xs"
                variant="subtle"
                color="gray"
                onClick={() => {
                  setAngleDeg(34);
                  setElevationDeg(26);
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
              value={Math.round(angleDeg)}
              onChange={(val) => typeof val === 'number' && setAngleDeg(val)}
              min={-360}
              max={360}
              step={5}
              suffix="°"
            />
            <NumberInput
              size="xs"
              label="Наклон (°)"
              value={Math.round(elevationDeg)}
              onChange={(val) => typeof val === 'number' && setElevationDeg(val)}
              min={-89}
              max={89}
              step={5}
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

          <Divider color="#2C2E33" />

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
        </Stack>
      </Paper>
    </Box>
  );
};
