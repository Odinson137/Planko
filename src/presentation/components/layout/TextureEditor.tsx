import { getPieceTexture, getSchematicSheet } from '../../../core/textures/PieceTextures';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Button, Group, MultiSelect, NumberInput, ScrollArea, SegmentedControl, Stack, Switch, Text, Title } from '@mantine/core';
import { useProjectStore } from '../../../application/stores/useProjectStore';
import { LayoutCalculationResult } from '../../../core/layout/LayoutEngine';
import { Wall } from '../../../core/models/Wall';
import { sheetTexturePreview } from '../../../core/textures/PhotoTextures';
import { slopeTexturePiece, resolveTextureMapping, TexturedPiece, TextureMapping, textureFootprint, textureMappingError, texturePieceOutline, textureSheetOutline } from '../../../core/textures/TextureMapping';
import { polygonsSeparated } from '../../../core/geometry/PolygonCollision';

type Target = TexturedPiece & { id: string; label: string; partLabel: string; materialId: string; thickness?: number };

export const TextureEditor: React.FC<{ wall: Wall; layout: LayoutCalculationResult }> = ({ wall, layout }) => {
  const { selectedPieceIds, selectedColumnIndex, selectedSegmentIndex, selectedSubPieceId, project, setTextureMappings } = useProjectStore();
  const targets = useMemo<Target[]>(() => [
    ...layout.panels.filter(p => !p.isVoid).map(p => ({ ...p, label: `${p.partLabel} · ${p.decorCode || 'без артикула'} · ${Math.round(p.width)}×${Math.round(p.height)}` })),
    ...(layout.slopes ?? []).map(p => ({ ...slopeTexturePiece(p), label: `${p.partLabel} · ${p.openingName}: ${p.sideLabel} · ${p.decorCode || 'без артикула'}` })),
  ], [layout]);
  const [ids, setIds] = useState<string[]>([]);
  const [activeId, setActiveId] = useState<string>();
  const [isFixed, setIsFixed] = useState(false);
  const [pieceDrafts, setPieceDrafts] = useState<Record<string, TextureMapping>>({});
  const [actionError, setActionError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const canvas = useRef<HTMLCanvasElement>(null);
  const drag = useRef<{ id: string; dx: number; dy: number }>();
  const selectionKey = JSON.stringify([selectedPieceIds, selectedColumnIndex, selectedSegmentIndex, selectedSubPieceId, project.selectedOpeningId, wall.id]);
  useEffect(() => {
    let next = layout.panels.filter(p => selectedPieceIds.includes(p.id) || p.subPieceId === selectedSubPieceId && !!selectedSubPieceId);
    if (!next.length && selectedColumnIndex !== null) next = layout.panels.filter(p => p.originalColumnIndex === selectedColumnIndex && p.originalSegmentIndex === (selectedSegmentIndex ?? 0));
    const nextIds = project.selectedOpeningId
      ? (layout.slopes ?? []).filter(p => p.openingId === project.selectedOpeningId).map(p => p.id)
      : next.map(p => p.id);
    setIds(nextIds);
    setSaved(false);
  // Selection changes, rather than every geometry recalculation, drive the target picker.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectionKey]);
  const selected = targets.filter(p => ids.includes(p.id));
  const active = selected.find(p => p.id === activeId) ?? selected[0];
  const draftsKey = JSON.stringify([wall.id, selected.map(p => [p.id, p.textureMapping, p.patternAngleDeg, p.x, p.y, p.width, p.height])]);
  useEffect(() => {
    setPieceDrafts(Object.fromEntries(selected.map(p => [p.id, resolveTextureMapping(p)])));
    setActiveId(current => selected.some(p => p.id === current) ? current : selected[0]?.id);
    setIsFixed(active?.textureMapping?.enabled ?? false);
    setActionError(null);
    drag.current = undefined;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draftsKey]);
  const draftFor = (piece: Target) => pieceDrafts[piece.id] ?? resolveTextureMapping(piece);
  const draft = active ? draftFor(active) : { offsetX: 0, offsetY: 0, angleDeg: 0 };
  const updatePiece = (id: string, patch: Partial<TextureMapping>) => {
    const target = selected.find(p => p.id === id);
    if (!isFixed || !target) return;
    setPieceDrafts(d => ({ ...d, [id]: { ...(d[id] ?? resolveTextureMapping(target)), ...patch, anchor: undefined } }));
    setActionError(null);
    setSaved(false);
  };
  const update = (patch: Partial<TextureMapping>) => { if (active) updatePiece(active.id, patch); };
  const previewPiece = active ? { ...active, textureMapping: draft, patternFlipX: false } : undefined;
  const photo = active && sheetTexturePreview(active.textureCategory, active.decorCode);
  const sw = active?.textureStockWidth ?? 1220, sh = active?.textureStockHeight ?? 2800;
  const schematic = useMemo(() => active && !photo ? getSchematicSheet(active).toDataURL() : undefined,
    [active?.textureCategory, active?.materialColor, photo]);
  const errorTarget = selected.find(p => textureMappingError({ ...p, textureMapping: draftFor(p), patternFlipX: false }));
  const error = errorTarget ? `${errorTarget.label}: ${textureMappingError({ ...errorTarget, textureMapping: draftFor(errorTarget), patternFlipX: false })}` : undefined;
  // Only compatible source sheets can be previewed together. The picker still retains every draft.
  const onSheet = selected.filter(p => p.materialId === active?.materialId && p.decorCode === active.decorCode &&
    p.textureCategory === active.textureCategory && p.thickness === active.thickness &&
    (p.textureStockWidth ?? 1220) === sw && (p.textureStockHeight ?? 2800) === sh);
  const outlines = onSheet.map(p => ({ piece: p, points: textureSheetOutline({ ...p, textureMapping: draftFor(p) }) }));
  const collisions = new Set<string>();
  outlines.forEach((a, i) => outlines.slice(i + 1).forEach(b => {
    if (!polygonsSeparated(a.points, b.points, 0) || active?.materialType === 'SLAT' &&
      Math.min(...a.points.map(p => p.y)) < Math.max(...b.points.map(p => p.y)) &&
      Math.min(...b.points.map(p => p.y)) < Math.max(...a.points.map(p => p.y))) {
      collisions.add(a.piece.id); collisions.add(b.piece.id);
    }
  }));
  const sheetPoint = (e: React.PointerEvent<SVGSVGElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const scale = Math.min(rect.width / sw, rect.height / sh);
    return { x: (e.clientX - rect.left - (rect.width - sw * scale) / 2) / scale,
      y: (e.clientY - rect.top - (rect.height - sh * scale) / 2) / scale };
  };
  const toggleFixed = (checked: boolean) => {
    try {
      if (!checked) setTextureMappings(wall.id, selected.map(p => ({ id: p.id, mapping: { ...draftFor(p), enabled: false } })));
      setIsFixed(checked); setSaved(false); setActionError(null);
    } catch (e) { setActionError(e instanceof Error ? e.message : 'Не удалось применить настройки.'); }
  };
  useEffect(() => {
    const ctx = canvas.current?.getContext('2d');
    if (!ctx || !previewPiece) return;
    ctx.clearRect(0, 0, 280, 180);
    const texture = getPieceTexture(previewPiece);
    if (!texture) return;
    const scale = Math.min(280 / texture.width, 180 / texture.height);
    const left = (280 - texture.width * scale) / 2, top = (180 - texture.height * scale) / 2;
    const outline = texturePieceOutline(previewPiece).map(p => ({
      x: left + p.x / previewPiece.width * texture.width * scale,
      y: top + p.y / previewPiece.height * texture.height * scale,
    }));
    ctx.beginPath();
    outline.forEach((p, i) => i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y));
    ctx.closePath();
    ctx.save(); ctx.clip();
    ctx.drawImage(texture, left, top, texture.width * scale, texture.height * scale);
    if (!photo) {
      ctx.save(); ctx.translate(140,90); ctx.rotate(draft.angleDeg*Math.PI/180);
      ctx.beginPath(); ctx.moveTo(0,28); ctx.lineTo(0,-28); ctx.moveTo(-9,-16); ctx.lineTo(0,-28); ctx.lineTo(9,-16);
      ctx.strokeStyle = '#fff'; ctx.lineWidth = 7; ctx.stroke();
      ctx.strokeStyle = '#1971c2'; ctx.lineWidth = 3; ctx.stroke(); ctx.restore();
    }
    ctx.restore();
  }, [previewPiece]);

  return <ScrollArea h="100%" w={360} miw={360} style={{ borderLeft: '1px solid #dee2e6' }}><Stack p="md" gap="sm">
    <Title order={5}>Текстуры</Title>
    <Text size="xs" c="dimmed">Выберите деталь на стене. Shift + клик — несколько деталей. Откосы доступны в списке.</Text>
    <MultiSelect label="Панели и откосы" searchable clearable value={ids} onChange={next => { setIds(next); setSaved(false); }}
      data={targets.map(p => ({ value: p.id, label: p.label }))} />
    {!active && <Text size="sm">Выберите деталь, чтобы настроить участок исходного листа.</Text>}
    {active && <>
      <Text size="sm" fw={600}>{active.decorCode} · Лист {sw} × {sh} мм</Text>
      <Text size="xs" c="dimmed">Размер листа взят из каталога. Направление и участок можно настроить независимо от наличия фотографии.</Text>
      <Switch label="Фиксировать раскрой по текстуре" checked={isFixed} onChange={e => toggleFixed(e.currentTarget.checked)} />
      {!isFixed && <Alert color="blue">Автоматический раскрой: детали свободно компонуются для минимального расхода листов. Включите переключатель, если требуется строго зафиксировать узор текстуры на исходном листе.</Alert>}
      {actionError && <Alert color="red">{actionError}</Alert>}
      <Stack gap="sm" style={{ opacity: isFixed ? 1 : 0.4, pointerEvents: isFixed ? 'auto' : 'none' }}>
        {!photo && <Alert color="blue">Фотографии нет — показан условный рисунок. Поворот и отступы сохраняются и учитываются при раскрое.</Alert>}
        <Group gap="xs">{selected.map(p => <Button key={p.id} size="compact-xs" disabled={!isFixed}
          variant={p.id === active.id ? 'filled' : 'default'} aria-pressed={p.id === active.id}
          onClick={() => { setActiveId(p.id); setActionError(null); }}>[{p.partLabel}]</Button>)}</Group>
        {onSheet.length !== selected.length && <Text size="xs" c="dimmed">На листе показаны детали выбранного материала и формата. Для остальных выберите номер детали.</Text>}
        <Text size="xs">Перетащите активный контур или задайте отступы от левого верхнего угла. Выберите номер детали для переключения.</Text>
        <svg aria-label="Участок рисунка на исходном листе" role="img" viewBox={`0 0 ${sw} ${sh}`} style={{ height: 300, width: '100%', touchAction: 'none', cursor: 'crosshair' }}
          onPointerDown={e => {
            if (!isFixed || e.button !== 0) return;
            const id = (e.target as Element).closest('[data-piece-id]')?.getAttribute('data-piece-id');
            const piece = selected.find(p => p.id === id);
            if (!piece) return;
            setActiveId(piece.id);
            const point = sheetPoint(e), mapping = draftFor(piece);
            drag.current = { id: piece.id, dx: point.x - mapping.offsetX, dy: point.y - mapping.offsetY };
            e.currentTarget.setPointerCapture(e.pointerId);
          }}
          onPointerMove={e => {
            if (!isFixed || !drag.current || !e.currentTarget.hasPointerCapture(e.pointerId)) return;
            const piece = selected.find(p => p.id === drag.current!.id);
            if (!piece) return;
            const point = sheetPoint(e), footprint = textureFootprint(piece.width, piece.height, draftFor(piece).angleDeg);
            updatePiece(piece.id, { offsetX: Math.round(Math.max(0, Math.min(sw - footprint.width, point.x - drag.current.dx))),
              offsetY: Math.round(Math.max(0, Math.min(sh - footprint.height, point.y - drag.current.dy))) });
          }}
          onPointerUp={e => { drag.current = undefined; if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId); }}
          onPointerCancel={() => { drag.current = undefined; }}
          onLostPointerCapture={() => { drag.current = undefined; }}>
          <image href={photo || schematic} width={sw} height={sh} preserveAspectRatio="none" />
          {outlines.sort((a, b) => Number(a.piece.id === active.id) - Number(b.piece.id === active.id)).map(({ piece, points }) => {
            const current = piece.id === active.id;
            const invalid = !!textureMappingError({ ...piece, textureMapping: draftFor(piece), patternFlipX: false });
            const color = invalid || collisions.has(piece.id) ? '#fa5252' : current ? '#1971c2' : '#868e96';
            return <g key={piece.id} data-piece-id={piece.id} style={{ cursor: current ? 'grab' : 'pointer' }}>
              <polygon points={points.map(p => `${p.x},${p.y}`).join(' ')} fill={`${color}${current ? '33' : '11'}`}
                stroke={color} strokeWidth={12} strokeDasharray={current ? undefined : '36 24'} />
              <text x={(Math.min(...points.map(p => p.x)) + Math.max(...points.map(p => p.x))) / 2}
                y={(Math.min(...points.map(p => p.y)) + Math.max(...points.map(p => p.y))) / 2}
                textAnchor="middle" dominantBaseline="middle" fontSize={100} fontWeight={700}
                fill={color} stroke="white" strokeWidth={8} paintOrder="stroke">[{piece.partLabel}]</text>
            </g>;
          })}
        </svg>
        {isFixed && onSheet.length > 1 && <Alert color={collisions.size ? 'red' : error ? 'yellow' : 'teal'}>
          {collisions.size ? '⚠️ Детали перекрываются на листе — при раскрое они займут разные листы'
            : error ? 'Проверьте границы листа перед сохранением.' : '✅ Детали не пересекаются — они поместятся на один лист!'}</Alert>}
        <Group grow><NumberInput label="Отступ слева, мм" disabled={!isFixed} min={0} value={draft.offsetX} onChange={v => update({ offsetX: Number(v) || 0 })} />
          <NumberInput label="Отступ сверху, мм" disabled={!isFixed} min={0} value={draft.offsetY} onChange={v => update({ offsetY: Number(v) || 0 })} /></Group>
        <Text size="xs">Поворот рисунка на детали</Text>
        <SegmentedControl disabled={!isFixed} value={String(draft.angleDeg)} onChange={v => update({ angleDeg: Number(v) })} data={[0, 90, 180, 270].map(v => ({ value: String(v), label: `${v}°` }))} />
        <NumberInput label="Произвольный угол, °" disabled={!isFixed} value={draft.angleDeg} decimalScale={2} step={1}
          onChange={v => update({ angleDeg: Number(v) || 0 })} />
        {active.patternFlipX && <Alert color="yellow">В старом проекте включено зеркалирование. При применении оно будет снято: для зеркального рисунка нужен отдельный заводской вариант.</Alert>}
        <Text size="xs">{photo ? 'Предпросмотр детали' : 'Условный предпросмотр детали'} · {draft.angleDeg}°</Text><canvas ref={canvas} width={280} height={180} style={{ maxWidth: '100%' }} />
        {error && <Alert color="red">{error}</Alert>}
        <Text size="xs" c="dimmed">Участок сохраняется при раскрое. Перекрывающиеся участки потребуют отдельных листов.</Text>
        <Group grow><Button variant="default" disabled={!isFixed} onClick={() => update({ offsetX: 0, offsetY: 0, angleDeg: 0 })}>Сбросить</Button>
          <Button disabled={!isFixed || !!error || !selected.length} onClick={() => { try { setTextureMappings(wall.id, selected.map(p => ({ id: p.id, mapping: { ...draftFor(p), enabled: true } }))); setSaved(true); setActionError(null); } catch (e) { setActionError(e instanceof Error ? e.message : 'Не удалось применить настройки.'); } }}>Применить ({selected.length})</Button></Group>
        {saved && <Text c="teal" size="sm">Настройки применены.</Text>}
      </Stack>
    </>}
  </Stack></ScrollArea>;
};
