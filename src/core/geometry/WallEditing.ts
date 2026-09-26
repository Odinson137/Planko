import type { Wall, WallBend, WallJointLine, WallPanelPiece } from '../models/Wall';
import { MATERIAL_NONE_ID } from '../models/Material';
import { bendLength, buildWallPath, normalizeTurn, resolvePathBends, type WallPathSection, type WallPoint } from './WallPath';

export type WallEnd = 'start' | 'end';
export const MIN_WALL_LENGTH = 100;
const EPS = 0.01;
const uid = () => globalThis.crypto.randomUUID();
const voidPanel = (p: WallPanelPiece) => p.isVoid || p.materialId === MATERIAL_NONE_ID;
const range = (points: { x: number; y: number }[]) => ({ min: Math.min(...points.map(p => p.x)), max: Math.max(...points.map(p => p.x)) });
const rectangle = (x: number, y: number, width: number, height: number) =>
  [{ x, y }, { x: x + width, y }, { x: x + width, y: y + height }, { x, y: y + height }];
function blank(x: number, y: number, width: number, height: number): WallPanelPiece {
  return { id: `wall-void-${uid()}`, points: rectangle(x, y, width, height), materialId: MATERIAL_NONE_ID, isVoid: true, partLabel: 'ПУСТО' };
}

const uuidPattern = '[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}';
const automaticBlankId = new RegExp(`^wall-void-${uuidPattern}(?:-${uuidPattern})*$`, 'i');
const blankFields = new Set(['id', 'points', 'materialId', 'isVoid', 'partLabel']);
function automaticBlankBounds(panel: WallPanelPiece) {
  // Includes strips made by previous versions, but excludes manual cuts and any
  // material, notes, texture or edge settings subsequently assigned by the user.
  if (!automaticBlankId.test(panel.id) || panel.materialId !== MATERIAL_NONE_ID || !panel.isVoid || panel.partLabel !== 'ПУСТО' ||
    Object.entries(panel).some(([key, value]) => !blankFields.has(key) && value !== undefined) || panel.points.length < 4) return null;
  const { min: left, max: right } = range(panel.points);
  const bottom = Math.min(...panel.points.map(p => p.y)), top = Math.max(...panel.points.map(p => p.y));
  if (right-left <= EPS || top-bottom <= EPS) return null;
  let area = 0;
  for (let i=0; i<panel.points.length; i++) {
    const a=panel.points[i], b=panel.points[(i+1)%panel.points.length];
    if ((Math.abs(a.x-left)>EPS && Math.abs(a.x-right)>EPS) || (Math.abs(a.y-bottom)>EPS && Math.abs(a.y-top)>EPS)) return null;
    area += a.x*b.y-b.x*a.y;
  }
  if (Math.abs(Math.abs(area)/2-(right-left)*(top-bottom)) > EPS) return null;
  return { left, right, bottom, top };
}

/** Coalesce only untouched generated rectangles inside this corner's arc. */
function coalesceCornerBlanks(wall: Wall, bend: WallBend): Wall {
  const end = bend.x+bendLength(bend);
  const candidates = (wall.panels ?? []).flatMap(panel => {
    const bounds = automaticBlankBounds(panel);
    if (!bounds || bounds.left < bend.x-EPS || bounds.right > end+EPS ||
      Object.keys(wall.customJoints).some(key => key.includes(panel.id))) return [];
    return [{ panel, ...bounds }];
  }).sort((a,b) => a.bottom-b.bottom || a.top-b.top || a.left-b.left);
  const replacements = new Map<string, WallPanelPiece>(), removed = new Set<string>();
  let previous: typeof candidates[number] | undefined;
  for (const candidate of candidates) {
    const seam = candidate.left;
    const hasJoint = wall.joints?.some(j => {
      const dx = j.p2.x-j.p1.x;
      if (Math.abs(dx) < EPS) return Math.abs(j.p1.x-seam) < EPS &&
        Math.max(j.p1.y,j.p2.y) > candidate.bottom+EPS && Math.min(j.p1.y,j.p2.y) < candidate.top-EPS;
      const t = (seam-j.p1.x)/dx, y = j.p1.y+t*(j.p2.y-j.p1.y);
      return t >= 0 && t <= 1 && y > candidate.bottom+EPS && y < candidate.top-EPS;
    });
    if (previous && Math.abs(previous.right-seam)<EPS && Math.abs(previous.bottom-candidate.bottom)<EPS &&
      Math.abs(previous.top-candidate.top)<EPS && !hasJoint) {
      previous = { ...previous, right: candidate.right };
      replacements.set(previous.panel.id, { ...previous.panel,
        points: rectangle(previous.left, previous.bottom, previous.right-previous.left, previous.top-previous.bottom) });
      removed.add(candidate.panel.id);
    } else previous = candidate;
  }
  return removed.size ? { ...wall, panels: wall.panels!.filter(p => !removed.has(p.id)).map(p => replacements.get(p.id) ?? p) } : wall;
}

function clip(points: WallPanelPiece['points'], coordinate: 'x' | 'y', value: number, below: boolean) {
  const out: typeof points = [];
  for (let i = 0; i < points.length; i++) {
    const a = points[i], b = points[(i + 1) % points.length];
    const insideA = below ? a[coordinate] <= value : a[coordinate] >= value;
    const insideB = below ? b[coordinate] <= value : b[coordinate] >= value;
    if (insideA) out.push({ ...a });
    if (insideA !== insideB) {
      const t = (value - a[coordinate]) / (b[coordinate] - a[coordinate]);
      out.push({ x: a.x + t * (b.x - a.x), y: a.y + t * (b.y - a.y) });
    }
  }
  return out;
}
function translatePanel(p: WallPanelPiece, dx: number): WallPanelPiece {
  return { ...p, points: p.points.map(pt => ({ ...pt, x: pt.x + dx })),
    ...(p.textureMapping?.anchor ? { textureMapping: { ...p.textureMapping, anchor: { ...p.textureMapping.anchor, x: p.textureMapping.anchor.x + dx } } } : {}) };
}

function clipJoint(joint: WallJointLine, boundary: number, below: boolean): WallJointLine | null {
  const inside = (x: number) => below ? x <= boundary : x >= boundary;
  const a = inside(joint.p1.x), b = inside(joint.p2.x);
  if (!a && !b) return null;
  if (a && b) return joint;
  const ratio = (boundary - joint.p1.x) / (joint.p2.x - joint.p1.x);
  const point = { x: boundary, y: joint.p1.y + ratio * (joint.p2.y - joint.p1.y) };
  return { ...joint, p1: a ? joint.p1 : point, p2: b ? joint.p2 : point };
}

/** Replace [from, to] by an empty strip. Deletion also removes objects wholly inside it. */
function spliceSurface(wall: Wall, from: number, to: number, length: number, deleting = false): Wall {
  const delta = length - (to - from);
  if (Math.abs(delta) < EPS) return wall;
  const removed = to > from + EPS;
  const touches = (min: number, max: number) => removed
    ? max > from + EPS && min < to - EPS
    : min < from - EPS && max > from + EPS;
  const contained = (min: number, max: number) => min >= from - EPS && max <= to + EPS;
  const openings = wall.openings.filter(op => !deleting || !contained(op.x, op.x + op.width));
  if (openings.some(op => touches(op.x, op.x + op.width)))
    throw new Error('Изменение затрагивает проём. Сначала переместите его в пределах участка.');
  const panels: WallPanelPiece[] = [];
  for (const p of wall.panels ?? []) {
    const bounds = range(p.points);
    if (deleting && contained(bounds.min, bounds.max)) continue;
    if (bounds.min >= to - EPS) { panels.push(translatePanel(p, delta)); continue; }
    if (bounds.max <= from + EPS) { panels.push(p); continue; }
    if (!voidPanel(p)) throw new Error('Изменение затрагивает готовую деталь. Сначала измените её раскладку.');
    const left = clip(p.points, 'x', from, true), right = clip(p.points, 'x', to, false);
    if (left.length >= 3 && range(left).max - range(left).min > EPS) panels.push({ ...p, points: left });
    if (right.length >= 3 && range(right).max - range(right).min > EPS)
      panels.push(translatePanel({ ...p, id: `${p.id}-${uid()}`, points: right }, delta));
  }
  if (length > EPS) panels.push(blank(from, 0, length, wall.height));
  const customJoints = { ...wall.customJoints };
  const sourceJoints = deleting ? wall.joints?.flatMap(j => {
    const parts = [from > EPS ? clipJoint(j, from, true) : null, to < wall.width - EPS ? clipJoint(j, to, false) : null]
      .filter((part): part is WallJointLine => !!part && Math.hypot(part.p2.x-part.p1.x, part.p2.y-part.p1.y) > EPS);
    if (!parts.length) delete customJoints[j.id];
    return parts.map((part, i) => {
      if (i === 0) return part;
      const id = `${j.id}-${uid()}`;
      if (customJoints[j.id]) customJoints[id] = { ...customJoints[j.id], id };
      return { ...part, id };
    });
  }) : wall.joints;
  const joints = sourceJoints?.map(j => {
    const min = Math.min(j.p1.x, j.p2.x), max = Math.max(j.p1.x, j.p2.x);
    if (touches(min, max) || (removed && min > from + EPS && max < to - EPS))
      throw new Error('Изменение затрагивает стык. Сначала измените его положение.');
    return min >= to - EPS ? { ...j, p1: { ...j.p1, x: j.p1.x + delta }, p2: { ...j.p2, x: j.p2.x + delta } } : j;
  });
  return { ...wall, width: wall.width + delta, panels, joints, customJoints,
    openings: openings.map(op => op.x >= to - EPS ? { ...op, x: op.x + delta } : op),
    bends: wall.bends?.map(b => b.x >= to - EPS ? { ...b, x: b.x + delta } : b) };
}

export function validateWallPath(wall: Wall) {
  if (wall.planPose && !Object.values(wall.planPose).every(Number.isFinite)) throw new Error('Некорректное положение стены на плане.');
  if (!Number.isFinite(wall.width) || wall.width < MIN_WALL_LENGTH || wall.width > 1e6)
    throw new Error('Длина цепочки должна быть от 100 до 1 000 000 мм.');
  const bends = resolvePathBends(wall);
  let previousEnd = 0;
  for (const b of bends) {
    if (![b.sStart, b.radius, b.angleDeg].every(Number.isFinite) || b.radius < 0 || b.angleDeg <= 0 || b.angleDeg >= 180 ||
      b.sStart < previousEnd - EPS || b.sEnd > wall.width + EPS)
      throw new Error('Углы или скругления перекрываются либо выходят за пределы стены.');
    previousEnd = b.sEnd;
  }
  const path = buildWallPath(wall, bends);
  const points: WallPoint[] = [path.startPoint];
  for (const section of path.pathSections) {
    const count = section.isBend ? 48 : 1;
    for (let i = 1; i <= count; i++) points.push(section.getPoint(section.sStart + (section.sEnd - section.sStart) * i / count, 0));
  }
  const cross = (a: WallPoint, b: WallPoint, c: WallPoint) => (b.x-a.x)*(c.z-a.z) - (b.z-a.z)*(c.x-a.x);
  const on = (a: WallPoint, b: WallPoint, c: WallPoint) => Math.abs(cross(a,b,c)) < EPS &&
    c.x >= Math.min(a.x,b.x)-EPS && c.x <= Math.max(a.x,b.x)+EPS && c.z >= Math.min(a.z,b.z)-EPS && c.z <= Math.max(a.z,b.z)+EPS;
  for (let i = 0; i < points.length - 1; i++) for (let j = i + 2; j < points.length - 1; j++) {
    const a = points[i], b = points[i+1], c = points[j], d = points[j+1];
    if ((cross(a,b,c)*cross(a,b,d) < 0 && cross(c,d,a)*cross(c,d,b) < 0) || on(a,b,c) || on(a,b,d) || on(c,d,a) || on(c,d,b))
      throw new Error('Участки пересекаются или замыкаются. В этом режиме поддерживается открытая цепочка стен.');
  }
}

export function extendWall(wall: Wall, end: WallEnd, length: number, outwardHeading: number): Wall {
  if (!Number.isFinite(length) || length < MIN_WALL_LENGTH || !Number.isFinite(outwardHeading))
    throw new Error('Длина нового участка должна быть не меньше 100 мм.');
  const path = buildWallPath(wall, resolvePathBends(wall));
  const incoming = end === 'end' ? path.endHeading : outwardHeading + Math.PI;
  const outgoing = end === 'end' ? outwardHeading : path.startHeading;
  const turn = normalizeTurn(outgoing - incoming);
  if (Math.abs(turn) > Math.PI * 179 / 180) throw new Error('Новая стена не должна идти обратно по предыдущей.');
  let next = spliceSurface(wall, end === 'end' ? wall.width : 0, end === 'end' ? wall.width : 0, length);
  if (Math.abs(turn) > 0.00001) {
    const bend: WallBend = { id: `bend-${uid()}`, x: end === 'end' ? wall.width : length,
      radius: 0, angleDeg: Math.round(Math.abs(turn) * 180 / Math.PI * 1e8) / 1e8, type: turn < 0 ? 'INNER_CORNER' : 'OUTER_CORNER' };
    next = { ...next, bends: [...(next.bends ?? []), bend].sort((a,b) => a.x-b.x) };
  }
  if (end === 'start') next = { ...next, planPose: {
    x: path.startPoint.x + Math.cos(outwardHeading) * length,
    z: path.startPoint.z - Math.sin(outwardHeading) * length, heading: incoming } };
  validateWallPath(next);
  return next;
}

export function resizeWallSection(wall: Wall, sectionId: string, length: number): Wall {
  if (!Number.isFinite(length) || length < MIN_WALL_LENGTH) throw new Error('Длина участка должна быть не меньше 100 мм.');
  const section = buildWallPath(wall, resolvePathBends(wall)).pathSections.find(s => s.id === sectionId && !s.isBend);
  if (!section) throw new Error('Выберите прямой участок стены.');
  const delta = length - (section.sEnd - section.sStart);
  const next = delta >= 0 ? spliceSurface(wall, section.sEnd, section.sEnd, delta)
    : spliceSurface(wall, section.sEnd + delta, section.sEnd, 0);
  validateWallPath(next);
  return next;
}

/** Remove a straight section and its outgoing corner; the successor takes its place.
 * For the last section remove the incoming corner instead. Removing the first
 * keeps the surviving chain in world space. Null means the entire chain is gone.
 */
export function removeWallSection(wall: Wall, sectionId: string): Wall | null {
  const bends = resolvePathBends(wall), path = buildWallPath(wall, bends);
  const sections = path.pathSections.filter(s => !s.isBend);
  const index = sections.findIndex(s => s.id === sectionId);
  if (index < 0) throw new Error('Выберите прямой участок стены.');
  if (sections.length === 1) return null;
  const section = sections[index], following = sections[index+1];
  const incoming = bends.findIndex(b => `after-${b.id}` === section.id);
  const outgoing = following ? bends.findIndex(b => `after-${b.id}` === following.id) : -1;
  const from = index === 0 ? 0 : following ? section.sStart : bends[incoming].sStart;
  const to = following ? following.sStart : wall.width;
  const removedBends = new Set(bends.filter((_b, i) => following ? i > incoming && i <= outgoing : i >= incoming).map(b => b.id));
  let next = spliceSurface({ ...wall, bends: wall.bends?.filter(b => !removedBends.has(b.id)) }, from, to, 0, true);
  if (index === 0) next = { ...next, planPose: { x: following.startPoint.x, z: following.startPoint.z, heading: following.startHeading } };
  // Explicit bends supersede old per-panel/column radii. Do not revive a deleted corner.
  if (!next.bends?.length) next = { ...next, customPanels: {}, panels: next.panels?.map(p => ({ ...p, radiusConfig: undefined })) };
  validateWallPath(next);
  return next;
}

export function changeWallCorner(wall: Wall, bendId: string, patch: Pick<WallBend, 'angleDeg' | 'radius' | 'type'>): Wall {
  const bend = wall.bends?.find(b => b.id === bendId);
  if (!bend) throw new Error('Выберите угол стены.');
  if (!Number.isFinite(patch.angleDeg) || patch.angleDeg < 1 || patch.angleDeg > 179 || !Number.isFinite(patch.radius) || patch.radius < 0)
    throw new Error('Укажите угол от 1° до 179° и неотрицательный радиус.');
  const end = bend.x + bendLength(bend), delta = bendLength(patch) - bendLength(bend);
  let next = delta >= 0 ? spliceSurface(wall, end, end, delta) : spliceSurface(wall, end + delta, end, 0);
  next = { ...next, bends: next.bends?.map(b => b.id === bendId ? { ...bend, ...patch } : b) };
  next = coalesceCornerBlanks(next, { ...bend, ...patch });
  validateWallPath(next);
  return next;
}

/** Straighten a corner without removing any unfolded surface or its contents. */
export function straightenWallCorner(wall: Wall, bendId: string): Wall {
  if (!wall.bends?.some(b => b.id === bendId)) throw new Error('Выберите угол стены.');
  let next = { ...wall, bends: wall.bends.filter(b => b.id !== bendId) };
  if (!next.bends.length) next = { ...next, customPanels: {}, panels: next.panels?.map(p => ({ ...p, radiusConfig: undefined })) };
  validateWallPath(next);
  return next;
}

export function resizeWallHeight(wall: Wall, height: number): Wall {
  if (!Number.isFinite(height) || height < 100 || height > 20000) throw new Error('Высота должна быть от 100 до 20 000 мм.');
  if (height === wall.height) return wall;
  if (wall.openings.some(op => op.y + op.height > height + EPS)) throw new Error('Проём выходит за новую высоту стены.');
  if (wall.panels?.some(p => !voidPanel(p) && p.points.some(pt => pt.y > height + EPS)))
    throw new Error('Уменьшение высоты затрагивает готовую деталь. Сначала измените раскладку.');
  if (wall.joints?.some(j => j.p1.y > height + EPS || j.p2.y > height + EPS)) throw new Error('Стык выходит за новую высоту стены.');
  const panels = height > wall.height ? [...(wall.panels ?? []), blank(0, wall.height, wall.width, height - wall.height)]
    : (wall.panels ?? []).map(p => ({ ...p, points: clip(p.points, 'y', height, true) }))
      .filter(p => p.points.length >= 3 && Math.max(...p.points.map(pt => pt.y)) - Math.min(...p.points.map(pt => pt.y)) > EPS);
  return { ...wall, height, panels };
}

export const straightSections = (wall: Wall): WallPathSection[] => buildWallPath(wall, resolvePathBends(wall)).pathSections.filter(s => !s.isBend);
