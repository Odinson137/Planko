import React, { useState, useRef, useEffect, useCallback } from 'react';
import {
  Modal,
  Button,
  Group,
  Stack,
  Text,
  Box,
  Paper,
  Badge,
  NumberInput,
} from '@mantine/core';
import {
  Scissors,
  RotateCcw,
  Check,
  X,
} from 'lucide-react';
import { useProjectStore } from '../../../application/stores/useProjectStore';
import {
  PolygonSlicingEngine,
  Point2D,
  PolygonSubPiece,
  SnapResult,
} from '../../../core/geometry/PolygonSlicingEngine';
import { MATERIAL_NONE_ID } from '../../../core/models/Material';

export const PanelSlicingModal: React.FC = () => {
  const {
    project,
    isSlicingModalOpen,
    slicingTarget,
    selectedSubPieceId,
    closeSlicingModal,
    applyPanelSlicingResult,
  } = useProjectStore();

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);

  // Размеры холста
  const [canvasDimensions, setCanvasDimensions] = useState<{ width: number; height: number }>({
    width: 1100,
    height: 620,
  });

  useEffect(() => {
    if (!isSlicingModalOpen) return;
    const updateSize = () => {
      if (containerRef.current) {
        const w = containerRef.current.clientWidth;
        const h = containerRef.current.clientHeight;
        if (w > 100 && h > 100) {
          setCanvasDimensions({ width: w, height: h });
        }
      }
    };
    updateSize();
    const timer = setTimeout(updateSize, 80);
    window.addEventListener('resize', updateSize);
    return () => {
      clearTimeout(timer);
      window.removeEventListener('resize', updateSize);
    };
  }, [isSlicingModalOpen]);

  // Полигоны и история
  const [pieces, setPieces] = useState<PolygonSubPiece[]>([]);

  // Интерактивное рисование линии реза
  const [drawingStart, setDrawingStart] = useState<Point2D | null>(null);
  const [currentMouse, setCurrentMouse] = useState<Point2D | null>(null);
  const [activeSnap, setActiveSnap] = useState<SnapResult | null>(null);

  // Точные координаты ножа для ручного ввода
  const [inputP1X, setInputP1X] = useState<number>(0);
  const [inputP1Y, setInputP1Y] = useState<number>(0);
  const [inputP2X, setInputP2X] = useState<number>(0);
  const [inputP2Y, setInputP2Y] = useState<number>(0);
  const [manualEdgeOffset, setManualEdgeOffset] = useState<number | ''>('');

  const currentWall = project.walls.find((w) => w.id === slicingTarget?.wallId);
  const colIdx = slicingTarget?.columnIndex ?? 0;
  const segIdx = slicingTarget?.segmentIndex ?? 0;

  const selectedPieceIds = useProjectStore((s) => s.selectedPieceIds);

  // Находим целевую полигональную деталь из wall.panels (если есть)
  const targetPanel = currentWall?.panels?.find(
    (p) =>
      p.id === slicingTarget?.panelId ||
      p.id === selectedSubPieceId ||
      selectedPieceIds.includes(p.id)
  ) || (currentWall?.panels && currentWall.panels[colIdx]);

  const customCol = currentWall?.customPanels?.[colIdx];
  const customSeg = customCol?.segments?.[segIdx];

  const defaultMaterial =
    project.materials.find((m) => m.id === currentWall?.zone.materialId) ||
    project.materials.find((m) => m.id === MATERIAL_NONE_ID) ||
    project.materials[0];

  let panelMaterial = defaultMaterial;
  let isPanelVoid = false;
  let panelWidth = 1220;
  let panelHeight = 2800;

  if (targetPanel) {
    const xs = targetPanel.points.map((p) => p.x);
    const ys = targetPanel.points.map((p) => p.y);
    panelWidth = Math.round(Math.max(...xs) - Math.min(...xs));
    panelHeight = Math.round(Math.max(...ys) - Math.min(...ys));
    panelMaterial =
      project.materials.find((m) => m.id === targetPanel.materialId) || defaultMaterial;
    isPanelVoid = targetPanel.isVoid || panelMaterial.isVoid || panelMaterial.id === MATERIAL_NONE_ID;
  } else {
    panelMaterial =
      (customSeg?.customMaterialId &&
        project.materials.find((m) => m.id === customSeg.customMaterialId)) ||
      (customCol?.customMaterialId &&
        project.materials.find((m) => m.id === customCol.customMaterialId)) ||
      defaultMaterial;
    isPanelVoid = panelMaterial.isVoid || panelMaterial.id === MATERIAL_NONE_ID;
    panelWidth = Math.round(
      customCol?.customWidth ?? (currentWall ? (defaultMaterial.isVoid ? currentWall.width : defaultMaterial.width) : 1220)
    );
    panelHeight = Math.round(
      customSeg?.height ?? (currentWall ? currentWall.height : 2800)
    );
  }

  // Инициализация при открытии модального окна
  useEffect(() => {
    if (!isSlicingModalOpen) return;

    if (targetPanel) {
      const xs = targetPanel.points.map((p) => p.x);
      const ys = targetPanel.points.map((p) => p.y);
      const minX = Math.min(...xs);
      const minY = Math.min(...ys);

      const initialPoly: Point2D[] = targetPanel.points.map((pt) => ({
        x: Math.round(pt.x - minX),
        y: Math.round(pt.y - minY),
      }));

      const initialPiece: PolygonSubPiece = {
        id: `piece-${Date.now()}-1`,
        points: initialPoly,
        materialId: isPanelVoid ? MATERIAL_NONE_ID : panelMaterial.id,
        isVoid: isPanelVoid,
        color: isPanelVoid ? 'rgba(30, 31, 35, 0.45)' : (targetPanel.color || panelMaterial.color),
        decorCode: isPanelVoid ? '' : (targetPanel.decorCode || panelMaterial.decorCode),
        decorName: isPanelVoid ? 'Без материала' : (targetPanel.decorName || panelMaterial.decorName),
        partLabel: isPanelVoid ? 'ПУСТО' : targetPanel.partLabel,
        patternAngleDeg: targetPanel.patternAngleDeg || 0,
        patternFlipX: targetPanel.patternFlipX || false,
        areaSqM: Math.round((PolygonSlicingEngine.calculatePolygonArea(initialPoly) / 1_000_000) * 1000) / 1000,
      };

      setPieces([initialPiece]);
    } else {
      const existingSubPieces = customSeg?.subPieces || customCol?.subPieces;
      if (existingSubPieces && existingSubPieces.length > 0) {
        setPieces([...existingSubPieces]);
      } else {
        // Инициализируем полигон с точными реальными габаритами выбранной панели
        const initialPoly: Point2D[] = [
          { x: 0, y: 0 },
          { x: panelWidth, y: 0 },
          { x: panelWidth, y: panelHeight },
          { x: 0, y: panelHeight },
        ];

        const initialPiece: PolygonSubPiece = {
          id: `piece-${Date.now()}-1`,
          points: initialPoly,
          materialId: isPanelVoid ? MATERIAL_NONE_ID : panelMaterial.id,
          isVoid: isPanelVoid,
          color: isPanelVoid ? 'rgba(30, 31, 35, 0.45)' : (customSeg?.customColor || customCol?.customColor || panelMaterial.color),
          decorCode: isPanelVoid ? '' : (customSeg?.customDecorCode || customCol?.customDecorCode || panelMaterial.decorCode),
          decorName: isPanelVoid ? 'Без материала' : panelMaterial.decorName,
          partLabel: isPanelVoid ? 'ПУСТО' : `1.${colIdx + 1}.${segIdx + 1}`,
          patternAngleDeg: customSeg?.patternAngleDeg || customCol?.patternAngleDeg || 0,
          patternFlipX: customSeg?.patternFlipX || customCol?.patternFlipX || false,
          areaSqM: Math.round(((panelWidth * panelHeight) / 1_000_000) * 1000) / 1000,
        };

        setPieces([initialPiece]);
      }
    }

    setDrawingStart(null);
    setCurrentMouse(null);
    setActiveSnap(null);
  }, [isSlicingModalOpen, panelWidth, panelHeight, panelMaterial, customSeg, customCol, colIdx, segIdx, isPanelVoid, targetPanel]);

  // Рассечение полигонов линией ножа
  const applyCutLineToPieces = useCallback(
    (p1: Point2D, p2: Point2D, gap: number) => {
      const nextPieces: PolygonSubPiece[] = [];
      let didSplitAny = false;

      pieces.forEach((piece) => {
        const split = PolygonSlicingEngine.splitPolygonByLine(piece.points, p1, p2, gap);
        if (split) {
          didSplitAny = true;
          const allPolys = split.allPieces || [split.pieceA, split.pieceB];
          allPolys.forEach((polyPts) => {
            const area =
              Math.round(
                (PolygonSlicingEngine.calculatePolygonArea(polyPts) / 1_000_000) * 1000
              ) / 1000;
            nextPieces.push({
              ...piece,
              id: `piece-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
              points: polyPts,
              areaSqM: area,
            });
          });
        } else {
          nextPieces.push(piece);
        }
      });

      if (didSplitAny) {
        const baseLabel = targetPanel ? targetPanel.partLabel : `1.${colIdx + 1}.${segIdx + 1}`;
        const indexedPieces = nextPieces.map((p, idx) => ({
          ...p,
          partLabel: p.isVoid || p.materialId === MATERIAL_NONE_ID
            ? 'ПУСТО'
            : (nextPieces.length > 1 ? `${baseLabel}.${idx + 1}` : baseLabel),
        }));
        setPieces(indexedPieces);
      }
    },
    [pieces, colIdx, segIdx, targetPanel]
  );

  // Сброс всех разрезов
  const handleReset = () => {
    if (targetPanel) {
      const xs = targetPanel.points.map((p) => p.x);
      const ys = targetPanel.points.map((p) => p.y);
      const minX = Math.min(...xs);
      const minY = Math.min(...ys);

      const initialPoly: Point2D[] = targetPanel.points.map((pt) => ({
        x: Math.round(pt.x - minX),
        y: Math.round(pt.y - minY),
      }));

      const initialPiece: PolygonSubPiece = {
        id: `piece-${Date.now()}-1`,
        points: initialPoly,
        materialId: isPanelVoid ? MATERIAL_NONE_ID : panelMaterial.id,
        isVoid: isPanelVoid,
        color: isPanelVoid ? 'rgba(30, 31, 35, 0.45)' : (targetPanel.color || panelMaterial.color),
        decorCode: isPanelVoid ? '' : (targetPanel.decorCode || panelMaterial.decorCode),
        decorName: isPanelVoid ? 'Без материала' : (targetPanel.decorName || panelMaterial.decorName),
        partLabel: isPanelVoid ? 'ПУСТО' : targetPanel.partLabel,
        patternAngleDeg: 0,
        areaSqM: Math.round((PolygonSlicingEngine.calculatePolygonArea(initialPoly) / 1_000_000) * 1000) / 1000,
      };

      setPieces([initialPiece]);
    } else {
      const initialPoly: Point2D[] = [
        { x: 0, y: 0 },
        { x: panelWidth, y: 0 },
        { x: panelWidth, y: panelHeight },
        { x: 0, y: panelHeight },
      ];

      const initialPiece: PolygonSubPiece = {
        id: `piece-${Date.now()}-1`,
        points: initialPoly,
        materialId: isPanelVoid ? MATERIAL_NONE_ID : panelMaterial.id,
        isVoid: isPanelVoid,
        color: isPanelVoid ? 'rgba(30, 31, 35, 0.45)' : panelMaterial.color,
        decorCode: isPanelVoid ? '' : panelMaterial.decorCode,
        decorName: isPanelVoid ? 'Без материала' : panelMaterial.decorName,
        partLabel: isPanelVoid ? 'ПУСТО' : `1.${colIdx + 1}.${segIdx + 1}`,
        patternAngleDeg: 0,
        areaSqM: Math.round(((panelWidth * panelHeight) / 1_000_000) * 1000) / 1000,
      };

      setPieces([initialPiece]);
    }

    setDrawingStart(null);
    setCurrentMouse(null);
    setActiveSnap(null);
  };

  // Применение раскроя на стену
  const handleApply = () => {
    if (!currentWall) return;
    applyPanelSlicingResult(
      currentWall.id,
      colIdx,
      segIdx,
      pieces,
      targetPanel?.id || slicingTarget?.panelId
    );
    closeSlicingModal();
  };

  // Цвета для контрастного чертёжного разделения деталей
  const CAD_PIECE_COLORS = [
    { fill: 'rgba(34, 139, 230, 0.22)', stroke: '#339af0', text: '#74c0fc' },
    { fill: 'rgba(32, 201, 151, 0.22)', stroke: '#20c997', text: '#63e6be' },
    { fill: 'rgba(250, 176, 5, 0.22)', stroke: '#fab005', text: '#ffe066' },
    { fill: 'rgba(230, 73, 128, 0.22)', stroke: '#e64980', text: '#f783ac' },
    { fill: 'rgba(190, 75, 219, 0.22)', stroke: '#be4bdb', text: '#da77f2' },
    { fill: 'rgba(76, 110, 245, 0.22)', stroke: '#4c6ef5', text: '#91a7ff' },
  ];

  // Отрисовка холста (Чертёжный CAD-вид)
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const width = canvas.width;
    const height = canvas.height;

    // 1. Черный технический CAD-фон
    ctx.fillStyle = '#0f1115';
    ctx.fillRect(0, 0, width, height);

    // Масштабирование по габаритам панели
    const pad = 65;
    const availW = width - pad * 2;
    const availH = height - pad * 2;
    const scale = Math.min(availW / panelWidth, availH / panelHeight, 0.85);

    const offX = (width - panelWidth * scale) / 2;
    const offY = (height - panelHeight * scale) / 2;

    const toCanvas = (pt: Point2D): Point2D => ({
      x: offX + pt.x * scale,
      y: offY + (panelHeight - pt.y) * scale,
    });

    // 2. Координатная CAD-сетка (100 мм и 500 мм)
    ctx.lineWidth = 1;
    for (let x = 0; x <= panelWidth; x += 100) {
      const p1 = toCanvas({ x, y: 0 });
      const p2 = toCanvas({ x, y: panelHeight });
      ctx.strokeStyle = x % 500 === 0 ? 'rgba(77, 171, 247, 0.18)' : 'rgba(255, 255, 255, 0.04)';
      ctx.beginPath();
      ctx.moveTo(p1.x, p1.y);
      ctx.lineTo(p2.x, p2.y);
      ctx.stroke();
    }
    for (let y = 0; y <= panelHeight; y += 100) {
      const p1 = toCanvas({ x: 0, y });
      const p2 = toCanvas({ x: panelWidth, y });
      ctx.strokeStyle = y % 500 === 0 ? 'rgba(77, 171, 247, 0.18)' : 'rgba(255, 255, 255, 0.04)';
      ctx.beginPath();
      ctx.moveTo(p1.x, p1.y);
      ctx.lineTo(p2.x, p2.y);
      ctx.stroke();
    }

    // 3. Отрисовка деталей раскроя (Чертёжные полигоны с размерами)
    pieces.forEach((piece, pIdx) => {
      if (!piece.points || piece.points.length < 3) return;

      const cadColor = CAD_PIECE_COLORS[pIdx % CAD_PIECE_COLORS.length];

      // Заливка полигона
      ctx.save();
      ctx.beginPath();
      const firstPt = toCanvas(piece.points[0]);
      ctx.moveTo(firstPt.x, firstPt.y);
      for (let i = 1; i < piece.points.length; i++) {
        const pt = toCanvas(piece.points[i]);
        ctx.lineTo(pt.x, pt.y);
      }
      ctx.closePath();
      ctx.fillStyle = cadColor.fill;
      ctx.fill();

      // Чертёжный контур
      const isSelectedPiece = Boolean(selectedSubPieceId && piece.id === selectedSubPieceId);
      ctx.strokeStyle = isSelectedPiece ? '#ffd43b' : cadColor.stroke;
      ctx.lineWidth = isSelectedPiece ? 4.0 : 2.5;
      ctx.stroke();
      ctx.restore();

      // Выносные размеры на всех гранях полигона
      const n = piece.points.length;
      for (let i = 0; i < n; i++) {
        const pt1 = piece.points[i];
        const pt2 = piece.points[(i + 1) % n];
        const edgeLen = Math.hypot(pt2.x - pt1.x, pt2.y - pt1.y);

        if (edgeLen >= 70) {
          const c1 = toCanvas(pt1);
          const c2 = toCanvas(pt2);
          const midX = (c1.x + c2.x) / 2;
          const midY = (c1.y + c2.y) / 2;

          // Угол наклона текста вдоль грани
          const angle = Math.atan2(c2.y - c1.y, c2.x - c1.x);
          const normAngle = angle > Math.PI / 2 ? angle - Math.PI : angle < -Math.PI / 2 ? angle + Math.PI : angle;

          ctx.save();
          ctx.translate(midX, midY);
          ctx.rotate(normAngle);

          ctx.font = '600 10px JetBrains Mono, monospace';
          const dimText = `${Math.round(edgeLen)}`;
          const textW = ctx.measureText(dimText).width;

          // Подложка под размер
          ctx.fillStyle = 'rgba(15, 17, 21, 0.85)';
          ctx.fillRect(-textW / 2 - 3, -8, textW + 6, 16);

          ctx.fillStyle = isSelectedPiece ? '#ffe066' : '#ced4da';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText(dimText, 0, 0);
          ctx.restore();
        }
      }

      // Центроид и технический бейдж детали
      const centroid = PolygonSlicingEngine.calculateCentroid(piece.points);
      const cCanvas = toCanvas(centroid);
      const labelText = isSelectedPiece
        ? `⭐ [${piece.partLabel || `#${pIdx + 1}`}]  ${piece.areaSqM || 0} м² (ВЫБРАНА)`
        : `[${piece.partLabel || `#${pIdx + 1}`}]  ${piece.areaSqM || 0} м²`;

      ctx.font = '700 11px JetBrains Mono, monospace';
      const badgeW = ctx.measureText(labelText).width;
      ctx.fillStyle = isSelectedPiece ? 'rgba(30, 26, 10, 0.95)' : 'rgba(15, 17, 21, 0.9)';
      ctx.fillRect(cCanvas.x - badgeW / 2 - 8, cCanvas.y - 12, badgeW + 16, 24);

      ctx.strokeStyle = isSelectedPiece ? '#ffd43b' : cadColor.stroke;
      ctx.lineWidth = isSelectedPiece ? 2.0 : 1.5;
      ctx.strokeRect(cCanvas.x - badgeW / 2 - 8, cCanvas.y - 12, badgeW + 16, 24);

      ctx.fillStyle = isSelectedPiece ? '#ffd43b' : cadColor.text;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(labelText, cCanvas.x, cCanvas.y);

      // Вершины полигона (CAD-точки)
      piece.points.forEach((pt) => {
        const cpt = toCanvas(pt);
        ctx.fillStyle = '#ffffff';
        ctx.beginPath();
        ctx.arc(cpt.x, cpt.y, 3.5, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = '#1c7ed6';
        ctx.lineWidth = 1.5;
        ctx.stroke();
      });
    });

    // 4. Главные габаритные размерные линии панели (сверху и справа)
    ctx.strokeStyle = '#4dabf7';
    ctx.fillStyle = '#4dabf7';
    ctx.font = '700 11px JetBrains Mono, monospace';
    ctx.lineWidth = 1.2;

    // Верхняя размерная линия
    const top1 = toCanvas({ x: 0, y: panelHeight });
    const top2 = toCanvas({ x: panelWidth, y: panelHeight });
    const topY = top1.y - 24;
    ctx.beginPath();
    ctx.moveTo(top1.x, top1.y - 4);
    ctx.lineTo(top1.x, topY);
    ctx.lineTo(top2.x, topY);
    ctx.lineTo(top2.x, top2.y - 4);
    ctx.stroke();

    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';
    ctx.fillText(`${panelWidth} мм`, (top1.x + top2.x) / 2, topY - 4);

    // Правая размерная линия
    const r1 = toCanvas({ x: panelWidth, y: 0 });
    const r2 = toCanvas({ x: panelWidth, y: panelHeight });
    const rX = r1.x + 24;
    ctx.beginPath();
    ctx.moveTo(r1.x + 4, r1.y);
    ctx.lineTo(rX, r1.y);
    ctx.lineTo(rX, r2.y);
    ctx.lineTo(r2.x + 4, r2.y);
    ctx.stroke();

    ctx.save();
    ctx.translate(rX + 14, (r1.y + r2.y) / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.fillText(`${panelHeight} мм`, 0, 0);
    ctx.restore();

    // 5. Текущая линия реза ножа (если идет протяжка)
    if (drawingStart && currentMouse) {
      const p1C = toCanvas(drawingStart);
      const p2C = toCanvas(currentMouse);

      // Лазерная линия ножа
      ctx.strokeStyle = '#ff6b6b';
      ctx.lineWidth = 2.5;
      ctx.setLineDash([6, 4]);
      ctx.beginPath();
      ctx.moveTo(p1C.x, p1C.y);
      ctx.lineTo(p2C.x, p2C.y);
      ctx.stroke();
      ctx.setLineDash([]);

      // Точки реза
      ctx.fillStyle = '#ff6b6b';
      ctx.beginPath();
      ctx.arc(p1C.x, p1C.y, 5, 0, Math.PI * 2);
      ctx.arc(p2C.x, p2C.y, 5, 0, Math.PI * 2);
      ctx.fill();

      // Динамический HUD с длиной и углом
      const dx = currentMouse.x - drawingStart.x;
      const dy = currentMouse.y - drawingStart.y;
      const lenMm = Math.hypot(dx, dy);
      let angleDeg = (Math.atan2(dy, dx) * 180) / Math.PI;
      if (angleDeg < 0) angleDeg += 360;

      const hudText = `✂ РЕЗ: ${Math.round(lenMm)} мм  •  ${Math.round(angleDeg)}°`;
      ctx.font = '700 11px JetBrains Mono, monospace';
      const hudW = ctx.measureText(hudText).width;
      const midC = { x: (p1C.x + p2C.x) / 2, y: (p1C.y + p2C.y) / 2 };

      ctx.fillStyle = 'rgba(15, 17, 21, 0.95)';
      ctx.fillRect(midC.x - hudW / 2 - 6, midC.y - 20, hudW + 12, 20);
      ctx.strokeStyle = '#ff6b6b';
      ctx.lineWidth = 1;
      ctx.strokeRect(midC.x - hudW / 2 - 6, midC.y - 20, hudW + 12, 20);

      ctx.fillStyle = '#ff8787';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(hudText, midC.x, midC.y - 10);
    }

    // 6. Отрисовка активного смарт-магнита и РАЗМЕРОВ ОТ ГРАНИЦ
    if (activeSnap && activeSnap.snapped) {
      const snapC = toCanvas(activeSnap.point);

      // 6.1 Если есть привязка к грани (edgeSegment) — рисуем выносные размеры к обоим концам грани
      if (activeSnap.edgeSegment) {
        const { p1, p2, dist1, dist2 } = activeSnap.edgeSegment;
        const p1C = toCanvas(p1);
        const p2C = toCanvas(p2);

        ctx.save();
        ctx.strokeStyle = '#20c997';
        ctx.lineWidth = 2;

        // Линия участка 1 (от P1 до точки прилипания)
        ctx.beginPath();
        ctx.moveTo(p1C.x, p1C.y);
        ctx.lineTo(snapC.x, snapC.y);
        ctx.stroke();

        // Линия участка 2 (от точки прилипания до P2)
        ctx.beginPath();
        ctx.moveTo(snapC.x, snapC.y);
        ctx.lineTo(p2C.x, p2C.y);
        ctx.stroke();

        // Засечки на концах и в точке прилипания
        [p1C, snapC, p2C].forEach((pt) => {
          ctx.fillStyle = '#20c997';
          ctx.beginPath();
          ctx.arc(pt.x, pt.y, 4, 0, Math.PI * 2);
          ctx.fill();
        });

        // Подписи размеров вдоль отрезков
        if (dist1 > 20) {
          const mid1X = (p1C.x + snapC.x) / 2;
          const mid1Y = (p1C.y + snapC.y) / 2;
          ctx.font = '700 11px JetBrains Mono, monospace';
          const t1 = `${dist1} мм`;
          const w1 = ctx.measureText(t1).width;
          ctx.fillStyle = 'rgba(15, 17, 21, 0.9)';
          ctx.fillRect(mid1X - w1 / 2 - 4, mid1Y - 10, w1 + 8, 20);
          ctx.strokeStyle = '#20c997';
          ctx.lineWidth = 1;
          ctx.strokeRect(mid1X - w1 / 2 - 4, mid1Y - 10, w1 + 8, 20);
          ctx.fillStyle = '#63e6be';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText(t1, mid1X, mid1Y);
        }

        if (dist2 > 20) {
          const mid2X = (snapC.x + p2C.x) / 2;
          const mid2Y = (snapC.y + p2C.y) / 2;
          ctx.font = '700 11px JetBrains Mono, monospace';
          const t2 = `${dist2} мм`;
          const w2 = ctx.measureText(t2).width;
          ctx.fillStyle = 'rgba(15, 17, 21, 0.9)';
          ctx.fillRect(mid2X - w2 / 2 - 4, mid2Y - 10, w2 + 8, 20);
          ctx.strokeStyle = '#20c997';
          ctx.lineWidth = 1;
          ctx.strokeRect(mid2X - w2 / 2 - 4, mid2Y - 10, w2 + 8, 20);
          ctx.fillStyle = '#63e6be';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText(t2, mid2X, mid2Y);
        }

        ctx.restore();
      }

      // Маркер самой точки магнита
      ctx.strokeStyle = '#20c997';
      ctx.fillStyle = 'rgba(32, 201, 151, 0.35)';
      ctx.lineWidth = 2.5;

      ctx.beginPath();
      if (activeSnap.snapType === 'MIDPOINT') {
        ctx.moveTo(snapC.x, snapC.y - 9);
        ctx.lineTo(snapC.x + 9, snapC.y);
        ctx.lineTo(snapC.x, snapC.y + 9);
        ctx.lineTo(snapC.x - 9, snapC.y);
        ctx.closePath();
      } else {
        ctx.arc(snapC.x, snapC.y, 7, 0, Math.PI * 2);
      }
      ctx.fill();
      ctx.stroke();

      // Бейдж с точными координатами и расстояниями
      const distInfo = activeSnap.edgeSegment
        ? `${activeSnap.edgeSegment.dist1} мм ⟵ ➔ ${activeSnap.edgeSegment.dist2} мм`
        : `X: ${Math.round(activeSnap.point.x)}, Y: ${Math.round(activeSnap.point.y)}`;

      const badgeText = `🧲 ${activeSnap.label || 'Грань'} • ${distInfo}`;
      ctx.font = '700 11px JetBrains Mono, monospace';
      const snapLabelW = ctx.measureText(badgeText).width;
      ctx.fillStyle = 'rgba(15, 17, 21, 0.95)';
      ctx.fillRect(snapC.x + 12, snapC.y - 14, snapLabelW + 10, 22);
      ctx.strokeStyle = '#20c997';
      ctx.lineWidth = 1.2;
      ctx.strokeRect(snapC.x + 12, snapC.y - 14, snapLabelW + 10, 22);

      ctx.fillStyle = '#20c997';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.fillText(badgeText, snapC.x + 17, snapC.y - 3);
    }
  }, [pieces, drawingStart, currentMouse, activeSnap, panelWidth, panelHeight]);

  // Обработчик движения мыши (Идеальное точное позиционирование 1:1)
  const handleCanvasMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    
    // Перевод CSS-координат клика мыши в реальные пиксели холста
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    const cx = (e.clientX - rect.left) * scaleX;
    const cy = (e.clientY - rect.top) * scaleY;

    const pad = 65;
    const availW = canvas.width - pad * 2;
    const availH = canvas.height - pad * 2;
    const scale = Math.min(availW / panelWidth, availH / panelHeight, 0.85);
    const offX = (canvas.width - panelWidth * scale) / 2;
    const offY = (canvas.height - panelHeight * scale) / 2;

    const rawMm: Point2D = {
      x: Math.max(0, Math.min(panelWidth, (cx - offX) / scale)),
      y: Math.max(0, Math.min(panelHeight, panelHeight - (cy - offY) / scale)),
    };

    const polyPointsList = pieces.map((p) => p.points);
    const snap = PolygonSlicingEngine.snapPoint(
      rawMm,
      polyPointsList,
      [],
      panelWidth,
      panelHeight,
      drawingStart,
      24
    );

    setActiveSnap(snap);
    setCurrentMouse(snap.point);

    if (!drawingStart) {
      setInputP1X(Math.round(snap.point.x));
      setInputP1Y(Math.round(snap.point.y));
    } else {
      setInputP2X(Math.round(snap.point.x));
      setInputP2Y(Math.round(snap.point.y));
    }

    if (snap.edgeSegment) {
      setManualEdgeOffset(snap.edgeSegment.dist1);
    }
  };

  // Обработчик клика ножом
  const handleCanvasMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (e.button !== 0) return;
    if (!currentMouse) return;

    if (!drawingStart) {
      setDrawingStart(currentMouse);
      setInputP1X(Math.round(currentMouse.x));
      setInputP1Y(Math.round(currentMouse.y));
    } else {
      if (Math.hypot(currentMouse.x - drawingStart.x, currentMouse.y - drawingStart.y) > 15) {
        applyCutLineToPieces(drawingStart, currentMouse, 0);
      }
      setDrawingStart(null);
    }
  };

  // Ручная установка точного отступа от угла/грани
  const handleSetManualOffset = (dist: number) => {
    setManualEdgeOffset(dist);
    if (activeSnap && activeSnap.edgeSegment) {
      const { p1, p2 } = activeSnap.edgeSegment;
      const dx = p2.x - p1.x;
      const dy = p2.y - p1.y;
      const len = Math.hypot(dx, dy);
      if (len > 1e-4) {
        const factor = Math.max(0, Math.min(len, dist)) / len;
        const newPt: Point2D = {
          x: Math.round(p1.x + dx * factor),
          y: Math.round(p1.y + dy * factor),
        };
        setCurrentMouse(newPt);
        if (!drawingStart) {
          setInputP1X(newPt.x);
          setInputP1Y(newPt.y);
        } else {
          setInputP2X(newPt.x);
          setInputP2Y(newPt.y);
        }
      }
    }
  };

  // Применение точного разреза по введенным координатам
  const handleExecuteExactCut = () => {
    const p1: Point2D = { x: inputP1X, y: inputP1Y };
    const p2: Point2D = { x: inputP2X, y: inputP2Y };
    if (Math.hypot(p2.x - p1.x, p2.y - p1.y) > 10) {
      applyCutLineToPieces(p1, p2, 0);
      setDrawingStart(null);
      setCurrentMouse(null);
      setActiveSnap(null);
    }
  };

  if (!isSlicingModalOpen) return null;

  return (
    <Modal
      opened={isSlicingModalOpen}
      onClose={closeSlicingModal}
      size="90%"
      title={
        <Group justify="space-between" align="center" style={{ width: '100%' }}>
          <Group gap="xs">
            <Scissors size={22} color="#339af0" />
            <div>
              <Text fw={700} size="md" c="blue.4">
                ЧЕРТЕЖ РАСКРОЯ: {panelWidth} × {panelHeight} мм
              </Text>
              <Text size="xs" c="dimmed">
                Ячейка К#{colIdx + 1} Р#{segIdx + 1} • Деталей: {pieces.length} шт. • Проведите линию ножом или задайте точные размеры ниже
              </Text>
            </div>
          </Group>

          <Group gap="xs">
            <Button
              size="xs"
              variant="subtle"
              color="red"
              leftSection={<RotateCcw size={14} />}
              onClick={handleReset}
            >
              Сбросить
            </Button>

            <Button variant="default" size="xs" onClick={closeSlicingModal} leftSection={<X size={14} />}>
              Отмена
            </Button>

            <Button
              variant="filled"
              color="blue"
              size="xs"
              leftSection={<Check size={16} />}
              onClick={handleApply}
            >
              Применить раскрой ({pieces.length} дет.)
            </Button>
          </Group>
        </Group>
      }
      styles={{
        header: { backgroundColor: '#141517', borderBottom: '1px solid #2C2E33', padding: '12px 16px' },
        body: { backgroundColor: '#0e1013', padding: 12 },
        content: { backgroundColor: '#0e1013', border: '1px solid #339af0' },
      }}
    >
      <Stack gap="xs">
        {/* ХОЛСТ ЧЕРТЕЖА */}
        <Box
          ref={containerRef}
          style={{
            height: '63vh',
            backgroundColor: '#0f1115',
            borderRadius: 8,
            overflow: 'hidden',
            position: 'relative',
            display: 'flex',
            justifyContent: 'center',
            alignItems: 'center',
            cursor: 'crosshair',
            border: '1px solid #25262b',
          }}
        >
          <canvas
            ref={canvasRef}
            width={canvasDimensions.width}
            height={canvasDimensions.height}
            onMouseMove={handleCanvasMouseMove}
            onMouseDown={handleCanvasMouseDown}
            style={{ width: '100%', height: '100%', display: 'block' }}
          />
        </Box>

        {/* ПАНЕЛЬ ТОЧНОГО ВВОДА РАЗМЕРОВ И ОТСТУПОВ (CAD Precision Toolbar) */}
        <Paper p="xs" withBorder style={{ backgroundColor: '#141517', borderColor: '#2C2E33' }}>
          <Group justify="space-between" align="center" wrap="wrap">
            <Group gap="sm" align="center">
              <Text size="xs" fw={700} c="dimmed">
                📏 ТОЧНЫЕ КООРДИНАТЫ РЕЗА:
              </Text>
              <Group gap={4} align="center">
                <Text size="xs" c="gray">X₁:</Text>
                <NumberInput
                  size="xs"
                  w={85}
                  min={0}
                  max={panelWidth}
                  value={inputP1X}
                  onChange={(val) => setInputP1X(Number(val) || 0)}
                  placeholder="0"
                />
                <Text size="xs" c="gray">Y₁:</Text>
                <NumberInput
                  size="xs"
                  w={85}
                  min={0}
                  max={panelHeight}
                  value={inputP1Y}
                  onChange={(val) => setInputP1Y(Number(val) || 0)}
                  placeholder="0"
                />
              </Group>

              <Text size="xs" c="gray">→</Text>

              <Group gap={4} align="center">
                <Text size="xs" c="gray">X₂:</Text>
                <NumberInput
                  size="xs"
                  w={85}
                  min={0}
                  max={panelWidth}
                  value={inputP2X}
                  onChange={(val) => setInputP2X(Number(val) || 0)}
                  placeholder="0"
                />
                <Text size="xs" c="gray">Y₂:</Text>
                <NumberInput
                  size="xs"
                  w={85}
                  min={0}
                  max={panelHeight}
                  value={inputP2Y}
                  onChange={(val) => setInputP2Y(Number(val) || 0)}
                  placeholder="0"
                />
              </Group>

              <Button
                size="xs"
                variant="light"
                color="blue"
                leftSection={<Scissors size={13} />}
                onClick={handleExecuteExactCut}
              >
                Выполнить разрез
              </Button>
            </Group>

            {/* Активный отступ от примагниченной грани */}
            {activeSnap && activeSnap.edgeSegment && (
              <Group gap="xs" align="center">
                <Badge color="teal" size="sm" variant="light">
                  🧲 Отступ: {activeSnap.edgeSegment.dist1} мм / {activeSnap.edgeSegment.dist2} мм
                </Badge>
                <NumberInput
                  size="xs"
                  w={120}
                  min={0}
                  value={manualEdgeOffset}
                  onChange={(val) => handleSetManualOffset(Number(val) || 0)}
                  placeholder="Отступ (мм)"
                  rightSection={<Text size="xs" c="dimmed">мм</Text>}
                />
              </Group>
            )}
          </Group>
        </Paper>
      </Stack>
    </Modal>
  );
};
