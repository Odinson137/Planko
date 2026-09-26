import { buildWallPath, resolvePathBends } from '../../../core/geometry/WallPath';
import { clipHiddenFaces, occludingFace, type DepthPoint } from '../../../core/geometry/FaceOcclusion';
import { wallOcclusionFaces, wallSurfaceSlices } from '../../../core/geometry/WallOcclusion';
import { drawOpeningSlopes } from '../../../application/services/SlopeDrawing';
import { useSlopeJointStore } from '../../../application/stores/useSlopeJointStore';
import { getPieceTexture } from '../../../core/textures/PieceTextures';
import { drawTextureFace } from '../../../core/textures/PhotoTextures';
import React, { useRef, useEffect, useLayoutEffect, useMemo, useState, useCallback } from 'react';
import { Box, Group, ActionIcon, Tooltip, Slider, Text, Button, Paper, Badge, NumberInput, SimpleGrid, Divider, Stack } from '@mantine/core';
import { Camera, ZoomIn, ZoomOut, RotateCw, Download, Compass } from 'lucide-react';
import { useProjectStore } from '../../../application/stores/useProjectStore';
import { useEditorStore } from '../../../application/stores/useEditorStore';
import { LayoutEngine, CalculatedPanelPiece } from '../../../core/layout/LayoutEngine';
import { MATERIAL_NONE_ID } from '../../../core/models/Material';
import { isDoorOrPortal, isPortalOpening } from '../../../core/models/Opening';
import { useAppTheme } from '../../theme/useAppTheme';

interface Point3D {
  x: number;
  y: number;
  z: number;
}

interface Point2D {
  x: number;
  y: number;
}

interface Interval1D {
  start: number;
  end: number;
}

function subtractInterval(intervals: Interval1D[], removeStart: number, removeEnd: number): Interval1D[] {
  const result: Interval1D[] = [];
  for (const inv of intervals) {
    if (removeEnd <= inv.start + 0.1 || removeStart >= inv.end - 0.1) {
      result.push(inv);
      continue;
    }
    if (removeStart > inv.start + 0.1) {
      result.push({ start: inv.start, end: removeStart });
    }
    if (removeEnd < inv.end - 0.1) {
      result.push({ start: removeEnd, end: inv.end });
    }
  }
  return result;
}

export const Axonometric3DView: React.FC = () => {
  const t = useAppTheme();
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);

  const [angleDeg, setAngleDeg] = useState<number>(34);         // Угол поворота (30-35°)
  const [elevationDeg, setElevationDeg] = useState<number>(26);    // Наклон камеры сверху
  const [zoomScale, setZoomScale] = useState<number>(0.24);      // Масштаб
  const [panOffset, setPanOffset] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState<boolean>(false);
  const dragStart = useRef<{ x: number; y: number } | null>(null);

  const { project } = useProjectStore();
  const { showTextures, showProfiles } = useEditorStore();
  const slopeEditor = useSlopeJointStore();
  const selectedWall = project.walls.find((w) => w.id === project.selectedWallId);
  const selectedMaterial = project.materials.find(
    (m) => m.id === (selectedWall?.zone.materialId || MATERIAL_NONE_ID)
  ) || project.materials.find((m) => m.id === MATERIAL_NONE_ID) || project.materials[0];

  const selectedWallIndex = selectedWall ? project.walls.findIndex((w) => w.id === selectedWall.id) : -1;
  const selectedWallNumber = selectedWallIndex >= 0 ? selectedWallIndex + 1 : 1;

  const layout = useMemo(() =>
    selectedWall && selectedMaterial
      ? LayoutEngine.calculateWallLayout(selectedWall, selectedMaterial, project.materials, selectedWallNumber)
      : null, [selectedWall, selectedMaterial, project.materials, selectedWallNumber]);

  // Wall geometry does not change when the camera moves.
  const sceneGeometry = useMemo(() => {
    if (!selectedWall || !layout) return null;
    const path = buildWallPath(selectedWall, resolvePathBends(selectedWall, layout.panels));
    const surfaceSlices = wallSurfaceSlices(path.pathSections, [
      ...layout.panels.flatMap(panel => [panel.x, panel.x + panel.width]),
      ...selectedWall.openings.filter(op => op.isCutout !== false).flatMap(op => [op.x, op.x + op.width]),
    ]);
    return { ...path, surfaceSlices,
      occlusionFaces: wallOcclusionFaces(selectedWall, path.pathSections, 150, surfaceSlices) };
  }, [selectedWall, layout]);

  // Keep textures for the current wall, avoiding repeated cache lookups for every curved slice.
  const panelTextures = useMemo(() => {
    const textures = new Map<CalculatedPanelPiece, HTMLCanvasElement | undefined>();
    if (showTextures) for (const panel of layout?.panels ?? []) {
      if (!panel.isVoid && panel.materialId !== MATERIAL_NONE_ID) textures.set(panel, getPieceTexture(panel));
    }
    return textures;
  }, [layout, showTextures]);

  // Математическая 3D-проекция точки (X, Y, Z) в экранные 2D (x, y)
  const project3D = useMemo(() => {
    const radA = (angleDeg * Math.PI) / 180;
    const radE = (elevationDeg * Math.PI) / 180;
    const cosA = Math.cos(radA), sinA = Math.sin(radA);
    const cosE = Math.cos(radE), sinE = Math.sin(radE);
    return (p: Point3D, cx: number, cy: number, scale: number): DepthPoint => {

      // Вращение вокруг вертикальной оси Y
      const xRot = p.x * cosA - p.z * sinA;
      const zRot = p.x * sinA + p.z * cosA;

      // Проекция с учетом угла наклона камеры сверху
      const screenX = cx + xRot * scale + panOffset.x;
      const screenY = cy - (p.y * cosE - zRot * sinE) * scale + panOffset.y;

      return { x: screenX, y: screenY, depth: zRot * cosE + p.y * sinE };
    };
  }, [angleDeg, elevationDeg, panOffset]);

  // Отрисовка фотореалистичных текстур материалов на 3D-гранях панелей
  const draw3DMaterialTexture = (
    ctx: CanvasRenderingContext2D,
    panel: CalculatedPanelPiece,
    p0: Point2D,
    p1: Point2D,
    p2: Point2D,
    p3: Point2D,
    bounds: { x: number; y: number; width: number; height: number }
  ) => {
    const category = panel.textureCategory || 'WOOD';
    const texture = panelTextures.get(panel);
    if (texture) {
      drawTextureFace(ctx, texture, p0, p1, p2, p3, {
        x: (bounds.x - panel.x) / panel.width,
        y: (panel.y + panel.height - bounds.y - bounds.height) / panel.height,
        width: bounds.width / panel.width, height: bounds.height / panel.height,
      });
      return;
    }
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(p0.x, p0.y);
    ctx.lineTo(p1.x, p1.y);
    ctx.lineTo(p2.x, p2.y);
    ctx.lineTo(p3.x, p3.y);
    ctx.closePath();
    ctx.clip();

    switch (category) {
      case 'WOOD': {
        // Натуральные 3D волокна древесины от нижнего ребра к верхнему
        const numFibers = 7;
        for (let f = 1; f < numFibers; f++) {
          const u = f / numFibers;
          const bX = p0.x + (p1.x - p0.x) * u;
          const bY = p0.y + (p1.y - p0.y) * u;
          const tX = p3.x + (p2.x - p3.x) * u;
          const tY = p3.y + (p2.y - p3.y) * u;

          const wave = Math.sin(u * Math.PI * 3) * 2;
          ctx.strokeStyle = f % 3 === 0 ? 'rgba(0, 0, 0, 0.12)' : 'rgba(0, 0, 0, 0.06)';
          ctx.lineWidth = f % 3 === 0 ? 1.2 : 0.7;
          ctx.beginPath();
          ctx.moveTo(bX, bY);
          ctx.bezierCurveTo(
            bX * 0.65 + tX * 0.35 + wave,
            bY * 0.65 + tY * 0.35,
            bX * 0.35 + tX * 0.65 - wave,
            bY * 0.35 + tY * 0.65,
            tX,
            tY
          );
          ctx.stroke();

          // Светлый блик волокна
          if (f % 2 === 0) {
            ctx.strokeStyle = 'rgba(255, 255, 255, 0.08)';
            ctx.lineWidth = 0.8;
            ctx.beginPath();
            ctx.moveTo(bX + 1.2, bY);
            ctx.lineTo(tX + 1.2, tY);
            ctx.stroke();
          }
        }
        break;
      }

      case 'FABRIC': {
        // 3D переплетение нитей
        const lines = 10;
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.07)';
        ctx.lineWidth = 0.8;
        for (let l = 1; l < lines; l++) {
          const u = l / lines;
          ctx.beginPath();
          ctx.moveTo(p0.x + (p1.x - p0.x) * u, p0.y + (p1.y - p0.y) * u);
          ctx.lineTo(p3.x + (p2.x - p3.x) * u, p3.y + (p2.y - p3.y) * u);
          ctx.stroke();
        }
        ctx.strokeStyle = 'rgba(0, 0, 0, 0.08)';
        for (let l = 1; l < lines; l++) {
          const v = l / lines;
          ctx.beginPath();
          ctx.moveTo(p0.x + (p3.x - p0.x) * v, p0.y + (p3.y - p0.y) * v);
          ctx.lineTo(p1.x + (p2.x - p1.x) * v, p1.y + (p2.y - p1.y) * v);
          ctx.stroke();
        }
        break;
      }

      case 'MARBLE_HQ':
      case 'GOLD_HQ': {
        // Мраморные и золотые жилы в 3D
        const isGold = category === 'GOLD_HQ';
        ctx.strokeStyle = isGold ? 'rgba(218, 165, 32, 0.45)' : 'rgba(40, 40, 45, 0.22)';
        ctx.lineWidth = 2.5;
        ctx.beginPath();
        ctx.moveTo(p0.x * 0.8 + p1.x * 0.2, p0.y * 0.8 + p1.y * 0.2);
        ctx.bezierCurveTo(
          p0.x * 0.4 + p3.x * 0.4 + p1.x * 0.2,
          p0.y * 0.4 + p3.y * 0.4 + p1.y * 0.2,
          p1.x * 0.4 + p2.x * 0.4 + p0.x * 0.2,
          p1.y * 0.4 + p2.y * 0.4 + p0.y * 0.2,
          p3.x * 0.2 + p2.x * 0.8,
          p3.y * 0.2 + p2.y * 0.8
        );
        ctx.stroke();
        break;
      }

      case 'MIRROR': {
        // 3D зеркальный блик на всю грань панели
        const minX = Math.min(p0.x, p1.x, p2.x, p3.x);
        const minY = Math.min(p0.y, p1.y, p2.y, p3.y);
        const maxX = Math.max(p0.x, p1.x, p2.x, p3.x);
        const maxY = Math.max(p0.y, p1.y, p2.y, p3.y);
        const grad = ctx.createLinearGradient(p0.x, p0.y, p2.x, p2.y);
        grad.addColorStop(0, 'rgba(255, 255, 255, 0.01)');
        grad.addColorStop(0.4, 'rgba(255, 255, 255, 0.14)');
        grad.addColorStop(0.5, 'rgba(255, 255, 255, 0.32)');
        grad.addColorStop(0.6, 'rgba(255, 255, 255, 0.14)');
        grad.addColorStop(1, 'rgba(0, 0, 0, 0.08)');
        ctx.fillStyle = grad;
        ctx.fillRect(minX, minY, maxX - minX, maxY - minY);
        break;
      }

      case 'METAL': {
        // 3D брашинг
        const numLines = 12;
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.08)';
        ctx.lineWidth = 0.7;
        for (let l = 1; l < numLines; l++) {
          const u = l / numLines;
          ctx.beginPath();
          ctx.moveTo(p0.x + (p1.x - p0.x) * u, p0.y + (p1.y - p0.y) * u);
          ctx.lineTo(p3.x + (p2.x - p3.x) * u, p3.y + (p2.y - p3.y) * u);
          ctx.stroke();
        }
        break;
      }
    }

    ctx.restore();
  };

  // Отсечение 2D-полигона вертикальной полосой [xMin, xMax] (Sutherland-Hodgman)
  const clipPolygonByXRange = (points: Point2D[], xMin: number, xMax: number): Point2D[] => {
    if (!points || points.length < 3) return [];

    let outputList = points;

    const clipLeft = (pts: Point2D[]) => {
      const res: Point2D[] = [];
      for (let i = 0; i < pts.length; i++) {
        const p1 = pts[i];
        const p2 = pts[(i + 1) % pts.length];
        const p1In = p1.x >= xMin - 0.001;
        const p2In = p2.x >= xMin - 0.001;

        if (p1In && p2In) {
          res.push(p2);
        } else if (p1In && !p2In) {
          const t = Math.abs(p2.x - p1.x) > 0.0001 ? (xMin - p1.x) / (p2.x - p1.x) : 0;
          res.push({ x: xMin, y: p1.y + t * (p2.y - p1.y) });
        } else if (!p1In && p2In) {
          const t = Math.abs(p2.x - p1.x) > 0.0001 ? (xMin - p1.x) / (p2.x - p1.x) : 0;
          res.push({ x: xMin, y: p1.y + t * (p2.y - p1.y) });
          res.push(p2);
        }
      }
      return res;
    };

    const clipRight = (pts: Point2D[]) => {
      const res: Point2D[] = [];
      for (let i = 0; i < pts.length; i++) {
        const p1 = pts[i];
        const p2 = pts[(i + 1) % pts.length];
        const p1In = p1.x <= xMax + 0.001;
        const p2In = p2.x <= xMax + 0.001;

        if (p1In && p2In) {
          res.push(p2);
        } else if (p1In && !p2In) {
          const t = Math.abs(p2.x - p1.x) > 0.0001 ? (xMax - p1.x) / (p2.x - p1.x) : 0;
          res.push({ x: xMax, y: p1.y + t * (p2.y - p1.y) });
        } else if (!p1In && p2In) {
          const t = Math.abs(p2.x - p1.x) > 0.0001 ? (xMax - p1.x) / (p2.x - p1.x) : 0;
          res.push({ x: xMax, y: p1.y + t * (p2.y - p1.y) });
          res.push(p2);
        }
      }
      return res;
    };

    outputList = clipLeft(outputList);
    outputList = clipRight(outputList);
    return outputList;
  };

  // Расчет угловой биссектрисы (Miter Joint) для стыковки стен и панелей под произвольным углом
  const computeMiterVector = (psi1: number, psi2: number, d: number): { x: number; z: number } => {
    const n1x = -Math.sin(psi1);
    const n1z = -Math.cos(psi1);
    const n2x = -Math.sin(psi2);
    const n2z = -Math.cos(psi2);

    const sumX = n1x + n2x;
    const sumZ = n1z + n2z;
    const len = Math.sqrt(sumX * sumX + sumZ * sumZ);

    if (len < 0.001) {
      return { x: n1x * d, z: n1z * d };
    }

    const mX = sumX / len;
    const mZ = sumZ / len;
    const dot = n1x * mX + n1z * mZ;
    const scale = Math.abs(dot) > 0.05 ? d / dot : d;

    return { x: mX * scale, z: mZ * scale };
  };

  // Отрисовка всей монолитной 3D-сцены
  const renderScene = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas || !selectedWall || !layout || !sceneGeometry) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const width = canvas.width;
    const height = canvas.height;

    ctx.clearRect(0, 0, width, height);

    const wallW = selectedWall.width;
    const wallH = selectedWall.height;
    const wallThick = 150; // Толщина несущей стены (мм)
    const panelThick = 8;  // Толщина декоративной панели (мм)

    // =========================================================================
    // 1. Построение непрерывной 3D траектории стены (с поворотами на WallBend)
    // =========================================================================
    const { pathSections, allPathPoints, getPointAtS, surfaceSlices, occlusionFaces } = sceneGeometry;

    // Fit the entire chain, including a translated origin after prepending a wall.
    // Keep manual zoom and pan as offsets from this fit.
    const projected = allPathPoints.flatMap(p => [project3D(p, 0, 0, 1), project3D({ ...p, y: wallH }, 0, 0, 1)]);
    const x0 = Math.min(...projected.map(p => p.x)) - panOffset.x;
    const x1 = Math.max(...projected.map(p => p.x)) - panOffset.x;
    const y0 = Math.min(...projected.map(p => p.y)) - panOffset.y;
    const y1 = Math.max(...projected.map(p => p.y)) - panOffset.y;
    const scale = Math.min(Math.max(60, width - 160) / Math.max(100, x1-x0),
      Math.max(60, height - 230) / Math.max(100, y1-y0)) * zoomScale / 0.24;
    const cx = width / 2 - (x0+x1) * scale / 2;
    const cy = height * 0.43 - (y0+y1) * scale / 2;

    const wallOccluders = occlusionFaces
      .map(face => occludingFace(face.map(point => project3D(point, cx, cy, scale))))
      .filter((face): face is NonNullable<typeof face> => face !== null);

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

    ctx.fillStyle = t.canvas3dFloor;
    ctx.beginPath();
    ctx.moveTo(floorPoints[0].x, floorPoints[0].y);
    floorPoints.forEach((p) => ctx.lineTo(p.x, p.y));
    ctx.closePath();
    ctx.fill();

    // Сетка плитки
    ctx.strokeStyle = t.canvas3dGrid;
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
    // 3. Отрисовка МОНОЛИТНОЙ НЕСУЩЕЙ СТЕНЫ (Задняя грань, Верхний срез и торцы)
    // =========================================================================

    // 3.1. Задняя грань стены (Back Wall Faces с вырезами под сквозные проемы)
    pathSections.forEach((sec) => {
      const steps = sec.isBend ? 14 : 1;
      const len = sec.sEnd - sec.sStart;
      for (let i = 0; i < steps; i++) {
        const s0 = sec.sStart + (i / steps) * len;
        const s1 = sec.sStart + ((i + 1) / steps) * len;

        // Вычитаем сквозные проемы (окна, двери)
        let intervals: Interval1D[] = [{ start: 0, end: wallH }];
        selectedWall.openings.forEach((op) => {
          if (op.isCutout !== false && (op.type === 'WINDOW' || isDoorOrPortal(op)) && s1 > op.x + 0.1 && s0 < op.x + op.width - 0.1) {
            intervals = subtractInterval(intervals, op.y, op.y + op.height);
          }
        });

        for (const inv of intervals) {
          if (inv.end - inv.start <= 1) continue;
          const b0_bot = project3D(sec.getPoint(s0, inv.start, wallThick), cx, cy, scale);
          const b1_bot = project3D(sec.getPoint(s1, inv.start, wallThick), cx, cy, scale);
          const b1_top = project3D(sec.getPoint(s1, inv.end, wallThick), cx, cy, scale);
          const b0_top = project3D(sec.getPoint(s0, inv.end, wallThick), cx, cy, scale);

          ctx.fillStyle = t.canvas3dWallBack;
          ctx.strokeStyle = t.isDark ? '#25272c' : '#CBD5E1';
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(b0_bot.x, b0_bot.y);
          ctx.lineTo(b1_bot.x, b1_bot.y);
          ctx.lineTo(b1_top.x, b1_top.y);
          ctx.lineTo(b0_top.x, b0_top.y);
          ctx.closePath();
          ctx.fill();
          ctx.stroke();
        }
      }
    });

    // 3.2. Верхняя грань несущей стены (Бесшовный Miter Joint)
    pathSections.forEach((sec, idx) => {
      if (sec.isBend) {
        const steps = 14;
        const len = sec.sEnd - sec.sStart;
        for (let i = 0; i < steps; i++) {
          const s0 = sec.sStart + (i / steps) * len;
          const s1 = sec.sStart + ((i + 1) / steps) * len;

          const topF0 = project3D(sec.getPoint(s0, wallH, 0), cx, cy, scale);
          const topF1 = project3D(sec.getPoint(s1, wallH, 0), cx, cy, scale);
          const topB1 = project3D(sec.getPoint(s1, wallH, wallThick), cx, cy, scale);
          const topB0 = project3D(sec.getPoint(s0, wallH, wallThick), cx, cy, scale);

          ctx.fillStyle = t.canvas3dWallTop;
          ctx.strokeStyle = t.isDark ? '#3a3e47' : '#94A3B8';
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
      } else {
        const psiBefore = idx > 0 ? pathSections[idx - 1].endHeading : sec.startHeading;
        const psiAfter = idx < pathSections.length - 1 ? pathSections[idx + 1].startHeading : sec.endHeading;
        const vMiterStart = computeMiterVector(psiBefore, sec.startHeading, wallThick);
        const vMiterEnd = computeMiterVector(sec.endHeading, psiAfter, wallThick);

        const topF0 = project3D({ x: sec.startPoint.x, y: wallH, z: sec.startPoint.z }, cx, cy, scale);
        const topF1 = project3D({ x: sec.endPoint.x, y: wallH, z: sec.endPoint.z }, cx, cy, scale);
        const topB1 = project3D({ x: sec.endPoint.x + vMiterEnd.x, y: wallH, z: sec.endPoint.z + vMiterEnd.z }, cx, cy, scale);
        const topB0 = project3D({ x: sec.startPoint.x + vMiterStart.x, y: wallH, z: sec.startPoint.z + vMiterStart.z }, cx, cy, scale);

        ctx.fillStyle = t.canvas3dWallTop;
        ctx.strokeStyle = t.isDark ? '#3a3e47' : '#94A3B8';
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

    // 3.3. Левый торец стены
    const tL0 = project3D(getPointAtS(0, 0, 0), cx, cy, scale);
    const tL1 = project3D(getPointAtS(0, wallH, 0), cx, cy, scale);
    const tL2 = project3D(getPointAtS(0, wallH, wallThick), cx, cy, scale);
    const tL3 = project3D(getPointAtS(0, 0, wallThick), cx, cy, scale);

    ctx.fillStyle = t.canvas3dWallBack;
    ctx.beginPath();
    ctx.moveTo(tL0.x, tL0.y);
    ctx.lineTo(tL1.x, tL1.y);
    ctx.lineTo(tL2.x, tL2.y);
    ctx.lineTo(tL3.x, tL3.y);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    // 3.4. Правый торец стены
    const tR0 = project3D(getPointAtS(wallW, 0, 0), cx, cy, scale);
    const tR1 = project3D(getPointAtS(wallW, wallH, 0), cx, cy, scale);
    const tR2 = project3D(getPointAtS(wallW, wallH, wallThick), cx, cy, scale);
    const tR3 = project3D(getPointAtS(wallW, 0, wallThick), cx, cy, scale);

    ctx.fillStyle = t.canvas3dWallBack;
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

      // Если это полигональная деталь (треугольник, трапеция после раскроя)
      if (panel.polygonPoints && panel.polygonPoints.length >= 3) {
        const thisPanelThick = isVoid ? 0 : (panel.thickness || (isSlat ? 15 : 5));

        const sortedPolySlices = surfaceSlices.filter(s => s >= pStartS && s <= pEndS);

        for (let i = 0; i < sortedPolySlices.length - 1; i++) {
          const s0 = sortedPolySlices[i];
          const s1 = sortedPolySlices[i + 1];
          if (s1 - s0 <= 0.5) continue;

          const clippedPoly = clipPolygonByXRange(panel.polygonPoints, s0, s1);
          if (clippedPoly.length < 3) continue;

          const poly3D = clippedPoly.map((pt) =>
            project3D(getPointAtS(pt.x, pt.y, -thisPanelThick), cx, cy, scale)
          );

          // Проверяем, находится ли этот срез внутри сгиба
          const inBend = pathSections.find((sec) => sec.isBend && s0 >= sec.sStart - 1 && s1 <= sec.sEnd + 1);
          let lightFactor = 0.95;
          if (inBend) {
            const u = (s0 - inBend.sStart) / (inBend.sEnd - inBend.sStart);
            lightFactor = inBend.bend?.type === 'INNER_CORNER' ? 0.55 + 0.45 * Math.abs(u - 0.5) * 2 : 0.65 + 0.35 * Math.sin(u * Math.PI);
          } else {
            const sec = pathSections.find((s) => s0 >= s.sStart - 0.1 && s1 <= s.sEnd + 0.1);
            if (sec) {
              const sunAngle = -Math.PI / 4;
              const angleDiff = sec.startHeading - sunAngle;
              lightFactor = 0.86 + 0.14 * Math.cos(angleDiff);
            }
          }

          ctx.save();
          clipHiddenFaces(ctx, poly3D, wallOccluders);
          ctx.beginPath();
          ctx.moveTo(poly3D[0].x, poly3D[0].y);
          for (let pi = 1; pi < poly3D.length; pi++) {
            ctx.lineTo(poly3D[pi].x, poly3D[pi].y);
          }
          ctx.closePath();
          ctx.fillStyle = isVoid ? 'rgba(20, 21, 24, 0.7)' : adjustBrightness(baseColor, lightFactor);
          ctx.strokeStyle = isVoid ? '#2C2E33' : adjustBrightness(baseColor, 0.7);
          ctx.lineWidth = inBend ? 0.5 : 1;
          ctx.fill();
          ctx.stroke();

          // Отрисовка текстуры и реек внутри маски среза полигона
          if (!isVoid) {
            ctx.clip();
            if (isSlat) {
              const slatThick = panel.thickness || 15;
              const slatWidth = panel.width > 200 ? 50 : Math.max(30, Math.floor(panel.width / (panel.reliefType === 'WAVE_GW90' ? 4 : 3)));
              const count = Math.max(1, Math.floor((s1 - s0) / slatWidth));

              for (let k = 0; k < count; k++) {
                const subS0 = s0 + k * slatWidth;
                const subS1 = Math.min(s1, subS0 + slatWidth - 4);

                let intervals: Interval1D[] = [{ start: yBot, end: yTop }];
                selectedWall.openings.forEach((op) => {
                  if (op.isCutout !== false && subS1 > op.x + 0.1 && subS0 < op.x + op.width - 0.1) {
                    intervals = subtractInterval(intervals, op.y, op.y + op.height);
                  }
                });

                for (const inv of intervals) {
                  if (inv.end - inv.start <= 1) continue;
                  const segYBot = inv.start;
                  const segYTop = inv.end;

                  const p0 = project3D(getPointAtS(subS0, segYBot, -slatThick), cx, cy, scale);
                  const p1 = project3D(getPointAtS(subS1, segYBot, -slatThick), cx, cy, scale);
                  const p2 = project3D(getPointAtS(subS1, segYTop, -slatThick), cx, cy, scale);
                  const p3 = project3D(getPointAtS(subS0, segYTop, -slatThick), cx, cy, scale);

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

                  if (showTextures) {
                    draw3DMaterialTexture(ctx, panel, p0, p1, p2, p3, { x: subS0, y: segYBot, width: subS1 - subS0, height: segYTop - segYBot });
                  }
                }
              }
            } else if (showTextures) {
              const p0 = project3D(getPointAtS(s0, yBot, -thisPanelThick), cx, cy, scale);
              const p1 = project3D(getPointAtS(s1, yBot, -thisPanelThick), cx, cy, scale);
              const p2 = project3D(getPointAtS(s1, yTop, -thisPanelThick), cx, cy, scale);
              const p3 = project3D(getPointAtS(s0, yTop, -thisPanelThick), cx, cy, scale);
              draw3DMaterialTexture(ctx, panel, p0, p1, p2, p3, { x: s0, y: yBot, width: s1 - s0, height: yTop - yBot });
            }
          }
          ctx.restore();
        }
        return;
      }

      if (isSlat) {
        // Реечные ламели AllWall (GW90 волна, GW30 желоб, GW10..GW68)
        const slatThick = panel.thickness || 15;
        const slatWidth = panel.width > 200 ? 50 : Math.max(30, Math.floor(panel.width / (panel.reliefType === 'WAVE_GW90' ? 4 : 3)));
        const count = Math.max(1, Math.floor(panel.width / slatWidth));

        for (let i = 0; i < count; i++) {
          const s0 = pStartS + i * slatWidth;
          const s1 = Math.min(pEndS, s0 + slatWidth - 4);

          // Вычитаем вырезы проемов (окна, двери, ниши)
          let intervals: Interval1D[] = [{ start: yBot, end: yTop }];
          selectedWall.openings.forEach((op) => {
            if (op.isCutout !== false && s1 > op.x + 0.1 && s0 < op.x + op.width - 0.1) {
              intervals = subtractInterval(intervals, op.y, op.y + op.height);
            }
          });

          for (const inv of intervals) {
            if (inv.end - inv.start <= 1) continue;
            const segYBot = inv.start;
            const segYTop = inv.end;

            const p0 = project3D(getPointAtS(s0, segYBot, -slatThick), cx, cy, scale);
            const p1 = project3D(getPointAtS(s1, segYBot, -slatThick), cx, cy, scale);
            const p2 = project3D(getPointAtS(s1, segYTop, -slatThick), cx, cy, scale);
            const p3 = project3D(getPointAtS(s0, segYTop, -slatThick), cx, cy, scale);

            ctx.save();
            clipHiddenFaces(ctx, [p0, p1, p2, p3], wallOccluders);
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

            if (!isVoid && showTextures) {
              draw3DMaterialTexture(ctx, panel, p0, p1, p2, p3, { x: s0, y: segYBot, width: s1 - s0, height: segYTop - segYBot });
            }
            ctx.restore();

            // Верхний торец рейки
            const pt0 = p3;
            const pt1 = p2;
            const pt2 = project3D(getPointAtS(s1, segYTop, 0), cx, cy, scale);
            const pt3 = project3D(getPointAtS(s0, segYTop, 0), cx, cy, scale);

            ctx.save();
            clipHiddenFaces(ctx, [pt0, pt1, pt2, pt3], wallOccluders);
            ctx.fillStyle = adjustBrightness(baseColor, 1.08);
            ctx.beginPath();
            ctx.moveTo(pt0.x, pt0.y);
            ctx.lineTo(pt1.x, pt1.y);
            ctx.lineTo(pt2.x, pt2.y);
            ctx.lineTo(pt3.x, pt3.y);
            ctx.closePath();
            ctx.fill();
            ctx.restore();

            // Нижний торец рейки (если висит над проемом)
            if (segYBot > yBot + 1 && elevationDeg < 20) {
              const pb0 = p0;
              const pb1 = p1;
              const pb2 = project3D(getPointAtS(s1, segYBot, 0), cx, cy, scale);
              const pb3 = project3D(getPointAtS(s0, segYBot, 0), cx, cy, scale);

              ctx.save();
              clipHiddenFaces(ctx, [pb0, pb1, pb2, pb3], wallOccluders);
              ctx.fillStyle = adjustBrightness(baseColor, 0.75);
              ctx.beginPath();
              ctx.moveTo(pb0.x, pb0.y);
              ctx.lineTo(pb1.x, pb1.y);
              ctx.lineTo(pb2.x, pb2.y);
              ctx.lineTo(pb3.x, pb3.y);
              ctx.closePath();
              ctx.fill();
              ctx.restore();
            }
          }
        }
      } else {
        // Листовые панели
        const thisPanelThick = isVoid ? 0 : (panel.thickness || 5);

        const sortedSlices = surfaceSlices.filter(s => s >= pStartS && s <= pEndS);

        for (let i = 0; i < sortedSlices.length - 1; i++) {
          const s0 = sortedSlices[i];
          const s1 = sortedSlices[i + 1];
          if (s1 - s0 <= 0.5) continue;

          // Вычитаем вырезы проемов
          let intervals: Interval1D[] = [{ start: yBot, end: yTop }];
          selectedWall.openings.forEach((op) => {
            if (op.isCutout !== false && s1 > op.x + 0.1 && s0 < op.x + op.width - 0.1) {
              intervals = subtractInterval(intervals, op.y, op.y + op.height);
            }
          });

          for (const inv of intervals) {
            if (inv.end - inv.start <= 1) continue;
            const segYBot = inv.start;
            const segYTop = inv.end;

            const p0 = project3D(getPointAtS(s0, segYBot, -thisPanelThick), cx, cy, scale);
            const p1 = project3D(getPointAtS(s1, segYBot, -thisPanelThick), cx, cy, scale);
            const p2 = project3D(getPointAtS(s1, segYTop, -thisPanelThick), cx, cy, scale);
            const p3 = project3D(getPointAtS(s0, segYTop, -thisPanelThick), cx, cy, scale);

            // Проверяем, находится ли этот срез внутри сгиба
            const inBend = pathSections.find((sec) => sec.isBend && s0 >= sec.sStart - 1 && s1 <= sec.sEnd + 1);
            let lightFactor = 0.95;
            if (inBend) {
              const u = (s0 - inBend.sStart) / (inBend.sEnd - inBend.sStart);
              lightFactor = inBend.bend?.type === 'INNER_CORNER' ? 0.55 + 0.45 * Math.abs(u - 0.5) * 2 : 0.65 + 0.35 * Math.sin(u * Math.PI);
            } else {
              const sec = pathSections.find((s) => s0 >= s.sStart - 0.1 && s1 <= s.sEnd + 0.1);
              if (sec) {
                const sunAngle = -Math.PI / 4;
                const angleDiff = sec.startHeading - sunAngle;
                lightFactor = 0.86 + 0.14 * Math.cos(angleDiff);
              }
            }

            ctx.save();
            clipHiddenFaces(ctx, [p0, p1, p2, p3], wallOccluders);
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

            if (!isVoid && showTextures) {
              draw3DMaterialTexture(ctx, panel, p0, p1, p2, p3, { x: s0, y: segYBot, width: s1 - s0, height: segYTop - segYBot });
            }
            if (isVoid) {
              ctx.strokeStyle = '#343a40';
              ctx.setLineDash([4, 4]);
              ctx.beginPath();
              ctx.moveTo(p0.x, p0.y);
              ctx.lineTo(p2.x, p2.y);
              ctx.moveTo(p1.x, p1.y);
              ctx.lineTo(p3.x, p3.y);
              ctx.stroke();
            }
            ctx.restore();

            // Верхний торец панели
            const pt0 = p3;
            const pt1 = p2;
            const pt2 = project3D(getPointAtS(s1, segYTop, 0), cx, cy, scale);
            const pt3 = project3D(getPointAtS(s0, segYTop, 0), cx, cy, scale);

            ctx.save();
            clipHiddenFaces(ctx, [pt0, pt1, pt2, pt3], wallOccluders);
            ctx.fillStyle = adjustBrightness(baseColor, 0.82);
            ctx.beginPath();
            ctx.moveTo(pt0.x, pt0.y);
            ctx.lineTo(pt1.x, pt1.y);
            ctx.lineTo(pt2.x, pt2.y);
            ctx.lineTo(pt3.x, pt3.y);
            ctx.closePath();
            ctx.fill();
            ctx.restore();
          }
        }
      }
    });

    // =========================================================================
    // 5. Отрисовка проемов (Двери, ТВ)
    // =========================================================================
    // 5. Отрисовка проемов и откосов в 3D
    // =========================================================================
    selectedWall.openings.forEach((op) => {
      const opP0 = project3D(getPointAtS(op.x, op.y, -panelThick - 2), cx, cy, scale);
      const opP1 = project3D(getPointAtS(op.x + op.width, op.y, -panelThick - 2), cx, cy, scale);
      const opP2 = project3D(getPointAtS(op.x + op.width, op.y + op.height, -panelThick - 2), cx, cy, scale);
      const opP3 = project3D(getPointAtS(op.x, op.y + op.height, -panelThick - 2), cx, cy, scale);

      if (op.isCutout === false) {
        // Декор поверх плит (ТВ-зона / зеркало)
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
        return;
      }

      const opDepth = op.depth ?? (op.type === 'WINDOW' ? 200 : 150);
      const selectedCorner = project.selectedOpeningId === op.id && slopeEditor.target?.projectId === project.id &&
        slopeEditor.target.wallId === selectedWall.id && slopeEditor.target.openingId === op.id ? slopeEditor.corner : undefined;
      drawOpeningSlopes(ctx, op, layout.slopes ?? [], layout.slopeJoints ?? [],
        p => project3D(getPointAtS(p.x, p.y, p.z), cx, cy, scale),
        { textures: showTextures, profiles: showProfiles, selectedCorner });

      // =========================================================================
      // Отрисовка внутреннего заполнения проема (ПОЛОТНО/ОКНО СТОИТ НА ГЛУБИНЕ ПРОЕМА opDepth)
      // =========================================================================
      if (op.type === 'DOOR' && !isPortalOpening(op)) {
        const dp0 = project3D(getPointAtS(op.x + 10, op.y, opDepth), cx, cy, scale);
        const dp1 = project3D(getPointAtS(op.x + op.width - 10, op.y, opDepth), cx, cy, scale);
        const dp2 = project3D(getPointAtS(op.x + op.width - 10, op.y + op.height - 10, opDepth), cx, cy, scale);
        const dp3 = project3D(getPointAtS(op.x + 10, op.y + op.height - 10, opDepth), cx, cy, scale);

        ctx.fillStyle = '#453325';
        ctx.strokeStyle = '#251b14';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(dp0.x, dp0.y);
        ctx.lineTo(dp1.x, dp1.y);
        ctx.lineTo(dp2.x, dp2.y);
        ctx.lineTo(dp3.x, dp3.y);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();

        // Ручка
        const handlePos = project3D(getPointAtS(op.x + op.width - 50, op.y + 1000, opDepth - 10), cx, cy, scale);
        ctx.fillStyle = '#e9ecef';
        ctx.beginPath();
        ctx.arc(handlePos.x, handlePos.y, 4, 0, Math.PI * 2);
        ctx.fill();
      } else if (op.type === 'WINDOW') {
        // Оконная рама со стеклопакетом на глубине opDepth
        const wp0 = project3D(getPointAtS(op.x + 15, op.y + 15, opDepth), cx, cy, scale);
        const wp1 = project3D(getPointAtS(op.x + op.width - 15, op.y + 15, opDepth), cx, cy, scale);
        const wp2 = project3D(getPointAtS(op.x + op.width - 15, op.y + op.height - 15, opDepth), cx, cy, scale);
        const wp3 = project3D(getPointAtS(op.x + 15, op.y + op.height - 15, opDepth), cx, cy, scale);

        // Внешняя рама профиля окна
        const frame0 = project3D(getPointAtS(op.x, op.y, opDepth), cx, cy, scale);
        const frame1 = project3D(getPointAtS(op.x + op.width, op.y, opDepth), cx, cy, scale);
        const frame2 = project3D(getPointAtS(op.x + op.width, op.y + op.height, opDepth), cx, cy, scale);
        const frame3 = project3D(getPointAtS(op.x, op.y + op.height, opDepth), cx, cy, scale);

        ctx.save();
        clipHiddenFaces(ctx, [frame0, frame1, frame2, frame3], wallOccluders);
        ctx.fillStyle = '#212529';
        ctx.strokeStyle = '#343a40';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(frame0.x, frame0.y);
        ctx.lineTo(frame1.x, frame1.y);
        ctx.lineTo(frame2.x, frame2.y);
        ctx.lineTo(frame3.x, frame3.y);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();

        // Стеклопакет
        ctx.fillStyle = 'rgba(165, 216, 255, 0.28)';
        ctx.strokeStyle = '#ced4da';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(wp0.x, wp0.y);
        ctx.lineTo(wp1.x, wp1.y);
        ctx.lineTo(wp2.x, wp2.y);
        ctx.lineTo(wp3.x, wp3.y);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();

        // Легкий световой блик на стекле
        ctx.save();
        ctx.beginPath();
        ctx.moveTo(wp0.x, wp0.y);
        ctx.lineTo(wp1.x, wp1.y);
        ctx.lineTo(wp2.x, wp2.y);
        ctx.lineTo(wp3.x, wp3.y);
        ctx.closePath();
        ctx.clip();

        const grad = ctx.createLinearGradient(wp0.x, wp0.y, wp2.x, wp2.y);
        grad.addColorStop(0, 'rgba(255, 255, 255, 0.05)');
        grad.addColorStop(0.35, 'rgba(255, 255, 255, 0.18)');
        grad.addColorStop(0.5, 'rgba(255, 255, 255, 0.02)');
        grad.addColorStop(0.65, 'rgba(255, 255, 255, 0.12)');
        grad.addColorStop(1, 'rgba(255, 255, 255, 0.02)');
        ctx.fillStyle = grad;
        ctx.fill();
        ctx.restore();

        // Вертикальный импост окна (переплет)
        const midX = op.x + op.width / 2;
        const imp0 = project3D(getPointAtS(midX, op.y + 15, opDepth), cx, cy, scale);
        const imp1 = project3D(getPointAtS(midX, op.y + op.height - 15, opDepth), cx, cy, scale);
        ctx.strokeStyle = '#ced4da';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(imp0.x, imp0.y);
        ctx.lineTo(imp1.x, imp1.y);
        ctx.stroke();
        ctx.restore();
      } else if (op.type === 'NICHE') {
        // Задняя стенка ниши на глубине opDepth
        const np0 = project3D(getPointAtS(op.x, op.y, opDepth), cx, cy, scale);
        const np1 = project3D(getPointAtS(op.x + op.width, op.y, opDepth), cx, cy, scale);
        const np2 = project3D(getPointAtS(op.x + op.width, op.y + op.height, opDepth), cx, cy, scale);
        const np3 = project3D(getPointAtS(op.x, op.y + op.height, opDepth), cx, cy, scale);

        ctx.fillStyle = '#1a1b1e';
        ctx.strokeStyle = '#2c2e33';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(np0.x, np0.y);
        ctx.lineTo(np1.x, np1.y);
        ctx.lineTo(np2.x, np2.y);
        ctx.lineTo(np3.x, np3.y);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
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
  }, [selectedWall, layout, sceneGeometry, panelTextures, elevationDeg, zoomScale, panOffset, project3D,
    showTextures, showProfiles, slopeEditor, project.id, project.selectedOpeningId, t.isDark]);

  function adjustBrightness(hex: string, percent: number): string {
    if (!hex || !hex.startsWith('#')) return hex || '#888';
    let num = parseInt(hex.slice(1), 16);
    let r = Math.min(255, Math.max(0, Math.round(((num >> 16) & 255) * percent)));
    let g = Math.min(255, Math.max(0, Math.round(((num >> 8) & 255) * percent)));
    let b = Math.min(255, Math.max(0, Math.round((num & 255) * percent)));
    return `rgb(${r}, ${g}, ${b})`;
  }

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
        style={{
          position: 'absolute',
          bottom: 20,
          right: 20,
          backgroundColor: t.canvas3dPanelOverlay,
          backdropFilter: 'blur(12px)',
          border: `1px solid ${t.border}`,
          borderRadius: 8,
          zIndex: 10,
          width: 320,
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
        </Stack>
      </Paper>
    </Box>
  );
};
