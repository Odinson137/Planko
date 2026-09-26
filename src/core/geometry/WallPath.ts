import type { RadiusConfig, Wall, WallBend } from '../models/Wall';

export interface WallPoint { x: number; y: number; z: number }
export interface PathBend {
  id: string; sStart: number; sEnd: number; arcLen: number;
  radius: number; angleDeg: number; type: WallBend['type'];
}
export interface WallPathSection {
  id: string; sStart: number; sEnd: number; isBend: boolean; bend?: PathBend;
  startPoint: WallPoint; endPoint: WallPoint; startHeading: number; endHeading: number;
  centerPoint?: WallPoint; totalTurn?: number;
  getPoint: (s: number, y: number, depthOffset?: number) => WallPoint;
}
export interface WallPathCorner { bend: PathBend; point: WallPoint; incoming: number; outgoing: number }
export const bendLength = (b: Pick<WallBend, 'radius' | 'angleDeg'>) => Math.round(Math.PI * b.radius * (b.angleDeg ?? 90) / 180);
export const normalizeTurn = (angle: number) => Math.atan2(Math.sin(angle), Math.cos(angle));

/** Legacy column bends use the same trajectory as explicit wall bends. */
export function resolvePathBends(wall: Wall, panels: { id: string; x: number; radiusConfig?: RadiusConfig; arcLength?: number }[] = []): PathBend[] {
  const bends: PathBend[] = (wall.bends ?? []).map(b => ({ ...b, sStart: b.x,
    sEnd: b.x + bendLength(b), arcLen: bendLength(b) }));
  if (!bends.length) for (const p of panels) {
    if (!p.radiusConfig || bends.some(b => b.sStart === p.x)) continue;
    const angleDeg = p.radiusConfig.angleDeg ?? 90;
    const arcLen = p.arcLength ?? bendLength({ radius: p.radiusConfig.radius, angleDeg });
    bends.push({ ...p.radiusConfig, id: `legacy-${p.id}`, angleDeg, sStart: p.x, sEnd: p.x + arcLen, arcLen });
  }
  return bends.sort((a, b) => a.sStart - b.sStart);
}

/** Shared world-space trajectory for the plan, axonometric view and PDF. Y is height. */
export function buildWallPath(wall: Pick<Wall, 'width' | 'planPose'>, activeBends: PathBend[]) {
  const pathSections: WallPathSection[] = [], corners: WallPathCorner[] = [];
  const origin = wall.planPose ?? { x: 0, z: 0, heading: 0 };
  let point: WallPoint = { x: origin.x, y: 0, z: origin.z }, heading = origin.heading, distance = 0;
  let sectionId = 'start';
  const allPathPoints: WallPoint[] = [{ ...point }];
  function straight(end: number) {
    if (end <= distance + 0.00001) return;
    const start = { ...point }, angle = heading, sStart = distance, length = end - distance;
    const getPoint = (s: number, y: number, depth = 0): WallPoint => {
      const d = Math.max(0, Math.min(length, s - sStart));
      return { x: start.x + Math.cos(angle) * d - Math.sin(angle) * depth,
        y, z: start.z - Math.sin(angle) * d - Math.cos(angle) * depth };
    };
    point = getPoint(end, 0);
    pathSections.push({ id: sectionId, sStart, sEnd: end, isBend: false,
      startPoint: start, endPoint: point, startHeading: angle, endHeading: angle, getPoint });
    distance = end;
    allPathPoints.push(point);
  }
  for (const bend of [...activeBends].sort((a, b) => a.sStart - b.sStart)) {
    straight(bend.sStart);
    const start = { ...point }, incoming = heading;
    const sign = bend.type === 'INNER_CORNER' ? -1 : 1;
    const totalTurn = bend.angleDeg * Math.PI / 180, outgoing = incoming + sign * totalTurn;
    if (bend.radius > 0 && bend.arcLen > 0) {
      const center = { x: start.x - sign * Math.sin(incoming) * bend.radius, y: 0,
        z: start.z - sign * Math.cos(incoming) * bend.radius };
      const getPoint = (s: number, y: number, depth = 0): WallPoint => {
        const u = Math.max(0, Math.min(1, (s - bend.sStart) / bend.arcLen));
        const phi = incoming - sign * Math.PI / 2 + sign * u * totalTurn;
        const radius = depth === 0 ? bend.radius : Math.max(5, bend.radius - sign * depth);
        return { x: center.x + Math.cos(phi) * radius, y, z: center.z - Math.sin(phi) * radius };
      };
      point = getPoint(bend.sEnd, 0);
      pathSections.push({ id: `arc-${bend.id}`, sStart: bend.sStart, sEnd: bend.sEnd, isBend: true, bend,
        startPoint: start, endPoint: point, startHeading: incoming, endHeading: outgoing,
        centerPoint: center, totalTurn, getPoint });
      for (let i = 1; i <= 32; i++) allPathPoints.push(getPoint(bend.sStart + bend.arcLen * i / 32, 0));
    }
    corners.push({ bend, point: start, incoming, outgoing });
    heading = outgoing;
    distance = bend.sEnd;
    sectionId = `after-${bend.id}`;
  }
  straight(wall.width);
  const getPointAtS = (s: number, y = 0, depthOffset = 0): WallPoint => {
    const clamped = Math.max(0, Math.min(wall.width, s));
    const section = pathSections.find(sec => clamped >= sec.sStart && clamped <= sec.sEnd) ?? pathSections[pathSections.length - 1];
    return section ? section.getPoint(clamped, y, depthOffset) : { ...point, y };
  };
  return { pathSections, corners, allPathPoints, getPointAtS, endPoint: point, endHeading: heading,
    startPoint: { x: origin.x, y: 0, z: origin.z }, startHeading: origin.heading };
}

export function snapWallHeading(heading: number, base: number, enabled = true) {
  const turn = normalizeTurn(heading - base), step = Math.PI / 4;
  const snapped = Math.round(turn / step) * step;
  return enabled && Math.abs(turn - snapped) <= Math.PI / 60 ? base + snapped : heading;
}
