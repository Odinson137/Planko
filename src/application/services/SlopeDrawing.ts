import type { CalculatedSlopePiece } from '../../core/layout/LayoutEngine';
import type { Opening, SlopeJointId } from '../../core/models/Opening';
import { type CalculatedSlopeJoint, slopeJointHasProfile } from '../../core/geometry/SlopeJointGeometry';
import { getPieceTexture } from '../../core/textures/PieceTextures';
import { drawTextureFace } from '../../core/textures/PhotoTextures';
import { slopeTexturePiece } from '../../core/textures/TextureMapping';

type Point3 = { x: number; y: number; z: number };
type Point2 = { x: number; y: number };
export function slopeFaceVertices(op: Opening, face: CalculatedSlopePiece): [Point3, Point3, Point3, Point3] {
  const horizontal = face.side === 'TOP' || face.side === 'BOTTOM';
  const start = (horizontal ? op.x : op.y) + (face.startInset ?? 0), end = start + face.width;
  const z0 = face.zStart ?? 0, z1 = face.zEnd ?? face.depth;
  if (horizontal) {
    const y = op.y + (face.side === 'TOP' ? op.height : 0);
    return [{ x: start, y, z: z0 }, { x: end, y, z: z0 }, { x: end, y, z: z1 }, { x: start, y, z: z1 }];
  }
  const x = op.x + (face.side === 'RIGHT' ? op.width : 0);
  return [{ x, y: start, z: z0 }, { x, y: start, z: z1 }, { x, y: end, z: z1 }, { x, y: end, z: z0 }];
}

/** The interactive 3D view and PDF use the same physical faces and profile tracks. */
export function drawOpeningSlopes(ctx: CanvasRenderingContext2D, op: Opening, faces: CalculatedSlopePiece[], joints: CalculatedSlopeJoint[],
  project: (point: Point3) => Point2, options: { textures: boolean; profiles: boolean; selectedCorner?: SlopeJointId }) {
  const polygon = (points: Point3[], fill: string) => {
    const projected = points.map(project);
    ctx.beginPath(); ctx.moveTo(projected[0].x, projected[0].y);
    projected.slice(1).forEach(p => ctx.lineTo(p.x, p.y)); ctx.closePath(); ctx.fillStyle = fill; ctx.fill();
    return projected;
  };
  ctx.save();
  for (const face of faces.filter(f => f.openingId === op.id)) {
    const vertices = slopeFaceVertices(op, face);
    const points = polygon(vertices, face.materialColor);
    const texture = options.textures && getPieceTexture(slopeTexturePiece(face));
    if (texture) drawTextureFace(ctx, texture, points[0], points[1], points[2], points[3]);
    // A shallow shade retains the shape even with a uniform material.
    polygon(vertices, face.side === 'TOP' ? 'rgba(0,0,0,0.25)' : face.side === 'LEFT' ? 'rgba(0,0,0,0.15)' : 'rgba(0,0,0,0.06)');
    if (face.zStart !== undefined && face.zStart < 0 && face.side === 'BOTTOM') {
      const thickness = face.thickness ?? 8;
      polygon([vertices[0], vertices[1], { ...vertices[1], y: vertices[1].y - thickness }, { ...vertices[0], y: vertices[0].y - thickness }], face.materialColor);
    }
  }
  if (options.profiles) for (const joint of joints.filter(j => j.openingId === op.id && j.available)) {
    const selected = options.selectedCorner === joint.corner;
    const dx = joint.sides[1] === 'left' ? 1 : -1, dy = joint.sides[0] === 'bottom' ? 1 : -1;
    const first = joint.takeSide === 'SECOND' ? 0 : joint.visibleWidth / (joint.takeSide === 'BOTH' ? 2 : 1);
    const second = joint.visibleWidth - first;
    if (slopeJointHasProfile(joint)) {
      const color = joint.profileColor ?? '#212529';
      const p0 = { x: joint.x, y: joint.y, z: joint.zStart }, p1 = { ...p0, z: joint.zEnd };
      if (first > 0) polygon([p0, p1, { ...p1, x: p1.x + dx * first }, { ...p0, x: p0.x + dx * first }], color);
      if (second > 0) polygon([p0, p1, { ...p1, y: p1.y + dy * second }, { ...p0, y: p0.y + dy * second }], color);
    }
    if (joint.isLED || selected || (!joint.profileArticle && joint.width > 0)) {
      const a = project({ x: joint.x, y: joint.y, z: joint.zStart }), b = project({ x: joint.x, y: joint.y, z: joint.zEnd });
      ctx.save(); ctx.strokeStyle = selected ? '#339af0' : joint.isLED ? '#fff3bf' : '#212529';
      ctx.lineWidth = selected ? 3 : 1.5;
      if (joint.isLED) { ctx.shadowColor = '#ffd43b'; ctx.shadowBlur = 8; }
      if (!slopeJointHasProfile(joint)) ctx.setLineDash([4, 3]);
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke(); ctx.restore();
    }
  }
  ctx.restore();
}
