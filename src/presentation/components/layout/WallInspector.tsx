import React, { useMemo, useState } from 'react';
import { Accordion, Alert, Autocomplete, Badge, Button, Divider, Group, NumberInput, ScrollArea, SegmentedControl, Stack, Text, TextInput, Title } from '@mantine/core';
import { Trash2 } from 'lucide-react';
import { useProjectStore } from '../../../application/stores/useProjectStore';
import { useWallEditorStore } from '../../../application/stores/useWallEditorStore';
import { wallPlanBends } from '../../../application/services/WallEditing';
import { buildWallPath } from '../../../core/geometry/WallPath';
import type { WallBend } from '../../../core/models/Wall';
import { useAppTheme } from '../../theme/useAppTheme';

const ROOM_PRESETS = ['Гостиная', 'Спальня', 'Кухня', 'Прихожая', 'Коридор', 'Кабинет', 'Ванная', 'Детская', 'Гардеробная', 'Холл', 'Столовая', 'Мастер-спальня', 'Санузел', 'Лоджия', 'Офис'];
function WallDetailsForm({ name, roomName, rooms, apply }: {
  name: string; roomName: string; rooms: string[]; apply: (name: string, roomName: string) => void;
}) {
  const [draftName, setDraftName] = useState(name), [draftRoom, setDraftRoom] = useState(roomName);
  return <form onSubmit={e => { e.preventDefault(); apply(draftName, draftRoom); }}><Stack gap="xs">
    <TextInput label="Название стены" value={draftName} onChange={e => setDraftName(e.currentTarget.value)}/>
    <Autocomplete label="Помещение" value={draftRoom} onChange={setDraftRoom} data={rooms} clearable/>
    <Button size="xs" type="submit" disabled={!draftName.trim() || (draftName === name && draftRoom === roomName)}>Сохранить название и помещение</Button>
  </Stack></form>;
}

function DimensionForm({ label, value, min, max, apply }: { label: string; value: number; min: number; max?: number; apply: (value: number) => void }) {
  const [draft, setDraft] = useState<string | number>(Math.round(value*100)/100);
  return <form onSubmit={e => { e.preventDefault(); if (typeof draft === 'number') apply(draft); }}>
    <Stack gap="xs"><NumberInput label={label} value={draft} onChange={setDraft} min={min} max={max} step={10} decimalScale={2} clampBehavior="none"/>
      <Button size="xs" variant="light" type="submit" disabled={typeof draft !== 'number' || draft === value}>Применить</Button></Stack>
  </form>;
}
function CornerForm({ bend, apply }: { bend: WallBend; apply: (patch: Pick<WallBend, 'angleDeg' | 'radius' | 'type'>) => void }) {
  const [angle, setAngle] = useState<string | number>(Math.round(bend.angleDeg*100)/100);
  const [radius, setRadius] = useState<string | number>(bend.radius);
  const [type, setType] = useState(bend.type);
  return <form onSubmit={e => { e.preventDefault(); if (typeof angle === 'number' && typeof radius === 'number') apply({ angleDeg: angle, radius, type }); }}>
    <Stack gap="sm">
      <NumberInput label="Угол поворота, °" value={angle} onChange={setAngle} min={1} max={179} decimalScale={2} clampBehavior="none"/>
      <Text size="xs" c="dimmed">От продолжения предыдущего участка. Этот угол отмечен дугой на плане.</Text>
      <SegmentedControl value={type} onChange={value=>setType(value as WallBend['type'])} data={[
        { label: 'Влево', value: 'OUTER_CORNER' }, { label: 'Вправо', value: 'INNER_CORNER' },
      ]} size="xs"/>
      <NumberInput label="Радиус скругления, мм" value={radius} onChange={setRadius} min={0} decimalScale={2} clampBehavior="none"/>
      <Text size="xs" c="dimmed">0 мм — острый угол. Скругление добавляет длину дуги к развёртке.</Text>
      <Button size="xs" type="submit" disabled={typeof angle !== 'number' || typeof radius !== 'number'}>Применить угол</Button>
    </Stack>
  </form>;
}

export const WallInspector: React.FC = () => {
  const theme = useAppTheme(), project = useProjectStore(s => s.project), editor = useWallEditorStore();
  const wall = project.walls.find(w => w.id === project.selectedWallId);
  const path = useMemo(() => wall ? buildWallPath(wall, wallPlanBends(project, wall)) : null, [wall, project]);
  const segments = path?.pathSections.filter(s=>!s.isBend) ?? [];
  const selected = editor.selection?.kind === 'segment' ? segments.find(s=>s.id===editor.selection?.id) : null;
  const corner = editor.selection?.kind === 'corner' ? path?.corners.find(c=>c.bend.id===editor.selection?.id) : null;
  return <Stack h="100%" gap="xs" p="md" style={{ width: 300, minWidth: 300, background: theme.bgSidebar, borderLeft: `1px solid ${theme.border}` }}>
    <Group justify="space-between"><Title order={5}>Стены</Title><Badge variant="light">Вид сверху</Badge></Group>
    <ScrollArea offsetScrollbars style={{ flex: 1 }}><Stack gap="md">
      {editor.error && <Alert color="red" role="alert" title="Изменение не применено">{editor.error}</Alert>}
      {!wall && <Text size="sm">Выберите или добавьте стену. Удаление можно отменить кнопкой «Назад» в верхнем меню или Ctrl+Z.</Text>}
      {wall && <>
        <Text size="sm" fw={600}>{wall.name}</Text>
        <Text size="xs" c="dimmed">Участков: {segments.length} · развёртка {Math.round(wall.width)} мм</Text>
        {editor.drawEnd ? <><Text size="sm">Укажите конец новой стены на плане. После клика можно сразу строить следующую.</Text>
          <Button onClick={editor.finish}>Завершить построение</Button></> : <Group grow>
          <Button size="xs" variant="light" onClick={()=>editor.begin('start')}>+ В начале</Button>
          <Button size="xs" variant="light" onClick={()=>editor.begin('end')}>+ В конце</Button></Group>}
        <Divider/>
        {selected && <><Title order={6}>Участок {segments.indexOf(selected)+1}</Title>
          <DimensionForm key={`${wall.id}-${selected.id}-${selected.sEnd-selected.sStart}`} label="Длина участка, мм" value={selected.sEnd-selected.sStart} min={100} apply={value=>editor.resize(selected.id,value)}/>
          <Text size="xs" c="dimmed">Следующие участки сдвигаются, сохраняя длины и соединения.</Text>
          <Button size="xs" color="red" variant="light" leftSection={<Trash2 size={14}/>} onClick={()=>editor.remove(selected.id)}>Удалить участок</Button>
          <Text size="xs" c="dimmed">{segments.length === 1 ? 'Будет удалена вся цепочка.' :
            segments.indexOf(selected) === 0 ? 'Остальные участки останутся на прежних местах.' :
            segments.indexOf(selected) < segments.length-1 ? 'Следующий участок займёт его место, сохранив длину.' : 'Участок и примыкающий угол будут удалены.'}
            {' '}Отделка и проёмы на удаляемом участке тоже удалятся. Ctrl+Z — отменить.</Text></>}
        {corner && <><Title order={6}>Угол между участками</Title>
          <Text size="xs" c="dimmed">Измените угол и нажмите «Применить угол». Следующие участки повернутся, сохранив длины.</Text>
          <CornerForm key={`${corner.bend.id}-${corner.bend.angleDeg}-${corner.bend.radius}-${corner.bend.type}`}
            bend={{ id: corner.bend.id, x: corner.bend.sStart, radius: corner.bend.radius, angleDeg: corner.bend.angleDeg, type: corner.bend.type }}
            apply={patch=>editor.corner(corner.bend.id,patch)}/>
          <Button size="xs" variant="light" color="red" onClick={()=>editor.straighten(corner.bend.id)}>Убрать угол</Button>
          <Text size="xs" c="dimmed">Соседние участки объединятся в прямой. Длина развёртки и её содержимое сохранятся. Ctrl+Z — отменить.</Text></>}
        {!selected && !corner && !editor.drawEnd && <Text size="sm" c="dimmed">Выберите участок или угол на плане либо в списке ниже, чтобы изменить его.</Text>}
        <Divider label="Участки и углы"/>
        <Stack gap={4}>{segments.map((s,i)=>{
          const nextCorner = path?.corners.find(c=>Math.abs(c.bend.sStart-s.sEnd)<0.01);
          return <React.Fragment key={s.id}>
            <Button variant={selected?.id===s.id ? 'light' : 'subtle'} size="xs" justify="space-between"
              onClick={()=>editor.select({ kind:'segment', id:s.id })} rightSection={<Text size="xs">{Math.round(s.sEnd-s.sStart)} мм</Text>}>Участок {i+1}</Button>
            {nextCorner && <Button variant={corner?.bend.id===nextCorner.bend.id ? 'light' : 'subtle'} color="orange" size="xs" justify="space-between"
              onClick={()=>editor.select({ kind:'corner', id:nextCorner.bend.id })}
              rightSection={<Text size="xs">{Math.round(nextCorner.bend.angleDeg*100)/100}°{nextCorner.bend.radius > 0 ? ` · R ${nextCorner.bend.radius}` : ''}</Text>}>Угол после участка {i+1}</Button>}
          </React.Fragment>;
        })}</Stack>
        <Divider/>
        <DimensionForm key={`${wall.id}-${wall.height}`} label="Общая высота, мм" value={wall.height} min={100} max={20000} apply={editor.height}/>
        <Accordion variant="contained"><Accordion.Item value="details"><Accordion.Control>Название и помещение</Accordion.Control><Accordion.Panel>
          <WallDetailsForm key={`${wall.id}-${wall.name}-${wall.roomName}`} name={wall.name} roomName={wall.roomName ?? ''}
            rooms={Array.from(new Set([...project.walls.map(w=>w.roomName?.trim()).filter((r): r is string=>!!r), ...ROOM_PRESETS]))}
            apply={editor.details}/>
        </Accordion.Panel></Accordion.Item></Accordion>
        <Text size="xs" c="dimmed">Открытая цепочка стен. Пересечения и замыкание контура пока недоступны.</Text>
      </>}
    </Stack></ScrollArea>
  </Stack>;
};
