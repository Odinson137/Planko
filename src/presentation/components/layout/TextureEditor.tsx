import { getPieceTexture, getSchematicSheet } from '../../../core/textures/PieceTextures';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Button, Group, MultiSelect, NumberInput, ScrollArea, SegmentedControl, Stack, Text, Title } from '@mantine/core';
import { useProjectStore } from '../../../application/stores/useProjectStore';
import { LayoutCalculationResult } from '../../../core/layout/LayoutEngine';
import { Wall } from '../../../core/models/Wall';
import { sheetTexturePreview } from '../../../core/textures/PhotoTextures';
import { slopeTexturePiece, resolveTextureMapping, TexturedPiece, TextureMapping, textureFootprint, textureMappingError, pointOnSheet } from '../../../core/textures/TextureMapping';

type Target = TexturedPiece & { id: string; label: string };

export const TextureEditor: React.FC<{ wall: Wall; layout: LayoutCalculationResult }> = ({ wall, layout }) => {
  const { selectedPieceIds, selectedColumnIndex, selectedSegmentIndex, selectedSubPieceId, project, setTextureMappings } = useProjectStore();
  const targets = useMemo<Target[]>(() => [
    ...layout.panels.filter(p => !p.isVoid).map(p => ({ ...p, label: `${p.partLabel} · ${p.decorCode || 'без артикула'} · ${Math.round(p.width)}×${Math.round(p.height)}` })),
    ...(layout.slopes ?? []).map(p => ({ ...slopeTexturePiece(p), label: `${p.partLabel} · ${p.openingName}: ${p.sideLabel} · ${p.decorCode || 'без артикула'}` })),
  ], [layout]);
  const [ids, setIds] = useState<string[]>([]);
  const [draft, setDraft] = useState<TextureMapping>({ offsetX: 0, offsetY: 0, angleDeg: 0 });
  const [actionError, setActionError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const canvas = useRef<HTMLCanvasElement>(null);
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
  const active = targets.find(p => p.id === ids[0]);
  const selected = targets.filter(p => ids.includes(p.id));
  const activeKey = JSON.stringify([active?.id, active?.textureMapping, active?.patternAngleDeg, active?.width, active?.height]);
  useEffect(() => {
    if (active) setDraft(resolveTextureMapping(active));
    setActionError(null);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeKey]);
  const update = (patch: Partial<TextureMapping>) => { setDraft(d => ({ ...d, ...patch, anchor: undefined })); setSaved(false); };
  const previewPiece = active ? { ...active, textureMapping: draft, patternFlipX: false } : undefined;
  const photo = active && sheetTexturePreview(active.textureCategory, active.decorCode);
  const sw = active?.textureStockWidth ?? 1220, sh = active?.textureStockHeight ?? 2800;
  const footprint = textureFootprint(active?.width ?? 0, active?.height ?? 0, draft.angleDeg);
  const schematic = useMemo(() => active && !photo ? getSchematicSheet(active).toDataURL() : undefined,
    [active?.textureCategory, active?.materialColor, photo]);
  const errorTarget = selected.find(p => textureMappingError({ ...p, textureMapping: draft, patternFlipX: false }));
  const error = errorTarget ? `${errorTarget.label}: ${textureMappingError({ ...errorTarget, textureMapping: draft, patternFlipX: false })}` : undefined;
  useEffect(() => {
    const ctx = canvas.current?.getContext('2d');
    if (!ctx || !previewPiece) return;
    ctx.clearRect(0, 0, 280, 180);
    const texture = getPieceTexture(previewPiece);
    if (!texture) return;
    const scale = Math.min(280 / texture.width, 180 / texture.height);
    ctx.drawImage(texture, (280 - texture.width * scale) / 2, (180 - texture.height * scale) / 2, texture.width * scale, texture.height * scale);
    if (!photo) {
      ctx.save(); ctx.translate(140,90); ctx.rotate(draft.angleDeg*Math.PI/180);
      ctx.beginPath(); ctx.moveTo(0,28); ctx.lineTo(0,-28); ctx.moveTo(-9,-16); ctx.lineTo(0,-28); ctx.lineTo(9,-16);
      ctx.strokeStyle = '#fff'; ctx.lineWidth = 7; ctx.stroke();
      ctx.strokeStyle = '#1971c2'; ctx.lineWidth = 3; ctx.stroke(); ctx.restore();
    }
  }, [previewPiece]);

  return <ScrollArea h="100%" w={360} miw={360} style={{ borderLeft: '1px solid #dee2e6' }}><Stack p="md" gap="sm">
    <Title order={5}>Текстуры</Title>
    <Text size="xs" c="dimmed">Выберите деталь на стене. Shift + клик — несколько деталей. Откосы доступны в списке.</Text>
    <MultiSelect label="Панели и откосы" searchable clearable value={ids} onChange={setIds}
      data={targets.map(p => ({ value: p.id, label: p.label }))} />
    {!active && <Text size="sm">Выберите деталь, чтобы настроить участок исходного листа.</Text>}
    {active && <>
      <Text size="sm" fw={600}>{active.decorCode} · Лист {sw} × {sh} мм</Text>
      <Text size="xs" c="dimmed">Размер листа взят из каталога. Направление и участок можно настроить независимо от наличия фотографии.</Text>
      {!photo && <Alert color="blue">Фотографии нет — показан условный рисунок. Поворот и отступы сохраняются и учитываются при раскрое.</Alert>}
      {<>
        <Text size="xs">Перетащите рамку или задайте отступы от левого верхнего угла листа.</Text>
        <svg aria-label="Участок рисунка на исходном листе" role="img" viewBox={`0 0 ${sw} ${sh}`} style={{ height: 300, width: '100%', touchAction: 'none', cursor: 'crosshair' }}
          onPointerDown={e => { e.currentTarget.setPointerCapture(e.pointerId); const rect = e.currentTarget.getBoundingClientRect();
            // SVG uses a centred, aspect-preserving viewport.
            const scale = Math.min(rect.width / sw, rect.height / sh);
            const x = (e.clientX - rect.left - (rect.width - sw * scale) / 2) / scale;
            const y = (e.clientY - rect.top - (rect.height - sh * scale) / 2) / scale;
            update({ offsetX: Math.round(Math.max(0, Math.min(sw - footprint.width, x - footprint.width / 2))), offsetY: Math.round(Math.max(0, Math.min(sh - footprint.height, y - footprint.height / 2))) }); }}
          onPointerMove={e => { if (!e.currentTarget.hasPointerCapture(e.pointerId)) return; const rect = e.currentTarget.getBoundingClientRect();
            const scale = Math.min(rect.width / sw, rect.height / sh);
            update({ offsetX: Math.round(Math.max(0, Math.min(sw - footprint.width, (e.clientX - rect.left - (rect.width - sw * scale) / 2) / scale - footprint.width / 2))),
              offsetY: Math.round(Math.max(0, Math.min(sh - footprint.height, (e.clientY - rect.top - (rect.height - sh * scale) / 2) / scale - footprint.height / 2))) }); }}>
          <image href={photo || schematic} width={sw} height={sh} preserveAspectRatio="none" />
          <rect x={draft.offsetX} y={draft.offsetY} width={footprint.width} height={footprint.height} fill="none" strokeDasharray="30 20" stroke={error ? '#e03131' : '#228be6'} strokeWidth={20} />
          <polygon points={[[0,0],[active.width,0],[active.width,active.height],[0,active.height]].map(([x,y]) => {
            const p = pointOnSheet(x,y,active.width,active.height,draft.angleDeg);
            return `${draft.offsetX+p.x},${draft.offsetY+p.y}`;
          }).join(' ')} fill="#228be622" stroke={error ? '#e03131' : '#228be6'} strokeWidth={12} />
        </svg>
        <Group grow><NumberInput label="Отступ слева, мм" min={0} value={draft.offsetX} onChange={v => update({ offsetX: Number(v) || 0 })} />
          <NumberInput label="Отступ сверху, мм" min={0} value={draft.offsetY} onChange={v => update({ offsetY: Number(v) || 0 })} /></Group>
        <Text size="xs">Поворот рисунка на детали</Text>
        <SegmentedControl value={String(draft.angleDeg)} onChange={v => update({ angleDeg: Number(v) })} data={[0, 90, 180, 270].map(v => ({ value: String(v), label: `${v}°` }))} />
        <NumberInput label="Произвольный угол, °" value={draft.angleDeg} decimalScale={2} step={1}
          onChange={v => update({ angleDeg: Number(v) || 0 })} />
        {active.patternFlipX && <Alert color="yellow">В старом проекте включено зеркалирование. При применении оно будет снято: для зеркального рисунка нужен отдельный заводской вариант.</Alert>}
        <Text size="xs">{photo ? 'Предпросмотр детали' : 'Условный предпросмотр детали'} · {draft.angleDeg}°</Text><canvas ref={canvas} width={280} height={180} style={{ maxWidth: '100%' }} />
        {(error || actionError) && <Alert color="red">{error || actionError}</Alert>}
        <Text size="xs" c="dimmed">Участок сохраняется при раскрое. Перекрывающиеся участки потребуют отдельных листов. Между деталями учитывается пропил 4 мм.</Text>
        <Group grow><Button variant="default" onClick={() => update({ offsetX: 0, offsetY: 0, angleDeg: 0 })}>Сбросить</Button>
          <Button disabled={!!error || !selected.length} onClick={() => { try { setTextureMappings(wall.id, selected.map(p => ({ id: p.id, mapping: draft }))); setSaved(true); setActionError(null); } catch (e) { setActionError(e instanceof Error ? e.message : 'Не удалось применить настройки.'); } }}>Применить ({selected.length})</Button></Group>
        {saved && <Text c="teal" size="sm">Настройки применены.</Text>}
      </>}
    </>}
  </Stack></ScrollArea>;
};
