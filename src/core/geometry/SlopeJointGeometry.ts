import { ensureOpeningSlopes, type Opening, type SlopeJointConfig, type SlopeJointId, type SlopeJoints, type SlopeSide } from '../models/Opening';
import { DEFAULT_PROFILES, findProfileByArticle } from '../models/Profile';

export const SLOPE_JOINTS: ReadonlyArray<{ id: SlopeJointId; sides: readonly [SlopeSide, SlopeSide]; label: string }> = [
  { id: 'top-left', sides: ['top', 'left'], label: 'Верхний + левый' },
  { id: 'top-right', sides: ['top', 'right'], label: 'Верхний + правый' },
  { id: 'bottom-left', sides: ['bottom', 'left'], label: 'Нижний + левый' },
  { id: 'bottom-right', sides: ['bottom', 'right'], label: 'Нижний + правый' },
];
export const SLOPE_SIDE_LABELS: Record<SlopeSide, string> = { top: 'Верхний', bottom: 'Нижний', left: 'Левый', right: 'Правый' };
const nonNegative = (value: number) => Number.isFinite(value) ? Math.max(0, value) : 0;

/** Legacy settings remain readable without mutating the opening on selection/render. */
export function resolveSlopeJoints(op: Opening): SlopeJoints {
  const slopes = ensureOpeningSlopes(op);
  const type = slopes.jointProfileType ?? 'NONE';
  const legacy = type === 'NONE' ? undefined : DEFAULT_PROFILES[type];
  const articles = { CORNER: 'MC-02', LED_10: 'DL-13', JOINT_3: 'MC-06', JOINT_7: 'MC-06-7', JOINT_8: 'DL-01' };
  return Object.fromEntries(SLOPE_JOINTS.map(({ id }) => {
    const stored = slopes.joints?.[id];
    const config: SlopeJointConfig = stored ? {
      width: Math.min(100, nonNegative(stored.width)),
      takeSide: stored.takeSide === 'FIRST' || stored.takeSide === 'SECOND' ? stored.takeSide : 'BOTH',
      profileArticle: stored.profileArticle || undefined,
      profileColor: stored.profileColor || '#212529',
      isLED: !!stored.isLED,
    } : {
      // Old profiles never cut slope parts. Keep their geometry when importing.
      width: 0, takeSide: 'BOTH', isLED: type === 'LED_10',
      profileArticle: legacy && type !== 'NONE' ? articles[type] : undefined,
      profileColor: '#212529',
    };
    return [id, config];
  })) as SlopeJoints;
}

export interface SlopeFaceGeometry {
  side: SlopeSide;
  enabled: boolean;
  depth: number;
  zStart: number;
  zEnd: number;
  startInset: number; // Along X for horizontal slopes, along Y from floor for vertical slopes.
  endInset: number;
  length: number;
}
export interface CalculatedSlopeJoint extends SlopeJointConfig {
  id: string;
  openingId: string;
  corner: SlopeJointId;
  sides: readonly [SlopeSide, SlopeSide];
  name: string;
  available: boolean;
  unavailableReason?: string;
  x: number;
  y: number;
  zStart: number;
  zEnd: number;
  length: number;
  visibleWidth: number;
}

/** Slope depths are measured from the facade; surplus depth projects into the room. */
export function calculateSlopeGeometry(op: Opening) {
  const slopes = ensureOpeningSlopes(op);
  const openingDepth = nonNegative(op.depth ?? (op.type === 'WINDOW' ? 200 : op.type === 'TV_ZONE' ? 0 : 150));
  const configs = resolveSlopeJoints(op);
  const faces = Object.fromEntries((['top', 'bottom', 'left', 'right'] as const).map(side => {
    const depth = nonNegative(slopes.fitToOpeningDepth ? openingDepth : slopes.depthMode === 'SAME' ? slopes.depth : slopes[side].depth);
    return [side, { side, depth, zStart: Math.min(0, openingDepth - depth), zEnd: Math.min(openingDepth, depth),
      enabled: op.isCutout !== false && slopes.enabled && slopes[side].enabled && depth > 0 && op.width > 0 && op.height > 0,
      startInset: 0, endInset: 0, length: nonNegative(side === 'top' || side === 'bottom' ? op.width : op.height),
    }];
  })) as Record<SlopeSide, SlopeFaceGeometry>;
  const joints: CalculatedSlopeJoint[] = SLOPE_JOINTS.map(({ id, sides, label }) => {
    const [a, b] = sides.map(side => faces[side]);
    const zStart = Math.max(a.zStart, b.zStart), zEnd = Math.min(a.zEnd, b.zEnd);
    const available = a.enabled && b.enabled && zEnd > zStart;
    const config = configs[id];
    if (available) {
      const first = config.takeSide === 'SECOND' ? 0 : config.width / (config.takeSide === 'BOTH' ? 2 : 1);
      const second = config.width - first;
      a[sides[1] === 'left' ? 'startInset' : 'endInset'] += first;
      b[sides[0] === 'bottom' ? 'startInset' : 'endInset'] += second;
    }
    return { ...config, id: `slope-joint-${op.id}-${id}`, openingId: op.id, corner: id, sides,
      name: label, available, unavailableReason: !a.enabled || !b.enabled ? 'Нужны оба включённых откоса с ненулевой глубиной' : !available ? 'У откосов нет общей границы' : undefined,
      x: op.x + (sides[1] === 'right' ? op.width : 0), y: op.y + (sides[0] === 'top' ? op.height : 0),
      zStart, zEnd, length: available ? zEnd - zStart : 0,
      visibleWidth: findProfileByArticle(config.profileArticle ?? '')?.visibleWidth ?? config.width,
    };
  });
  for (const face of Object.values(faces)) face.length = Math.max(0, face.length - face.startInset - face.endInset);
  return { faces, joints };
}

export function slopeJointHasProfile(joint: SlopeJointConfig): boolean {
  return !!joint.profileArticle || joint.isLED;
}

/** One transaction for a single corner or every currently available corner. */
export function patchSlopeJoints(op: Opening, corner: SlopeJointId, patch: Partial<SlopeJointConfig>, all = false): Opening {
  const geometry = calculateSlopeGeometry(op);
  if (!geometry.joints.find(j => j.corner === corner)?.available) return op;
  if (patch.width !== undefined && (!Number.isFinite(patch.width) || patch.width < 0 || patch.width > 100)) throw new Error('Зазор должен быть от 0 до 100 мм.');
  const joints = resolveSlopeJoints(op);
  const config = { ...joints[corner], ...patch };
  if (Object.prototype.hasOwnProperty.call(patch, 'profileArticle')) {
    config.profileArticle = patch.profileArticle || undefined;
    const profile = findProfileByArticle(config.profileArticle ?? '');
    config.isLED = !!(profile?.isLEDCompatible || profile?.category === 'LED');
  }
  for (const joint of geometry.joints) if (joint.available && (all || joint.corner === corner)) joints[joint.corner] = { ...config };
  const next = { ...op, slopes: { ...ensureOpeningSlopes(op), joints } };
  const nextGeometry = calculateSlopeGeometry(next);
  if (Object.values(nextGeometry.faces).some(f => f.enabled && f.length <= 0)) throw new Error('Зазор полностью убирает откос. Уменьшите зазор или измените сторону подрезки.');
  return next;
}
