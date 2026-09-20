import React, { useEffect, useMemo } from 'react';
import { Circle, Layer, Line, Rect, Text } from 'react-konva';
import { KonvaEventObject } from 'konva/lib/Node';
import { useProjectStore } from '../../../application/stores/useProjectStore';
import { usePanelCutStore } from '../../../application/stores/usePanelCutStore';
import { cuttableWall, findCutPanel, previewPanelCut } from '../../../core/geometry/PanelCutEngine';
import { PolygonSlicingEngine as Geometry } from '../../../core/geometry/PolygonSlicingEngine';

export const PanelCutLayer: React.FC<{ width: number; height: number; zoom: number; panX: number; panY: number }> = props => {
  const { width, height, zoom, panX, panY } = props;
  const project = useProjectStore(s => s.project);
  const cut = usePanelCutStore();
  const wall = project.walls.find(w => w.id === project.selectedWallId);
  const source = useMemo(() => wall && cuttableWall(wall, project.materials), [wall, project.materials]);
  const panel = source && findCutPanel(source, cut.panelId);
  const preview = useMemo(() => panel && cut.p1 && cut.p2 ? previewPanelCut(panel, cut.p1, cut.p2) : null, [panel, cut.p1, cut.p2]);

  useEffect(() => {
    if (project.id !== cut.projectId || wall?.id !== cut.wallId) cut.finish();
  }, [project.id, wall?.id, cut.projectId, cut.wallId, cut.finish]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const input = event.target instanceof HTMLElement && (event.target.matches('input, textarea, select') || event.target.isContentEditable);
      if (event.key === 'Escape') {
        event.preventDefault();
        if (cut.p1 || cut.p2) cut.clearLine(); else cut.finish();
      } else if (!input && event.key === 'Enter') {
        event.preventDefault(); cut.apply();
      } else if (!input && (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') {
        event.preventDefault(); cut.undo();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [cut]);

  if (!wall || !source) return null;
  const wallH = wall.height;
  const pointer = (event: KonvaEventObject<MouseEvent>) => {
    const p = event.target.getStage()?.getPointerPosition();
    return p ? { x: (p.x - panX) / zoom, y: wallH - (p.y - panY) / zoom } : null;
  };
  const snapped = (event: KonvaEventObject<MouseEvent>) => {
    const raw = pointer(event);
    if (!raw || !panel) return null;
    if (event.evt.shiftKey && cut.p1) {
      const angle = Math.round(Math.atan2(raw.y - cut.p1.y, raw.x - cut.p1.x) / (Math.PI / 4)) * Math.PI / 4;
      const length = Math.hypot(raw.x - cut.p1.x, raw.y - cut.p1.y);
      raw.x = cut.p1.x + Math.cos(angle) * length;
      raw.y = cut.p1.y + Math.sin(angle) * length;
    }
    return Geometry.snapPoint(raw, [panel.points], [], wall.width, wall.height,
      cut.locked ? null : cut.p1, 9 / zoom);
  };
  const line = (a: { x: number; y: number }, b: { x: number; y: number }) => [a.x, wallH - a.y, b.x, wallH - b.y];
  const activePoint = cut.locked ? cut.p2 : cut.snap?.point;
  return (
    <Layer>
      <Rect x={-panX / zoom} y={-panY / zoom} width={width / zoom} height={height / zoom} fill="rgba(0,0,0,0)"
        onMouseMove={event => { const snap = snapped(event); if (snap) cut.hover(snap); }}
        onClick={event => {
          event.cancelBubble = true;
          if (event.evt.button !== 0) return;
          if (!panel) {
            const p = pointer(event);
            const target = p && source.panels?.find(item => Geometry.isPointInPolygon(p, item.points));
            if (target) cut.choosePanel(target.id);
          } else {
            const snap = snapped(event);
            if (snap) cut.clickPoint(snap);
          }
        }}
      />
      {panel && <Line points={panel.points.flatMap(p => [p.x, wallH - p.y])} closed
        stroke="#228be6" strokeWidth={2 / zoom} fill="rgba(34,139,230,0.06)" listening={false} />}
      {preview?.polygons.map((polygon, index) => <Line key={index} points={polygon.flatMap(p => [p.x, wallH - p.y])}
        closed fill={index % 2 ? 'rgba(32,201,151,0.16)' : 'rgba(34,139,230,0.12)'} listening={false} />)}
      {cut.p1 && cut.p2 && <Line points={line(cut.p1, cut.p2)} stroke={preview ? '#f59f00' : '#fa5252'}
        strokeWidth={2 / zoom} dash={[7 / zoom, 4 / zoom]} listening={false} />}
      {preview?.segments.map((segment, index) => <Line key={index} points={line(segment.p1, segment.p2)}
        stroke="#f59f00" strokeWidth={3 / zoom} listening={false} />)}
      {activePoint && <>
        <Line points={line({ x: 0, y: activePoint.y }, activePoint)} stroke="#20c997" strokeWidth={1 / zoom} dash={[4 / zoom, 4 / zoom]} listening={false} />
        <Line points={line({ x: activePoint.x, y: 0 }, activePoint)} stroke="#20c997" strokeWidth={1 / zoom} dash={[4 / zoom, 4 / zoom]} listening={false} />
        <Text x={activePoint.x + 12 / zoom} y={wallH - activePoint.y + 12 / zoom}
          text={`${cut.snap?.label ?? 'Точка'} · X ${activePoint.x.toFixed(1)} · Y ${activePoint.y.toFixed(1)} мм`}
          fill="#0ca678" fontSize={12 / zoom} listening={false} />
      </>}
      {[cut.p1, activePoint].map((p, index) => p && <Circle key={index} x={p.x} y={wallH - p.y} radius={5 / zoom}
        fill={index ? '#20c997' : '#228be6'} stroke="white" strokeWidth={1.5 / zoom} listening={false} />)}
    </Layer>
  );
};
