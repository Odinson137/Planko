import React, { useRef, useEffect, useState, useCallback } from 'react';
import { Box, Group, ActionIcon, Tooltip, Slider, Text, Button, Paper, Badge, NumberInput, SimpleGrid, Divider, Stack } from '@mantine/core';
import { Camera, ZoomIn, ZoomOut, RotateCw, Download, Compass } from 'lucide-react';
import { useProjectStore } from '../../../application/stores/useProjectStore';
import { LayoutEngine } from '../../../core/layout/LayoutEngine';
import { MATERIAL_NONE_ID } from '../../../core/models/Material';
import { RadiusType } from '../../../core/models/Wall';

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

    const wallW = selectedWall.width;
    const wallH = selectedWall.height;
    const wallThick = 150; // Толщина несущей стены (мм)
    const panelThick = 8;  // Толщина декоративной панели (мм)

    // =========================================================================
    // 1. Построение непрерывной 3D траектории стены (с поворотами на WallBend)
    // =========================================================================
    interface ActiveBend3D {
      id: string;
      sStart: number;
      sEnd: number;
      arcLen: number;
      radius: number;
      angleDeg: number;
      type: RadiusType;
    }

    const activeBends: ActiveBend3D[] = [];

    if (selectedWall.bends && selectedWall.bends.length > 0) {
      selectedWall.bends.forEach((b) => {
        const arcLen = Math.round((Math.PI * b.radius * (b.angleDeg || 90)) / 180);
        activeBends.push({
          id: b.id,
          sStart: b.x,
          sEnd: b.x + arcLen,
          arcLen,
          radius: b.radius,
          angleDeg: b.angleDeg || 90,
          type: b.type,
        });
      });
    } else {
      // Обратная совместимость со старыми колонками
      layout.panels.forEach((p) => {
        if (p.radiusConfig && !activeBends.some((b) => b.sStart === p.x)) {
          const arcLen = p.arcLength || Math.round((Math.PI * p.radiusConfig.radius * (p.radiusConfig.angleDeg || 90)) / 180);
          activeBends.push({
            id: `legacy-${p.id}`,
            sStart: p.x,
            sEnd: p.x + arcLen,
            arcLen,
            radius: p.radiusConfig.radius,
            angleDeg: p.radiusConfig.angleDeg || 90,
            type: p.radiusConfig.type,
          });
        }
      });
    }

    activeBends.sort((a, b) => a.sStart - b.sStart);

    interface PathSection3D {
      sStart: number;
      sEnd: number;
      isBend: boolean;
      bend?: ActiveBend3D;
      startPoint: Point3D;
      startHeading: number;
      centerPoint?: Point3D;
      totalTurn?: number;
      getPoint: (s: number, y: number, depthOffset: number) => Point3D;
    }

    const pathSections: PathSection3D[] = [];
    let curS = 0;
    let curPt: Point3D = { x: 0, y: 0, z: 0 };
    let curHeading = 0;
    const allPathPoints: Point3D[] = [{ x: 0, y: 0, z: 0 }];

    activeBends.forEach((bend) => {
      // 1. Прямой участок стены до изгиба
      if (bend.sStart > curS + 0.5) {
        const straightLen = bend.sStart - curS;
        const straightStartPt = { ...curPt };
        const straightHeading = curHeading;
        const sStart = curS;
        const sEnd = bend.sStart;

        pathSections.push({
          sStart,
          sEnd,
          isBend: false,
          startPoint: straightStartPt,
          startHeading: straightHeading,
          getPoint: (s: number, y: number, depthOffset = 0) => {
            const dist = Math.max(0, Math.min(straightLen, s - sStart));
            const normX = -Math.sin(straightHeading) * depthOffset;
            const normZ = -Math.cos(straightHeading) * depthOffset;
            return {
              x: straightStartPt.x + Math.cos(straightHeading) * dist + normX,
              y,
              z: straightStartPt.z - Math.sin(straightHeading) * dist + normZ,
            };
          },
        });

        curPt = {
          x: straightStartPt.x + Math.cos(straightHeading) * straightLen,
          y: 0,
          z: straightStartPt.z - Math.sin(straightHeading) * straightLen,
        };
        curS = sEnd;
        allPathPoints.push({ ...curPt });
      }

      // 2. Участок изгиба
      const R = bend.radius;
      const totalTurn = ((bend.angleDeg || 90) * Math.PI) / 180;
      const psi = curHeading;
      const bendStartPt = { ...curPt };
      const sStart = curS;
      const sEnd = curS + bend.arcLen;

      if (bend.type === 'INNER_CORNER') {
        const cX = bendStartPt.x + Math.sin(psi) * R;
        const cZ = bendStartPt.z + Math.cos(psi) * R;
        const centerPt = { x: cX, y: 0, z: cZ };

        pathSections.push({
          sStart,
          sEnd,
          isBend: true,
          bend,
          startPoint: bendStartPt,
          startHeading: psi,
          centerPoint: centerPt,
          totalTurn,
          getPoint: (s: number, y: number, depthOffset = 0) => {
            const u = Math.max(0, Math.min(1, (s - sStart) / bend.arcLen));
            const alpha = u * totalTurn;
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
        curPt = {
          x: cX + Math.cos(endPhi) * R,
          y: 0,
          z: cZ - Math.sin(endPhi) * R,
        };
        curHeading = psi - totalTurn;
      } else {
        // OUTER_CORNER / ARCH_VAULT
        const cX = bendStartPt.x - Math.sin(psi) * R;
        const cZ = bendStartPt.z - Math.cos(psi) * R;
        const centerPt = { x: cX, y: 0, z: cZ };

        pathSections.push({
          sStart,
          sEnd,
          isBend: true,
          bend,
          startPoint: bendStartPt,
          startHeading: psi,
          centerPoint: centerPt,
          totalTurn,
          getPoint: (s: number, y: number, depthOffset = 0) => {
            const u = Math.max(0, Math.min(1, (s - sStart) / bend.arcLen));
            const alpha = u * totalTurn;
            const phi = psi - Math.PI / 2 + alpha;
            const effR = Math.max(5, R - depthOffset);
            return {
              x: cX + Math.cos(phi) * effR,
              y,
              z: cZ - Math.sin(phi) * effR,
            };
          },
        });

        const endPhi = psi - Math.PI / 2 + totalTurn;
        curPt = {
          x: cX + Math.cos(endPhi) * R,
          y: 0,
          z: cZ - Math.sin(endPhi) * R,
        };
        curHeading = psi + totalTurn;
      }

      curS = sEnd;
      allPathPoints.push({ ...curPt });
    });

    // 3. Завершающий прямой участок стены
    if (curS < wallW) {
      const straightLen = wallW - curS;
      const straightStartPt = { ...curPt };
      const straightHeading = curHeading;
      const sStart = curS;
      const sEnd = wallW;

      pathSections.push({
        sStart,
        sEnd,
        isBend: false,
        startPoint: straightStartPt,
        startHeading: straightHeading,
        getPoint: (s: number, y: number, depthOffset = 0) => {
          const dist = Math.max(0, Math.min(straightLen, s - sStart));
          const normX = -Math.sin(straightHeading) * depthOffset;
          const normZ = -Math.cos(straightHeading) * depthOffset;
          return {
            x: straightStartPt.x + Math.cos(straightHeading) * dist + normX,
            y,
            z: straightStartPt.z - Math.sin(straightHeading) * dist + normZ,
          };
        },
      });

      curPt = {
        x: straightStartPt.x + Math.cos(straightHeading) * straightLen,
        y: 0,
        z: straightStartPt.z - Math.sin(straightHeading) * straightLen,
      };
      allPathPoints.push({ ...curPt });
    }

    const getPointAtS = (s: number, y: number, depthOffset = 0): Point3D => {
      const clampedS = Math.max(0, Math.min(wallW, s));
      const section = pathSections.find((sec) => clampedS >= sec.sStart && clampedS <= sec.sEnd) || pathSections[pathSections.length - 1];
      if (!section) return { x: 0, y, z: 0 };
      return section.getPoint(clampedS, y, depthOffset);
    };

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
    pathSections.forEach((sec) => {
      const steps = sec.isBend ? 14 : 1;
      const len = sec.sEnd - sec.sStart;
      for (let i = 0; i < steps; i++) {
        const s0 = sec.sStart + (i / steps) * len;
        const s1 = sec.sStart + ((i + 1) / steps) * len;

        const topF0 = project3D(getPointAtS(s0, wallH, 0), cx, cy, scale);
        const topF1 = project3D(getPointAtS(s1, wallH, 0), cx, cy, scale);
        const topB1 = project3D(getPointAtS(s1, wallH, wallThick), cx, cy, scale);
        const topB0 = project3D(getPointAtS(s0, wallH, wallThick), cx, cy, scale);

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

    // Левый торец стены
    const tL0 = project3D(getPointAtS(0, 0, 0), cx, cy, scale);
    const tL1 = project3D(getPointAtS(0, wallH, 0), cx, cy, scale);
    const tL2 = project3D(getPointAtS(0, wallH, wallThick), cx, cy, scale);
    const tL3 = project3D(getPointAtS(0, 0, wallThick), cx, cy, scale);

    ctx.fillStyle = '#1c1e22';
    ctx.beginPath();
    ctx.moveTo(tL0.x, tL0.y);
    ctx.lineTo(tL1.x, tL1.y);
    ctx.lineTo(tL2.x, tL2.y);
    ctx.lineTo(tL3.x, tL3.y);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    // Правый торец стены
    const tR0 = project3D(getPointAtS(wallW, 0, 0), cx, cy, scale);
    const tR1 = project3D(getPointAtS(wallW, wallH, 0), cx, cy, scale);
    const tR2 = project3D(getPointAtS(wallW, wallH, wallThick), cx, cy, scale);
    const tR3 = project3D(getPointAtS(wallW, 0, wallThick), cx, cy, scale);

    ctx.fillStyle = '#222429';
    ctx.beginPath();
    ctx.moveTo(tR0.x, tR0.y);
    ctx.lineTo(tR1.x, tR1.y);
    ctx.lineTo(tR2.x, tR2.y);
    ctx.lineTo(tR3.x, tR3.y);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    // =========================================================================
    // 4. Отрисовка ДЕКОРАТИВНЫХ ПАНЕЛЕЙ (непрерывно огибающих углы в 3D)
    // =========================================================================
    layout.panels.forEach((panel) => {
      const isVoid = panel.isVoid || panel.materialId === MATERIAL_NONE_ID;
      const isSlat = panel.materialType === 'SLAT';
      const baseColor = isVoid ? '#16171a' : (panel.materialColor || '#d6cbbe');

      const yBot = panel.y;
      const yTop = panel.y + panel.height;
      const pStartS = panel.x;
      const pEndS = panel.x + panel.width;

      if (isSlat) {
        // Реечные ламели AllWall (GW90 волна, GW30 желоб, GW10..GW68)
        const slatThick = panel.thickness || 15;
        const slatWidth = panel.width > 200 ? 50 : Math.max(30, Math.floor(panel.width / (panel.reliefType === 'WAVE_GW90' ? 4 : 3)));
        const count = Math.max(1, Math.floor(panel.width / slatWidth));

        for (let i = 0; i < count; i++) {
          const s0 = pStartS + i * slatWidth;
          const s1 = Math.min(pEndS, s0 + slatWidth - 4);

          const p0 = project3D(getPointAtS(s0, yBot, -slatThick), cx, cy, scale);
          const p1 = project3D(getPointAtS(s1, yBot, -slatThick), cx, cy, scale);
          const p2 = project3D(getPointAtS(s1, yTop, -slatThick), cx, cy, scale);
          const p3 = project3D(getPointAtS(s0, yTop, -slatThick), cx, cy, scale);

          ctx.fillStyle = adjustBrightness(baseColor, 0.95);
          ctx.strokeStyle = adjustBrightness(baseColor, 0.6);
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
          const pt2 = project3D(getPointAtS(s1, yTop, 0), cx, cy, scale);
          const pt3 = project3D(getPointAtS(s0, yTop, 0), cx, cy, scale);

          ctx.fillStyle = adjustBrightness(baseColor, 1.08);
          ctx.beginPath();
          ctx.moveTo(pt0.x, pt0.y);
          ctx.lineTo(pt1.x, pt1.y);
          ctx.lineTo(pt2.x, pt2.y);
          ctx.lineTo(pt3.x, pt3.y);
          ctx.closePath();
          ctx.fill();
        }
      } else {
        // Листовые панели (разбиваем на фасеты на участках изгибов)
        const thisPanelThick = isVoid ? 0 : (panel.thickness || 5);
        const slicePoints: number[] = [pStartS];

        pathSections.forEach((sec) => {
          if (sec.sEnd > pStartS && sec.sStart < pEndS) {
            const overlapStart = Math.max(pStartS, sec.sStart);
            const overlapEnd = Math.min(pEndS, sec.sEnd);
            if (sec.isBend) {
              const bendSlices = 14;
              for (let k = 1; k <= bendSlices; k++) {
                const sVal = overlapStart + (k / bendSlices) * (overlapEnd - overlapStart);
                slicePoints.push(sVal);
              }
            } else {
              slicePoints.push(overlapEnd);
            }
          }
        });

        slicePoints.push(pEndS);
        const sortedSlices = Array.from(new Set(slicePoints.map((s) => Math.round(s * 10) / 10))).sort((a, b) => a - b);

        for (let i = 0; i < sortedSlices.length - 1; i++) {
          const s0 = sortedSlices[i];
          const s1 = sortedSlices[i + 1];
          if (s1 - s0 <= 0.5) continue;

          const p0 = project3D(getPointAtS(s0, yBot, -thisPanelThick), cx, cy, scale);
          const p1 = project3D(getPointAtS(s1, yBot, -thisPanelThick), cx, cy, scale);
          const p2 = project3D(getPointAtS(s1, yTop, -thisPanelThick), cx, cy, scale);
          const p3 = project3D(getPointAtS(s0, yTop, -thisPanelThick), cx, cy, scale);

          // Проверяем, находится ли этот срез внутри сгиба
          const inBend = pathSections.find((sec) => sec.isBend && s0 >= sec.sStart - 1 && s1 <= sec.sEnd + 1);
          let lightFactor = 0.95;
          if (inBend) {
            const u = (s0 - inBend.sStart) / (inBend.sEnd - inBend.sStart);
            lightFactor = inBend.bend?.type === 'INNER_CORNER' ? 0.55 + 0.45 * Math.abs(u - 0.5) * 2 : 0.65 + 0.35 * Math.sin(u * Math.PI);
          }

          ctx.fillStyle = isVoid ? '#141517' : adjustBrightness(baseColor, lightFactor);
          ctx.strokeStyle = isVoid ? '#2c2e33' : '#141517';
          ctx.lineWidth = inBend ? 0.5 : 1.2;
          ctx.beginPath();
          ctx.moveTo(p0.x, p0.y);
          ctx.lineTo(p1.x, p1.y);
          ctx.lineTo(p2.x, p2.y);
          ctx.lineTo(p3.x, p3.y);
          ctx.closePath();
          ctx.fill();
          ctx.stroke();

          // Верхний торец панели
          const pt0 = p3;
          const pt1 = p2;
          const pt2 = project3D(getPointAtS(s1, yTop, 0), cx, cy, scale);
          const pt3 = project3D(getPointAtS(s0, yTop, 0), cx, cy, scale);

          ctx.fillStyle = adjustBrightness(baseColor, 0.82);
          ctx.beginPath();
          ctx.moveTo(pt0.x, pt0.y);
          ctx.lineTo(pt1.x, pt1.y);
          ctx.lineTo(pt2.x, pt2.y);
          ctx.lineTo(pt3.x, pt3.y);
          ctx.closePath();
          ctx.fill();
        }

        if (isVoid) {
          const p0 = project3D(getPointAtS(pStartS, yBot, -panelThick), cx, cy, scale);
          const p1 = project3D(getPointAtS(pEndS, yBot, -panelThick), cx, cy, scale);
          const p2 = project3D(getPointAtS(pEndS, yTop, -panelThick), cx, cy, scale);
          const p3 = project3D(getPointAtS(pStartS, yTop, -panelThick), cx, cy, scale);
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
    // 5. Отрисовка проемов (Двери, ТВ)
    // =========================================================================
    selectedWall.openings.forEach((op) => {
      const opP0 = project3D(getPointAtS(op.x, op.y, -panelThick - 2), cx, cy, scale);
      const opP1 = project3D(getPointAtS(op.x + op.width, op.y, -panelThick - 2), cx, cy, scale);
      const opP2 = project3D(getPointAtS(op.x + op.width, op.y + op.height, -panelThick - 2), cx, cy, scale);
      const opP3 = project3D(getPointAtS(op.x, op.y + op.height, -panelThick - 2), cx, cy, scale);

      if (op.type === 'DOOR') {
        const doorDepth = 70;
        const d0 = project3D(getPointAtS(op.x, op.y, doorDepth), cx, cy, scale);
        const d1 = project3D(getPointAtS(op.x + op.width, op.y, doorDepth), cx, cy, scale);
        const d2 = project3D(getPointAtS(op.x + op.width, op.y + op.height, doorDepth), cx, cy, scale);
        const d3 = project3D(getPointAtS(op.x, op.y + op.height, doorDepth), cx, cy, scale);

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
        const handlePos = project3D(getPointAtS(op.x + op.width - 50, op.y + 1000, doorDepth - 10), cx, cy, scale);
        ctx.fillStyle = '#e9ecef';
        ctx.beginPath();
        ctx.arc(handlePos.x, handlePos.y, 4, 0, Math.PI * 2);
        ctx.fill();
      } else if (op.type === 'TV_ZONE') {
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
    // 6. Отрисовка LED-линий со свечением
    // =========================================================================
    layout.joints.forEach((joint) => {
      if (!joint.isLED) return;

      const pStart = project3D(getPointAtS(joint.x, joint.y, -panelThick - 3), cx, cy, scale);
      const pEnd =
        joint.orientation === 'VERTICAL'
          ? project3D(getPointAtS(joint.x, joint.y + joint.length, -panelThick - 3), cx, cy, scale)
          : project3D(getPointAtS(joint.x + joint.length, joint.y, -panelThick - 3), cx, cy, scale);

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
