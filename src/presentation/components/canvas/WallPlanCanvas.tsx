import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Box, Button, Group, Text } from '@mantine/core';
import { useElementSize } from '@mantine/hooks';
import { Maximize2 } from 'lucide-react';
import { useProjectStore } from '../../../application/stores/useProjectStore';
import { useWallEditorStore } from '../../../application/stores/useWallEditorStore';
import { wallPlanBends } from '../../../application/services/WallEditing';
import { buildWallPath, normalizeTurn, snapWallHeading, type WallPoint } from '../../../core/geometry/WallPath';
import { MIN_WALL_LENGTH, type WallEnd } from '../../../core/geometry/WallEditing';
import { useAppTheme } from '../../theme/useAppTheme';

export const WallPlanCanvas: React.FC = () => {
  const theme = useAppTheme();
  const project = useProjectStore(s => s.project);
  const wall = project.walls.find(w => w.id === project.selectedWallId);
  const editor = useWallEditorStore();
  const { ref, width, height } = useElementSize();
  const svgRef = useRef<SVGSVGElement>(null);
  const drag = useRef<{ x: number; y: number; panX: number; panY: number } | null>(null);
  const [draft, setDraft] = useState<{ length: number; heading: number } | null>(null);
  const path = useMemo(() => wall ? buildWallPath(wall, wallPlanBends(project, wall)) : null, [wall, project]);
  const camera = editor.camera ?? { x: 100, y: height / 2, zoom: 0.15 };
  const screen = (p: WallPoint) => ({ x: p.x * camera.zoom + camera.x, y: p.z * camera.zoom + camera.y });
  const anchor = path && (editor.drawEnd === 'start' ? path.startPoint : path.endPoint);
  const baseHeading = path ? (editor.drawEnd === 'start' ? path.startHeading + Math.PI : path.endHeading) : 0;
  const preview = anchor && draft ? { x: anchor.x + Math.cos(draft.heading) * draft.length, y: 0,
    z: anchor.z - Math.sin(draft.heading) * draft.length } : null;
  const fit = useCallback(() => {
    if (!path || width < 1 || height < 1) return;
    const xs = path.allPathPoints.map(p => p.x), zs = path.allPathPoints.map(p => p.z);
    const minX = Math.min(...xs), maxX = Math.max(...xs), minZ = Math.min(...zs), maxZ = Math.max(...zs);
    const zoom = Math.max(0.005, Math.min(0.5, Math.max(60, width-180)/Math.max(100,maxX-minX), Math.max(60,height-180)/Math.max(100,maxZ-minZ)));
    editor.setCamera({ zoom, x: width/2 - (minX+maxX)*zoom/2, y: height/2 - (minZ+maxZ)*zoom/2 });
  }, [path, width, height, editor.setCamera]);
  useEffect(() => { if (wall) editor.syncTarget(project.id, wall.id); }, [project.id, wall?.id, editor.syncTarget]);
  useEffect(() => { if (!editor.camera) fit(); }, [editor.camera, fit]);
  useEffect(() => { setDraft(null); }, [editor.drawEnd, wall]);
  useEffect(() => () => useWallEditorStore.getState().finish(), []);
  const commit = useCallback(() => {
    if (draft && editor.extend(draft.length, draft.heading)) setDraft(null);
  }, [draft, editor.extend]);
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.closest('input, textarea, select, [contenteditable="true"]')) return;
      if (e.key === 'Escape') { e.preventDefault(); editor.finish(); }
      if (e.key === 'Enter' && editor.drawEnd && !(e.target as HTMLElement)?.closest('[role="button"], button')) { e.preventDefault(); commit(); }
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [editor.drawEnd, editor.finish, commit]);
  function local(clientX: number, clientY: number) {
    const bounds = svgRef.current!.getBoundingClientRect();
    return { x: clientX - bounds.left, y: clientY - bounds.top };
  }
  function move(e: React.PointerEvent<SVGSVGElement>) {
    const p = local(e.clientX, e.clientY);
    if (drag.current) {
      editor.setCamera({ ...camera, x: drag.current.panX + p.x - drag.current.x, y: drag.current.panY + p.y - drag.current.y });
      return;
    }
    if (!editor.drawEnd || !anchor) return;
    const dx = (p.x-camera.x)/camera.zoom - anchor.x, dz = (p.y-camera.y)/camera.zoom - anchor.z;
    setDraft({ length: Math.round(Math.hypot(dx,dz)/10)*10,
      heading: snapWallHeading(Math.atan2(-dz,dx), baseHeading, !e.altKey) });
  }
  function begin(end: WallEnd) { setDraft(null); editor.begin(end); }
  const activate = (fn: () => void) => (e: React.KeyboardEvent<SVGGElement>) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); fn(); }
  };
  let segmentNumber = 0;
  return <Box h="100%" style={{ display: 'flex', flexDirection: 'column', background: theme.canvasBg }}>
    <Group justify="space-between" px="md" py="xs" style={{ borderBottom: `1px solid ${theme.border}`, flexShrink: 0 }}>
      <div><Text size="sm" fw={600}>Стены · вид сверху</Text><Text size="xs" c="dimmed">
        {editor.drawEnd ? 'Клик — поставить стену · Esc — завершить · Alt — без привязок' : '+ — добавить участок · Жёлтая точка или угол в списке — изменить угол'}</Text></div>
      <Group gap={6}>
        <Button size="compact-xs" variant="subtle" aria-label="Показать всю цепочку" onClick={fit}><Maximize2 size={16}/></Button>
        {editor.drawEnd && <Button size="compact-xs" onClick={editor.finish}>Завершить</Button>}
      </Group>
    </Group>
    <Box ref={ref} style={{ flex: 1, minHeight: 0, position: 'relative' }}>
      {!wall && <Text p="xl" c="dimmed">Добавьте стену в левой панели.</Text>}
      <svg ref={svgRef} width={width} height={height} aria-label="План стен" style={{ display: 'block', touchAction: 'none', cursor: editor.drawEnd ? 'crosshair' : 'default' }}
        onPointerMove={move} onPointerLeave={() => { if (!drag.current) setDraft(null); }}
        onPointerUp={e => { if (drag.current) { drag.current = null; e.currentTarget.releasePointerCapture(e.pointerId); } }}
        onPointerCancel={() => { drag.current = null; }}
        onClick={() => { if (editor.drawEnd) commit(); }}
        onWheel={e => {
          e.preventDefault(); const p = local(e.clientX,e.clientY);
          const zoom = Math.max(0.005,Math.min(2,camera.zoom*(e.deltaY < 0 ? 1.12 : 1/1.12)));
          editor.setCamera({ zoom, x: p.x-(p.x-camera.x)*zoom/camera.zoom, y: p.y-(p.y-camera.y)*zoom/camera.zoom });
        }}>
        <defs><pattern id="wall-plan-grid" width={Math.max(20,500*camera.zoom)} height={Math.max(20,500*camera.zoom)} patternUnits="userSpaceOnUse" x={camera.x} y={camera.y}>
          <circle cx="1" cy="1" r="1" fill={theme.border}/></pattern></defs>
        <rect width="100%" height="100%" fill="url(#wall-plan-grid)" onPointerDown={e => {
          if (editor.drawEnd || e.button !== 0) return;
          editor.select(null); const p = local(e.clientX,e.clientY);
          drag.current = { ...p, panX: camera.x, panY: camera.y }; svgRef.current?.setPointerCapture(e.pointerId);
        }}/>
        {path?.pathSections.map(section => {
          const n = section.isBend ? 32 : 1, number = section.isBend ? null : ++segmentNumber;
          const points = Array.from({ length: n+1 }, (_,i) => screen(section.getPoint(section.sStart+(section.sEnd-section.sStart)*i/n,0)));
          const id = section.isBend ? section.bend!.id : section.id, kind = section.isBend ? 'corner' : 'segment';
          const selected = editor.selection?.id === id && editor.selection.kind === kind;
          const label = section.isBend ? `Угол ${Math.round(section.bend!.angleDeg)}°` : `Участок ${number}, длина ${Math.round(section.sEnd-section.sStart)} мм`;
          const midpoint = screen(section.getPoint((section.sStart+section.sEnd)/2,0));
          const vertical = Math.abs(Math.sin(section.startHeading)) > 0.7;
          const select = () => editor.select({ kind, id });
          return <g key={section.id} role="button" tabIndex={0} aria-label={label} onKeyDown={activate(select)}
            onClick={e => { if (editor.drawEnd) return; e.stopPropagation(); select(); }} style={{ cursor: editor.drawEnd ? 'crosshair' : 'pointer' }}>
            <polyline points={points.map(p=>`${p.x},${p.y}`).join(' ')} fill="none" stroke={selected ? '#228be6' : theme.textSecondary}
              strokeWidth={selected ? 13 : 10} strokeLinejoin="round" strokeLinecap="round"/>
            {!section.isBend && <text x={midpoint.x+(vertical ? 18 : 0)} y={midpoint.y+(vertical ? 4 : -18)} textAnchor={vertical ? 'start' : 'middle'} fontSize="12" fill={selected ? '#228be6' : theme.textPrimary}>
              {number} · {Math.round(section.sEnd-section.sStart)} мм</text>}
          </g>;
        })}
        {path?.corners.map(corner => {
          const p = screen(corner.point), selected = editor.selection?.kind === 'corner' && editor.selection.id === corner.bend.id;
          const select = () => editor.select({ kind: 'corner', id: corner.bend.id });
          const arc = Array.from({length: 25}, (_,i) => {
            const h = corner.incoming+(corner.outgoing-corner.incoming)*i/24;
            return `${p.x+42*Math.cos(h)},${p.y-42*Math.sin(h)}`;
          }).join(' ');
          return <g key={corner.bend.id} role="button" tabIndex={0} aria-label={`Выбрать угол ${Math.round(corner.bend.angleDeg)}°`}
            onKeyDown={activate(select)} onClick={e => { if (editor.drawEnd) return; e.stopPropagation(); select(); }} style={{ cursor: 'pointer' }}>
            <circle cx={p.x} cy={p.y} r={18} fill="transparent"/>
            <circle cx={p.x} cy={p.y} r={selected ? 9 : 7} fill={selected ? '#228be6' : '#f59f00'} stroke={theme.canvasBg} strokeWidth="2"/>
            {selected && <><line x1={p.x} y1={p.y} x2={p.x+55*Math.cos(corner.incoming)} y2={p.y-55*Math.sin(corner.incoming)} stroke="#228be6" strokeDasharray="3 3"/>
              <polyline points={arc} fill="none" stroke="#228be6" strokeWidth="1.5"/></>}
            <text x={p.x+14} y={p.y+23} fontSize="11" fill={theme.textPrimary}>{Math.round(corner.bend.angleDeg)}°{corner.bend.radius > 0 ? ` · R ${corner.bend.radius}` : ''}</text>
          </g>;
        })}
        {path && !editor.drawEnd && (['start','end'] as const).map(end => {
          const point = screen(end === 'start' ? path.startPoint : path.endPoint);
          const heading = end === 'start' ? path.startHeading+Math.PI : path.endHeading;
          const x = point.x+30*Math.cos(heading), y = point.y-30*Math.sin(heading);
          return <g key={end} role="button" tabIndex={0} aria-label={end === 'start' ? 'Продолжить с начала' : 'Продолжить с конца'}
            onKeyDown={activate(()=>begin(end))} onClick={e => { e.stopPropagation(); begin(end); }} style={{ cursor: 'pointer' }}>
            <circle cx={x} cy={y} r="17" fill={theme.bgCard} stroke="#228be6" strokeWidth="2"/>
            <path d={`M ${x-6} ${y} H ${x+6} M ${x} ${y-6} V ${y+6}`} stroke="#228be6" strokeWidth="2"/>
          </g>;
        })}
        {editor.drawEnd && preview && anchor && draft && (() => {
          const a = screen(anchor), b = screen(preview), valid = draft.length >= MIN_WALL_LENGTH;
          return <g pointerEvents="none"><line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke={valid ? '#228be6' : '#fa5252'} strokeWidth="8" strokeDasharray="10 6"/>
            <circle cx={b.x} cy={b.y} r="5" fill="#228be6"/>
            <rect x={b.x+12} y={b.y-32} width="195" height="27" rx="5" fill={theme.bgCard} stroke={theme.border}/>
            <text x={b.x+20} y={b.y-14} fontSize="12" fill={theme.textPrimary}>{draft.length} мм · поворот {Math.round(Math.abs(normalizeTurn(draft.heading-baseHeading))*180/Math.PI)}°</text>
          </g>;
        })()}
      </svg>
    </Box>
    <Text size="xs" c="dimmed" px="md" py={6}>Колесо — масштаб · перетаскивание фона — перемещение · Ctrl+Z / Ctrl+Shift+Z — отмена / повтор</Text>
  </Box>;
};
