import { isDoorOrPortal } from '../models/Opening';
import type { Wall } from '../models/Wall';
import type { WallPathSection, WallPoint } from './WallPath';

/** Shared tessellation keeps empty panels coplanar with their own curved wall surface. */
export function wallSurfaceSlices(sections: WallPathSection[], boundaries: number[] = []): number[] {
  const cuts = [...boundaries];
  for (const section of sections) {
    const steps = section.isBend ? 14 : 1;
    for (let i = 0; i <= steps; i++) cuts.push(section.sStart + (section.sEnd - section.sStart) * i / steps);
  }
  return [...new Set(cuts)].sort((a, b) => a - b);
}

/** Solid wall surfaces; an empty cladding panel does not make a hole in the wall. */
export function wallOcclusionFaces(wall: Pick<Wall, 'height' | 'openings'>,
  sections: WallPathSection[], thickness: number, boundaries: number[] = []): WallPoint[][] {
  const faces: WallPoint[][] = [];
  const cuts = wallSurfaceSlices(sections, [...boundaries,
    ...wall.openings.filter(op => op.isCutout !== false).flatMap(op => [op.x, op.x + op.width])]);
  for (const section of sections) {
    const sorted = cuts.filter(s => s >= section.sStart && s <= section.sEnd);
    for (let i = 0; i < sorted.length - 1; i++) {
      const s0 = sorted[i], s1 = sorted[i + 1], middle = (s0 + s1) / 2;
      for (const depth of [0, thickness]) {
        let intervals = [{ start: 0, end: wall.height }];
        for (const opening of wall.openings) {
          if (opening.isCutout === false || middle <= opening.x || middle >= opening.x + opening.width) continue;
          if (depth > 0 && opening.type !== 'WINDOW' && !isDoorOrPortal(opening)) continue;
          intervals = intervals.flatMap(interval => {
            const start = Math.max(interval.start, opening.y), end = Math.min(interval.end, opening.y + opening.height);
            if (start >= end) return [interval];
            return [{ start: interval.start, end: start }, { start: end, end: interval.end }]
              .filter(part => part.end > part.start);
          });
        }
        for (const interval of intervals) faces.push([
          section.getPoint(s0, interval.start, depth), section.getPoint(s1, interval.start, depth),
          section.getPoint(s1, interval.end, depth), section.getPoint(s0, interval.end, depth),
        ]);
      }
      for (const y of [0, wall.height]) {
        if (wall.openings.some(op => op.isCutout !== false && (op.type === 'WINDOW' || isDoorOrPortal(op)) &&
          middle > op.x && middle < op.x + op.width && op.y <= y && op.y + op.height >= y)) continue;
        faces.push([section.getPoint(s0, y, 0), section.getPoint(s1, y, 0),
          section.getPoint(s1, y, thickness), section.getPoint(s0, y, thickness)]);
      }
    }
  }
  for (const [section, s] of [[sections[0], sections[0]?.sStart],
    [sections[sections.length - 1], sections[sections.length - 1]?.sEnd]] as const) {
    if (!section) continue;
    faces.push([section.getPoint(s, 0, 0), section.getPoint(s, wall.height, 0),
      section.getPoint(s, wall.height, thickness), section.getPoint(s, 0, thickness)]);
  }
  return faces;
}
